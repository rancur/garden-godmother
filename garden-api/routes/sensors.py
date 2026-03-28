"""Weather, irrigation, sensor data endpoints."""
from __future__ import annotations

import json
import os
import time
import asyncio
import logging
import math
from datetime import date, datetime, timedelta
from typing import Optional

import httpx
from fastapi import APIRouter, HTTPException, Query, Request
from fastapi.responses import Response

from db import get_db
from auth import require_user, require_admin
from services.integrations import get_ha_config, get_rachio_config, get_hose_timer_config, get_integration_config

logger = logging.getLogger(__name__)

router = APIRouter()

# ──────────────── ZONE INFO ────────────────

@router.get("/api/zone")
def get_zone_info():
    with get_db() as db:
        rows = db.execute("SELECT key, value FROM zone_info").fetchall()
        return {r["key"]: r["value"] for r in rows}


# ──────────────── HOME ASSISTANT SENSORS ────────────────

# HA_URL and HA_TOKEN are now dynamically resolved via get_ha_config()
# These module-level vars serve as initial defaults for backward compat
# Configure via Settings > Integrations — this default is only used if no config exists
HA_URL = "http://homeassistant.local:8123"
HA_TOKEN = os.environ.get("HA_TOKEN", "")

# Simple in-memory cache: {key: (timestamp, data)}
_ha_cache: dict[str, tuple[float, dict]] = {}
HA_CACHE_TTL = 60  # seconds

# Tempest weather entity IDs — update these to match your Home Assistant entity names
WEATHER_ENTITY = "weather.my_weather_station"
WEATHER_SENSORS = {
    "temperature": "sensor.my_weather_station_air_temperature",
    "humidity": "sensor.my_weather_station_relative_humidity",
    "wind_speed": "sensor.my_weather_station_wind_speed",
    "wind_gust": "sensor.my_weather_station_wind_gust",
    "wind_direction": "sensor.my_weather_station_wind_direction",
    "uv_index": "sensor.my_weather_station_uv_index",
    "solar_radiation": "sensor.my_weather_station_solar_radiation",
    "rain_today": "sensor.my_weather_station_rain_accumulation_today",
    "rain_yesterday": "sensor.my_weather_station_rain_accumulation_yesterday",
    "rain_intensity": "sensor.my_weather_station_rain_intensity",
    "pressure": "sensor.my_weather_station_station_pressure",
    "pressure_trend": "sensor.my_weather_station_pressure_trend",
    "dew_point": "sensor.my_weather_station_dew_point",
    "feels_like": "sensor.my_weather_station_feels_like",
    "brightness": "sensor.my_weather_station_brightness",
    "lightning_count": "sensor.my_weather_station_lightning_strike_count",
}

# Rachio entities
RACHIO_ENTITIES = {
    "controller": "device_tracker.rachio_7d02c6",
    "calendar": "calendar.rachio_base_station_ca455278",
}

# Soil moisture sensors
MOISTURE_SENSORS = {
    "west_planter": {
        "soil_moisture": "sensor.third_reality_inc_3rsm0147z_soil_moisture",
        "temperature": "sensor.third_reality_inc_3rsm0147z_temperature",
        "humidity": "sensor.third_reality_inc_3rsm0147z_humidity",
        "battery": "sensor.third_reality_inc_3rsm0147z_battery",
    },
    "north_planter": {
        "soil_moisture": "sensor.north_planter_moisture_sensor_soil_moisture",
        "temperature": "sensor.north_planter_moisture_sensor_temperature",
        "humidity": "sensor.north_planter_moisture_sensor_humidity",
        "battery": "sensor.north_planter_moisture_sensor_battery",
    },
    "peach_tree": {
        "soil_moisture": "sensor.third_reality_inc_3rsm0147z_soil_moisture_2",
        "temperature": "sensor.third_reality_inc_3rsm0147z_temperature_2",
        "humidity": "sensor.third_reality_inc_3rsm0147z_humidity_2",
        "battery": "sensor.third_reality_inc_3rsm0147z_battery_2",
    },
}


def _ha_headers() -> dict:
    ha = get_ha_config()
    return {"Authorization": f"Bearer {ha['token']}", "Content-Type": "application/json"}

def _ha_url() -> str:
    return get_ha_config()["url"]

def _ha_is_configured() -> bool:
    return bool(get_ha_config()["token"])


async def _ha_get_state(entity_id: str) -> Optional[dict]:
    """Fetch a single entity state from HA REST API with caching."""
    cache_key = f"state:{entity_id}"
    now = time.time()
    if cache_key in _ha_cache:
        ts, data = _ha_cache[cache_key]
        if now - ts < HA_CACHE_TTL:
            return data

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            r = await client.get(
                f"{_ha_url()}/api/states/{entity_id}",
                headers=_ha_headers(),
            )
            if r.status_code == 200:
                data = r.json()
                _ha_cache[cache_key] = (now, data)
                return data
            logger.warning("HA returned %s for %s", r.status_code, entity_id)
            return None
    except Exception as exc:
        logger.warning("HA request failed for %s: %s", entity_id, exc)
        return None


async def _ha_get_states_bulk(entity_ids: list[str]) -> dict[str, Optional[dict]]:
    """Fetch multiple entity states, using cache where possible."""
    results: dict[str, Optional[dict]] = {}
    to_fetch: list[str] = []
    now = time.time()

    for eid in entity_ids:
        cache_key = f"state:{eid}"
        if cache_key in _ha_cache:
            ts, data = _ha_cache[cache_key]
            if now - ts < HA_CACHE_TTL:
                results[eid] = data
                continue
        to_fetch.append(eid)

    if to_fetch:
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                tasks = [
                    client.get(f"{_ha_url()}/api/states/{eid}", headers=_ha_headers())
                    for eid in to_fetch
                ]
                import asyncio
                responses = await asyncio.gather(*tasks, return_exceptions=True)
                for eid, resp in zip(to_fetch, responses):
                    if isinstance(resp, Exception):
                        logger.warning("HA request failed for %s: %s", eid, resp)
                        results[eid] = None
                    elif resp.status_code == 200:
                        data = resp.json()
                        _ha_cache[f"state:{eid}"] = (now, data)
                        results[eid] = data
                    else:
                        results[eid] = None
        except Exception as exc:
            logger.warning("HA bulk request failed: %s", exc)
            for eid in to_fetch:
                results[eid] = None

    return results


def _safe_float(value: Optional[str], default: Optional[float] = None) -> Optional[float]:
    if value is None or value in ("unavailable", "unknown", ""):
        return default
    try:
        return round(float(value), 2)
    except (ValueError, TypeError):
        return default


# ──────────────── SENSOR ENTITY MAPPINGS ────────────────

SENSOR_ROLES = ['outdoor_temperature', 'outdoor_humidity', 'wind_speed', 'rain_accumulation',
                'soil_moisture', 'soil_temperature', 'uv_index', 'solar_radiation']


def _get_entity_mappings() -> dict:
    """Load HA entity mappings from app_config."""
    with get_db() as db:
        row = db.execute("SELECT value FROM app_config WHERE key = 'ha_entity_mappings'").fetchone()
        return json.loads(row["value"]) if row else {}


def _mapped_entity(role: str, fallback: str = "") -> str:
    """Get the mapped entity ID for a sensor role, or return the fallback."""
    mappings = _get_entity_mappings()
    return mappings.get(role, fallback)


# ──────────────── WEATHER PROVIDER HELPERS ────────────────

def _wmo_code_to_condition(code):
    conditions = {0: "Clear", 1: "Mainly Clear", 2: "Partly Cloudy", 3: "Overcast",
                  45: "Foggy", 48: "Foggy", 51: "Light Drizzle", 53: "Drizzle", 55: "Heavy Drizzle",
                  61: "Light Rain", 63: "Rain", 65: "Heavy Rain", 71: "Light Snow", 73: "Snow",
                  80: "Light Showers", 81: "Showers", 82: "Heavy Showers", 95: "Thunderstorm"}
    return conditions.get(code, "Unknown")


def _wmo_code_to_icon(code):
    icons = {0: "\u2600\ufe0f", 1: "\U0001f324\ufe0f", 2: "\u26c5", 3: "\u2601\ufe0f", 45: "\U0001f32b\ufe0f", 48: "\U0001f32b\ufe0f",
             51: "\U0001f326\ufe0f", 53: "\U0001f327\ufe0f", 55: "\U0001f327\ufe0f", 61: "\U0001f327\ufe0f", 63: "\U0001f327\ufe0f", 65: "\U0001f327\ufe0f",
             71: "\U0001f328\ufe0f", 73: "\u2744\ufe0f", 80: "\U0001f326\ufe0f", 81: "\U0001f327\ufe0f", 82: "\u26c8\ufe0f", 95: "\u26c8\ufe0f"}
    return icons.get(code, "\U0001f321\ufe0f")


async def _fetch_tempest_forecast(config: dict, days: int) -> list[dict]:
    """Fetch forecast from Tempest WeatherFlow API."""
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.get(
                f"https://swd.weatherflow.com/swd/rest/better_forecast?station_id={config['station_id']}&token={config['api_token']}&units_temp=f&units_wind=mph&units_pressure=inhg&units_precip=in"
            )
            if resp.status_code == 200:
                data = resp.json()
                forecast = data.get("forecast", {}).get("daily", [])[:days]
                icon_map = {"clear-day": "☀️", "clear-night": "🌙", "cloudy": "☁️",
                            "partly-cloudy-day": "⛅", "partly-cloudy-night": "☁️",
                            "rain": "🌧️", "thunderstorm": "⛈️", "wind": "💨",
                            "fog": "🌫️", "snow": "❄️"}
                results = []
                for d in forecast:
                    day_epoch = d.get("day_start_local", 0)
                    day_date = datetime.fromtimestamp(day_epoch).strftime("%Y-%m-%d") if isinstance(day_epoch, (int, float)) and day_epoch > 0 else ""
                    results.append({
                        "date": day_date,
                        "high_f": d.get("air_temp_high"),
                        "low_f": d.get("air_temp_low"),
                        "condition": d.get("conditions", ""),
                        "precipitation_probability": d.get("precip_probability", 0),
                        "icon": icon_map.get(d.get("icon", ""), "🌡️"),
                    })
                return results
    except Exception as exc:
        logger.warning("Tempest forecast fetch failed: %s", exc)
    return []


