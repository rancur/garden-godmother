"""Integration tests for federation API routes using FastAPI TestClient."""
from __future__ import annotations

from datetime import datetime, timezone

import pytest

# conftest.py (in this package) already wires up the isolated DB, the `client`
# fixture, and the `auth_client` fixture (authenticated as an admin).  All we
# need to do here is import the helpers we need and write the tests.

# ── Shared helpers ─────────────────────────────────────────────────────────

_SETUP_PAYLOAD = {
    "display_name": "Test Garden",
    "instance_url": "https://garden.example.com",
    "coarse_location": "Pacific Northwest",
}


def _setup_identity(auth_client):
    """Helper: POST /api/federation/setup and return the JSON response."""
    resp = auth_client.post("/api/federation/setup", json=_SETUP_PAYLOAD)
    assert resp.status_code == 200, f"setup failed: {resp.text}"
    return resp.json()


def _create_invite(auth_client):
    """Helper: POST /api/federation/invite and return the code string."""
    resp = auth_client.post("/api/federation/invite")
    assert resp.status_code == 200, f"invite failed: {resp.text}"
    return resp.json()["code"]


# ── GET /api/federation/identity ──────────────────────────────────────────

class TestGetIdentity:
    def test_unauthenticated_returns_401(self, client):
        resp = client.get("/api/federation/identity")
        assert resp.status_code == 401

    def test_returns_not_configured_when_no_identity(self, auth_client):
        resp = auth_client.get("/api/federation/identity")
        assert resp.status_code == 200
        assert resp.json() == {"configured": False}

    def test_returns_identity_after_setup(self, auth_client):
        _setup_identity(auth_client)
        resp = auth_client.get("/api/federation/identity")
        assert resp.status_code == 200
        data = resp.json()
        assert data["configured"] is True
        assert data["display_name"] == _SETUP_PAYLOAD["display_name"]
        assert data["instance_url"] == _SETUP_PAYLOAD["instance_url"]

    def test_private_key_never_exposed(self, auth_client):
        _setup_identity(auth_client)
        resp = auth_client.get("/api/federation/identity")
        data = resp.json()
        assert "private_key" not in data

    def test_key_fingerprint_present(self, auth_client):
        _setup_identity(auth_client)
        resp = auth_client.get("/api/federation/identity")
        data = resp.json()
        assert "key_fingerprint" in data
        assert len(data["key_fingerprint"]) == 16


# ── POST /api/federation/setup ────────────────────────────────────────────

class TestSetupIdentity:
    def test_unauthenticated_returns_401(self, client):
        resp = client.post("/api/federation/setup", json=_SETUP_PAYLOAD)
        assert resp.status_code == 401

    def test_viewer_cannot_setup(self, viewer_client):
        resp = viewer_client.post("/api/federation/setup", json=_SETUP_PAYLOAD)
        assert resp.status_code == 403

    def test_setup_creates_identity(self, auth_client):
        resp = auth_client.post("/api/federation/setup", json=_SETUP_PAYLOAD)
        assert resp.status_code == 200
        data = resp.json()
        assert data["configured"] is True
        assert data["display_name"] == _SETUP_PAYLOAD["display_name"]
        assert data["instance_url"] == _SETUP_PAYLOAD["instance_url"]

    def test_private_key_not_in_response(self, auth_client):
        data = _setup_identity(auth_client)
        assert "private_key" not in data

    def test_key_fingerprint_in_response(self, auth_client):
        data = _setup_identity(auth_client)
        assert "key_fingerprint" in data
        assert isinstance(data["key_fingerprint"], str)
        assert len(data["key_fingerprint"]) == 16

    def test_instance_id_is_uuid(self, auth_client):
        import uuid
        data = _setup_identity(auth_client)
        assert "instance_id" in data
        # Should parse as a valid UUID without raising
        uuid.UUID(data["instance_id"])

    def test_setup_is_idempotent_preserves_keys(self, auth_client):
        """Re-running setup should update mutable fields but keep the same keypair."""
        first = _setup_identity(auth_client)
        second = auth_client.post("/api/federation/setup", json={
            "display_name": "Updated Name",
            "instance_url": "https://updated.example.com",
        }).json()
        assert second["key_fingerprint"] == first["key_fingerprint"]
        assert second["instance_id"] == first["instance_id"]
        assert second["display_name"] == "Updated Name"

    def test_setup_minimal_payload(self, auth_client):
        """Only display_name is required; optional fields may be None."""
        resp = auth_client.post("/api/federation/setup", json={"display_name": "Minimal"})
        assert resp.status_code == 200
        data = resp.json()
        assert data["display_name"] == "Minimal"

    def test_setup_missing_display_name_returns_422(self, auth_client):
        resp = auth_client.post("/api/federation/setup", json={})
        assert resp.status_code == 422


