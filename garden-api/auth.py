"""Authentication system — middleware, session management, auth endpoints."""
from __future__ import annotations

import json
import os
import re
import secrets
from datetime import datetime, timedelta

from argon2 import PasswordHasher
from argon2.exceptions import VerifyMismatchError

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import Response
from starlette.middleware.base import BaseHTTPMiddleware

from db import get_db
from models import (
    LoginRequest, RegisterRequest, ChangePasswordRequest,
    ProfileUpdate, AdminUserUpdate,
)

import logging

logger = logging.getLogger(__name__)
ph = PasswordHasher()

router = APIRouter()

SESSION_MAX_AGE = 30 * 24 * 3600  # 30 days
# Configure for your domain — set COOKIE_DOMAIN env var for production (e.g. ".yourdomain.com")
COOKIE_DOMAIN = os.environ.get("COOKIE_DOMAIN", "") or None


class AuthMiddleware(BaseHTTPMiddleware):
    """Require authentication on all API endpoints except auth, docs, and iCal feeds."""

    async def dispatch(self, request: Request, call_next):
        path = request.url.path
        # Skip auth for public paths
        if (path.startswith('/api/auth/') or
            path == '/docs' or
            path == '/openapi.json' or
            path.startswith('/api/calendar/ical') or  # iCal feeds are public (subscription URLs)
            path == '/api/notifications/vapid-key' or  # VAPID public key for web push
            path == '/api/settings/setup-status' or  # Setup check (needs to work pre-auth)
            path == '/api/federation/pair-request' or  # Federation peer-to-peer (sig auth)
            path == '/api/federation/pair-accept' or   # Federation peer-to-peer (sig auth)
            path == '/api/federation/profile' or       # Federation peer-to-peer (sig auth)
            path == '/api/federation/plant-list' or    # Federation peer-to-peer (sig auth)
            path == '/api/federation/sync' or          # Federation peer-to-peer (sig auth)
            path.endswith('/qr') or                     # QR code images are public (scan without logging in)
            request.method == 'OPTIONS'):  # CORS preflight
            return await call_next(request)

        # Check session cookie
        session_id = request.cookies.get('ggm_session')
        if not session_id:
            return Response(
                content=json.dumps({"detail": "Not authenticated"}),
                status_code=401,
                media_type="application/json",
            )

        # Validate session
        with get_db() as db:
            row = db.execute("""
                SELECT s.expires_at, u.id, u.username, u.display_name, u.role, u.is_active
                FROM sessions s JOIN users u ON s.user_id = u.id
                WHERE s.id = ? AND u.is_active = 1
            """, (session_id,)).fetchone()

            if not row or datetime.fromisoformat(row["expires_at"]) < datetime.utcnow():
                if row and datetime.fromisoformat(row["expires_at"]) < datetime.utcnow():
                    db.execute("DELETE FROM sessions WHERE id = ?", (session_id,))
                    db.commit()
                return Response(
                    content=json.dumps({"detail": "Not authenticated"}),
                    status_code=401,
                    media_type="application/json",
                )

            # Store user info on request state for endpoint access
            request.state.user = {
                "id": row["id"],
                "username": row["username"],
                "display_name": row["display_name"],
                "role": row["role"],
            }

        return await call_next(request)


def get_request_user(request: Request) -> dict | None:
    """Get user from request state (set by AuthMiddleware)."""
    return getattr(request.state, 'user', None)


def create_session(db, user_id: int, request: Request) -> str:
    """Create a new session and return the session ID."""
    session_id = secrets.token_urlsafe(32)
    expires_at = datetime.utcnow() + timedelta(seconds=SESSION_MAX_AGE)
    ip = request.client.host if request.client else None
    ua = request.headers.get("user-agent", "")[:500]
    db.execute(
        "INSERT INTO sessions (id, user_id, expires_at, ip_address, user_agent) VALUES (?, ?, ?, ?, ?)",
        (session_id, user_id, expires_at.isoformat(), ip, ua)
    )
    return session_id

def set_session_cookie(response: Response, session_id: str):
    """Set the session cookie on the response."""
    response.set_cookie(
        key="ggm_session",
        value=session_id,
        domain=COOKIE_DOMAIN,
        path="/",
        httponly=True,
        secure=True,
        samesite="lax",
        max_age=SESSION_MAX_AGE,
    )

def clear_session_cookie(response: Response):
    """Clear the session cookie."""
    response.delete_cookie(key="ggm_session", domain=COOKIE_DOMAIN, path="/")