async def _fetch_openmeteo_forecast(days: int) -> list[dict]:
    """Fetch forecast from Open-Meteo (free, no API key)."""
    with get_db() as db:
        prop = db.execute("SELECT latitude, longitude FROM property WHERE id = 1").fetchone()
        if not prop or not prop["latitude"]:
            return []
        lat, lon = prop["latitude"], prop["longitude"]

    try:
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.get(
                f"https://api.open-meteo.com/v1/forecast?latitude={lat}&longitude={lon}&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max,weathercode&temperature_unit=fahrenheit&precipitation_unit=inch&forecast_days={days}&timezone=auto"
            )
            if resp.status_code == 200:
                data = resp.json()
                daily = data.get("daily", {})
                dates = daily.get("time", [])
                return [{"date": dates[i],
                         "high_f": daily.get("temperature_2m_max", [None])[i],
                         "low_f": daily.get("temperature_2m_min", [None])[i],
                         "precipitation_probability": daily.get("precipitation_probability_max", [0])[i],
                         "condition": _wmo_code_to_condition(daily.get("weathercode", [0])[i]),
                         "icon": _wmo_code_to_icon(daily.get("weathercode", [0])[i])} for i in range(len(dates))]
    except Exception as exc:
        logger.warning("Open-Meteo forecast fetch failed: %s", exc)
    return []


async def _fetch_owm_forecast(config: dict, days: int) -> list[dict]:
    """Fetch forecast from OpenWeatherMap."""
    with get_db() as db:
        prop = db.execute("SELECT latitude, longitude FROM property WHERE id = 1").fetchone()
        if not prop or not prop["latitude"]:
            return []
        lat, lon = prop["latitude"], prop["longitude"]

    try:
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.get(
                f"https://api.openweathermap.org/data/2.5/forecast/daily?lat={lat}&lon={lon}&cnt={days}&appid={config['api_key']}&units=imperial"
            )
            if resp.status_code == 200:
                data = resp.json()
                return [{"date": datetime.fromtimestamp(d["dt"]).strftime("%Y-%m-%d"),
                         "high_f": d.get("temp", {}).get("max"),
                         "low_f": d.get("temp", {}).get("min"),
                         "precipitation_probability": round((d.get("pop", 0) or 0) * 100),
                         "condition": d.get("weather", [{}])[0].get("description", "").title(),
                         "icon": d.get("weather", [{}])[0].get("icon", "")} for d in data.get("list", [])[:days]]
    except Exception as exc:
        logger.warning("OWM forecast fetch failed: %s", exc)
    return []


async def _fetch_ha_forecast(days: int) -> list[dict]:
    """Fetch forecast from Home Assistant weather entity."""
    if not _ha_is_configured():
        return []

    CONDITION_ICONS = {
        "sunny": "\u2600\ufe0f", "clear": "\u2600\ufe0f", "clear-night": "\U0001f319",
        "partlycloudy": "\u26c5", "cloudy": "\u2601\ufe0f", "rainy": "\U0001f327\ufe0f",
        "pouring": "\U0001f327\ufe0f", "lightning": "\u26c8\ufe0f", "lightning-rainy": "\u26c8\ufe0f",
        "hail": "\U0001f327\ufe0f", "snowy": "\U0001f328\ufe0f", "snowy-rainy": "\U0001f328\ufe0f",
        "windy": "\U0001f4a8", "windy-variant": "\U0001f4a8", "fog": "\U0001f32b\ufe0f",
        "exceptional": "\u26a0\ufe0f",
    }

    forecast_data = None
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            r = await client.post(
                f"{_ha_url()}/api/services/weather/get_forecasts?return_response",
                headers=_ha_headers(),
                json={"entity_id": WEATHER_ENTITY, "type": "daily"},
            )
            if r.status_code == 200:
                resp = r.json()
                sr = resp.get("service_response", resp)
                entity_data = sr.get(WEATHER_ENTITY, {})
                forecast_data = entity_data.get("forecast", [])
    except Exception as exc:
        logger.warning("HA get_forecasts service failed: %s", exc)

    if not forecast_data:
        state = await _ha_get_state(WEATHER_ENTITY)
        if state:
            forecast_data = state.get("attributes", {}).get("forecast", [])

    if not forecast_data:
        return []

    from datetime import datetime as _dt
    result = []
    for entry in forecast_data[:days]:
        dt_str = entry.get("datetime", "")
        try:
            dt_obj = _dt.fromisoformat(dt_str.replace("Z", "+00:00"))
            date_str = dt_obj.strftime("%Y-%m-%d")
        except Exception:
            date_str = dt_str[:10] if len(dt_str) >= 10 else dt_str

        condition = (entry.get("condition") or "").lower()
        icon = CONDITION_ICONS.get(condition, "\u2600\ufe0f")
        high = entry.get("temperature")
        low = entry.get("templow")
        precip_prob = entry.get("precipitation_probability", 0)

        result.append({
            "date": date_str,
            "high_f": round(high) if high is not None else None,
            "low_f": round(low) if low is not None else None,
            "precipitation_probability": precip_prob,
            "condition": condition or entry.get("condition", "unknown"),
            "icon": icon,
        })
    return result


async def fetch_weather_forecast(days: int = 7) -> list[dict]:
    """Fetch weather forecast from the configured weather provider."""
    # Check which weather providers are configured (priority order)
    config = get_integration_config("weather_tempest")
    if config and config.get("api_token"):
        result = await _fetch_tempest_forecast(config, days)
        if result:
            return result

    config = get_integration_config("weather_openmeteo")
    if config is not None and config != {}:
        result = await _fetch_openmeteo_forecast(days)
        if result:
            return result

    config = get_integration_config("weather_openweathermap")
    if config and config.get("api_key"):
        result = await _fetch_owm_forecast(config, days)
        if result:
            return result

    # Fallback to HA if configured
    if _ha_is_configured():
        return await _fetch_ha_forecast(days)

    return []


def _fetch_forecast_sync(days: int = 7) -> list[dict]:
    """Fetch daily forecast from HA synchronously. Returns list of forecast day dicts.

    Each dict has keys: date, high_f, low_f, precipitation_in, precipitation_probability,
    wind_speed_mph, condition.
    """
    if not _ha_is_configured():
        return []
    try:
        with httpx.Client(timeout=10.0) as client:
            r = client.post(
                f"{_ha_url()}/api/services/weather/get_forecasts?return_response",
                headers=_ha_headers(),
                json={"entity_id": WEATHER_ENTITY, "type": "daily"},
            )
            if r.status_code == 200:
                resp = r.json()
                sr = resp.get("service_response", resp)
                entity_data = sr.get(WEATHER_ENTITY, {})
                forecast_data = entity_data.get("forecast", [])
            else:
                forecast_data = []
    except Exception:
        forecast_data = []

    # Fallback: entity state attributes (sync fetch)
    if not forecast_data:
        try:
            with httpx.Client(timeout=10.0) as client:
                r = client.get(
                    f"{_ha_url()}/api/states/{WEATHER_ENTITY}",
                    headers=_ha_headers(),
                )
                if r.status_code == 200:
                    attrs = r.json().get("attributes", {})
                    forecast_data = attrs.get("forecast", [])
        except Exception:
            forecast_data = []

    if not forecast_data:
        return []

    from datetime import datetime as _dt
    result = []
    for entry in forecast_data[:days]:
        dt_str = entry.get("datetime", "")
        try:
            dt_obj = _dt.fromisoformat(dt_str.replace("Z", "+00:00"))
            date_str = dt_obj.strftime("%Y-%m-%d")
        except Exception:
            date_str = dt_str[:10] if len(dt_str) >= 10 else dt_str

        high = entry.get("temperature")
        low = entry.get("templow")
        # HA forecast: precipitation is in inches or mm depending on config; Tempest typically inches
        precip = entry.get("precipitation", 0) or 0
        precip_prob = entry.get("precipitation_probability", 0) or 0
        wind = entry.get("wind_speed", 0) or 0
        condition = (entry.get("condition") or "").lower()

        result.append({
            "date": date_str,
            "high_f": round(float(high)) if high is not None else None,
            "low_f": round(float(low)) if low is not None else None,
            "precipitation_in": round(float(precip), 2),
            "precipitation_probability": round(float(precip_prob)),
            "wind_speed_mph": round(float(wind), 1),
            "condition": condition,
        })
    return result


