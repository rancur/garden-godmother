"""Unit tests for federation_crypto.py — Ed25519 keypair, signing, verification, helpers."""
from __future__ import annotations

import base64
import re
import uuid
from datetime import datetime, timedelta, timezone

import pytest

import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))

from federation_crypto import (
    generate_keypair,
    sign_request,
    verify_request,
    verify_timestamp,
    generate_instance_id,
    generate_invite_code,
    get_key_fingerprint,
)


# ── generate_keypair ───────────────────────────────────────────────────────

class TestGenerateKeypair:
    def test_returns_two_strings(self):
        pub, priv = generate_keypair()
        assert isinstance(pub, str)
        assert isinstance(priv, str)

    def test_both_are_valid_base64(self):
        pub, priv = generate_keypair()
        # Should not raise
        pub_bytes = base64.b64decode(pub)
        priv_bytes = base64.b64decode(priv)
        # Ed25519 raw keys are 32 bytes each
        assert len(pub_bytes) == 32
        assert len(priv_bytes) == 32

    def test_different_on_each_call(self):
        pub1, priv1 = generate_keypair()
        pub2, priv2 = generate_keypair()
        assert pub1 != pub2
        assert priv1 != priv2

    def test_public_and_private_differ(self):
        pub, priv = generate_keypair()
        assert pub != priv


# ── sign_request + verify_request ─────────────────────────────────────────

class TestSignVerifyRoundtrip:
    @pytest.fixture()
    def keypair(self):
        return generate_keypair()

    def test_roundtrip_basic(self, keypair):
        pub, priv = keypair
        ts = datetime.now(timezone.utc).isoformat()
        sig = sign_request(priv, "POST", "/api/federation/sync", ts, b'{"hello":"world"}')
        assert verify_request(pub, "POST", "/api/federation/sync", ts, b'{"hello":"world"}', sig)

    def test_roundtrip_empty_body(self, keypair):
        pub, priv = keypair
        ts = datetime.now(timezone.utc).isoformat()
        sig = sign_request(priv, "GET", "/api/federation/profile", ts, b"")
        assert verify_request(pub, "GET", "/api/federation/profile", ts, b"", sig)

    def test_wrong_key_fails(self, keypair):
        pub, priv = keypair
        pub2, _ = generate_keypair()
        ts = datetime.now(timezone.utc).isoformat()
        sig = sign_request(priv, "POST", "/api/test", ts, b"body")
        assert not verify_request(pub2, "POST", "/api/test", ts, b"body", sig)

    def test_tampered_body_fails(self, keypair):
        pub, priv = keypair
        ts = datetime.now(timezone.utc).isoformat()
        sig = sign_request(priv, "POST", "/api/test", ts, b"original body")
        assert not verify_request(pub, "POST", "/api/test", ts, b"tampered body", sig)

    def test_tampered_path_fails(self, keypair):
        pub, priv = keypair
        ts = datetime.now(timezone.utc).isoformat()
        sig = sign_request(priv, "POST", "/api/test", ts, b"body")
        assert not verify_request(pub, "POST", "/api/DIFFERENT", ts, b"body", sig)

    def test_tampered_method_fails(self, keypair):
        pub, priv = keypair
        ts = datetime.now(timezone.utc).isoformat()
        sig = sign_request(priv, "POST", "/api/test", ts, b"body")
        assert not verify_request(pub, "GET", "/api/test", ts, b"body", sig)

    def test_tampered_timestamp_fails(self, keypair):
        pub, priv = keypair
        ts = datetime.now(timezone.utc).isoformat()
        sig = sign_request(priv, "POST", "/api/test", ts, b"body")
        ts2 = (datetime.now(timezone.utc) + timedelta(seconds=1)).isoformat()
        assert not verify_request(pub, "POST", "/api/test", ts2, b"body", sig)

    def test_corrupted_signature_fails(self, keypair):
        pub, priv = keypair
        ts = datetime.now(timezone.utc).isoformat()
        sig = sign_request(priv, "POST", "/api/test", ts, b"body")
        # Flip a character in the base64 signature
        bad_sig = sig[:-4] + ("AAAA" if sig[-4:] != "AAAA" else "BBBB")
        assert not verify_request(pub, "POST", "/api/test", ts, b"body", bad_sig)

    def test_method_case_insensitive(self, keypair):
        """sign_request and verify_request both upper-case the method."""
        pub, priv = keypair
        ts = datetime.now(timezone.utc).isoformat()
        sig = sign_request(priv, "post", "/api/test", ts, b"body")
        # verify_request also calls .upper(), so this should pass
        assert verify_request(pub, "POST", "/api/test", ts, b"body", sig)

    def test_sign_returns_base64_string(self, keypair):
        _, priv = keypair
        ts = datetime.now(timezone.utc).isoformat()
        sig = sign_request(priv, "GET", "/path", ts)
        assert isinstance(sig, str)
        # Must be valid base64
        base64.b64decode(sig)


