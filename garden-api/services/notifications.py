"""Notification dispatchers — email, discord, webpush, pushbullet."""
from __future__ import annotations

import json
import logging
import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart

import httpx

from db import get_db

logger = logging.getLogger(__name__)


async def send_email_notification(config: dict, title: str, body: str, to_email: str = None):
    """Send email notification via SMTP."""
    msg = MIMEMultipart('alternative')
    msg['Subject'] = title
    msg['From'] = f"Garden Godmother <{config.get('smtp_user', '')}>"
    msg['To'] = to_email or config.get('smtp_user', '')

    html = f"""<div style="font-family: -apple-system, sans-serif; max-width: 500px; margin: 0 auto; padding: 20px;">
        <div style="background: #16a34a; color: white; padding: 12px 20px; border-radius: 12px 12px 0 0;">
            <strong>🌱 Garden Godmother</strong>
        </div>
        <div style="background: white; border: 1px solid #e5e7eb; padding: 20px; border-radius: 0 0 12px 12px;">
            <h2 style="color: #374151; margin: 0 0 12px 0; font-size: 18px;">{title}</h2>
            <p style="color: #6b7280; margin: 0; line-height: 1.5;">{body}</p>
        </div>
    </div>"""
    msg.attach(MIMEText(body, 'plain'))
    msg.attach(MIMEText(html, 'html'))

    smtp = smtplib.SMTP_SSL(config.get('smtp_host', 'smtp.gmail.com'), int(config.get('smtp_port', 465)))
    smtp.login(config['smtp_user'], config['smtp_pass'])
    smtp.send_message(msg)
    smtp.quit()


async def send_discord_notification(config: dict, title: str, body: str):
    """Send Discord webhook notification."""
    async with httpx.AsyncClient() as client:
        await client.post(config['webhook_url'], json={
            "embeds": [{
                "title": title,
                "description": body,
                "color": 0x16a34a,
                "footer": {"text": "Garden Godmother"},
            }]
        })


async def send_pushbullet_notification(config: dict, title: str, body: str):
    """Send Pushbullet notification."""
    async with httpx.AsyncClient() as client:
        await client.post(
            "https://api.pushbullet.com/v2/pushes",
            headers={"Access-Token": config['access_token']},
            json={"type": "note", "title": title, "body": body}
        )


async def send_webpush_notification(user_id: int, title: str, body: str, data: dict = None):
    """Send web push notification to all user's subscriptions."""
    from pywebpush import webpush, WebPushException
    with get_db() as db:
        vapid_pub = db.execute("SELECT value FROM app_config WHERE key = 'vapid_public_key'").fetchone()
        vapid_priv = db.execute("SELECT value FROM app_config WHERE key = 'vapid_private_key'").fetchone()
        vapid_email = db.execute("SELECT value FROM app_config WHERE key = 'vapid_email'").fetchone()
        if not vapid_pub or not vapid_priv:
            return
        subs = db.execute("SELECT subscription_json FROM webpush_subscriptions WHERE user_id = ?", (user_id,)).fetchall()
        for sub in subs:
            try:
                webpush(
                    subscription_info=json.loads(sub["subscription_json"]),
                    data=json.dumps({"title": title, "body": body, "url": data.get("url", "/") if data else "/"}),
                    vapid_private_key=vapid_priv["value"],
                    vapid_claims={"sub": vapid_email["value"]},
                )
            except WebPushException:
                # Subscription may have expired — clean up
                db.execute("DELETE FROM webpush_subscriptions WHERE subscription_json = ?", (sub["subscription_json"],))
                db.commit()
            except Exception:
                pass


async def send_notification(user_id: int, event_type: str, title: str, body: str, data: dict = None):
    """Send notification to all enabled channels for a user + event type."""
    with get_db() as db:
        channels = db.execute("""
            SELECT nc.channel_type, nc.config
            FROM notification_channels nc
            LEFT JOIN notification_preferences np
              ON nc.user_id = np.user_id AND nc.channel_type = np.channel_type AND np.event_type = ?
            WHERE nc.user_id = ? AND nc.enabled = 1
              AND (np.enabled IS NULL OR np.enabled = 1)
        """, (event_type, user_id)).fetchall()

        for ch in channels:
            status = "sent"
            error_msg = None
            try:
                config = json.loads(ch["config"]) if ch["config"] else {}
                if ch["channel_type"] == "email":
                    user_email = db.execute("SELECT email FROM users WHERE id = ?", (user_id,)).fetchone()
                    await send_email_notification(config, title, body, user_email["email"] if user_email else None)
                elif ch["channel_type"] == "discord":
                    await send_discord_notification(config, title, body)
                elif ch["channel_type"] == "webpush":
                    await send_webpush_notification(user_id, title, body, data)
                elif ch["channel_type"] == "pushbullet":
                    await send_pushbullet_notification(config, title, body)
            except Exception as e:
                status = "failed"
                error_msg = str(e)[:500]

            db.execute(
                "INSERT INTO notification_log (user_id, channel_type, event_type, title, body, status, error) VALUES (?, ?, ?, ?, ?, ?, ?)",
                (user_id, ch["channel_type"], event_type, title, body, status, error_msg)
            )
        db.commit()