def _analyze_forecast_weather(forecast: list[dict], current_temp: Optional[float] = None,
                               current_wind: Optional[float] = None,
                               current_rain: float = 0.0) -> dict:
    """Analyze forecast data and return weather-based task adjustment insights.

    Returns dict with keys:
      rain_forecast_2d: total rain in next 2 days (inches)
      rain_skip: bool -- should we skip watering today?
      rain_skip_reason: str or None
      heat_wave: bool -- 3+ consecutive days above 105F
      heat_wave_temps: list of temps
      frost_risk: bool -- any day in next 3 with low < 40F
      frost_risk_temps: list of (date, low) tuples
      high_wind: bool -- current wind > 20mph
      high_wind_speed: float or None
      today_high: float or None
      insights: list of human-readable insight strings
    """
    result = {
        "rain_forecast_2d": 0.0,
        "rain_skip": False,
        "rain_skip_reason": None,
        "heat_wave": False,
        "heat_wave_temps": [],
        "frost_risk": False,
        "frost_risk_temps": [],
        "high_wind": False,
        "high_wind_speed": current_wind,
        "today_high": None,
        "insights": [],
    }

    if not forecast:
        return result

    # Today's high from forecast
    if forecast and forecast[0].get("high_f") is not None:
        result["today_high"] = forecast[0]["high_f"]

    # Rain in next 2 days
    rain_2d = 0.0
    rain_details = []
    for day in forecast[:2]:
        precip = day.get("precipitation_in", 0) or 0
        rain_2d += precip
        if precip > 0:
            rain_details.append(f"{precip}in on {day['date']}")
    result["rain_forecast_2d"] = round(rain_2d, 2)

    if rain_2d > 0.25:
        result["rain_skip"] = True
        result["rain_skip_reason"] = f"Skipped watering \u2014 {rain_2d}in rain forecast ({', '.join(rain_details)})"
        result["insights"].append(result["rain_skip_reason"])

    # Also check if tomorrow specifically has rain (even if today doesn't)
    if len(forecast) >= 2:
        tomorrow_rain = forecast[1].get("precipitation_in", 0) or 0
        if tomorrow_rain > 0.25 and not result["rain_skip"]:
            result["rain_skip"] = True
            result["rain_skip_reason"] = f"Skipped watering \u2014 {tomorrow_rain}in rain forecast tomorrow"
            result["insights"].append(result["rain_skip_reason"])

    # Heat wave: 3+ days above 105F
    heat_temps = []
    for day in forecast[:5]:
        high = day.get("high_f")
        if high is not None and high > 105:
            heat_temps.append(round(high))
        else:
            if len(heat_temps) >= 3:
                break
            heat_temps = []
    if len(heat_temps) >= 3:
        result["heat_wave"] = True
        result["heat_wave_temps"] = heat_temps[:5]
        temps_str = ", ".join(f"{t}\u00b0F" for t in heat_temps[:5])
        result["insights"].append(f"Heat wave forecast \u2014 {len(heat_temps)} days above 105\u00b0F ({temps_str})")

    # Frost risk: next 3 days low < 40F
    frost_temps = []
    for day in forecast[:3]:
        low = day.get("low_f")
        if low is not None and low < 40:
            frost_temps.append((day["date"], round(low)))
    if frost_temps:
        result["frost_risk"] = True
        result["frost_risk_temps"] = frost_temps
        frost_str = ", ".join(f"{d}: {t}\u00b0F" for d, t in frost_temps)
        result["insights"].append(f"Frost risk \u2014 lows below 40\u00b0F ({frost_str})")

    # High wind (current sensor or today's forecast)
    wind_val = current_wind
    if wind_val is None and forecast:
        wind_val = forecast[0].get("wind_speed_mph")
    if wind_val and wind_val > 20:
        result["high_wind"] = True
        result["high_wind_speed"] = round(wind_val, 1)
        result["insights"].append(f"High wind \u2014 {round(wind_val, 1)}mph. Secure plants/stakes, skip granular fertilizer.")

    return result


@router.get("/api/sensors/weather")
async def get_weather_sensors():
    """Pull current Tempest weather data from HA, using entity mappings when available."""
    if not _ha_is_configured():
        raise HTTPException(503, "Home Assistant not configured — add token in Settings > Integrations")

    # Build effective sensor map: prefer DB entity mappings, fall back to hardcoded defaults
    mappings = _get_entity_mappings()
    # Map from entity-mapping roles to the keys used in WEATHER_SENSORS / response
    _role_to_key = {
        "outdoor_temperature": "temperature",
        "outdoor_humidity": "humidity",
        "wind_speed": "wind_speed",
        "rain_accumulation": "rain_today",
        "uv_index": "uv_index",
        "solar_radiation": "solar_radiation",
    }
    effective_sensors = dict(WEATHER_SENSORS)  # start with hardcoded defaults
    for role, key in _role_to_key.items():
        mapped = mappings.get(role)
        if mapped:
            effective_sensors[key] = mapped

    # Derive the weather entity from the temperature entity prefix
    # e.g. sensor.curran_national_park_air_temperature -> weather.curran_national_park
    weather_entity = WEATHER_ENTITY
    temp_entity = mappings.get("outdoor_temperature", "")
    if temp_entity:
        # Strip "sensor." prefix and known suffixes to get the station name
        station_name = temp_entity.replace("sensor.", "")
        for suffix in ("_air_temperature", "_temperature"):
            if station_name.endswith(suffix):
                station_name = station_name[: -len(suffix)]
                break
        candidate = f"weather.{station_name}"
        if candidate != "weather.":
            weather_entity = candidate

    all_ids = list(effective_sensors.values()) + [weather_entity]
    states = await _ha_get_states_bulk(all_ids)

    weather_state = states.get(weather_entity)
    condition = None
    if weather_state:
        condition = weather_state.get("state")

    result = {"condition": condition}
    for key, entity_id in effective_sensors.items():
        st = states.get(entity_id)
        if st:
            result[key] = _safe_float(st.get("state"))
            attrs = st.get("attributes", {})
            unit = attrs.get("unit_of_measurement")
            if unit:
                result[f"{key}_unit"] = unit
        else:
            result[key] = None

    return result


@router.get("/api/sensors/forecast")
async def get_weather_forecast_endpoint():
    """Pull 7-day forecast from the best available weather provider."""
    DAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
    SHORT_DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]

    forecast = await fetch_weather_forecast(days=7)

    if not forecast:
        raise HTTPException(404, "No forecast data available — configure a weather provider in Settings > Integrations")

    # Enrich with day names if not already present
    from datetime import datetime as _dt
    for entry in forecast:
        if "day_name" not in entry:
            try:
                dt_obj = _dt.strptime(entry["date"], "%Y-%m-%d")
                entry["day_name"] = DAY_NAMES[dt_obj.weekday()]
                entry["short_day"] = SHORT_DAYS[dt_obj.weekday()]
            except Exception:
                entry["day_name"] = ""
                entry["short_day"] = ""

    return {"forecast": forecast}


@router.get("/api/sensors/tempest-local")
def get_tempest_local(request: Request):
    """Get the latest observation from the local Tempest UDP listener."""
    require_user(request)
    from services.tempest_udp import get_latest_observation, is_receiving
    obs = get_latest_observation()
    return {
        "receiving": is_receiving(),
        "observation": obs,
    }


@router.get("/api/sensors/rachio")
async def get_rachio_sensors():
    """Pull Rachio irrigation data from HA."""
    if not _ha_is_configured():
        raise HTTPException(503, "Home Assistant not configured — add token in Settings > Integrations")

    all_ids = list(RACHIO_ENTITIES.values())
    states = await _ha_get_states_bulk(all_ids)

    controller_state = states.get(RACHIO_ENTITIES["controller"])
    calendar_state = states.get(RACHIO_ENTITIES["calendar"])

    controller_info = None
    if controller_state:
        controller_info = {
            "status": controller_state.get("state"),
            "friendly_name": controller_state.get("attributes", {}).get("friendly_name"),
        }

    next_run = None
    if calendar_state:
        attrs = calendar_state.get("attributes", {})
        next_run = {
            "active": calendar_state.get("state") == "on",
            "message": attrs.get("message"),
            "start_time": attrs.get("start_time"),
            "end_time": attrs.get("end_time"),
            "description": attrs.get("description"),
        }

    return {
        "controller": controller_info,
        "next_scheduled_run": next_run,
        "note": "Rachio zone-level data not available in HA. Use Rachio app for zone control.",
    }


@router.get("/api/irrigation/zones")
async def get_irrigation_zones():
    """Fetch zones from Rachio cloud API."""
    rachio_key = _rachio_api_key()
    person_id = _rachio_person_id()

    async with httpx.AsyncClient() as client:
        resp = await client.get(
            f"https://api.rach.io/1/public/person/{person_id}",
            headers={"Authorization": f"Bearer {rachio_key}"},
            timeout=10,
        )
        if resp.status_code != 200:
            return {"zones": [], "error": "Failed to reach Rachio API"}

        data = resp.json()
        zones = []
        for device in data.get("devices", []):
            device_name = device.get("name", "Unknown")
            for zone in device.get("zones", []):
                if zone.get("enabled"):
                    zones.append({
                        "id": zone["id"],
                        "name": zone["name"],
                        "zone_number": zone.get("zoneNumber"),
                        "device_name": device_name,
                        "enabled": True,
                    })

        zones.sort(key=lambda z: z.get("zone_number", 0))

        # Also fetch Smart Hose Timer valves from cloud-rest API
        valves = []
        try:
            bs_resp = await client.get(
                f"https://cloud-rest.rach.io/valve/listBaseStations/{person_id}",
                headers={"Authorization": f"Bearer {rachio_key}"},
                timeout=10,
            )
            if bs_resp.status_code == 200:
                bs_data = bs_resp.json()
                for bs in bs_data.get("baseStations", []):
                    bs_id = bs["id"]
                    bs_name = bs.get("name", "Hose Timer")
                    v_resp = await client.get(
                        f"https://cloud-rest.rach.io/valve/listValves/{bs_id}",
                        headers={"Authorization": f"Bearer {rachio_key}"},
                        timeout=10,
                    )
                    if v_resp.status_code == 200:
                        v_data = v_resp.json()
                        for v in v_data.get("valves", []):
                            valves.append({
                                "id": v["id"],
                                "name": v.get("name", "Valve"),
                                "zone_number": None,
                                "device_name": bs_name,
                                "device_type": "hose_timer",
                                "enabled": True,
                            })
        except Exception:
            pass

        return {
            "zones": zones,
            "valves": valves,
            "device": data.get("devices", [{}])[0].get("name"),
        }