# ── verify_timestamp ───────────────────────────────────────────────────────

class TestVerifyTimestamp:
    def test_current_timestamp_passes(self):
        ts = datetime.now(timezone.utc).isoformat()
        assert verify_timestamp(ts) is True

    def test_timestamp_with_z_suffix_passes(self):
        ts = datetime.utcnow().isoformat() + "Z"
        assert verify_timestamp(ts) is True

    def test_timestamp_slightly_in_past_passes(self):
        ts = (datetime.now(timezone.utc) - timedelta(seconds=60)).isoformat()
        assert verify_timestamp(ts) is True

    def test_timestamp_slightly_in_future_passes(self):
        ts = (datetime.now(timezone.utc) + timedelta(seconds=60)).isoformat()
        assert verify_timestamp(ts) is True

    def test_timestamp_10_min_ago_fails(self):
        ts = (datetime.now(timezone.utc) - timedelta(minutes=10)).isoformat()
        assert verify_timestamp(ts) is False

    def test_timestamp_10_min_in_future_fails(self):
        ts = (datetime.now(timezone.utc) + timedelta(minutes=10)).isoformat()
        assert verify_timestamp(ts) is False

    def test_timestamp_exactly_at_boundary_passes(self):
        # 299 seconds ago is within the default 300-second skew
        ts = (datetime.now(timezone.utc) - timedelta(seconds=299)).isoformat()
        assert verify_timestamp(ts) is True

    def test_malformed_timestamp_fails(self):
        assert verify_timestamp("not-a-timestamp") is False

    def test_empty_string_fails(self):
        assert verify_timestamp("") is False

    def test_none_like_string_fails(self):
        assert verify_timestamp("None") is False

    def test_custom_max_skew(self):
        # 10 seconds ago should fail with a 5-second max skew
        ts = (datetime.now(timezone.utc) - timedelta(seconds=10)).isoformat()
        assert verify_timestamp(ts, max_skew_seconds=5) is False

    def test_custom_max_skew_passes(self):
        ts = (datetime.now(timezone.utc) - timedelta(seconds=4)).isoformat()
        assert verify_timestamp(ts, max_skew_seconds=5) is True


# ── generate_instance_id ───────────────────────────────────────────────────

class TestGenerateInstanceId:
    def test_returns_string(self):
        iid = generate_instance_id()
        assert isinstance(iid, str)

    def test_valid_uuid4_format(self):
        iid = generate_instance_id()
        # Should parse as a valid UUID without raising
        parsed = uuid.UUID(iid, version=4)
        assert str(parsed) == iid

    def test_unique_on_each_call(self):
        ids = {generate_instance_id() for _ in range(20)}
        assert len(ids) == 20

    def test_hyphenated_format(self):
        iid = generate_instance_id()
        # UUID canonical form: 8-4-4-4-12
        parts = iid.split("-")
        assert len(parts) == 5
        assert [len(p) for p in parts] == [8, 4, 4, 4, 12]


# ── generate_invite_code ───────────────────────────────────────────────────

class TestGenerateInviteCode:
    def test_length_is_8(self):
        code = generate_invite_code()
        assert len(code) == 8

    def test_alphanumeric_only(self):
        for _ in range(50):
            code = generate_invite_code()
            assert re.fullmatch(r"[A-Z0-9]{8}", code), f"Code {code!r} contains non-alphanumeric chars"

    def test_unique_on_each_call(self):
        codes = {generate_invite_code() for _ in range(100)}
        # With 36^8 ≈ 2.8 trillion possibilities, 100 should all be unique
        assert len(codes) == 100

    def test_returns_string(self):
        assert isinstance(generate_invite_code(), str)

    def test_no_lowercase(self):
        for _ in range(20):
            code = generate_invite_code()
            assert code == code.upper()


# ── get_key_fingerprint ────────────────────────────────────────────────────

class TestGetKeyFingerprint:
    def test_returns_16_char_hex_string(self):
        pub, _ = generate_keypair()
        fp = get_key_fingerprint(pub)
        assert isinstance(fp, str)
        assert len(fp) == 16
        assert re.fullmatch(r"[0-9a-f]{16}", fp), f"Fingerprint {fp!r} is not lowercase hex"

    def test_deterministic_for_same_key(self):
        pub, _ = generate_keypair()
        fp1 = get_key_fingerprint(pub)
        fp2 = get_key_fingerprint(pub)
        assert fp1 == fp2

    def test_different_keys_produce_different_fingerprints(self):
        pub1, _ = generate_keypair()
        pub2, _ = generate_keypair()
        assert get_key_fingerprint(pub1) != get_key_fingerprint(pub2)

    def test_fingerprint_is_prefix_of_sha256_hex(self):
        """Verify the fingerprint is actually the first 16 chars of SHA256(raw_key)."""
        import hashlib
        pub, _ = generate_keypair()
        raw = base64.b64decode(pub)
        expected = hashlib.sha256(raw).hexdigest()[:16]
        assert get_key_fingerprint(pub) == expected
