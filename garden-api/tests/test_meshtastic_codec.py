"""Unit tests for the GGMP (Garden God Mother Protocol) Meshtastic codec.

These tests verify the binary codec without requiring any real radio hardware.
All tests operate on in-memory bytes only.

The codec is expected to live at ``garden-api/meshtastic_codec.py`` and
export the symbols listed in the imports below.
"""
from __future__ import annotations

import sys
from pathlib import Path

import pytest

# Ensure the garden-api directory is on the path so we can import the codec.
sys.path.insert(0, str(Path(__file__).parent.parent))

from meshtastic_codec import (
    encode_message,
    decode_message,
    MsgType,
    GGMessage,
    encode_profile,
    decode_profile,
    encode_plant_list,
    decode_plant_list,
    encode_harvest,
    decode_harvest,
    encode_alert,
    decode_alert,
    encode_interest,
    encode_retract,
    MAX_MSG_SIZE,
)

# Magic bytes that GGMP frames begin with
_MAGIC = b"GG"
_PROTOCOL_VERSION = 1


# ═══════════════════════════════════════════════════════════════════════════
# MAX_MSG_SIZE constant
# ═══════════════════════════════════════════════════════════════════════════

class TestMaxMsgSize:
    def test_max_msg_size_is_200(self):
        assert MAX_MSG_SIZE == 200

    def test_max_msg_size_is_int(self):
        assert isinstance(MAX_MSG_SIZE, int)


# ═══════════════════════════════════════════════════════════════════════════
# encode_message / decode_message — framing layer
# ═══════════════════════════════════════════════════════════════════════════

class TestEncodeMessage:
    def test_returns_bytes(self):
        result = encode_message(MsgType.PROFILE, b"payload")
        assert isinstance(result, bytes)

    def test_within_max_size(self):
        result = encode_message(MsgType.PROFILE, b"small payload")
        assert len(result) <= MAX_MSG_SIZE

    def test_starts_with_gg_magic(self):
        result = encode_message(MsgType.PROFILE, b"data")
        assert result[:2] == _MAGIC

    def test_version_byte_is_one(self):
        result = encode_message(MsgType.PROFILE, b"data")
        # Frame format: GG (2 bytes) | version (1 byte) | type (1 byte) | payload
        assert result[2] == _PROTOCOL_VERSION

    def test_type_byte_matches_msg_type(self):
        for msg_type in (MsgType.PROFILE, MsgType.PLANT_LIST, MsgType.HARVEST,
                         MsgType.ALERT, MsgType.INTEREST, MsgType.RETRACT):
            frame = encode_message(msg_type, b"x")
            assert frame[3] == int(msg_type), f"type byte wrong for {msg_type}"

    def test_empty_payload_allowed(self):
        result = encode_message(MsgType.INTEREST, b"")
        assert isinstance(result, bytes)
        assert result[:2] == _MAGIC

    def test_oversized_payload_raises_value_error(self):
        # Payload that, when framed, definitely exceeds 200 bytes
        oversized = b"x" * 300
        with pytest.raises(ValueError):
            encode_message(MsgType.PROFILE, oversized)


class TestDecodeMessage:
    def test_roundtrip_profile_type(self):
        payload = b"profile data"
        frame = encode_message(MsgType.PROFILE, payload)
        msg = decode_message(frame)
        assert msg is not None
        assert msg.msg_type == MsgType.PROFILE
        assert msg.payload == payload

    def test_roundtrip_plant_list_type(self):
        payload = b"plant list data"
        frame = encode_message(MsgType.PLANT_LIST, payload)
        msg = decode_message(frame)
        assert msg is not None
        assert msg.msg_type == MsgType.PLANT_LIST

    def test_roundtrip_harvest_type(self):
        payload = b"harvest data"
        frame = encode_message(MsgType.HARVEST, payload)
        msg = decode_message(frame)
        assert msg is not None
        assert msg.msg_type == MsgType.HARVEST

    def test_roundtrip_alert_type(self):
        payload = b"alert data"
        frame = encode_message(MsgType.ALERT, payload)
        msg = decode_message(frame)
        assert msg is not None
        assert msg.msg_type == MsgType.ALERT

    def test_roundtrip_interest_type(self):
        payload = b"\x01\x02"
        frame = encode_message(MsgType.INTEREST, payload)
        msg = decode_message(frame)
        assert msg is not None
        assert msg.msg_type == MsgType.INTEREST

    def test_roundtrip_retract_type(self):
        payload = b"\x01\x02"
        frame = encode_message(MsgType.RETRACT, payload)
        msg = decode_message(frame)
        assert msg is not None
        assert msg.msg_type == MsgType.RETRACT

    def test_payload_preserved_exactly(self):
        original = b"\x00\x01\x02\xfe\xff"
        frame = encode_message(MsgType.HARVEST, original)
        msg = decode_message(frame)
        assert msg.payload == original

    def test_returns_none_for_invalid_magic(self):
        bad_frame = b"XX" + b"\x01\x01" + b"payload"
        assert decode_message(bad_frame) is None

    def test_returns_none_for_wrong_version(self):
        # Correct magic, wrong version byte
        bad_frame = _MAGIC + b"\x99" + bytes([int(MsgType.PROFILE)]) + b"data"
        assert decode_message(bad_frame) is None

    def test_returns_none_for_too_short_input(self):
        assert decode_message(b"GG") is None
        assert decode_message(b"G") is None
        assert decode_message(b"") is None

    def test_returns_none_for_empty_bytes(self):
        assert decode_message(b"") is None

    def test_returns_gg_message_instance(self):
        frame = encode_message(MsgType.PROFILE, b"data")
        msg = decode_message(frame)
        assert isinstance(msg, GGMessage)