@router.get("/api/irrigation/summary")
async def get_irrigation_summary():
    """Returns per-bed irrigation info, beds needing manual watering, and automated vs manual counts."""
    with get_db() as db:
        beds = db.execute("SELECT id, name, irrigation_type, irrigation_zone_name, irrigation_schedule FROM garden_beds ORDER BY name").fetchall()
        trays = db.execute("SELECT id, name, irrigation_type, irrigation_zone_name FROM seed_trays ORDER BY name").fetchall()

    # Get Rachio calendar for next scheduled run
    next_run = None
    if _ha_is_configured():
        try:
            calendar_state = await _ha_get_state(RACHIO_ENTITIES["calendar"])
            if calendar_state:
                attrs = calendar_state.get("attributes", {})
                next_run = {
                    "active": calendar_state.get("state") == "on",
                    "message": attrs.get("message"),
                    "start_time": attrs.get("start_time"),
                    "end_time": attrs.get("end_time"),
                }
        except Exception:
            pass

    # Get current weather for manual watering decision
    temp_f = None
    rain_today_in = None
    if _ha_is_configured():
        try:
            weather_ids = [WEATHER_SENSORS["temperature"], WEATHER_SENSORS["rain_today"]]
            states = await _ha_get_states_bulk(weather_ids)
            temp_f = _safe_float(states.get(WEATHER_SENSORS["temperature"], {}).get("state") if states.get(WEATHER_SENSORS["temperature"]) else None)
            rain_today_in = _safe_float(states.get(WEATHER_SENSORS["rain_today"], {}).get("state") if states.get(WEATHER_SENSORS["rain_today"]) else None)
        except Exception:
            pass

    bed_list = []
    auto_count = 0
    manual_count = 0
    manual_needing_water = []

    with get_db() as db:
        for bed in beds:
            b = dict(bed)
            irr_type = b.get("irrigation_type") or "manual"

            # Get plants' water needs for this bed
            plant_waters = db.execute(
                """SELECT DISTINCT p.water FROM plantings pl
                   JOIN plants p ON pl.plant_id = p.id
                   WHERE pl.bed_id = ? AND pl.status NOT IN ('harvested', 'removed', 'failed')""",
                (b["id"],)
            ).fetchall()
            water_needs = [r["water"] for r in plant_waters if r["water"]]

            bed_info = {
                "id": b["id"],
                "name": b["name"],
                "irrigation_type": irr_type,
                "irrigation_zone_name": b.get("irrigation_zone_name"),
                "irrigation_schedule": b.get("irrigation_schedule"),
                "next_scheduled_run": next_run if irr_type in ("rachio_controller", "rachio_hose_timer") else None,
                "plant_water_needs": water_needs,
            }
            bed_list.append(bed_info)

            if irr_type in ("rachio_controller", "rachio_hose_timer"):
                auto_count += 1
            elif irr_type == "manual":
                manual_count += 1
                # Determine if manual watering needed today
                if water_needs:
                    needs_water = False
                    if rain_today_in is not None and rain_today_in > 0.25:
                        pass  # Recent rain, skip
                    elif temp_f is not None and temp_f > 100:
                        needs_water = True  # Extreme heat
                    elif "high" in water_needs:
                        needs_water = True  # High-water plants always need daily check
                    if needs_water:
                        manual_needing_water.append({"id": b["id"], "name": b["name"], "reason": f"temp={temp_f}F, rain={rain_today_in}in, needs={water_needs}"})

    tray_list = []
    for tray in trays:
        t = dict(tray)
        tray_list.append({
            "id": t["id"],
            "name": t["name"],
            "irrigation_type": t.get("irrigation_type") or "manual",
            "irrigation_zone_name": t.get("irrigation_zone_name"),
        })

    return {
        "beds": bed_list,
        "trays": tray_list,
        "manual_needing_water_today": manual_needing_water,
        "counts": {"automated": auto_count, "manual": manual_count, "total": auto_count + manual_count},
        "weather": {"temperature_f": temp_f, "rain_today_in": rain_today_in},
        "next_rachio_run": next_run,
    }


@router.get("/api/sensors/moisture")
async def get_moisture_sensors():
    """Pull soil moisture sensor data from HA."""
    if not _ha_is_configured():
        raise HTTPException(503, "Home Assistant not configured — add token in Settings > Integrations")

    all_ids = []
    for sensor_group in MOISTURE_SENSORS.values():
        all_ids.extend(sensor_group.values())
    states = await _ha_get_states_bulk(all_ids)

    sensors = []
    for location, entity_map in MOISTURE_SENSORS.items():
        sensor_data = {"location": location.replace("_", " ").title()}
        all_unavailable = True
        for metric, entity_id in entity_map.items():
            st = states.get(entity_id)
            if st:
                val = _safe_float(st.get("state"))
                sensor_data[metric] = val
                attrs = st.get("attributes", {})
                unit = attrs.get("unit_of_measurement")
                if unit:
                    sensor_data[f"{metric}_unit"] = unit
                if val is not None:
                    all_unavailable = False
            else:
                sensor_data[metric] = None
        sensor_data["available"] = not all_unavailable
        sensors.append(sensor_data)

    return {"sensors": sensors}


@router.get("/api/sensors/summary")
async def get_sensor_summary():
    """Combined dashboard-friendly summary of all garden-related sensors."""
    if not _ha_is_configured():
        raise HTTPException(503, "Home Assistant not configured — add token in Settings > Integrations")

    # Gather all entity IDs we need
    all_ids = list(WEATHER_SENSORS.values()) + [WEATHER_ENTITY]
    all_ids.extend(RACHIO_ENTITIES.values())
    for sensor_group in MOISTURE_SENSORS.values():
        all_ids.extend(sensor_group.values())
    states = await _ha_get_states_bulk(all_ids)

    # Weather
    weather_state = states.get(WEATHER_ENTITY)
    condition = weather_state.get("state") if weather_state else None

    temp = _safe_float(states.get(WEATHER_SENSORS["temperature"], {}).get("state") if states.get(WEATHER_SENSORS["temperature"]) else None)
    humidity = _safe_float(states.get(WEATHER_SENSORS["humidity"], {}).get("state") if states.get(WEATHER_SENSORS["humidity"]) else None)
    uv = _safe_float(states.get(WEATHER_SENSORS["uv_index"], {}).get("state") if states.get(WEATHER_SENSORS["uv_index"]) else None)
    wind = _safe_float(states.get(WEATHER_SENSORS["wind_speed"], {}).get("state") if states.get(WEATHER_SENSORS["wind_speed"]) else None)
    rain_today = _safe_float(states.get(WEATHER_SENSORS["rain_today"], {}).get("state") if states.get(WEATHER_SENSORS["rain_today"]) else None)
    solar = _safe_float(states.get(WEATHER_SENSORS["solar_radiation"], {}).get("state") if states.get(WEATHER_SENSORS["solar_radiation"]) else None)

    # Rachio
    calendar_state = states.get(RACHIO_ENTITIES["calendar"])
    rachio_running = False
    if calendar_state and calendar_state.get("state") == "on":
        rachio_running = True

    # Moisture
    moisture_readings = []
    any_dry = False
    any_available = False
    for location, entity_map in MOISTURE_SENSORS.items():
        sm_state = states.get(entity_map["soil_moisture"])
        val = _safe_float(sm_state.get("state") if sm_state else None)
        available = val is not None
        if available:
            any_available = True
            if val < 20:
                any_dry = True
        moisture_readings.append({
            "location": location.replace("_", " ").title(),
            "soil_moisture": val,
            "available": available,
        })

    # Watering recommendation
    recommendation = _watering_recommendation(
        temp=temp, humidity=humidity, rain_today=rain_today,
        rachio_running=rachio_running, any_dry=any_dry, any_available=any_available,
    )

    return {
        "weather": {
            "condition": condition,
            "temperature_f": temp,
            "humidity_pct": humidity,
            "uv_index": uv,
            "wind_speed_mph": wind,
            "rain_today_in": rain_today,
            "solar_radiation_wm2": solar,
        },
        "rachio": {
            "any_zone_running": rachio_running,
        },
        "moisture": moisture_readings,
        "recommendation": recommendation,
    }


def _watering_recommendation(
    temp: Optional[float], humidity: Optional[float], rain_today: Optional[float],
    rachio_running: bool, any_dry: bool, any_available: bool,
) -> dict:
    """Generate a watering recommendation based on current conditions."""
    reasons = []
    action = "monitor"

    if rachio_running:
        return {"action": "none", "message": "Irrigation is currently running.", "reasons": ["Rachio active"]}

    if rain_today is not None and rain_today > 0.1:
        reasons.append(f"Rain today: {rain_today} in")
        action = "skip"
    elif rain_today is not None and rain_today > 0:
        reasons.append(f"Light rain today: {rain_today} in")

    if any_available and any_dry:
        reasons.append("Soil moisture below 20% on one or more sensors")
        action = "water"
    elif any_available and not any_dry:
        reasons.append("Soil moisture levels adequate")

    if temp is not None and temp > 100:
        reasons.append(f"High temperature ({temp}F) — water early morning or evening only")
        if action != "skip":
            action = "water"

    if humidity is not None and humidity < 15:
        reasons.append(f"Very low humidity ({humidity}%) — evaporation high")

    if not any_available:
        reasons.append("Soil moisture sensors unavailable — check batteries")

    messages = {
        "water": "Watering recommended today.",
        "skip": "Skip watering — rain detected.",
        "monitor": "Conditions normal — monitor soil moisture.",
        "none": "No action needed.",
    }

    return {"action": action, "message": messages.get(action, ""), "reasons": reasons}


# ──────────────── SENSOR HISTORY RECORDING ────────────────

def _db_insert_sensor_reading(sensor_type: str, sensor_name: str, value: float, unit: str | None = None, metadata: str | None = None):
    """Insert a single sensor reading into the database."""
    try:
        with get_db() as db:
            db.execute(
                "INSERT INTO sensor_readings (sensor_type, sensor_name, value, unit, metadata) VALUES (?, ?, ?, ?, ?)",
                (sensor_type, sensor_name, value, unit, metadata),
            )
            db.commit()
    except Exception as exc:
        logger.warning("Failed to insert sensor reading: %s", exc)


