"""Notification system endpoints."""
from __future__ import annotations

import json
from datetime import datetime, timedelta
from typing import Optional

from fastapi import APIRouter, HTTPException, Query, Request
from fastapi.responses import Response

from db import get_db
from auth import require_user, require_admin
from models import NotificationChannelUpdate, NotificationPreferenceUpdate, WebPushSubscription
from services.notifications import (
    send_email_notification, send_discord_notification,
    send_pushbullet_notification, send_webpush_notification,
)
from constants import NOTIFICATION_EVENT_TYPES

router = APIRouter()

# ──────────────── NOTIFICATION ENDPOINTS ────────────────

NOTIFICATION_EVENT_TYPES = [
    'task_due', 'task_overdue', 'harvest_ready', 'frost_warning',
    'plant_health', 'invite_accepted'
]


@router.get("/api/notifications/vapid-key")
def get_vapid_key():
    """Public endpoint — returns VAPID public key for web push subscription."""
    with get_db() as db:
        row = db.execute("SELECT value FROM app_config WHERE key = 'vapid_public_key'").fetchone()
        return {"public_key": row["value"] if row else None}


@router.get("/api/notifications/channels")
def list_notification_channels(request: Request):
    user = require_user(request)
    with get_db() as db:
        rows = db.execute("SELECT * FROM notification_channels WHERE user_id = ?", (user["id"],)).fetchall()
        results = []
        for r in rows:
            d = dict(r)
            # Mask sensitive fields in config
            if d.get("config"):
                try:
                    config = json.loads(d["config"]) if isinstance(d["config"], str) else d["config"]
                    for key in list(config.keys()):
                        val = config[key]
                        if isinstance(val, str) and any(s in key.lower() for s in ('pass', 'secret', 'token', 'webhook_url')):
                            config[key] = val[:8] + "..." + val[-4:] if len(val) > 12 else "***"
                    d["config"] = json.dumps(config)
                except Exception:
                    pass
            results.append(d)
        return results




@router.put("/api/notifications/channels/{channel_type}")
def upsert_notification_channel(channel_type: str, body: NotificationChannelUpdate, request: Request):
    user = require_user(request)
    if channel_type not in ('email', 'discord', 'webpush', 'pushbullet'):
        raise HTTPException(400, "Invalid channel type")
    if channel_type == 'email':
        cfg = body.config
        for field in ('smtp_host', 'smtp_port', 'smtp_user', 'smtp_pass'):
            if not cfg.get(field):
                raise HTTPException(400, f"Missing required email field: {field}")
    with get_db() as db:
        db.execute("""
            INSERT INTO notification_channels (user_id, channel_type, enabled, config)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(user_id, channel_type) DO UPDATE SET enabled = ?, config = ?
        """, (user["id"], channel_type, 1 if body.enabled else 0, json.dumps(body.config),
              1 if body.enabled else 0, json.dumps(body.config)))
        db.commit()
    return {"ok": True}


@router.delete("/api/notifications/channels/{channel_type}")
def delete_notification_channel(channel_type: str, request: Request):
    user = require_user(request)
    with get_db() as db:
        db.execute("DELETE FROM notification_channels WHERE user_id = ? AND channel_type = ?", (user["id"], channel_type))
        db.commit()
    return {"ok": True}


@router.get("/api/notifications/preferences")
def list_notification_preferences(request: Request):
    user = require_user(request)
    with get_db() as db:
        rows = db.execute("SELECT * FROM notification_preferences WHERE user_id = ?", (user["id"],)).fetchall()
        return {"event_types": NOTIFICATION_EVENT_TYPES, "preferences": [dict(r) for r in rows]}




@router.put("/api/notifications/preferences")
def update_notification_preferences(body: NotificationPreferenceUpdate, request: Request):
    user = require_user(request)
    with get_db() as db:
        for pref in body.preferences:
            db.execute("""
                INSERT INTO notification_preferences (user_id, event_type, channel_type, enabled)
                VALUES (?, ?, ?, ?)
                ON CONFLICT(user_id, event_type, channel_type) DO UPDATE SET enabled = ?
            """, (user["id"], pref["event_type"], pref["channel_type"],
                  1 if pref.get("enabled", True) else 0,
                  1 if pref.get("enabled", True) else 0))
        db.commit()
    return {"ok": True}


@router.post("/api/notifications/test/{channel_type}")
async def test_notification(channel_type: str, request: Request):
    user = require_user(request)
    with get_db() as db:
        ch = db.execute("SELECT config FROM notification_channels WHERE user_id = ? AND channel_type = ?",
                        (user["id"], channel_type)).fetchone()
        if not ch:
            raise HTTPException(404, "Channel not configured")
        config = json.loads(ch["config"]) if ch["config"] else {}
        user_email_row = db.execute("SELECT email FROM users WHERE id = ?", (user["id"],)).fetchone()
        user_email = user_email_row["email"] if user_email_row else None
    try:
        if channel_type == "email":
            await send_email_notification(config, "Test Notification", "This is a test notification from Garden Godmother!", user_email)
        elif channel_type == "discord":
            await send_discord_notification(config, "Test Notification", "This is a test notification from Garden Godmother!")
        elif channel_type == "webpush":
            await send_webpush_notification(user["id"], "Test Notification", "This is a test from Garden Godmother!")
        elif channel_type == "pushbullet":
            await send_pushbullet_notification(config, "Test Notification", "This is a test notification from Garden Godmother!")
        return {"ok": True}
    except Exception as e:
        raise HTTPException(500, f"Notification failed: {str(e)[:200]}")


@router.get("/api/notifications/log")
def list_notification_log(request: Request, limit: int = 50):
    user = require_user(request)
    with get_db() as db:
        rows = db.execute("""
            SELECT * FROM notification_log WHERE user_id = ?
            ORDER BY created_at DESC LIMIT ?
        """, (user["id"], limit)).fetchall()
        return [dict(r) for r in rows]


# Web push subscription management


@router.post("/api/notifications/webpush/subscribe")
def webpush_subscribe(body: WebPushSubscription, request: Request):
    user = require_user(request)
    sub_json = json.dumps(body.subscription)
    with get_db() as db:
        # Check if already subscribed
        existing = db.execute(
            "SELECT id FROM webpush_subscriptions WHERE user_id = ? AND subscription_json = ?",
            (user["id"], sub_json)
        ).fetchone()
        if not existing:
            db.execute(
                "INSERT INTO webpush_subscriptions (user_id, subscription_json, user_agent) VALUES (?, ?, ?)",
                (user["id"], sub_json, request.headers.get("user-agent", "")[:500])
            )
            db.commit()
    return {"ok": True}


@router.delete("/api/notifications/webpush/subscribe")
def webpush_unsubscribe(body: WebPushSubscription, request: Request):
    user = require_user(request)
    with get_db() as db:
        db.execute(
            "DELETE FROM webpush_subscriptions WHERE user_id = ? AND subscription_json = ?",
            (user["id"], json.dumps(body.subscription))
        )
        db.commit()
    return {"ok": True}

