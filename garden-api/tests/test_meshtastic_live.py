"""
Live integration tests for Meshtastic GGMP transport.

Requires: Meshtastic node reachable at 192.168.3.55:4403
Run with: pytest tests/test_meshtastic_live.py -v -s

Discovered channel layout on 192.168.3.55 (2026-04-03):
  [0] MediumFast  (role=PRIMARY)
  [1] Weather     (role=SECONDARY)
  [2] forest-chat (role=SECONDARY)
  [3] Fireflies   (role=SECONDARY)
  [4] gem-and-jam (role=SECONDARY)
  [5] azmsh       (role=SECONDARY)
  [6] gardening   (role=SECONDARY)  <- Garden Godmother channel
  [7] glendale    (role=SECONDARY)

Python 3.9 compatibility note:
  meshtastic_codec.py and meshtastic_transport.py use PEP 604 union
  annotations (X | Y) that require Python 3.10+.  We load them via
  exec() after prepending ``from __future__ import annotations`` so the
  annotations are stored as strings instead of being evaluated at import
  time.  No application source files are modified.
"""
from __future__ import annotations

import os
import socket
import sys
import time
import types
import uuid

import pytest

# ---------------------------------------------------------------------------
# Path setup
# ---------------------------------------------------------------------------

_PARENT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _PARENT_DIR not in sys.path:
    sys.path.insert(0, _PARENT_DIR)


# ---------------------------------------------------------------------------
# Python 3.9 shim: load modules that use X|Y annotation syntax
# ---------------------------------------------------------------------------

def _load_module_compat(name: str) -> types.ModuleType | None:
    """
    Compile *name*.py with ``from __future__ import annotations`` prepended
    so that PEP 604 (X | Y) annotations don't cause a TypeError on Python 3.9.

    The module is registered in sys.modules BEFORE exec so that @dataclass
    can resolve ``cls.__module__`` correctly (Python 3.9 dataclasses look up
    the module via sys.modules at class-definition time).
    """
    src_path = os.path.join(_PARENT_DIR, f"{name}.py")
    try:
        with open(src_path) as fh:
            source = fh.read()
        patched = "from __future__ import annotations\n" + source
        code = compile(patched, src_path, "exec")
        # Pre-register so dataclasses can find the module dict
        mod = types.ModuleType(name)
        mod.__file__ = src_path
        sys.modules[name] = mod
        exec(code, mod.__dict__)  # noqa: S102  — isolated test shim only
        return mod
    except Exception as exc:
        # Remove broken module registration and report
        sys.modules.pop(name, None)
        sys.stderr.write(f"[shim] could not load {name}: {exc}\n")
        return None


_codec = _load_module_compat("meshtastic_codec")
_transport_mod = _load_module_compat("meshtastic_transport")


# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

MESHTASTIC_HOST = "192.168.3.55"
MESHTASTIC_PORT = 4403
GARDENING_CHANNEL_INDEX = 6
GARDENING_CHANNEL_NAME = "gardening"
GGMP_PORT = 256  # Private app portnum (matches meshtastic_transport.GGMP_PORT)


# ---------------------------------------------------------------------------
# Availability guard
# ---------------------------------------------------------------------------

def _node_available() -> bool:
    """Return True if TCP port 4403 answers within 3 seconds."""
    try:
        s = socket.create_connection((MESHTASTIC_HOST, MESHTASTIC_PORT), timeout=3)
        s.close()
        return True
    except OSError:
        return False


requires_node = pytest.mark.skipif(
    not _node_available(),
    reason=f"Meshtastic node at {MESHTASTIC_HOST}:{MESHTASTIC_PORT} not reachable",
)


# ---------------------------------------------------------------------------
# Test helpers
# ---------------------------------------------------------------------------

def _fresh_keypair():
    """Generate a fresh Ed25519 keypair using federation_crypto."""
    from federation_crypto import generate_keypair  # type: ignore
    # generate_keypair() -> (public_key_b64, private_key_b64)
    pub, priv = generate_keypair()
    return pub, priv


def _fresh_instance_id() -> str:
    return str(uuid.uuid4())


def _open_iface():
    import meshtastic.tcp_interface  # type: ignore
    return meshtastic.tcp_interface.TCPInterface(MESHTASTIC_HOST)


# ---------------------------------------------------------------------------
# 1 — Connectivity
# ---------------------------------------------------------------------------

@requires_node
def test_tcp_connect():
    """Node accepts TCP connection on port 4403 and populates myInfo."""
    iface = _open_iface()
    try:
        assert iface.myInfo is not None, "myInfo should be populated after connect"
        assert iface.myInfo.my_node_num != 0, "Node number should be non-zero"
    finally:
        iface.close()


# ---------------------------------------------------------------------------
# 2 — Channel discovery
# ---------------------------------------------------------------------------