def _db_insert_sensor_readings_batch(rows: list[tuple]):
    """Insert multiple sensor readings at once. Each tuple: (sensor_type, sensor_name, value, unit, metadata)."""
    if not rows:
        return
    try:
        with get_db() as db:
            db.executemany(
                "INSERT INTO sensor_readings (sensor_type, sensor_name, value, unit, metadata) VALUES (?, ?, ?, ?, ?)",
                rows,
            )
            db.commit()
    except Exception as exc:
        logger.warning("Failed to batch-insert sensor readings: %s", exc)


async def _record_sensor_snapshot():
    """Snapshot current sensor readings into the DB. Called every 5 minutes."""
    rows: list[tuple] = []

    try:
        # Weather sensors
        if _ha_is_configured():
            all_ids = list(WEATHER_SENSORS.values())
            states = await _ha_get_states_bulk(all_ids)
            for key, entity_id in WEATHER_SENSORS.items():
                st = states.get(entity_id)
                if st:
                    val = _safe_float(st.get("state"))
                    if val is not None:
                        unit = st.get("attributes", {}).get("unit_of_measurement")
                        rows.append(("weather", key, val, unit, None))
    except Exception as exc:
        logger.warning("Error recording weather data: %s", exc)

    try:
        # Moisture sensors
        if _ha_is_configured():
            all_ids = []
            for sensor_group in MOISTURE_SENSORS.values():
                all_ids.extend(sensor_group.values())
            states = await _ha_get_states_bulk(all_ids)
            for location, entity_map in MOISTURE_SENSORS.items():
                for metric, entity_id in entity_map.items():
                    st = states.get(entity_id)
                    if st:
                        val = _safe_float(st.get("state"))
                        if val is not None:
                            unit = st.get("attributes", {}).get("unit_of_measurement")
                            sensor_name = f"{location}_{metric}"
                            rows.append(("moisture", sensor_name, val, unit, None))
    except Exception as exc:
        logger.warning("Error recording moisture data: %s", exc)

    try:
        # Rachio status
        if _ha_is_configured():
            calendar_state = await _ha_get_state(RACHIO_ENTITIES["calendar"])
            if calendar_state:
                is_running = 1.0 if calendar_state.get("state") == "on" else 0.0
                rows.append(("rachio", "irrigation_active", is_running, None, None))
    except Exception as exc:
        logger.warning("Error recording rachio data: %s", exc)

    _db_insert_sensor_readings_batch(rows)
    if rows:
        logger.info("Recorded %d sensor readings", len(rows))


async def _downsample_and_cleanup():
    """Run daily: downsample old data to hourly/daily aggregates and purge old raw readings."""
    try:
        with get_db() as db:
            now = datetime.utcnow()

            # Downsample readings older than 7 days into hourly
            cutoff_hourly = (now - timedelta(days=7)).strftime("%Y-%m-%d %H:%M:%S")
            db.execute("""
                INSERT OR REPLACE INTO sensor_readings_hourly (sensor_type, sensor_name, value_min, value_max, value_avg, sample_count, hour_start)
                SELECT sensor_type, sensor_name, MIN(value), MAX(value), AVG(value), COUNT(*),
                       strftime('%Y-%m-%d %H:00:00', recorded_at)
                FROM sensor_readings
                WHERE recorded_at < ?
                GROUP BY sensor_type, sensor_name, strftime('%Y-%m-%d %H:00:00', recorded_at)
            """, (cutoff_hourly,))

            # Downsample hourly readings older than 30 days into daily
            cutoff_daily = (now - timedelta(days=30)).strftime("%Y-%m-%d %H:%M:%S")
            db.execute("""
                INSERT OR REPLACE INTO sensor_readings_daily (sensor_type, sensor_name, value_min, value_max, value_avg, sample_count, day_start)
                SELECT sensor_type, sensor_name, MIN(value_min), MAX(value_max), AVG(value_avg), SUM(sample_count),
                       strftime('%Y-%m-%d', hour_start)
                FROM sensor_readings_hourly
                WHERE hour_start < ?
                GROUP BY sensor_type, sensor_name, strftime('%Y-%m-%d', hour_start)
            """, (cutoff_daily,))

            # Delete raw readings older than 7 days (already downsampled)
            db.execute("DELETE FROM sensor_readings WHERE recorded_at < ?", (cutoff_hourly,))

            # Delete hourly readings older than 30 days (already downsampled to daily)
            db.execute("DELETE FROM sensor_readings_hourly WHERE hour_start < ?", (cutoff_daily,))

            # Delete daily readings older than 1 year
            cutoff_year = (now - timedelta(days=365)).strftime("%Y-%m-%d")
            db.execute("DELETE FROM sensor_readings_daily WHERE day_start < ?", (cutoff_year,))

            db.commit()
            logger.info("Sensor data downsampled and cleaned up")
    except Exception as exc:
        logger.warning("Error in downsample/cleanup: %s", exc)


async def _sensor_recording_loop():
    """Background loop: record sensor data every 5 minutes."""
    await asyncio.sleep(10)  # wait for app startup
    while True:
        try:
            await _record_sensor_snapshot()
        except Exception as exc:
            logger.warning("Sensor recording loop error: %s", exc)
        await asyncio.sleep(300)  # 5 minutes


async def _daily_cleanup_loop():
    """Background loop: run downsampling/cleanup once per day."""
    await asyncio.sleep(60)  # wait for app startup
    while True:
        try:
            await _downsample_and_cleanup()
        except Exception as exc:
            logger.warning("Daily cleanup loop error: %s", exc)
        await asyncio.sleep(86400)  # 24 hours


async def startup_sensor_recording():
    asyncio.create_task(_sensor_recording_loop())
    asyncio.create_task(_daily_cleanup_loop())


# ──────────────── SENSOR HISTORY ENDPOINTS ────────────────

@router.get("/api/sensors/history")
async def get_sensor_history(
    sensor_type: str = Query(None, description="Filter by sensor_type: weather, moisture, rachio"),
    sensor_name: str = Query(None, description="Filter by sensor_name, e.g. temperature"),
    hours: int = Query(24, ge=1, le=168, description="Hours of history to return"),
):
    """Get raw sensor readings for the last N hours."""
    cutoff = (datetime.utcnow() - timedelta(hours=hours)).strftime("%Y-%m-%d %H:%M:%S")
    query = "SELECT sensor_type, sensor_name, value, unit, recorded_at FROM sensor_readings WHERE recorded_at >= ?"
    params: list = [cutoff]

    if sensor_type:
        query += " AND sensor_type = ?"
        params.append(sensor_type)
    if sensor_name:
        query += " AND sensor_name = ?"
        params.append(sensor_name)

    query += " ORDER BY recorded_at DESC LIMIT 5000"

    with get_db() as db:
        rows = db.execute(query, params).fetchall()
        return {
            "readings": [dict(r) for r in rows],
            "count": len(rows),
            "hours": hours,
        }


@router.get("/api/sensors/history/daily")
async def get_sensor_history_daily(
    sensor_name: str = Query(..., description="Sensor name, e.g. temperature"),
    days: int = Query(30, ge=1, le=365, description="Days of daily aggregates"),
):
    """Get daily min/max/avg for a sensor over the last N days."""
    cutoff = (datetime.utcnow() - timedelta(days=days)).strftime("%Y-%m-%d")
    results = []

    with get_db() as db:
        # Recent data from raw readings (last 7 days) - aggregate on the fly
        raw_cutoff = (datetime.utcnow() - timedelta(days=7)).strftime("%Y-%m-%d %H:%M:%S")
        raw_rows = db.execute("""
            SELECT strftime('%Y-%m-%d', recorded_at) as day_start,
                   MIN(value) as value_min, MAX(value) as value_max,
                   AVG(value) as value_avg, COUNT(*) as sample_count
            FROM sensor_readings
            WHERE sensor_name = ? AND recorded_at >= ?
            GROUP BY strftime('%Y-%m-%d', recorded_at)
            ORDER BY day_start
        """, (sensor_name, raw_cutoff)).fetchall()
        for r in raw_rows:
            results.append(dict(r))

        # Older data from daily table
        if days > 7:
            daily_rows = db.execute("""
                SELECT day_start, value_min, value_max, value_avg, sample_count
                FROM sensor_readings_daily
                WHERE sensor_name = ? AND day_start >= ? AND day_start < ?
                ORDER BY day_start
            """, (sensor_name, cutoff, raw_cutoff[:10])).fetchall()
            for r in daily_rows:
                results.append(dict(r))

        # Also check hourly table for 7-30 day range
        if days > 7:
            hourly_cutoff = (datetime.utcnow() - timedelta(days=min(days, 30))).strftime("%Y-%m-%d %H:%M:%S")
            hourly_rows = db.execute("""
                SELECT strftime('%Y-%m-%d', hour_start) as day_start,
                       MIN(value_min) as value_min, MAX(value_max) as value_max,
                       AVG(value_avg) as value_avg, SUM(sample_count) as sample_count
                FROM sensor_readings_hourly
                WHERE sensor_name = ? AND hour_start >= ? AND hour_start < ?
                GROUP BY strftime('%Y-%m-%d', hour_start)
                ORDER BY day_start
            """, (sensor_name, hourly_cutoff, raw_cutoff)).fetchall()
            for r in hourly_rows:
                d = dict(r)
                # Only add if not already covered by daily table
                if not any(existing["day_start"] == d["day_start"] for existing in results):
                    results.append(d)

    # Sort and deduplicate by day
    seen_days: set[str] = set()
    unique_results = []
    results.sort(key=lambda x: x["day_start"])
    for r in results:
        if r["day_start"] not in seen_days:
            seen_days.add(r["day_start"])
            unique_results.append(r)

    return {
        "sensor_name": sensor_name,
        "days": days,
        "data": unique_results,
    }


