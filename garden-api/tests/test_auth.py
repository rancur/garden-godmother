"""Tests for the authentication system — login, register, sessions, passwords."""
from __future__ import annotations


# ── Login ──────────────────────────────────────────────────────────────────

def test_login_missing_fields(client):
    """POST /api/auth/login with empty body should return 422 (validation error)."""
    resp = client.post("/api/auth/login", json={})
    assert resp.status_code == 422


def test_login_invalid_credentials(client):
    """Wrong username/password should return 401."""
    resp = client.post("/api/auth/login", json={
        "username": "nobody",
        "password": "wrongpassword",
    })
    assert resp.status_code == 401


def test_login_success(client, _seed_admin):
    """Valid credentials should return 200 with user info and set a session cookie."""
    resp = client.post("/api/auth/login", json={
        "username": "testadmin",
        "password": "testpassword123",
    })
    assert resp.status_code == 200
    data = resp.json()
    assert data["username"] == "testadmin"
    assert data["role"] == "admin"
    assert "ggm_session" in resp.cookies


def test_login_case_insensitive(client, _seed_admin):
    """Username lookup should be case-insensitive."""
    resp = client.post("/api/auth/login", json={
        "username": "TestAdmin",
        "password": "testpassword123",
    })
    assert resp.status_code == 200


# ── Session / Me ───────────────────────────────────────────────────────────

def test_unauthenticated_access(client):
    """Requests without a session cookie should get 401 on protected endpoints."""
    resp = client.get("/api/beds")
    assert resp.status_code == 401


def test_me_authenticated(auth_client):
    """/api/auth/me should return the current user when authenticated."""
    resp = auth_client.get("/api/auth/me")
    assert resp.status_code == 200
    data = resp.json()
    assert data["username"] == "testadmin"
    assert data["role"] == "admin"


def test_me_unauthenticated(client):
    """/api/auth/me should 401 without a session."""
    resp = client.get("/api/auth/me")
    assert resp.status_code == 401


# ── Logout ─────────────────────────────────────────────────────────────────

def test_logout(auth_client):
    """Logging out should invalidate the session."""
    resp = auth_client.post("/api/auth/logout")
    assert resp.status_code == 200
    # Session is now invalid — /api/auth/me should fail
    resp = auth_client.get("/api/auth/me")
    assert resp.status_code == 401


# ── Registration ───────────────────────────────────────────────────────────

def test_register_requires_invite(client):
    """Registration with an invalid invite code should fail."""
    resp = client.post("/api/auth/register", json={
        "username": "newuser",
        "password": "securepass123",
        "display_name": "New User",
        "invite_code": "INVALID",
        "email": "new@example.com",
    })
    assert resp.status_code == 400
    assert "invite" in resp.json()["detail"].lower()


def test_register_short_password(client):
    """Passwords under 8 characters should be rejected."""
    resp = client.post("/api/auth/register", json={
        "username": "newuser",
        "password": "short",
        "display_name": "New User",
        "invite_code": "ANYTHING",
        "email": "new@example.com",
    })
    assert resp.status_code == 400


def test_register_invalid_username(client):
    """Usernames with special characters should be rejected."""
    resp = client.post("/api/auth/register", json={
        "username": "bad user!",
        "password": "securepass123",
        "display_name": "Bad User",
        "invite_code": "ANYTHING",
        "email": "bad@example.com",
    })
    assert resp.status_code == 400


def test_register_with_valid_invite(auth_client):
    """Full registration flow: admin creates invite, new user registers."""
    # Create invite as admin
    resp = auth_client.post("/api/admin/invites")
    assert resp.status_code == 200
    invite_code = resp.json()["code"]

    # Register (uses a fresh client to avoid the admin session)
    from main import app
    from fastapi.testclient import TestClient
    fresh = TestClient(app, raise_server_exceptions=False)
    resp = fresh.post("/api/auth/register", json={
        "username": "inviteduser",
        "password": "securepass123",
        "display_name": "Invited User",
        "invite_code": invite_code,
        "email": "invited@example.com",
    })
    assert resp.status_code == 200
    assert resp.json()["ok"] is True


# ── Change Password ────────────────────────────────────────────────────────

def test_change_password(auth_client):
    """Changing password with valid old password should succeed."""
    resp = auth_client.post("/api/auth/change-password", json={
        "old_password": "testpassword123",
        "new_password": "newpassword456",
    })
    assert resp.status_code == 200

    # Should be able to log in with new password
    from main import app
    from fastapi.testclient import TestClient
    fresh = TestClient(app, raise_server_exceptions=False)
    resp = fresh.post("/api/auth/login", json={
        "username": "testadmin",
        "password": "newpassword456",
    })
    assert resp.status_code == 200


def test_change_password_wrong_old(auth_client):
    """Changing password with incorrect old password should fail."""
    resp = auth_client.post("/api/auth/change-password", json={
        "old_password": "wrongoldpassword",
        "new_password": "doesntmatter",
    })
    assert resp.status_code == 400


# ── Profile Update ─────────────────────────────────────────────────────────

def test_update_profile(auth_client):
    """Users should be able to update their display name and email."""
    resp = auth_client.patch("/api/auth/profile", json={
        "display_name": "Updated Name",
        "email": "updated@example.com",
    })
    assert resp.status_code == 200

    me = auth_client.get("/api/auth/me").json()
    assert me["display_name"] == "Updated Name"
    assert me["email"] == "updated@example.com"