# ── POST /api/federation/invite ───────────────────────────────────────────

class TestCreateInvite:
    def test_unauthenticated_returns_401(self, client):
        resp = client.post("/api/federation/invite")
        assert resp.status_code == 401

    def test_requires_identity_first(self, auth_client):
        """Creating an invite without setup should return 400."""
        resp = auth_client.post("/api/federation/invite")
        assert resp.status_code == 400
        assert "setup" in resp.json()["detail"].lower()

    def test_returns_code_and_pair_url(self, auth_client):
        _setup_identity(auth_client)
        resp = auth_client.post("/api/federation/invite")
        assert resp.status_code == 200
        data = resp.json()
        assert "code" in data
        assert "expires_at" in data
        assert len(data["code"]) == 8

    def test_code_is_alphanumeric(self, auth_client):
        import re
        _setup_identity(auth_client)
        resp = auth_client.post("/api/federation/invite")
        code = resp.json()["code"]
        assert re.fullmatch(r"[A-Z0-9]{8}", code)

    def test_pair_url_contains_code(self, auth_client):
        _setup_identity(auth_client)
        resp = auth_client.post("/api/federation/invite")
        data = resp.json()
        assert data["pair_url"] is not None
        assert data["code"] in data["pair_url"]

    def test_expires_in_24h(self, auth_client):
        from datetime import timedelta
        _setup_identity(auth_client)
        before = datetime.now(timezone.utc)
        resp = auth_client.post("/api/federation/invite")
        data = resp.json()
        expires_str = data["expires_at"].replace("Z", "+00:00")
        expires = datetime.fromisoformat(expires_str)
        diff = expires - before
        # Should be approximately 24 hours (allow ±5 min)
        assert timedelta(hours=23, minutes=55) <= diff <= timedelta(hours=24, minutes=5)

    def test_multiple_invites_have_unique_codes(self, auth_client):
        _setup_identity(auth_client)
        codes = set()
        for _ in range(5):
            resp = auth_client.post("/api/federation/invite")
            codes.add(resp.json()["code"])
        assert len(codes) == 5


# ── GET /api/federation/peers ─────────────────────────────────────────────

class TestListPeers:
    def test_unauthenticated_returns_401(self, client):
        resp = client.get("/api/federation/peers")
        assert resp.status_code == 401

    def test_returns_empty_list_initially(self, auth_client):
        resp = auth_client.get("/api/federation/peers")
        assert resp.status_code == 200
        assert resp.json() == []

    def test_returns_list_type(self, auth_client):
        resp = auth_client.get("/api/federation/peers")
        assert isinstance(resp.json(), list)


# ── GET /api/federation/prefs ─────────────────────────────────────────────

class TestGetPrefs:
    def test_unauthenticated_returns_401(self, client):
        resp = client.get("/api/federation/prefs")
        assert resp.status_code == 401

    def test_returns_all_false_defaults(self, auth_client):
        resp = auth_client.get("/api/federation/prefs")
        assert resp.status_code == 200
        data = resp.json()
        for field in (
            "share_plant_list",
            "share_harvest_offers",
            "share_seed_swaps",
            "share_journal_public",
            "share_alerts",
        ):
            assert field in data
            assert data[field] is False, f"{field} should default to False"


# ── PATCH /api/federation/prefs ───────────────────────────────────────────

