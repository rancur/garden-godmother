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
"""
import sys
import os
import time
import socket

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

MESHTASTIC_HOST = "192.168.3.55"
MESHTASTIC_PORT = 4403
GARDENING_CHANNEL_INDEX = 6
GARDENING_CHANNEL_NAME = "gardening"
GGMP_PORT = 256


def _node_available() -> bool:
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


@requires_node
def test_tcp_connect():
    """Node accepts TCP connection on port 4403."""
    import meshtastic.tcp_interface
    iface = meshtastic.tcp_interface.TCPInterface(MESHTASTIC_HOST)
    try:
        assert iface.myInfo is not None, "myInfo should be populated after connect"
    finally:
        iface.close()


@requires_node
def test_gardening_channel_exists():
    """'gardening' channel is present at index 6."""
    import meshtastic.tcp_interface
    iface = meshtastic.tcp_interface.TCPInterface(MESHTASTIC_HOST)
    try:
        channels = {}
        if hasattr(iface, "localNode") and iface.localNode:
            for ch in iface.localNode.channels:
                if ch and hasattr(ch, "settings") and ch.settings.name:
                    channels[ch.settings.name.lower()] = ch.index
        assert GARDENING_CHANNEL_NAME in channels, (
            f"'gardening' not found. Available: {list(channels.keys())}"
        )
        assert channels[GARDENING_CHANNEL_NAME] == GARDENING_CHANNEL_INDEX, (
            f"Expected gardening at index {GARDENING_CHANNEL_INDEX}, "
            f"got {channels[GARDENING_CHANNEL_NAME]}"
        )
    finally:
        iface.close()


@requires_node
def test_encode_profile_beacon_fits_in_mesh_packet():
    """PROFILE beacon fits within 200 bytes."""
    from meshtastic_codec import encode_message, encode_profile, MsgType, MAX_MSG_SIZE
    from federation_crypto import generate_keypair

    keys = generate_keypair()
    payload = encode_profile("Garden Godmother Test", keys["public_key"])
    frame = encode_message(MsgType.PROFILE, keys["instance_id"], payload, keys["private_key"])
    assert len(frame) <= MAX_MSG_SIZE, f"Frame too large: {len(frame)} bytes"


@requires_node
def test_send_profile_beacon_on_gardening_channel():
    """Send a PROFILE beacon on channel 6 (gardening) without error."""
    import meshtastic.tcp_interface
    from meshtastic_codec import encode_message, encode_profile, MsgType
    from federation_crypto import generate_keypair

    keys = generate_keypair()
    payload = encode_profile("GG-Test", keys["public_key"])
    frame = encode_message(MsgType.PROFILE, keys["instance_id"], payload, keys["private_key"])

    iface = meshtastic.tcp_interface.TCPInterface(MESHTASTIC_HOST)
    try:
        iface.sendData(frame, portNum=GGMP_PORT, channelIndex=GARDENING_CHANNEL_INDEX, wantAck=False)
    finally:
        iface.close()


@requires_node
def test_send_plant_list_beacon_on_gardening_channel():
    """Send a PLANT_LIST beacon on channel 6 (gardening) without error."""
    import meshtastic.tcp_interface
    from meshtastic_codec import encode_message, encode_plant_list, MsgType
    from federation_crypto import generate_keypair

    keys = generate_keypair()
    payload = encode_plant_list(["Tomato", "Basil", "Zucchini", "Nopal"])
    frame = encode_message(MsgType.PLANT_LIST, keys["instance_id"], payload, keys["private_key"])

    iface = meshtastic.tcp_interface.TCPInterface(MESHTASTIC_HOST)
    try:
        iface.sendData(frame, portNum=GGMP_PORT, channelIndex=GARDENING_CHANNEL_INDEX, wantAck=False)
    finally:
        iface.close()


@requires_node
def test_receive_window_collects_ggmp_packets():
    """Subscribe to mesh for 5 seconds and report any GGMP packets received."""
    import meshtastic.tcp_interface
    from pubsub import pub
    from meshtastic_codec import decode_message, MAGIC

    received_ggmp = []

    def on_receive(packet, interface):
        decoded = packet.get("decoded", {})
        raw = decoded.get("payload", b"")
        if raw and raw[:2] == MAGIC:
            msg = decode_message(raw)
            if msg:
                received_ggmp.append({
                    "type": msg.msg_type.name,
                    "peer": msg.instance_id_prefix.hex(),
                    "payload_len": len(msg.payload),
                })

    iface = meshtastic.tcp_interface.TCPInterface(MESHTASTIC_HOST)
    try:
        pub.subscribe(on_receive, "meshtastic.receive")
        time.sleep(5)
    finally:
        iface.close()

    print(f"\nGGMP packets received in 5s window: {len(received_ggmp)}")
    for pkt in received_ggmp:
        print(f"  type={pkt['type']} peer={pkt['peer']} payload={pkt['payload_len']}B")