# ═══════════════════════════════════════════════════════════════════════════
# MsgType enum
# ═══════════════════════════════════════════════════════════════════════════

class TestMsgType:
    def test_all_expected_types_exist(self):
        for name in ("PROFILE", "PLANT_LIST", "HARVEST", "ALERT", "INTEREST", "RETRACT"):
            assert hasattr(MsgType, name), f"MsgType.{name} missing"

    def test_types_are_distinct(self):
        values = [int(t) for t in (
            MsgType.PROFILE, MsgType.PLANT_LIST, MsgType.HARVEST,
            MsgType.ALERT, MsgType.INTEREST, MsgType.RETRACT,
        )]
        assert len(values) == len(set(values)), "MsgType values must be unique"

    def test_types_fit_in_one_byte(self):
        for t in (MsgType.PROFILE, MsgType.PLANT_LIST, MsgType.HARVEST,
                  MsgType.ALERT, MsgType.INTEREST, MsgType.RETRACT):
            assert 0 <= int(t) <= 255, f"{t} out of byte range"


# ═══════════════════════════════════════════════════════════════════════════
# Profile encode / decode
# ═══════════════════════════════════════════════════════════════════════════

class TestProfileCodec:
    def test_encode_returns_bytes(self):
        result = encode_profile("Alice", "pubkey123")
        assert isinstance(result, bytes)

    def test_decode_returns_dict_or_namedtuple(self):
        raw = encode_profile("Alice", "pubkey123")
        result = decode_profile(raw)
        assert result is not None

    def test_display_name_preserved(self):
        raw = encode_profile("Gardener Bob", "pubkey456")
        result = decode_profile(raw)
        assert result["display_name"] == "Gardener Bob"

    def test_public_key_preserved(self):
        pub = "AAABBBCCC000"
        raw = encode_profile("Carol", pub)
        result = decode_profile(raw)
        assert result["public_key"] == pub

    def test_roundtrip_empty_display_name(self):
        raw = encode_profile("", "somekey")
        result = decode_profile(raw)
        assert result["display_name"] == ""

    def test_encoded_size_within_limit(self):
        raw = encode_profile("Alice", "pubkey123")
        assert len(raw) <= MAX_MSG_SIZE

    def test_unicode_display_name_preserved(self):
        name = "Gärtner"
        raw = encode_profile(name, "key")
        result = decode_profile(raw)
        assert result["display_name"] == name

    def test_full_frame_roundtrip_via_encode_decode_message(self):
        profile_bytes = encode_profile("Dave", "mypublickey")
        frame = encode_message(MsgType.PROFILE, profile_bytes)
        msg = decode_message(frame)
        assert msg.msg_type == MsgType.PROFILE
        result = decode_profile(msg.payload)
        assert result["display_name"] == "Dave"
        assert result["public_key"] == "mypublickey"


# ═══════════════════════════════════════════════════════════════════════════
# Plant list encode / decode
# ═══════════════════════════════════════════════════════════════════════════