class TestUpdatePrefs:
    def test_unauthenticated_returns_401(self, client):
        resp = client.patch("/api/federation/prefs", json={"share_plant_list": True})
        assert resp.status_code == 401

    def test_update_single_field(self, auth_client):
        resp = auth_client.patch("/api/federation/prefs", json={"share_plant_list": True})
        assert resp.status_code == 200
        data = resp.json()
        assert data["share_plant_list"] is True
        # Other fields should default to False
        assert data["share_harvest_offers"] is False

    def test_update_multiple_fields(self, auth_client):
        resp = auth_client.patch("/api/federation/prefs", json={
            "share_plant_list": True,
            "share_harvest_offers": True,
        })
        assert resp.status_code == 200
        data = resp.json()
        assert data["share_plant_list"] is True
        assert data["share_harvest_offers"] is True
        assert data["share_seed_swaps"] is False

    def test_update_is_persisted(self, auth_client):
        auth_client.patch("/api/federation/prefs", json={"share_alerts": True})
        resp = auth_client.get("/api/federation/prefs")
        assert resp.json()["share_alerts"] is True

    def test_update_then_revert(self, auth_client):
        auth_client.patch("/api/federation/prefs", json={"share_plant_list": True})
        auth_client.patch("/api/federation/prefs", json={"share_plant_list": False})
        resp = auth_client.get("/api/federation/prefs")
        assert resp.json()["share_plant_list"] is False

    def test_empty_patch_is_accepted(self, auth_client):
        resp = auth_client.patch("/api/federation/prefs", json={})
        assert resp.status_code == 200

    def test_update_all_fields(self, auth_client):
        payload = {
            "share_plant_list": True,
            "share_harvest_offers": True,
            "share_seed_swaps": True,
            "share_journal_public": True,
            "share_alerts": True,
        }
        resp = auth_client.patch("/api/federation/prefs", json=payload)
        assert resp.status_code == 200
        data = resp.json()
        for field, value in payload.items():
            assert data[field] is value


# ── POST /api/federation/pair-request ────────────────────────────────────

class TestPairRequest:
    """Tests for the public peer-to-peer pair-request endpoint."""

    _PEER_PAYLOAD = {
        "instance_id": "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
        "display_name": "Remote Garden",
        "public_key": None,   # filled in via fixture
        "instance_url": "https://remote.example.com",
        "invite_code": None,  # filled in per-test
    }

    @pytest.fixture()
    def peer_public_key(self):
        import sys
        from pathlib import Path
        sys.path.insert(0, str(Path(__file__).parent.parent))
        from federation_crypto import generate_keypair
        pub, _ = generate_keypair()
        return pub

    def test_rejects_missing_invite_code(self, auth_client, peer_public_key):
        """Invalid (nonexistent) invite code should return 400."""
        _setup_identity(auth_client)
        payload = {**self._PEER_PAYLOAD, "public_key": peer_public_key, "invite_code": "BADCODE1"}
        resp = auth_client.post("/api/federation/pair-request", json=payload)
        assert resp.status_code == 400
        assert "invite" in resp.json()["detail"].lower()

    def test_rejects_when_federation_not_configured(self, auth_client, peer_public_key):
        """Should return 503 if local identity is not set up."""
        payload = {**self._PEER_PAYLOAD, "public_key": peer_public_key, "invite_code": "ANYTHING"}
        resp = auth_client.post("/api/federation/pair-request", json=payload)
        assert resp.status_code == 503

    def test_accepts_valid_invite_code(self, auth_client, peer_public_key):
        """A valid, unused invite code should cause pairing to enter 'pending' state."""
        _setup_identity(auth_client)
        code = _create_invite(auth_client)
        payload = {
            **self._PEER_PAYLOAD,
            "public_key": peer_public_key,
            "invite_code": code,
        }
        resp = auth_client.post("/api/federation/pair-request", json=payload)
        assert resp.status_code == 200
        data = resp.json()
        assert data["status"] == "pending"

    def test_used_invite_code_rejected(self, auth_client, peer_public_key):
        """After a code is used once, a second request with the same code should fail."""
        _setup_identity(auth_client)
        code = _create_invite(auth_client)
        payload = {
            **self._PEER_PAYLOAD,
            "public_key": peer_public_key,
            "invite_code": code,
        }
        # Use it once
        first = auth_client.post("/api/federation/pair-request", json=payload)
        assert first.status_code == 200
        # Try again — should be rejected
        second = auth_client.post("/api/federation/pair-request", json=payload)
        assert second.status_code == 400

    def test_pair_request_peer_appears_in_peers_list(self, auth_client, peer_public_key):
        """After a successful pair-request, the peer should show in GET /api/federation/peers."""
        _setup_identity(auth_client)
        code = _create_invite(auth_client)
        auth_client.post("/api/federation/pair-request", json={
            **self._PEER_PAYLOAD,
            "public_key": peer_public_key,
            "invite_code": code,
        })
        peers = auth_client.get("/api/federation/peers").json()
        assert len(peers) == 1
        peer = peers[0]
        assert peer["peer_id"] == self._PEER_PAYLOAD["instance_id"]
        assert peer["status"] == "pending"

    def test_pair_request_missing_fields_returns_422(self, auth_client):
        """Submitting an incomplete body should return 422 (validation error)."""
        _setup_identity(auth_client)
        resp = auth_client.post("/api/federation/pair-request", json={"invite_code": "ANYTHING"})
        assert resp.status_code == 422
