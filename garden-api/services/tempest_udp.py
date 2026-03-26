"""Tempest WeatherFlow local UDP listener.

Listens on UDP port 50222 for broadcast messages from Tempest stations
on the local network. Zero cloud dependency — real-time observations
directly from the hardware.
"""
import asyncio
import json
import logging
import time
from datetime import datetime

logger = logging.getLogger(__name__)

# Latest observation cache (updated by UDP listener)
_latest_obs = {}
_listener_running = False

# obs_st field indices (from Tempest UDP API docs)
# [epoch, wind_lull, wind_avg, wind_gust, wind_dir, wind_interval,
#  pressure, temperature_C, humidity, illuminance, uv_index,
#  solar_radiation, rain_minute, precip_type, lightning_avg_dist,
#  lightning_count, battery, report_interval, local_daily_rain,
#  rain_final, local_daily_rain_final, precip_analysis_type]


def _parse_obs_st(obs: list, serial: str) -> dict:
    """Parse an obs_st observation array into a readable dict."""
    if len(obs) < 18:
        return {}
    return {
        "timestamp": obs[0],
        "wind_lull_mph": round(obs[1] * 2.237, 1) if obs[1] is not None else None,
        "wind_avg_mph": round(obs[2] * 2.237, 1) if obs[2] is not None else None,
        "wind_gust_mph": round(obs[3] * 2.237, 1) if obs[3] is not None else None,
        "wind_direction": obs[4],
        "pressure_inhg": round(obs[6] * 0.02953, 2) if obs[6] is not None else None,
        "temperature_f": round(obs[7] * 9 / 5 + 32, 1) if obs[7] is not None else None,
        "humidity": obs[8],
        "illuminance": obs[9],
        "uv_index": obs[10],
        "solar_radiation": obs[11],
        "rain_last_minute_in": round(obs[12] * 0.03937, 3) if obs[12] is not None else None,
        "battery_volts": obs[16],
        "daily_rain_in": round(obs[18] * 0.03937, 2) if len(obs) > 18 and obs[18] is not None else None,
        "serial": serial,
        "received_at": datetime.utcnow().isoformat(),
    }


class TempestUDPProtocol(asyncio.DatagramProtocol):
    def datagram_received(self, data, addr):
        global _latest_obs
        try:
            msg = json.loads(data.decode())
            msg_type = msg.get("type")
            serial = msg.get("serial_number", "")

            if msg_type == "obs_st" and msg.get("obs"):
                obs = msg["obs"][0]
                parsed = _parse_obs_st(obs, serial)
                if parsed:
                    _latest_obs = parsed
                    logger.debug(
                        "Tempest UDP obs: %.1f\u00b0F, %d%% humidity",
                        parsed.get("temperature_f"),
                        parsed.get("humidity"),
                    )
            elif msg_type == "rapid_wind":
                # Update wind only
                if msg.get("ob") and len(msg["ob"]) >= 3:
                    _latest_obs["wind_avg_mph"] = round(msg["ob"][1] * 2.237, 1)
                    _latest_obs["wind_direction"] = msg["ob"][2]
        except Exception as exc:
            logger.debug("Tempest UDP parse error: %s", exc)


async def start_udp_listener(port: int = 50222):
    """Start listening for Tempest UDP broadcasts."""
    global _listener_running
    if _listener_running:
        return

    loop = asyncio.get_event_loop()
    try:
        transport, protocol = await loop.create_datagram_endpoint(
            TempestUDPProtocol,
            local_addr=("0.0.0.0", port),
            allow_broadcast=True,
        )
        _listener_running = True
        logger.info("Tempest UDP listener started on port %d", port)
    except Exception as exc:
        logger.warning("Could not start Tempest UDP listener: %s", exc)


def get_latest_observation() -> dict:
    """Get the most recent observation from the UDP listener."""
    return dict(_latest_obs) if _latest_obs else {}


def is_receiving() -> bool:
    """Check if we're actively receiving UDP data."""
    if not _latest_obs:
        return False
    received = _latest_obs.get("received_at", "")
    if not received:
        return False
    try:
        last = datetime.fromisoformat(received)
        return (datetime.utcnow() - last).total_seconds() < 300  # 5 min timeout
    except Exception:
        return False