@requires_node
def test_gardening_channel_exists():
    """'gardening' channel is present and at index 6."""
    iface = _open_iface()
    try:
        channels: dict[str, int] = {}
        if hasattr(iface, "localNode") and iface.localNode:
            for ch in iface.localNode.channels:
                if ch and hasattr(ch, "settings") and ch.settings.name:
                    channels[ch.settings.name.lower()] = ch.index
        assert GARDENING_CHANNEL_NAME in channels, (
            f"'gardening' not found. Available: {list(channels.keys())}"
        )
        found_idx = channels[GARDENING_CHANNEL_NAME]
        assert found_idx == GARDENING_CHANNEL_INDEX, (
            f"Expected gardening at index {GARDENING_CHANNEL_INDEX}, got {found_idx}"
        )
        print(f"\n  'gardening' channel confirmed at index {found_idx}")
    finally:
        iface.close()


@requires_node
def test_list_all_channels():
    """Print all channels for informational purposes (always passes)."""
    iface = _open_iface()
    try:
        print(f"\n  Channels on {MESHTASTIC_HOST}:")
        if hasattr(iface, "localNode") and iface.localNode:
            for ch in iface.localNode.channels:
                if ch and hasattr(ch, "settings"):
                    print(f"    [{ch.index}] {ch.settings.name!r} (role={ch.role})")
    finally:
        iface.close()


# ---------------------------------------------------------------------------
# 3 — GGMP codec round-trips (no live node required)
# ---------------------------------------------------------------------------

def test_codec_loadable():
    """meshtastic_codec must load on this Python version."""
    assert _codec is not None, "meshtastic_codec could not be loaded"


def test_encode_decode_profile_roundtrip():
    """PROFILE encode→decode round-trip preserves display_name and pubkey."""
    assert _codec is not None, "codec not available"
    pub, priv = _fresh_keypair()
    iid = _fresh_instance_id()

    payload = _codec.encode_profile("QA Tester", pub)
    frame = _codec.encode_message(_codec.MsgType.PROFILE, iid, payload, priv)
    msg = _codec.decode_message(frame)

    assert msg is not None
    assert msg.msg_type == _codec.MsgType.PROFILE
    decoded = _codec.decode_profile(msg.payload)
    assert decoded is not None
    assert decoded["display_name"] == "QA Tester"


def test_encode_decode_plant_list_roundtrip():
    """PLANT_LIST encode→decode round-trip preserves plant names."""
    assert _codec is not None, "codec not available"
    pub, priv = _fresh_keypair()
    iid = _fresh_instance_id()
    plants_in = ["Tomato", "Basil", "Zucchini", "Kale"]

    payload = _codec.encode_plant_list(plants_in)
    frame = _codec.encode_message(_codec.MsgType.PLANT_LIST, iid, payload, priv)
    msg = _codec.decode_message(frame)

    assert msg is not None
    plants_out = _codec.decode_plant_list(msg.payload)
    assert plants_out == plants_in


def test_profile_beacon_size_within_200_bytes():
    """Encoded PROFILE beacon must fit within the 200-byte MTU."""
    assert _codec is not None, "codec not available"
    pub, priv = _fresh_keypair()
    iid = _fresh_instance_id()

    payload = _codec.encode_profile("GardenGodmother-QA", pub)
    frame = _codec.encode_message(_codec.MsgType.PROFILE, iid, payload, priv)
    assert len(frame) <= _codec.MAX_MSG_SIZE, f"Frame too large: {len(frame)} bytes"


def test_frame_starts_with_gg_magic():
    """All encoded frames must start with b'GG'."""
    assert _codec is not None, "codec not available"
    pub, priv = _fresh_keypair()
    iid = _fresh_instance_id()

    payload = _codec.encode_profile("QA", pub)
    frame = _codec.encode_message(_codec.MsgType.PROFILE, iid, payload, priv)
    assert frame[:2] == b"GG"


def test_instance_id_prefix_embedded_in_frame():
    """The first 4 bytes after the 4-byte header must be the UUID prefix."""
    assert _codec is not None, "codec not available"
    pub, priv = _fresh_keypair()
    iid = _fresh_instance_id()

    payload = _codec.encode_profile("QA", pub)
    frame = _codec.encode_message(_codec.MsgType.PROFILE, iid, payload, priv)
    msg = _codec.decode_message(frame)
    expected = bytes.fromhex(iid.replace("-", "")[:8])
    assert msg.instance_id_prefix == expected


def test_signature_is_nonzero():
    """The 8-byte trailing signature must not be all zeros."""
    assert _codec is not None, "codec not available"
    pub, priv = _fresh_keypair()
    iid = _fresh_instance_id()

    payload = _codec.encode_profile("QA", pub)
    frame = _codec.encode_message(_codec.MsgType.PROFILE, iid, payload, priv)
    sig = frame[-_codec.SIG_SIZE:]
    assert sig != b"\x00" * _codec.SIG_SIZE


