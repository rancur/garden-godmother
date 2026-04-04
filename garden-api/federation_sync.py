from __future__ import annotations
"""
Background sync engine for Garden Co-op federation.
Periodically pulls data from active peers and pushes our shared data.
"""
import json
import logging
import urllib.request
import urllib.error
from datetime import datetime, timezone

from db import get_db

logger = logging.getLogger(__name__)


def _get_timestamp() -> str:
    return datetime.now(timezone.utc).isoformat()


def _signed_headers(identity: dict, method: str, path: str, body: bytes = b"") -> dict:
    from federation_crypto import sign_request, decrypt_private_key
    ts = _get_timestamp()
    private_key = decrypt_private_key(identity["private_key"])
    sig = sign_request(private_key, method, path, ts, body)
    return {
        "Content-Type": "application/json",
        "X-GG-Instance-Id": identity["instance_id"],
        "X-GG-Timestamp": ts,
        "X-GG-Signature": sig,
    }


def _fetch_from_peer(peer_url: str, path: str, identity: dict) -> dict | None:
    """Make a signed GET request to a peer. Returns parsed JSON or None on error."""
    url = peer_url.rstrip("/") + path
    headers = _signed_headers(identity, "GET", path)
    req = urllib.request.Request(url, headers=headers, method="GET")
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            return json.loads(resp.read())
    except Exception as e:
        logger.warning(f"Failed to fetch {url}: {e}")
        return None


def _push_to_peer(peer_url: str, path: str, payload: dict, identity: dict) -> bool:
    """Make a signed POST request to a peer. Returns True on success."""
    url = peer_url.rstrip("/") + path
    body = json.dumps(payload).encode()
    headers = _signed_headers(identity, "POST", path, body)
    req = urllib.request.Request(url, data=body, headers=headers, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            return resp.status < 300
    except Exception as e:
        logger.warning(f"Failed to push to {url}: {e}")
        return False


def _get_our_shared_data(db, prefs: dict) -> dict:
    """Build the payload of data we're sharing, based on prefs."""
    import sqlite3
    payload = {}

    if prefs.get("share_plant_list"):
        try:
            rows = db.execute("SELECT DISTINCT p.name as plant_name FROM plantings pl JOIN plants p ON pl.plant_id = p.id WHERE pl.status NOT IN ('removed', 'failed')").fetchall()
            payload["plant_list"] = [r["plant_name"] for r in rows]
        except sqlite3.OperationalError:
            pass

    if prefs.get("share_harvest_offers"):
        try:
            rows = db.execute(
                "SELECT plant_name, quantity_description, notes, available_until FROM harvest_offers WHERE published=1 AND status='available'"
            ).fetchall()
            payload["harvest_offers"] = [dict(r) for r in rows]
        except sqlite3.OperationalError:
            pass

    if prefs.get("share_alerts"):
        try:
            rows = db.execute(
                "SELECT alert_type, title, body, severity, affects_plants, expires_at FROM federation_alerts WHERE published=1 AND source_peer_id IS NULL"
            ).fetchall()
            alerts = []
            for r in rows:
                d = dict(r)
                if d.get("affects_plants"):
                    try:
                        d["affects_plants"] = json.loads(d["affects_plants"])
                    except Exception:
                        pass
                alerts.append(d)
            payload["alerts"] = alerts
        except sqlite3.OperationalError:
            pass

    return payload


def sync_with_peer(peer: dict, identity: dict) -> dict:
    """Pull data from one peer and push our data to them. Returns sync result."""
    result = {"peer_id": peer["peer_id"], "pulled": [], "pushed": False, "error": None}

    with get_db() as db:
        # Pull their profile + shared data
        data_types = ["profile", "plant_list", "harvest_offers", "alerts"]
        for data_type in data_types:
            path = f"/api/federation/{data_type.replace('_', '-')}"
            data = _fetch_from_peer(peer["peer_url"], path, identity)
            if data:
                db.execute("""
                    INSERT INTO federation_peer_data (peer_id, data_type, payload, fetched_at)
                    VALUES (?, ?, ?, datetime('now'))
                    ON CONFLICT(peer_id, data_type) DO UPDATE SET
                        payload = excluded.payload,
                        fetched_at = excluded.fetched_at
                """, (peer["peer_id"], data_type, json.dumps(data)))
                result["pulled"].append(data_type)

        # Push our data
        prefs = db.execute("SELECT * FROM federation_sharing_prefs WHERE id=1").fetchone()
        if prefs:
            our_data = _get_our_shared_data(db, dict(prefs))
            if our_data:
                pushed = _push_to_peer(peer["peer_url"], "/api/federation/sync", our_data, identity)
                result["pushed"] = pushed

        # Update last_seen
        db.execute(
            "UPDATE federation_peers SET last_seen=datetime('now') WHERE id=?",
            (peer["id"],)
        )
        db.commit()

    return result


def run_sync_cycle():
    """Main sync job — runs every 30 minutes via APScheduler."""
    logger.info("Federation sync cycle starting")

    with get_db() as db:
        identity = db.execute("SELECT * FROM federation_identity WHERE id=1").fetchone()
        if not identity:
            logger.debug("No federation identity configured, skipping sync")
            return
        identity = dict(identity)

        peers = db.execute(
            "SELECT * FROM federation_peers WHERE status='active'"
        ).fetchall()
        peers = [dict(p) for p in peers]

    if not peers:
        logger.debug("No active peers, skipping sync")
        return

    logger.info(f"Syncing with {len(peers)} peers")
    for peer in peers:
        try:
            result = sync_with_peer(peer, identity)
            logger.info(f"Synced peer {peer['peer_id'][:8]}: pulled={result['pulled']}, pushed={result['pushed']}")
        except Exception as e:
            logger.error(f"Sync failed for peer {peer['peer_id'][:8]}: {e}")

    logger.info("Federation sync cycle complete")
