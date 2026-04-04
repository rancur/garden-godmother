"""
GGMP v1 — Garden Godmother Mesh Protocol
Binary message codec for Meshtastic LoRa transport.
All messages ≤ 200 bytes.

Wire format:
  Bytes 0-1:  Magic "GG" (0x47 0x47)
  Byte  2:    Protocol version (0x01)
  Byte  3:    Message type code
  Bytes 4-7:  Instance ID (first 4 bytes of UUID, no hyphens, hex decoded)
  Bytes 8-N:  Payload (variable, type-specific)
  Last  8:    Signature (first 8 bytes of Ed25519 sig over header+payload)

MAX_PAYLOAD = 188  (200 - 2 magic - 1 version - 1 type - 4 instance - 8 sig)
"""
import struct
import hashlib
import base64
from enum import IntEnum
from dataclasses import dataclass


MAGIC = b"GG"
VERSION = 0x01
MAX_MSG_SIZE = 200
HEADER_SIZE = 8   # magic(2) + version(1) + type(1) + instance_id(4)
SIG_SIZE = 8
MAX_PAYLOAD_SIZE = MAX_MSG_SIZE - HEADER_SIZE - SIG_SIZE  # 184


class MsgType(IntEnum):
    PROFILE   = 0x01   # identity beacon
    HARVEST   = 0x02   # harvest offer
    PLANT_LIST = 0x03  # what we're growing (truncated list)
    ALERT     = 0x04   # pest/weather alert
    INTEREST  = 0x05   # interest in an offer
    RETRACT   = 0x06   # retract an offer


@dataclass
class GGMessage:
    msg_type: MsgType
    instance_id_prefix: bytes   # 4 bytes
    payload: bytes
    signature: bytes            # 8 bytes (truncated Ed25519)


def _instance_id_to_bytes(instance_id: str) -> bytes:
    """Convert UUID string to 4-byte prefix (first 4 bytes of hex-decoded UUID)."""
    clean = instance_id.replace("-", "")
    return bytes.fromhex(clean[:8])


def _build_signable(msg_type: int, instance_id_prefix: bytes, payload: bytes) -> bytes:
    return bytes([VERSION, msg_type]) + instance_id_prefix + payload


def encode_message(msg_type: MsgType, instance_id: str, payload: bytes, private_key_b64: str) -> bytes:
    """Encode a GGMP message. Payload must be <= MAX_PAYLOAD_SIZE bytes."""
    if len(payload) > MAX_PAYLOAD_SIZE:
        raise ValueError(f"Payload {len(payload)} bytes exceeds max {MAX_PAYLOAD_SIZE}")

    iid = _instance_id_to_bytes(instance_id)
    signable = _build_signable(int(msg_type), iid, payload)

    # Full Ed25519 signature, truncated to 8 bytes for wire format
    from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
    private_bytes = base64.b64decode(private_key_b64)
    private_key = Ed25519PrivateKey.from_private_bytes(private_bytes)
    full_sig = private_key.sign(signable)
    truncated_sig = full_sig[:SIG_SIZE]

    return MAGIC + bytes([VERSION, int(msg_type)]) + iid + payload + truncated_sig


def decode_message(raw: bytes) -> GGMessage | None:
    """Decode a raw GGMP message. Returns None if invalid magic/version."""
    if len(raw) < HEADER_SIZE + SIG_SIZE:
        return None
    if raw[:2] != MAGIC or raw[2] != VERSION:
        return None

    msg_type_byte = raw[3]
    try:
        msg_type = MsgType(msg_type_byte)
    except ValueError:
        return None

    iid = raw[4:8]
    payload = raw[8:-SIG_SIZE]
    sig = raw[-SIG_SIZE:]

    return GGMessage(msg_type=msg_type, instance_id_prefix=iid, payload=payload, signature=sig)


# ── Payload encoders/decoders ────────────────────────────────────────

def encode_profile(display_name: str, public_key_b64: str) -> bytes:
    """PROFILE beacon: 1-byte name_len + name + 32-byte pubkey"""
    name_bytes = display_name.encode("utf-8")[:30]  # max 30 chars
    pubkey_bytes = base64.b64decode(public_key_b64)[:32]
    return bytes([len(name_bytes)]) + name_bytes + pubkey_bytes


def decode_profile(payload: bytes) -> dict | None:
    """Decode PROFILE payload. Returns {display_name, public_key_b64} or None."""
    try:
        name_len = payload[0]
        display_name = payload[1:1+name_len].decode("utf-8")
        pubkey_raw = payload[1+name_len:1+name_len+32]
        return {
            "display_name": display_name,
            "public_key_b64": base64.b64encode(pubkey_raw).decode(),
        }
    except Exception:
        return None


def encode_plant_list(plants: list[str]) -> bytes:
    """PLANT_LIST: pack as many plant names as fit, newline-separated, truncated."""
    joined = "\n".join(plants).encode("utf-8")
    return joined[:MAX_PAYLOAD_SIZE]


def decode_plant_list(payload: bytes) -> list[str]:
    """Decode PLANT_LIST payload."""
    try:
        return payload.decode("utf-8").split("\n")
    except Exception:
        return []


def encode_harvest(plant_name: str, quantity: str, offer_id: int) -> bytes:
    """HARVEST offer: 2-byte offer_id + 1-byte plen + plant + 1-byte qlen + qty"""
    pname = plant_name.encode("utf-8")[:50]
    qty = quantity.encode("utf-8")[:80]
    return struct.pack(">H", offer_id & 0xFFFF) + bytes([len(pname)]) + pname + bytes([len(qty)]) + qty


def decode_harvest(payload: bytes) -> dict | None:
    """Decode HARVEST payload."""
    try:
        offer_id = struct.unpack(">H", payload[:2])[0]
        plen = payload[2]
        plant_name = payload[3:3+plen].decode("utf-8")
        qlen = payload[3+plen]
        quantity = payload[4+plen:4+plen+qlen].decode("utf-8")
        return {"offer_id": offer_id, "plant_name": plant_name, "quantity": quantity}
    except Exception:
        return None


def encode_alert(alert_type: str, title: str, severity: str = "info") -> bytes:
    """ALERT: 1-byte severity + 1-byte type_len + type + 1-byte title_len + title"""
    sev_map = {"info": 0, "warning": 1, "urgent": 2}
    sev_byte = sev_map.get(severity, 0)
    atype = alert_type.encode("utf-8")[:20]
    atitle = title.encode("utf-8")[:100]
    return bytes([sev_byte, len(atype)]) + atype + bytes([len(atitle)]) + atitle


def decode_alert(payload: bytes) -> dict | None:
    """Decode ALERT payload."""
    sev_names = {0: "info", 1: "warning", 2: "urgent"}
    try:
        sev = sev_names.get(payload[0], "info")
        tlen = payload[1]
        alert_type = payload[2:2+tlen].decode("utf-8")
        alen = payload[2+tlen]
        title = payload[3+tlen:3+tlen+alen].decode("utf-8")
        return {"severity": sev, "alert_type": alert_type, "title": title}
    except Exception:
        return None


def encode_interest(offer_id: int) -> bytes:
    """INTEREST in an offer: just the 2-byte offer_id"""
    return struct.pack(">H", offer_id & 0xFFFF)


def encode_retract(offer_id: int) -> bytes:
    """RETRACT an offer: just the 2-byte offer_id"""
    return struct.pack(">H", offer_id & 0xFFFF)