@router.get("/api/sensors/history/chart")
async def get_sensor_history_chart(
    sensor_name: str = Query(..., description="Sensor name, e.g. temperature"),
    hours: int = Query(48, ge=1, le=168, description="Hours of data for chart"),
):
    """Return data formatted for charting: labels + values arrays."""
    cutoff = (datetime.utcnow() - timedelta(hours=hours)).strftime("%Y-%m-%d %H:%M:%S")

    with get_db() as db:
        rows = db.execute("""
            SELECT value, recorded_at
            FROM sensor_readings
            WHERE sensor_name = ? AND recorded_at >= ?
            ORDER BY recorded_at ASC
        """, (sensor_name, cutoff)).fetchall()

    labels = [r["recorded_at"] for r in rows]
    values = [r["value"] for r in rows]

    return {
        "sensor_name": sensor_name,
        "hours": hours,
        "labels": labels,
        "values": values,
        "count": len(values),
    }


@router.get("/api/irrigation/history")
async def get_irrigation_history(
    days: int = Query(30, ge=1, le=365, description="Days of irrigation history"),
):
    """Get irrigation event log."""
    cutoff = (datetime.utcnow() - timedelta(days=days)).strftime("%Y-%m-%d %H:%M:%S")

    with get_db() as db:
        rows = db.execute("""
            SELECT id, zone_name, event_type, duration_minutes, source, recorded_at
            FROM irrigation_events
            WHERE recorded_at >= ?
            ORDER BY recorded_at DESC
        """, (cutoff,)).fetchall()

        return {
            "events": [dict(r) for r in rows],
            "count": len(rows),
            "days": days,
        }


# ──────────────── HA ENTITY SELECTOR (Issue #40) ────────────────


@router.get("/api/sensors/ha-entities")
async def list_ha_entities(request: Request):
    """List available Home Assistant sensor entities for mapping."""
    require_admin(request)
    config = get_ha_config()
    if not config.get("token"):
        return {"entities": [], "error": "Home Assistant not configured"}

    try:
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.get(
                f"{config['url']}/api/states",
                headers={"Authorization": f"Bearer {config['token']}"}
            )
            if resp.status_code == 200:
                states = resp.json()
                sensors = [{"entity_id": s["entity_id"],
                           "friendly_name": s.get("attributes", {}).get("friendly_name", s["entity_id"]),
                           "state": s["state"],
                           "unit": s.get("attributes", {}).get("unit_of_measurement", "")}
                          for s in states if s["entity_id"].startswith("sensor.")]
                return {"entities": sorted(sensors, key=lambda x: x["friendly_name"])}
            return {"entities": [], "error": f"HA returned {resp.status_code}"}
    except Exception as e:
        return {"entities": [], "error": str(e)[:200]}


@router.get("/api/sensors/entity-mappings")
def get_entity_mappings(request: Request):
    """Get saved HA entity-to-role mappings."""
    require_user(request)
    with get_db() as db:
        row = db.execute("SELECT value FROM app_config WHERE key = 'ha_entity_mappings'").fetchone()
        mappings = json.loads(row["value"]) if row else {}
        return {"roles": SENSOR_ROLES, "mappings": mappings}


@router.put("/api/sensors/entity-mappings")
async def update_entity_mappings(request: Request):
    """Save HA entity-to-role mappings."""
    require_admin(request)
    body = await request.json()
    mappings = body.get("mappings", {})
    with get_db() as db:
        db.execute("INSERT OR REPLACE INTO app_config (key, value) VALUES (?, ?)",
                   ("ha_entity_mappings", json.dumps(mappings)))
        db.commit()
    return {"ok": True}


# ──────────────── RACHIO SCHEDULE DATA ────────────────

def _rachio_api_key():
    return get_rachio_config()["api_key"] or os.environ.get("RACHIO_API_KEY", "")

def _rachio_person_id():
    return get_rachio_config()["person_id"]

def _rachio_base_station_id():
    return get_hose_timer_config()["base_station_id"]

def _rachio_valve_id():
    return get_hose_timer_config()["valve_id"]

# Cache for Rachio schedule data (5 min TTL)
_rachio_schedule_cache: dict = {}
RACHIO_SCHEDULE_CACHE_TTL = 300


def _water_level_score(level: str) -> int:
    """Return numeric score for water need level (low=1, moderate=2, high=3)."""
    return {"low": 1, "moderate": 2, "high": 3}.get((level or "").lower(), 2)


def _describe_frequency(schedule_rule: dict) -> str:
    """Human-readable frequency from a Rachio scheduleRule."""
    freq = schedule_rule.get("frequency")
    if not freq:
        return "unknown"
    kind = freq.get("type", "")
    if kind == "EVEN":
        return "every 2 days (even)"
    elif kind == "ODD":
        return "every 2 days (odd)"
    elif kind == "INTERVAL":
        interval = freq.get("interval", 1)
        if interval == 1:
            return "daily"
        return f"every {interval} days"
    elif kind == "SPECIFIC":
        days_of_week = freq.get("daysOfWeek", [])
        day_names = {0: "Sun", 1: "Mon", 2: "Tue", 3: "Wed", 4: "Thu", 5: "Fri", 6: "Sat"}
        return ", ".join(day_names.get(d, str(d)) for d in sorted(days_of_week))
    return kind.lower()


async def _fetch_rachio_person_data() -> dict:
    """Fetch full person data from Rachio controller API with caching."""
    cache_key = "person_data"
    now = time.time()
    if cache_key in _rachio_schedule_cache:
        ts, data = _rachio_schedule_cache[cache_key]
        if now - ts < RACHIO_SCHEDULE_CACHE_TTL:
            return data
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.get(
                f"https://api.rach.io/1/public/person/{_rachio_person_id()}",
                headers={"Authorization": f"Bearer {_rachio_api_key()}"},
            )
            if resp.status_code == 200:
                data = resp.json()
                _rachio_schedule_cache[cache_key] = (now, data)
                return data
    except Exception as exc:
        logger.warning("Rachio person fetch failed: %s", exc)
    return {}


async def _fetch_hose_timer_programs() -> list:
    """Fetch watering programs for the hose timer valve."""
    cache_key = "hose_programs"
    now = time.time()
    if cache_key in _rachio_schedule_cache:
        ts, data = _rachio_schedule_cache[cache_key]
        if now - ts < RACHIO_SCHEDULE_CACHE_TTL:
            return data
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.get(
                f"https://cloud-rest.rach.io/program/listPrograms/{_rachio_valve_id()}",
                headers={"Authorization": f"Bearer {_rachio_api_key()}"},
            )
            if resp.status_code == 200:
                programs = resp.json().get("programs", [])
                _rachio_schedule_cache[cache_key] = (now, programs)
                return programs
    except Exception as exc:
        logger.warning("Rachio hose timer programs fetch failed: %s", exc)
    return []


async def _fetch_valve_day_views(days: int = 7) -> list:
    """Fetch historical watering data for the hose timer valve."""
    cache_key = f"valve_day_views_{days}"
    now = time.time()
    if cache_key in _rachio_schedule_cache:
        ts, data = _rachio_schedule_cache[cache_key]
        if now - ts < RACHIO_SCHEDULE_CACHE_TTL:
            return data
    try:
        end_ts = int(now * 1000)
        start_ts = int((now - days * 86400) * 1000)
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.post(
                "https://cloud-rest.rach.io/summary/getValveDayViews",
                headers={"Authorization": f"Bearer {_rachio_api_key()}", "Content-Type": "application/json"},
                json={"valveId": _rachio_valve_id(), "startTime": start_ts, "endTime": end_ts},
            )
            if resp.status_code == 200:
                views = resp.json().get("dayViews", [])
                _rachio_schedule_cache[cache_key] = (now, views)
                return views
    except Exception as exc:
        logger.warning("Rachio valve day views fetch failed: %s", exc)
    return []


def _get_beds_for_zone(zone_name: str) -> list:
    """Get beds/trays assigned to a given irrigation zone name."""
    with get_db() as db:
        beds = db.execute(
            "SELECT id, name, irrigation_type, irrigation_zone_name FROM garden_beds WHERE irrigation_zone_name = ?",
            (zone_name,)
        ).fetchall()
        trays = db.execute(
            "SELECT id, name, irrigation_type, irrigation_zone_name FROM seed_trays WHERE irrigation_zone_name = ?",
            (zone_name,)
        ).fetchall()
        result = []
        for b in beds:
            bd = dict(b)
            # Get plants in this bed
            plants_rows = db.execute(
                """SELECT DISTINCT p.name, p.water FROM plantings pl
                   JOIN plants p ON pl.plant_id = p.id
                   WHERE pl.bed_id = ? AND pl.status NOT IN ('harvested', 'removed', 'failed')""",
                (bd["id"],)
            ).fetchall()
            bd["plants"] = [{"name": r["name"], "water": r["water"]} for r in plants_rows]
            bd["entity_type"] = "bed"
            result.append(bd)
        for t in trays:
            td = dict(t)
            td["plants"] = []
            td["entity_type"] = "tray"
            result.append(td)
        return result


def _analyze_water_mismatch(plants: list, duration_minutes: float, frequency_desc: str) -> list:
    """Flag mismatches between plant water needs and schedule."""
    mismatches = []
    # Estimate runs per week from frequency
    freq_lower = frequency_desc.lower()
    runs_per_week = 3  # default
    if "daily" in freq_lower:
        runs_per_week = 7
    elif "every 2 days" in freq_lower:
        runs_per_week = 3.5
    elif "every 3 days" in freq_lower:
        runs_per_week = 2.3
    elif "every" in freq_lower:
        m = re.search(r"every\s+(\d+)\s+days", freq_lower)
        if m:
            runs_per_week = 7 / int(m.group(1))
    else:
        # Count named days
        day_names = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"]
        count = sum(1 for d in day_names if d in freq_lower)
        if count > 0:
            runs_per_week = count

    weekly_minutes = duration_minutes * runs_per_week

    for plant in plants:
        water = (plant.get("water") or "moderate").lower()
        if water == "high" and weekly_minutes < 20:
            mismatches.append(
                f"{plant['name']} needs high water but zone only runs {duration_minutes:.0f}min, "
                f"{frequency_desc} ({weekly_minutes:.0f} min/week)"
            )
        elif water == "low" and weekly_minutes > 60:
            mismatches.append(
                f"{plant['name']} needs low water but zone runs {duration_minutes:.0f}min, "
                f"{frequency_desc} ({weekly_minutes:.0f} min/week) — risk of overwatering"
            )
    return mismatches