# ---------------------------------------------------------------------------
# 4 — Send PROFILE beacon over the live mesh
# ---------------------------------------------------------------------------

@requires_node
def test_send_profile_beacon_on_gardening_channel():
    """Send a PROFILE beacon on channel 6 (gardening) without error."""
    assert _codec is not None, "codec not available"
    pub, priv = _fresh_keypair()
    iid = _fresh_instance_id()

    payload = _codec.encode_profile("GG-QA", pub)
    frame = _codec.encode_message(_codec.MsgType.PROFILE, iid, payload, priv)

    iface = _open_iface()
    try:
        iface.sendData(
            frame,
            portNum=GGMP_PORT,
            channelIndex=GARDENING_CHANNEL_INDEX,
            wantAck=False,
        )
        print(f"\n  PROFILE beacon sent: {len(frame)} bytes on channel {GARDENING_CHANNEL_INDEX}")
    finally:
        iface.close()


# ---------------------------------------------------------------------------
# 5 — Send PLANT_LIST beacon over the live mesh
# ---------------------------------------------------------------------------

@requires_node
def test_send_plant_list_beacon_on_gardening_channel():
    """Send a PLANT_LIST beacon on channel 6 (gardening) without error."""
    assert _codec is not None, "codec not available"
    pub, priv = _fresh_keypair()
    iid = _fresh_instance_id()

    plants = ["Tomato", "Basil", "Zucchini", "Nopal", "Kale", "Pepper"]
    payload = _codec.encode_plant_list(plants)
    frame = _codec.encode_message(_codec.MsgType.PLANT_LIST, iid, payload, priv)

    iface = _open_iface()
    try:
        iface.sendData(
            frame,
            portNum=GGMP_PORT,
            channelIndex=GARDENING_CHANNEL_INDEX,
            wantAck=False,
        )
        print(f"\n  PLANT_LIST beacon sent: {len(frame)} bytes on channel {GARDENING_CHANNEL_INDEX}")
    finally:
        iface.close()


# ---------------------------------------------------------------------------
# 6 — Receive listener (5-second window)
# ---------------------------------------------------------------------------

@requires_node
def test_receive_window_collects_ggmp_packets():
    """
    Subscribe to inbound mesh packets for 5 seconds and decode any GGMP frames.
    Passes whether or not packets arrive — it only fails on subscription error.
    """
    assert _codec is not None, "codec not available"
    from pubsub import pub  # type: ignore

    received_ggmp: list = []

    def on_receive(packet, interface):
        decoded = packet.get("decoded", {})
        raw = decoded.get("payload", b"")
        if raw and raw[:2] == _codec.MAGIC:
            msg = _codec.decode_message(raw)
            if msg:
                received_ggmp.append({
                    "type": msg.msg_type.name,
                    "peer": msg.instance_id_prefix.hex(),
                    "payload_len": len(msg.payload),
                })

    iface = _open_iface()
    try:
        pub.subscribe(on_receive, "meshtastic.receive")
        print(f"\n  Listening for GGMP packets (port {GGMP_PORT}) for 5 seconds...")
        time.sleep(5)
        try:
            pub.unsubscribe(on_receive, "meshtastic.receive")
        except Exception:
            pass
    finally:
        iface.close()

    print(f"  GGMP packets received in 5s window: {len(received_ggmp)}")
    for pkt in received_ggmp:
        print(f"    type={pkt['type']} peer={pkt['peer']} payload={pkt['payload_len']}B")


# ---------------------------------------------------------------------------
# 7 — MeshtasticTransport class smoke tests
# ---------------------------------------------------------------------------

def test_transport_module_loadable():
    """meshtastic_transport must load on this Python version."""
    assert _transport_mod is not None, "meshtastic_transport could not be loaded"


@requires_node
def test_transport_is_connected_after_manual_interface_assign():
    """MeshtasticTransport.is_connected is True when interface is set."""
    assert _transport_mod is not None, "transport module not available"
    MeshtasticTransport = _transport_mod.MeshtasticTransport

    transport = MeshtasticTransport(hostname=MESHTASTIC_HOST)
    assert transport.is_connected is False, "should be disconnected before interface is set"

    iface = _open_iface()
    transport.interface = iface
    try:
        assert transport.is_connected is True
        print(f"\n  MeshtasticTransport.is_connected=True after manual interface assign")
    finally:
        transport.stop()


def test_transport_stop_when_not_connected():
    """MeshtasticTransport.stop() must not raise when never connected."""
    assert _transport_mod is not None, "transport module not available"
    MeshtasticTransport = _transport_mod.MeshtasticTransport

    transport = MeshtasticTransport(hostname=MESHTASTIC_HOST)
    transport.stop()  # should be a safe no-op
