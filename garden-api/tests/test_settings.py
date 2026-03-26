"""Tests for settings and integration endpoints."""
from __future__ import annotations


# ── Setup status ───────────────────────────────────────────────────────────

def test_setup_status_unauthenticated(client):
    """GET /api/settings/setup-status should work without auth (returns login step)."""
    resp = client.get("/api/settings/setup-status")
    assert resp.status_code == 200
    data = resp.json()
    assert data["setup_complete"] is False
    assert data["step"] == "login"


def test_setup_status_authenticated(auth_client):
    """Authenticated users should see the current setup step."""
    resp = auth_client.get("/api/settings/setup-status")
    assert resp.status_code == 200
    data = resp.json()
    assert "setup_complete" in data


def test_mark_setup_complete(auth_client):
    """POST /api/settings/setup-complete should mark setup as done."""
    resp = auth_client.post("/api/settings/setup-complete")
    assert resp.status_code == 200

    status = auth_client.get("/api/settings/setup-status").json()
    assert status["setup_complete"] is True


# ── Frost dates ────────────────────────────────────────────────────────────

def test_get_frost_dates(auth_client):
    """GET /api/settings/frost-dates should return frost dates."""
    resp = auth_client.get("/api/settings/frost-dates")
    assert resp.status_code == 200
    data = resp.json()
    assert "last_frost" in data
    assert "first_frost" in data


def test_update_frost_dates(auth_client):
    """PUT /api/settings/frost-dates should update frost dates."""
    resp = auth_client.put("/api/settings/frost-dates", json={
        "last_frost": "02-15",
        "first_frost": "12-01",
    })
    assert resp.status_code == 200
    assert resp.json()["last_frost"] == "02-15"
    assert resp.json()["first_frost"] == "12-01"


def test_update_frost_dates_invalid(auth_client):
    """Invalid frost date format should fail."""
    resp = auth_client.put("/api/settings/frost-dates", json={
        "last_frost": "not-a-date",
        "first_frost": "12-01",
    })
    assert resp.status_code == 400


# ── USDA zone ──────────────────────────────────────────────────────────────

def test_update_usda_zone(auth_client):
    """PUT /api/settings/usda-zone should save the zone."""
    resp = auth_client.put("/api/settings/usda-zone", json={"zone": "9b"})
    assert resp.status_code == 200
    assert resp.json()["zone"] == "9b"


# ── Settings aggregate ────────────────────────────────────────────────────

def test_get_settings(auth_client):
    """GET /api/settings should return the aggregate settings object."""
    resp = auth_client.get("/api/settings")
    assert resp.status_code == 200
    data = resp.json()
    assert "property" in data
    assert "soil_profile" in data
    assert "database_stats" in data
    assert "version" in data


# ── Integrations (admin-only) ─────────────────────────────────────────────

def test_list_integrations(auth_client):
    """GET /api/integrations should return available integrations."""
    resp = auth_client.get("/api/integrations")
    assert resp.status_code == 200
    data = resp.json()
    assert isinstance(data, list)


def test_integrations_require_admin(viewer_client):
    """Non-admin users should not access integration settings."""
    resp = viewer_client.get("/api/integrations")
    assert resp.status_code == 403


# ── Admin endpoints ────────────────────────────────────────────────────────

def test_admin_list_users(auth_client):
    """GET /api/admin/users should list all users."""
    resp = auth_client.get("/api/admin/users")
    assert resp.status_code == 200
    data = resp.json()
    assert isinstance(data, list)
    assert len(data) >= 1


def test_admin_list_invites(auth_client):
    """GET /api/admin/invites should list invite codes."""
    resp = auth_client.get("/api/admin/invites")
    assert resp.status_code == 200
    assert isinstance(resp.json(), list)


def test_admin_create_and_delete_invite(auth_client):
    """Creating and deleting an invite should work."""
    create_resp = auth_client.post("/api/admin/invites")
    assert create_resp.status_code == 200
    code = create_resp.json()["code"]

    # Find the invite in the list
    invites = auth_client.get("/api/admin/invites").json()
    invite = next((i for i in invites if i["code"] == code), None)
    assert invite is not None

    # Delete it
    del_resp = auth_client.delete(f"/api/admin/invites/{invite['id']}")
    assert del_resp.status_code == 200