def get_current_user(request: Request) -> dict | None:
    """Read session cookie and return user dict or None."""
    session_id = request.cookies.get("ggm_session")
    if not session_id:
        return None
    with get_db() as db:
        row = db.execute("""
            SELECT s.id as session_id, s.expires_at, u.id, u.username, u.display_name, u.email, u.role, u.avatar_url, u.is_active
            FROM sessions s JOIN users u ON s.user_id = u.id
            WHERE s.id = ? AND u.is_active = 1
        """, (session_id,)).fetchone()
        if not row:
            return None
        if datetime.fromisoformat(row["expires_at"]) < datetime.utcnow():
            db.execute("DELETE FROM sessions WHERE id = ?", (session_id,))
            db.commit()
            return None
        # Sliding window: extend session if >1 day old
        last_active = db.execute("SELECT last_active_at FROM sessions WHERE id = ?", (session_id,)).fetchone()
        if last_active:
            try:
                la = datetime.fromisoformat(last_active["last_active_at"])
                if (datetime.utcnow() - la).total_seconds() > 86400:
                    new_expires = datetime.utcnow() + timedelta(seconds=SESSION_MAX_AGE)
                    db.execute("UPDATE sessions SET last_active_at = ?, expires_at = ? WHERE id = ?",
                               (datetime.utcnow().isoformat(), new_expires.isoformat(), session_id))
                    db.commit()
            except (ValueError, TypeError):
                pass
        return {
            "id": row["id"],
            "username": row["username"],
            "display_name": row["display_name"],
            "email": row["email"],
            "role": row["role"],
            "avatar_url": row["avatar_url"],
        }

def require_user(request: Request) -> dict:
    """FastAPI dependency: require authenticated user."""
    user = get_current_user(request)
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated")
    return user

def require_admin(request: Request) -> dict:
    """FastAPI dependency: require admin user."""
    user = require_user(request)
    if user["role"] != "admin":
        raise HTTPException(status_code=403, detail="Admin required")
    return user


def audit_log(db, user_id: int, action: str, entity_type: str, entity_id=None, details: dict = None, ip: str = None):
    """Record an action in the audit log."""
    db.execute(
        "INSERT INTO audit_log (user_id, action, entity_type, entity_id, details, ip_address) VALUES (?, ?, ?, ?, ?, ?)",
        (user_id, action, entity_type, str(entity_id) if entity_id else None, json.dumps(details) if details else None, ip)
    )



# ──────────────── AUTH ENDPOINTS ────────────────

@router.post("/api/auth/login")
def auth_login(req: LoginRequest, request: Request):
    with get_db() as db:
        user = db.execute("SELECT * FROM users WHERE username = ? AND is_active = 1", (req.username.lower().strip(),)).fetchone()
        if not user:
            raise HTTPException(status_code=401, detail="Invalid credentials")
        try:
            ph.verify(user["password_hash"], req.password)
        except VerifyMismatchError:
            raise HTTPException(status_code=401, detail="Invalid credentials")
        # Check if rehash needed (argon2 parameter changes)
        if ph.check_needs_rehash(user["password_hash"]):
            db.execute("UPDATE users SET password_hash = ? WHERE id = ?", (ph.hash(req.password), user["id"]))
        session_id = create_session(db, user["id"], request)
        db.execute("UPDATE users SET last_login_at = ? WHERE id = ?", (datetime.utcnow().isoformat(), user["id"]))
        audit_log(db, user["id"], "login", "session", session_id, {"ip": request.client.host if request.client else None}, request.client.host if request.client else None)
        db.commit()
    response = Response(content=json.dumps({
        "id": user["id"],
        "username": user["username"],
        "display_name": user["display_name"],
        "email": user["email"],
        "role": user["role"],
        "avatar_url": user["avatar_url"],
    }), media_type="application/json")
    set_session_cookie(response, session_id)
    return response

@router.post("/api/auth/logout")
def auth_logout(request: Request):
    user = get_current_user(request)
    session_id = request.cookies.get("ggm_session")
    if session_id:
        with get_db() as db:
            if user:
                audit_log(db, user["id"], "logout", "session", None, None, request.client.host if request.client else None)
            db.execute("DELETE FROM sessions WHERE id = ?", (session_id,))
            db.commit()
    response = Response(content=json.dumps({"ok": True}), media_type="application/json")
    clear_session_cookie(response)
    return response

@router.get("/api/auth/me")
def auth_me(request: Request):
    user = get_current_user(request)
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated")
    return user

@router.post("/api/auth/register")
def auth_register(req: RegisterRequest, request: Request):
    if not req.email or not req.email.strip():
        raise HTTPException(400, "Email is required")
    username = req.username.lower().strip()
    if len(username) < 2 or len(username) > 30:
        raise HTTPException(400, "Username must be 2-30 characters")
    if len(req.password) < 8:
        raise HTTPException(400, "Password must be at least 8 characters")
    if not re.match(r'^[a-zA-Z0-9_.-]+$', username):
        raise HTTPException(400, "Username can only contain letters, numbers, dots, hyphens, underscores")
    with get_db() as db:
        # Verify invite code
        invite = db.execute(
            "SELECT * FROM invite_codes WHERE code = ? AND used_by IS NULL AND expires_at > ?",
            (req.invite_code, datetime.utcnow().isoformat())
        ).fetchone()
        if not invite:
            raise HTTPException(400, "Invalid or expired invite code")
        # Check username uniqueness
        existing = db.execute("SELECT id FROM users WHERE username = ?", (username,)).fetchone()
        if existing:
            raise HTTPException(400, "Username already taken")
        # Create user
        cursor = db.execute(
            "INSERT INTO users (username, display_name, email, password_hash, role) VALUES (?, ?, ?, ?, ?)",
            (username, req.display_name.strip(), req.email.strip() if req.email else None, ph.hash(req.password), invite["role"])
        )
        user_id = cursor.lastrowid
        # Mark invite as used
        db.execute("UPDATE invite_codes SET used_by = ?, used_at = ? WHERE id = ?",
                   (user_id, datetime.utcnow().isoformat(), invite["id"]))
        audit_log(db, user_id, "register", "user", user_id, {"username": username, "invited_by": invite["created_by"]}, request.client.host if request.client else None)
        db.commit()
    return {"ok": True, "message": "Account created. Please log in."}