@router.get("/api/irrigation/schedules")
async def get_irrigation_schedules():
    """Pull ALL schedule data from Rachio controller and hose timer."""
    person_data = await _fetch_rachio_person_data()
    hose_programs = await _fetch_hose_timer_programs()

    controller_schedules = []
    for device in person_data.get("devices", []):
        device_name = device.get("name", "Unknown Controller")
        zone_map = {z["id"]: z for z in device.get("zones", []) if z.get("enabled")}

        for rule in device.get("scheduleRules", []):
            zone_durations = []
            total_duration = 0
            for zone_entry in rule.get("zones", []):
                zone_id = zone_entry.get("zoneId")
                duration_secs = zone_entry.get("duration", 0)
                duration_min = duration_secs / 60
                total_duration += duration_min
                zone_info = zone_map.get(zone_id, {})
                zone_name = zone_info.get("name", "Unknown Zone")
                assigned = _get_beds_for_zone(zone_name)
                zone_durations.append({
                    "zone_id": zone_id,
                    "zone_name": zone_name,
                    "zone_number": zone_info.get("zoneNumber"),
                    "duration_minutes": round(duration_min, 1),
                    "assigned_beds": assigned,
                })

            controller_schedules.append({
                "id": rule.get("id"),
                "name": rule.get("name", "Unnamed Schedule"),
                "summary": rule.get("summary", ""),
                "enabled": rule.get("enabled", False),
                "frequency": _describe_frequency(rule),
                "total_duration_minutes": round(total_duration, 1),
                "start_hour": rule.get("startHour"),
                "start_minute": rule.get("startMinute"),
                "zones": zone_durations,
                "device_name": device_name,
            })

    hose_timer_schedules = []
    for prog in hose_programs:
        run_times = prog.get("runTimes", [])
        frequency = prog.get("frequency", {})
        freq_type = frequency.get("type", "")
        freq_desc = "unknown"
        if freq_type == "INTERVAL":
            interval = frequency.get("interval", 1)
            freq_desc = "daily" if interval == 1 else f"every {interval} days"
        elif freq_type == "SPECIFIC":
            days = frequency.get("daysOfWeek", [])
            day_names = {0: "Sun", 1: "Mon", 2: "Tue", 3: "Wed", 4: "Thu", 5: "Fri", 6: "Sat"}
            freq_desc = ", ".join(day_names.get(d, str(d)) for d in sorted(days))

        total_dur = sum(rt.get("duration", 0) for rt in run_times) / 60
        assigned = _get_beds_for_zone("Hose Timer")  # match against beds with this zone name

        hose_timer_schedules.append({
            "id": prog.get("id"),
            "name": prog.get("name", "Unnamed Program"),
            "enabled": prog.get("enabled", False),
            "frequency": freq_desc,
            "total_duration_minutes": round(total_dur, 1),
            "run_times": [{"start_hour": rt.get("startHour"), "start_minute": rt.get("startMinute"), "duration_seconds": rt.get("duration")} for rt in run_times],
            "valve_id": _rachio_valve_id(),
            "assigned_beds": assigned,
        })

    return {
        "controller_schedules": controller_schedules,
        "hose_timer_schedules": hose_timer_schedules,
    }


@router.get("/api/irrigation/zone/{zone_name}/schedule")
async def get_zone_schedule(zone_name: str):
    """Get schedule details for a specific irrigation zone."""
    person_data = await _fetch_rachio_person_data()
    hose_programs = await _fetch_hose_timer_programs()

    matching_schedules = []
    assigned = _get_beds_for_zone(zone_name)

    # Check controller schedules
    for device in person_data.get("devices", []):
        zone_map = {z["id"]: z for z in device.get("zones", []) if z.get("enabled")}
        zone_by_name = {z.get("name", "").lower(): z for z in zone_map.values()}
        matched_zone = zone_by_name.get(zone_name.lower())

        for rule in device.get("scheduleRules", []):
            if not rule.get("enabled"):
                continue
            for zone_entry in rule.get("zones", []):
                zone_id = zone_entry.get("zoneId")
                zone_info = zone_map.get(zone_id, {})
                if zone_info.get("name", "").lower() == zone_name.lower():
                    duration_min = zone_entry.get("duration", 0) / 60
                    freq = _describe_frequency(rule)
                    mismatches = _analyze_water_mismatch(
                        [p for b in assigned for p in b.get("plants", [])],
                        duration_min,
                        freq
                    )
                    matching_schedules.append({
                        "schedule_name": rule.get("name"),
                        "source": "controller",
                        "frequency": freq,
                        "duration_minutes": round(duration_min, 1),
                        "start_hour": rule.get("startHour"),
                        "start_minute": rule.get("startMinute"),
                        "mismatches": mismatches,
                    })

    # Check hose timer programs if zone_name matches hose timer
    if zone_name.lower() in ("hose timer", "hose_timer", "smart hose timer"):
        for prog in hose_programs:
            if not prog.get("enabled"):
                continue
            frequency = prog.get("frequency", {})
            freq_type = frequency.get("type", "")
            if freq_type == "INTERVAL":
                interval = frequency.get("interval", 1)
                freq_desc = "daily" if interval == 1 else f"every {interval} days"
            elif freq_type == "SPECIFIC":
                days = frequency.get("daysOfWeek", [])
                day_names = {0: "Sun", 1: "Mon", 2: "Tue", 3: "Wed", 4: "Thu", 5: "Fri", 6: "Sat"}
                freq_desc = ", ".join(day_names.get(d, str(d)) for d in sorted(days))
            else:
                freq_desc = "unknown"
            total_dur = sum(rt.get("duration", 0) for rt in prog.get("runTimes", [])) / 60
            mismatches = _analyze_water_mismatch(
                [p for b in assigned for p in b.get("plants", [])],
                total_dur,
                freq_desc
            )
            matching_schedules.append({
                "schedule_name": prog.get("name"),
                "source": "hose_timer",
                "frequency": freq_desc,
                "duration_minutes": round(total_dur, 1),
                "run_times": prog.get("runTimes", []),
                "mismatches": mismatches,
            })

    # Get next run from HA calendar
    next_run = None
    if _ha_is_configured():
        try:
            calendar_state = await _ha_get_state(RACHIO_ENTITIES["calendar"])
            if calendar_state:
                attrs = calendar_state.get("attributes", {})
                msg = attrs.get("message", "")
                # If the calendar message references the zone, include it
                if zone_name.lower() in (msg or "").lower() or not msg:
                    next_run = {
                        "active": calendar_state.get("state") == "on",
                        "message": msg,
                        "start_time": attrs.get("start_time"),
                        "end_time": attrs.get("end_time"),
                    }
        except Exception:
            pass

    return {
        "zone_name": zone_name,
        "schedules": matching_schedules,
        "assigned_beds": assigned,
        "next_run": next_run,
    }


@router.get("/api/irrigation/schedules/history")
async def get_irrigation_schedule_history(
    days: int = Query(7, ge=1, le=90, description="Days of history"),
):
    """Get combined watering history from DB events and hose timer valve day views."""
    cutoff = (datetime.utcnow() - timedelta(days=days)).strftime("%Y-%m-%d %H:%M:%S")

    # DB events (from sensor recording)
    with get_db() as db:
        db_events = db.execute("""
            SELECT id, zone_name, event_type, duration_minutes, source, recorded_at
            FROM irrigation_events
            WHERE recorded_at >= ?
            ORDER BY recorded_at DESC
        """, (cutoff,)).fetchall()

    # Hose timer valve day views
    valve_views = await _fetch_valve_day_views(days)
    hose_events = []
    for view in valve_views:
        day_ts = view.get("dayTimestamp")
        if day_ts:
            day_str = datetime.utcfromtimestamp(day_ts / 1000).strftime("%Y-%m-%d")
        else:
            day_str = "unknown"
        total_secs = view.get("totalDuration", 0)
        hose_events.append({
            "date": day_str,
            "total_duration_seconds": total_secs,
            "total_duration_minutes": round(total_secs / 60, 1),
            "run_count": view.get("numberOfRuns", 0),
            "source": "hose_timer",
        })

    return {
        "controller_events": [dict(r) for r in db_events],
        "hose_timer_daily": hose_events,
        "days": days,
    }