class TestPlantListCodec:
    def test_encode_returns_bytes(self):
        result = encode_plant_list(["Tomato", "Basil"])
        assert isinstance(result, bytes)

    def test_empty_list_roundtrips(self):
        raw = encode_plant_list([])
        plants = decode_plant_list(raw)
        assert plants == []

    def test_single_plant_roundtrips(self):
        raw = encode_plant_list(["Tomato"])
        plants = decode_plant_list(raw)
        assert plants == ["Tomato"]

    def test_multiple_plants_roundtrip(self):
        original = ["Tomato", "Basil", "Zucchini", "Pepper"]
        raw = encode_plant_list(original)
        plants = decode_plant_list(raw)
        assert plants == original

    def test_encoded_size_within_limit_for_short_list(self):
        raw = encode_plant_list(["Tomato", "Basil", "Pepper"])
        assert len(raw) <= MAX_MSG_SIZE

    def test_long_list_truncated_to_fit(self):
        """Very long lists should be truncated rather than exceeding MAX_MSG_SIZE."""
        long_list = [f"Plant{i:03d}" for i in range(100)]
        raw = encode_plant_list(long_list)
        assert len(raw) <= MAX_MSG_SIZE
        plants = decode_plant_list(raw)
        # Should contain a subset starting from the beginning
        assert isinstance(plants, list)
        assert len(plants) <= len(long_list)
        if plants:
            assert plants[0] == long_list[0]

    def test_plants_are_strings(self):
        raw = encode_plant_list(["Cucumber", "Kale"])
        plants = decode_plant_list(raw)
        for p in plants:
            assert isinstance(p, str)

    def test_full_frame_roundtrip(self):
        plant_bytes = encode_plant_list(["Arugula", "Spinach"])
        frame = encode_message(MsgType.PLANT_LIST, plant_bytes)
        msg = decode_message(frame)
        assert msg.msg_type == MsgType.PLANT_LIST
        plants = decode_plant_list(msg.payload)
        assert "Arugula" in plants
        assert "Spinach" in plants


# ═══════════════════════════════════════════════════════════════════════════
# Harvest encode / decode
# ═══════════════════════════════════════════════════════════════════════════

class TestHarvestCodec:
    def test_encode_returns_bytes(self):
        result = encode_harvest(offer_id=1, plant_name="Tomato", quantity="5 lbs")
        assert isinstance(result, bytes)

    def test_offer_id_preserved(self):
        raw = encode_harvest(offer_id=42, plant_name="Zucchini", quantity="3 lbs")
        result = decode_harvest(raw)
        assert result["offer_id"] == 42

    def test_plant_name_preserved(self):
        raw = encode_harvest(offer_id=1, plant_name="Cucumber", quantity="2 lbs")
        result = decode_harvest(raw)
        assert result["plant_name"] == "Cucumber"

    def test_quantity_preserved(self):
        raw = encode_harvest(offer_id=1, plant_name="Pepper", quantity="About 20")
        result = decode_harvest(raw)
        assert result["quantity"] == "About 20"

    def test_encoded_size_within_limit(self):
        raw = encode_harvest(offer_id=1, plant_name="Tomato", quantity="5 lbs")
        assert len(raw) <= MAX_MSG_SIZE

    def test_roundtrip_all_fields(self):
        raw = encode_harvest(offer_id=99, plant_name="Carrot", quantity="A bunch")
        result = decode_harvest(raw)
        assert result["offer_id"] == 99
        assert result["plant_name"] == "Carrot"
        assert result["quantity"] == "A bunch"

    def test_full_frame_roundtrip(self):
        harvest_bytes = encode_harvest(offer_id=7, plant_name="Beet", quantity="1 lb")
        frame = encode_message(MsgType.HARVEST, harvest_bytes)
        msg = decode_message(frame)
        assert msg.msg_type == MsgType.HARVEST
        result = decode_harvest(msg.payload)
        assert result["offer_id"] == 7
        assert result["plant_name"] == "Beet"


# ═══════════════════════════════════════════════════════════════════════════
# Alert encode / decode
# ═══════════════════════════════════════════════════════════════════════════

