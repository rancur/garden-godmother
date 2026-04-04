"""
Meshtastic transport for Garden Co-op.
Handles device connection, GGMP beacon scheduling, and inbound message handling.

Requires: pip install meshtastic
Device connection: serial (USB) or TCP (network-connected node).
"""
import json
import logging
import threading
import time
from datetime import datetime, timezone

logger = logging.getLogger(__name__)

# Meshtastic channel app port for GGMP
GGMP_PORT = 256  # Private app portnum


def _get_identity_and_key():
    """Fetch our federation identity from the DB."""
    from db import get_db
    from federation_crypto import decrypt_private_key
    with get_db() as db:
        row = db.execute("SELECT * FROM federation_identity WHERE id=1").fetchone()
        if not row:
            return None, None
        d = dict(row)
        d["private_key"] = decrypt_private_key(d["private_key"])
        return d, d["private_key"]


def _store_peer_beacon(instance_id_hex: str, data: dict):
    """Store a received beacon's profile data in federation_peer_data."""
    from db import get_db
    with get_db() as db:
        peer_id = instance_id_hex  # use hex prefix as peer_id for mesh peers
        db.execute("""
            INSERT INTO federation_peer_data (peer_id, data_type, payload, fetched_at)
            VALUES (?, 'profile', ?, datetime('now'))
            ON CONFLICT(peer_id, data_type) DO UPDATE SET
                payload = excluded.payload,
                fetched_at = excluded.fetched_at
        """, (peer_id, json.dumps(data)))
        db.commit()


def send_profile_beacon(interface, channel_index: int = 0):
    """Broadcast our PROFILE beacon to the mesh."""
    from meshtastic_codec import encode_message, encode_profile, MsgType

    identity, private_key = _get_identity_and_key()
    if not identity:
        logger.debug("No federation identity, skipping beacon")
        return

    payload = encode_profile(identity["display_name"], identity["public_key"])
    msg = encode_message(MsgType.PROFILE, identity["instance_id"], payload, private_key)

    try:
        interface.sendData(msg, portNum=GGMP_PORT, channelIndex=channel_index, wantAck=False)
        logger.info(f"Sent PROFILE beacon ({len(msg)} bytes)")
    except Exception as e:
        logger.error(f"Failed to send beacon: {e}")


def send_harvest_beacon(interface, plant_name: str, quantity: str, offer_id: int, channel_index: int = 0):
    """Broadcast a HARVEST offer to the mesh."""
    from meshtastic_codec import encode_message, encode_harvest, MsgType

    identity, private_key = _get_identity_and_key()
    if not identity:
        return

    payload = encode_harvest(plant_name, quantity, offer_id)
    msg = encode_message(MsgType.HARVEST, identity["instance_id"], payload, private_key)

    try:
        interface.sendData(msg, portNum=GGMP_PORT, channelIndex=channel_index, wantAck=False)
        logger.info(f"Sent HARVEST beacon for {plant_name}")
    except Exception as e:
        logger.error(f"Failed to send harvest beacon: {e}")


def send_alert_beacon(interface, alert_type: str, title: str, severity: str = "info", channel_index: int = 0):
    """Broadcast an ALERT to the mesh."""
    from meshtastic_codec import encode_message, encode_alert, MsgType

    identity, private_key = _get_identity_and_key()
    if not identity:
        return

    payload = encode_alert(alert_type, title, severity)
    msg = encode_message(MsgType.ALERT, identity["instance_id"], payload, private_key)

    try:
        interface.sendData(msg, portNum=GGMP_PORT, channelIndex=channel_index, wantAck=False)
        logger.info(f"Sent ALERT beacon: {title}")
    except Exception as e:
        logger.error(f"Failed to send alert beacon: {e}")