@router.get("/api/irrigation/bed/{bed_id}/schedule")
async def get_bed_irrigation_schedule(bed_id: int):
    """Given a bed with an assigned irrigation zone, show schedule details, history, and plant water analysis."""
    with get_db() as db:
        bed_row = db.execute("SELECT * FROM garden_beds WHERE id = ?", (bed_id,)).fetchone()
        if not bed_row:
            raise HTTPException(404, "Bed not found")
        bed = dict(bed_row)

        # Get plants in this bed
        plant_rows = db.execute(
            """SELECT DISTINCT p.id, p.name, p.water, p.category FROM plantings pl
               JOIN plants p ON pl.plant_id = p.id
               WHERE pl.bed_id = ? AND pl.status NOT IN ('harvested', 'removed', 'failed')""",
            (bed_id,)
        ).fetchall()
        plants = [dict(r) for r in plant_rows]

    irr_type = bed.get("irrigation_type") or "manual"
    zone_name = bed.get("irrigation_zone_name") or ""

    result = {
        "bed_id": bed_id,
        "bed_name": bed.get("name"),
        "irrigation_type": irr_type,
        "irrigation_zone_name": zone_name,
        "plants": plants,
        "schedules": [],
        "next_watering": None,
        "watering_summary": None,
        "history_7d": [],
        "mismatches": [],
    }

    if irr_type in ("rachio_controller", "rachio_hose_timer") and zone_name:
        zone_data = await get_zone_schedule(zone_name)
        result["schedules"] = zone_data.get("schedules", [])
        result["next_watering"] = zone_data.get("next_run")

        # Build watering summary from first enabled schedule
        if result["schedules"]:
            sched = result["schedules"][0]
            dur = sched.get("duration_minutes", 0)
            freq = sched.get("frequency", "unknown")
            result["watering_summary"] = f"Watered for {dur:.0f} min, {freq}"

            # Collect all mismatches
            all_mismatches = []
            for s in result["schedules"]:
                all_mismatches.extend(s.get("mismatches", []))
            result["mismatches"] = list(set(all_mismatches))

        # Get last 7 days of watering history
        cutoff = (datetime.utcnow() - timedelta(days=7)).strftime("%Y-%m-%d %H:%M:%S")
        with get_db() as db:
            events = db.execute("""
                SELECT id, zone_name, event_type, duration_minutes, source, recorded_at
                FROM irrigation_events
                WHERE zone_name = ? AND recorded_at >= ?
                ORDER BY recorded_at DESC
            """, (zone_name, cutoff)).fetchall()
            result["history_7d"] = [dict(r) for r in events]

        # Also fetch hose timer history if applicable
        if irr_type == "rachio_hose_timer":
            valve_views = await _fetch_valve_day_views(7)
            for view in valve_views:
                day_ts = view.get("dayTimestamp")
                if day_ts:
                    day_str = datetime.utcfromtimestamp(day_ts / 1000).strftime("%Y-%m-%d")
                else:
                    day_str = "unknown"
                result["history_7d"].append({
                    "zone_name": "Hose Timer",
                    "event_type": "run",
                    "duration_minutes": round(view.get("totalDuration", 0) / 60, 1),
                    "source": "hose_timer",
                    "recorded_at": day_str,
                })

    return result


@router.get("/api/irrigation/usage")
async def get_irrigation_usage(request: Request, days: int = 30):
    """Pull per-zone water usage (gallons, duration) from Rachio cloud API."""
    require_user(request)
    person_data = await _fetch_rachio_person_data()
    if not person_data:
        return {"usage": [], "error": "Rachio not configured"}

    devices = person_data.get("devices", [])
    if not devices:
        return {"usage": [], "error": "No devices found"}

    device_id = devices[0].get("id")
    end_ms = int(time.time() * 1000)
    start_ms = end_ms - (days * 86400 * 1000)

    # Build zone name lookup
    zone_names = {}
    for device in devices:
        for zone in device.get("zones", []):
            zone_names[zone.get("id", "")] = zone.get("name", "Unknown Zone")

    try:
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.get(
                f"https://api.rach.io/1/public/device/{device_id}/usage/{start_ms}/{end_ms}",
                headers={"Authorization": f"Bearer {_rachio_api_key()}"},
            )
            if resp.status_code == 200:
                raw = resp.json()
                # Enrich with zone names
                if isinstance(raw, list):
                    for entry in raw:
                        zid = entry.get("zoneId") or entry.get("zone_id", "")
                        if zid in zone_names:
                            entry["zone_name"] = zone_names[zid]
                return {"usage": raw, "days": days, "zone_names": zone_names}
    except Exception as e:
        return {"usage": [], "error": str(e)[:200]}
    return {"usage": [], "error": "Failed to fetch usage data"}


@router.get("/api/sensors/history/summary")
async def get_sensor_history_summary():
    """Overview of stored sensor data: counts, date ranges, latest values."""
    with get_db() as db:
        total = db.execute("SELECT COUNT(*) as c FROM sensor_readings").fetchone()["c"]
        hourly_total = db.execute("SELECT COUNT(*) as c FROM sensor_readings_hourly").fetchone()["c"]
        daily_total = db.execute("SELECT COUNT(*) as c FROM sensor_readings_daily").fetchone()["c"]

        oldest = db.execute("SELECT MIN(recorded_at) as t FROM sensor_readings").fetchone()["t"]
        newest = db.execute("SELECT MAX(recorded_at) as t FROM sensor_readings").fetchone()["t"]

        # Latest value per sensor_name
        latest_rows = db.execute("""
            SELECT sensor_type, sensor_name, value, unit, recorded_at
            FROM sensor_readings sr1
            WHERE recorded_at = (
                SELECT MAX(recorded_at) FROM sensor_readings sr2
                WHERE sr2.sensor_name = sr1.sensor_name
            )
            GROUP BY sensor_name
            ORDER BY sensor_type, sensor_name
        """).fetchall()

        return {
            "raw_readings_count": total,
            "hourly_aggregates_count": hourly_total,
            "daily_aggregates_count": daily_total,
            "oldest_reading": oldest,
            "newest_reading": newest,
            "latest_per_sensor": [dict(r) for r in latest_rows],
        }


# ──────────────── SENSOR ASSIGNMENTS ────────────────

VALID_TARGET_TYPES = ('bed', 'ground_plant', 'tray', 'area')


@router.get("/api/sensors/available")
async def get_available_sensors(request: Request):
    """Return known HA sensor entities that can be assigned to planters."""
    require_user(request)
    sensors = []
    for location, entity_map in MOISTURE_SENSORS.items():
        for metric, entity_id in entity_map.items():
            sensors.append({
                "entity_id": entity_id,
                "location": location.replace("_", " ").title(),
                "metric": metric,
                "friendly_name": f"{location.replace('_', ' ').title()} - {metric.replace('_', ' ').title()}",
            })
    return {"sensors": sensors}


@router.get("/api/sensors/assignments")
def list_sensor_assignments(request: Request):
    """List all sensor-to-planter assignments."""
    require_user(request)
    with get_db() as db:
        rows = db.execute("SELECT * FROM sensor_assignments ORDER BY created_at DESC").fetchall()
        return [dict(r) for r in rows]


@router.put("/api/sensors/assignments")
async def upsert_sensor_assignment(request: Request):
    """Assign a HA sensor entity to a planter/ground plant/tray/area."""
    require_user(request)
    body = await request.json()
    entity_id = body.get("entity_id", "").strip()
    entity_friendly_name = body.get("entity_friendly_name", "").strip() or None
    target_type = body.get("target_type", "").strip()
    target_id = body.get("target_id")
    sensor_role = body.get("sensor_role", "soil_moisture").strip()

    if not entity_id:
        raise HTTPException(status_code=400, detail="entity_id is required")
    if target_type not in VALID_TARGET_TYPES:
        raise HTTPException(status_code=400, detail=f"target_type must be one of {VALID_TARGET_TYPES}")
    if not target_id:
        raise HTTPException(status_code=400, detail="target_id is required")

    with get_db() as db:
        # Upsert: replace on conflict
        db.execute("""
            INSERT INTO sensor_assignments (entity_id, entity_friendly_name, target_type, target_id, sensor_role)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(entity_id, target_type, target_id) DO UPDATE SET
                entity_friendly_name = excluded.entity_friendly_name,
                sensor_role = excluded.sensor_role
        """, (entity_id, entity_friendly_name, target_type, int(target_id), sensor_role))
        db.commit()
        row = db.execute(
            "SELECT * FROM sensor_assignments WHERE entity_id = ? AND target_type = ? AND target_id = ?",
            (entity_id, target_type, int(target_id))
        ).fetchone()
        return dict(row)


@router.delete("/api/sensors/assignments/{assignment_id}")
def delete_sensor_assignment(assignment_id: int, request: Request):
    """Remove a sensor assignment."""
    require_user(request)
    with get_db() as db:
        existing = db.execute("SELECT id FROM sensor_assignments WHERE id = ?", (assignment_id,)).fetchone()
        if not existing:
            raise HTTPException(status_code=404, detail="Assignment not found")
        db.execute("DELETE FROM sensor_assignments WHERE id = ?", (assignment_id,))
        db.commit()
        return {"ok": True}


@router.get("/api/sensors/readings/{target_type}/{target_id}")
async def get_sensor_readings_for_target(target_type: str, target_id: int, request: Request):
    """Get live sensor readings for a specific planter/ground plant/tray/area."""
    require_user(request)
    if target_type not in VALID_TARGET_TYPES:
        raise HTTPException(status_code=400, detail=f"target_type must be one of {VALID_TARGET_TYPES}")

    with get_db() as db:
        assignments = db.execute(
            "SELECT * FROM sensor_assignments WHERE target_type = ? AND target_id = ?",
            (target_type, target_id)
        ).fetchall()

    if not assignments:
        return {"assignments": [], "readings": []}

    # Fetch live state from HA for each assigned sensor
    entity_ids = [a["entity_id"] for a in assignments]
    states = await _ha_get_states_bulk(entity_ids)

    readings = []
    for assignment in assignments:
        a = dict(assignment)
        state = states.get(a["entity_id"])
        reading = {
            "assignment_id": a["id"],
            "entity_id": a["entity_id"],
            "entity_friendly_name": a["entity_friendly_name"],
            "sensor_role": a["sensor_role"],
            "state": None,
            "unit": None,
            "last_updated": None,
        }
        if state:
            reading["state"] = _safe_float(state.get("state")) if state.get("state") not in ("unavailable", "unknown") else None
            reading["unit"] = state.get("attributes", {}).get("unit_of_measurement")
            reading["last_updated"] = state.get("last_updated")
            reading["friendly_name"] = state.get("attributes", {}).get("friendly_name")
        readings.append(reading)

    return {"assignments": [dict(a) for a in assignments], "readings": readings}


# ──────────────── SHOPPING LIST ────────────────