class TestAlertCodec:
    def test_encode_returns_bytes(self):
        result = encode_alert(
            severity="info",
            alert_type="pest",
            title="Aphids spotted",
        )
        assert isinstance(result, bytes)

    def test_severity_info_preserved(self):
        raw = encode_alert(severity="info", alert_type="pest", title="Test")
        result = decode_alert(raw)
        assert result["severity"] == "info"

    def test_severity_warning_preserved(self):
        raw = encode_alert(severity="warning", alert_type="disease", title="Blight")
        result = decode_alert(raw)
        assert result["severity"] == "warning"

    def test_severity_urgent_preserved(self):
        raw = encode_alert(severity="urgent", alert_type="frost", title="Hard freeze")
        result = decode_alert(raw)
        assert result["severity"] == "urgent"

    def test_alert_type_preserved(self):
        raw = encode_alert(severity="info", alert_type="weather", title="Rain")
        result = decode_alert(raw)
        assert result["alert_type"] == "weather"

    def test_title_preserved(self):
        raw = encode_alert(severity="info", alert_type="pest", title="Slugs on lettuce")
        result = decode_alert(raw)
        assert result["title"] == "Slugs on lettuce"

    def test_encoded_size_within_limit(self):
        raw = encode_alert(severity="warning", alert_type="pest", title="Spider mites")
        assert len(raw) <= MAX_MSG_SIZE

    def test_roundtrip_all_fields(self):
        raw = encode_alert(
            severity="urgent",
            alert_type="frost",
            title="Frost warning tonight",
        )
        result = decode_alert(raw)
        assert result["severity"] == "urgent"
        assert result["alert_type"] == "frost"
        assert result["title"] == "Frost warning tonight"

    def test_full_frame_roundtrip(self):
        alert_bytes = encode_alert(severity="warning", alert_type="pest", title="Whitefly")
        frame = encode_message(MsgType.ALERT, alert_bytes)
        msg = decode_message(frame)
        assert msg.msg_type == MsgType.ALERT
        result = decode_alert(msg.payload)
        assert result["title"] == "Whitefly"
        assert result["severity"] == "warning"


# ═══════════════════════════════════════════════════════════════════════════
# Interest encode
# ═══════════════════════════════════════════════════════════════════════════

class TestEncodeInterest:
    def test_encode_interest_returns_bytes(self):
        result = encode_interest(offer_id=1)
        assert isinstance(result, bytes)

    def test_encode_interest_is_exactly_two_bytes(self):
        result = encode_interest(offer_id=5)
        assert len(result) == 2

    def test_encode_interest_for_offer_zero(self):
        result = encode_interest(offer_id=0)
        assert len(result) == 2

    def test_encode_interest_for_offer_max_byte(self):
        result = encode_interest(offer_id=255)
        assert len(result) == 2

    def test_encode_interest_different_ids_differ(self):
        a = encode_interest(offer_id=1)
        b = encode_interest(offer_id=2)
        assert a != b

    def test_full_frame_encode_interest(self):
        interest_bytes = encode_interest(offer_id=3)
        frame = encode_message(MsgType.INTEREST, interest_bytes)
        msg = decode_message(frame)
        assert msg is not None
        assert msg.msg_type == MsgType.INTEREST
        assert msg.payload == interest_bytes


# ═══════════════════════════════════════════════════════════════════════════
# Retract encode
# ═══════════════════════════════════════════════════════════════════════════

class TestEncodeRetract:
    def test_encode_retract_returns_bytes(self):
        result = encode_retract(offer_id=1)
        assert isinstance(result, bytes)

    def test_encode_retract_is_exactly_two_bytes(self):
        result = encode_retract(offer_id=10)
        assert len(result) == 2

    def test_encode_retract_for_offer_zero(self):
        result = encode_retract(offer_id=0)
        assert len(result) == 2

    def test_encode_retract_different_ids_differ(self):
        a = encode_retract(offer_id=1)
        b = encode_retract(offer_id=2)
        assert a != b

    def test_interest_and_retract_same_id_differ(self):
        """Interest and retract for the same offer_id must produce different bytes."""
        interest = encode_interest(offer_id=5)
        retract = encode_retract(offer_id=5)
        assert interest != retract

    def test_full_frame_encode_retract(self):
        retract_bytes = encode_retract(offer_id=7)
        frame = encode_message(MsgType.RETRACT, retract_bytes)
        msg = decode_message(frame)
        assert msg is not None
        assert msg.msg_type == MsgType.RETRACT
        assert msg.payload == retract_bytes


# ═══════════════════════════════════════════════════════════════════════════
# GGMessage data class / namedtuple
# ═══════════════════════════════════════════════════════════════════════════

class TestGGMessage:
    def test_has_msg_type_attribute(self):
        frame = encode_message(MsgType.PROFILE, b"data")
        msg = decode_message(frame)
        assert hasattr(msg, "msg_type")

    def test_has_payload_attribute(self):
        frame = encode_message(MsgType.PROFILE, b"data")
        msg = decode_message(frame)
        assert hasattr(msg, "payload")

    def test_msg_type_is_msg_type_enum(self):
        frame = encode_message(MsgType.HARVEST, b"data")
        msg = decode_message(frame)
        assert isinstance(msg.msg_type, MsgType)

    def test_payload_is_bytes(self):
        frame = encode_message(MsgType.PLANT_LIST, b"abc")
        msg = decode_message(frame)
        assert isinstance(msg.payload, bytes)