def on_receive(packet, interface):
    """Handle an inbound GGMP packet from the mesh."""
    from meshtastic_codec import (
        decode_message, decode_profile, decode_harvest, decode_plant_list,
        decode_alert, MsgType
    )

    try:
        # Extract raw bytes from the packet
        if "decoded" not in packet:
            return
        decoded = packet["decoded"]
        if decoded.get("portnum") != GGMP_PORT:
            return
        raw = decoded.get("payload", b"")
        if not raw:
            return

        msg = decode_message(raw)
        if not msg:
            return

        # Convert instance_id_prefix to hex string
        peer_prefix = msg.instance_id_prefix.hex()

        logger.debug(f"Received GGMP {msg.msg_type.name} from {peer_prefix}")

        if msg.msg_type == MsgType.PROFILE:
            data = decode_profile(msg.payload)
            if data:
                _store_peer_beacon(peer_prefix, data)
                logger.info(f"Mesh peer beacon: {data.get('display_name')} ({peer_prefix})")

        elif msg.msg_type == MsgType.HARVEST:
            data = decode_harvest(msg.payload)
            if data:
                from db import get_db
                with get_db() as db:
                    existing = db.execute(
                        "SELECT payload FROM federation_peer_data WHERE peer_id=? AND data_type='harvest_offers'",
                        (peer_prefix,)
                    ).fetchone()
                    offers = json.loads(existing["payload"]) if existing else []
                    # Upsert by offer_id
                    offers = [o for o in offers if o.get("offer_id") != data["offer_id"]]
                    offers.append(data)
                    db.execute("""
                        INSERT INTO federation_peer_data (peer_id, data_type, payload, fetched_at)
                        VALUES (?, 'harvest_offers', ?, datetime('now'))
                        ON CONFLICT(peer_id, data_type) DO UPDATE SET
                            payload=excluded.payload, fetched_at=excluded.fetched_at
                    """, (peer_prefix, json.dumps(offers)))
                    db.commit()

        elif msg.msg_type == MsgType.PLANT_LIST:
            plants = decode_plant_list(msg.payload)
            from db import get_db
            with get_db() as db:
                db.execute("""
                    INSERT INTO federation_peer_data (peer_id, data_type, payload, fetched_at)
                    VALUES (?, 'plant_list', ?, datetime('now'))
                    ON CONFLICT(peer_id, data_type) DO UPDATE SET
                        payload=excluded.payload, fetched_at=excluded.fetched_at
                """, (peer_prefix, json.dumps(plants)))
                db.commit()

        elif msg.msg_type == MsgType.ALERT:
            data = decode_alert(msg.payload)
            if data:
                from db import get_db
                with get_db() as db:
                    db.execute("""
                        INSERT OR IGNORE INTO federation_alerts
                            (source_peer_id, alert_type, title, body, severity, published)
                        VALUES (?, ?, ?, ?, ?, 0)
                    """, (peer_prefix, data["alert_type"], data["title"], data["title"], data["severity"]))
                    db.commit()

    except Exception as e:
        logger.error(f"Error handling GGMP packet: {e}")


class MeshtasticTransport:
    """
    Manages a Meshtastic device connection and GGMP beacon scheduling.

    Usage:
        transport = MeshtasticTransport(dev_path="/dev/ttyUSB0")
        transport.start()  # connects + starts beacon thread
        transport.stop()

    Or for TCP:
        transport = MeshtasticTransport(hostname="meshtastic.local")
    """

    BEACON_INTERVAL = 30 * 60  # 30 minutes (mesh etiquette)

    def __init__(self, dev_path: str | None = None, hostname: str | None = None, channel_index: int = 0):
        self.dev_path = dev_path
        self.hostname = hostname
        self.channel_index = channel_index
        self.interface = None
        self._stop_event = threading.Event()
        self._beacon_thread = None

    def start(self):
        """Connect to device and start beacon thread."""
        try:
            import meshtastic
            import meshtastic.serial_interface
            import meshtastic.tcp_interface
            from pubsub import pub

            if self.hostname:
                self.interface = meshtastic.tcp_interface.TCPInterface(self.hostname)
            else:
                self.interface = meshtastic.serial_interface.SerialInterface(self.dev_path)

            pub.subscribe(lambda packet, interface: on_receive(packet, interface), "meshtastic.receive")

            self._beacon_thread = threading.Thread(target=self._beacon_loop, daemon=True)
            self._beacon_thread.start()
            logger.info(f"Meshtastic transport started ({'TCP:' + self.hostname if self.hostname else self.dev_path})")

        except ImportError:
            logger.warning("meshtastic library not installed — mesh transport disabled")
        except Exception as e:
            logger.error(f"Failed to start Meshtastic transport: {e}")

    def stop(self):
        """Stop beacon thread and close device."""
        self._stop_event.set()
        if self.interface:
            try:
                self.interface.close()
            except Exception:
                pass
        logger.info("Meshtastic transport stopped")

    def _beacon_loop(self):
        """Send periodic PROFILE beacon every BEACON_INTERVAL seconds."""
        # Send one immediately on startup
        send_profile_beacon(self.interface, channel_index=self.channel_index)

        while not self._stop_event.wait(self.BEACON_INTERVAL):
            send_profile_beacon(self.interface, channel_index=self.channel_index)

    def broadcast_harvest(self, plant_name: str, quantity: str, offer_id: int):
        if self.interface:
            send_harvest_beacon(self.interface, plant_name, quantity, offer_id, channel_index=self.channel_index)

    def broadcast_alert(self, alert_type: str, title: str, severity: str = "info"):
        if self.interface:
            send_alert_beacon(self.interface, alert_type, title, severity, channel_index=self.channel_index)

    @property
    def is_connected(self) -> bool:
        return self.interface is not None


# Module-level singleton — set by main.py if device is configured
_transport: MeshtasticTransport | None = None

def get_transport() -> MeshtasticTransport | None:
    return _transport

def init_transport(dev_path: str | None = None, hostname: str | None = None, channel_index: int = 0):
    """Initialize the global transport. Called from main.py startup if MESHTASTIC_DEV or MESHTASTIC_HOST env vars are set."""
    global _transport
    _transport = MeshtasticTransport(dev_path=dev_path, hostname=hostname, channel_index=channel_index)
    _transport.start()
    return _transport