@router.post("/api/auth/change-password")
def auth_change_password(req: ChangePasswordRequest, request: Request):
    user = require_user(request)
    with get_db() as db:
        row = db.execute("SELECT password_hash FROM users WHERE id = ?", (user["id"],)).fetchone()
        try:
            ph.verify(row["password_hash"], req.old_password)
        except VerifyMismatchError:
            raise HTTPException(400, "Current password is incorrect")
        if len(req.new_password) < 8:
            raise HTTPException(400, "New password must be at least 8 characters")
        db.execute("UPDATE users SET password_hash = ? WHERE id = ?", (ph.hash(req.new_password), user["id"]))
        db.commit()
    return {"ok": True}

@router.patch("/api/auth/profile")
def update_profile(updates: ProfileUpdate, request: Request):
    user = require_user(request)
    with get_db() as db:
        if updates.display_name is not None:
            db.execute("UPDATE users SET display_name = ? WHERE id = ?", (updates.display_name.strip(), user["id"]))
        if updates.email is not None:
            db.execute("UPDATE users SET email = ? WHERE id = ?", (updates.email.strip() or None, user["id"]))
        db.commit()
    return {"ok": True}



# ──────────────── ADMIN ENDPOINTS ────────────────

@router.get("/api/admin/migrations")
def admin_list_migrations(request: Request):
    """List all applied database migrations."""
    require_admin(request)
    with get_db() as db:
        try:
            rows = db.execute("SELECT * FROM schema_migrations ORDER BY id").fetchall()
            return [dict(r) for r in rows]
        except Exception:
            return []


@router.get("/api/admin/users")
def admin_list_users(request: Request):
    require_admin(request)
    with get_db() as db:
        rows = db.execute("SELECT id, username, display_name, email, role, avatar_url, is_active, created_at, last_login_at FROM users ORDER BY id").fetchall()
        return [dict(r) for r in rows]

@router.patch("/api/admin/users/{user_id}")
def admin_update_user(user_id: int, updates: AdminUserUpdate, request: Request):
    admin = require_admin(request)
    if user_id == admin["id"] and updates.is_active is False:
        raise HTTPException(400, "Cannot deactivate yourself")
    with get_db() as db:
        user = db.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
        if not user:
            raise HTTPException(404, "User not found")
        if updates.role is not None:
            if updates.role not in ("admin", "user", "viewer"):
                raise HTTPException(400, "Invalid role")
            db.execute("UPDATE users SET role = ? WHERE id = ?", (updates.role, user_id))
        if updates.is_active is not None:
            db.execute("UPDATE users SET is_active = ? WHERE id = ?", (1 if updates.is_active else 0, user_id))
        if updates.display_name is not None:
            db.execute("UPDATE users SET display_name = ? WHERE id = ?", (updates.display_name.strip(), user_id))
        db.commit()
    return {"ok": True}

@router.post("/api/admin/invites")
def admin_create_invite(request: Request):
    admin = require_admin(request)
    code = secrets.token_urlsafe(6)[:8].upper()
    expires_at = (datetime.utcnow() + timedelta(days=7)).isoformat()
    with get_db() as db:
        db.execute(
            "INSERT INTO invite_codes (code, created_by, expires_at) VALUES (?, ?, ?)",
            (code, admin["id"], expires_at)
        )
        db.commit()
    return {"code": code, "expires_at": expires_at}

@router.get("/api/admin/invites")
def admin_list_invites(request: Request):
    require_admin(request)
    with get_db() as db:
        rows = db.execute("""
            SELECT ic.*, u1.display_name as created_by_name, u2.display_name as used_by_name
            FROM invite_codes ic
            LEFT JOIN users u1 ON ic.created_by = u1.id
            LEFT JOIN users u2 ON ic.used_by = u2.id
            ORDER BY ic.created_at DESC
        """).fetchall()
        return [dict(r) for r in rows]

@router.delete("/api/admin/invites/{invite_id}")
def admin_delete_invite(invite_id: int, request: Request):
    require_admin(request)
    with get_db() as db:
        invite = db.execute("SELECT * FROM invite_codes WHERE id = ? AND used_by IS NULL", (invite_id,)).fetchone()
        if not invite:
            raise HTTPException(404, "Invite not found or already used")
        db.execute("DELETE FROM invite_codes WHERE id = ?", (invite_id,))
        db.commit()
    return {"ok": True}
