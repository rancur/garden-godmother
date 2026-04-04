"""Federation / Garden Co-op API routes — identity, pairing, peers, sharing prefs, public endpoints."""
from __future__ import annotations

import json as json_mod
import logging
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone
from urllib.parse import urlparse

from fastapi import APIRouter, HTTPException, Request

from auth import audit_log, require_admin, require_user
from db import get_db
from federation_crypto import (
    decrypt_private_key,
    encrypt_private_key,
    generate_instance_id,
    generate_invite_code,
    generate_keypair,
    get_key_fingerprint,
    sign_request,
    verify_request,
    verify_timestamp,
)
from models import (
    FederationConnectRequest,
    FederationPairAccept,
    FederationPairRequest,
    FederationPeerUpdate,
    FederationPrefsUpdate,
    FederationSetup,
)

logger = logging.getLogger(__name__)

router = APIRouter()


# ──────────────── HELPERS ────────────────

def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _verify_peer_request(request: Request, db) -> dict:
    """Verify an inbound peer request via Ed25519 signature headers.

    Returns the peer row dict on success. Raises HTTPException(401) on failure.
    """
    instance_id = request.headers.get("X-GG-Instance-Id")
    timestamp = request.headers.get("X-GG-Timestamp")
    signature = request.headers.get("X-GG-Signature")

    if not instance_id or not timestamp or not signature:
        raise HTTPException(status_code=401, detail="Missing federation auth headers")

    if not verify_timestamp(timestamp):
        raise HTTPException(status_code=401, detail="Request timestamp out of acceptable range")

    peer = db.execute(
        "SELECT * FROM federation_peers WHERE peer_id = ?", (instance_id,)
    ).fetchone()
    if not peer:
        raise HTTPException(status_code=401, detail="Unknown peer instance")

    peer_dict = dict(peer)

    # Body bytes are available via request.state if pre-read, otherwise use empty bytes
    body_bytes = getattr(request.state, "_body_bytes", b"")

    valid = verify_request(
        peer_dict["public_key"],
        request.method,
        request.url.path,
        timestamp,
        body_bytes,
        signature,
    )
    if not valid:
        raise HTTPException(status_code=401, detail="Invalid request signature")

    return peer_dict


def _make_signed_request(url: str, method: str, payload: dict, identity: dict) -> dict:
    """Make an outbound signed HTTP request to a peer instance."""
    path = urlparse(url).path or "/"
    timestamp = _now_iso()
    body_bytes = json_mod.dumps(payload).encode()

    signature = sign_request(
        decrypt_private_key(identity["private_key"]),
        method,
        path,
        timestamp,
        body_bytes,
    )

    headers = {
        "Content-Type": "application/json",
        "X-GG-Instance-Id": identity["instance_id"],
        "X-GG-Timestamp": timestamp,
        "X-GG-Signature": signature,
    }

    req = urllib.request.Request(
        url,
        data=body_bytes if method != "GET" else None,
        headers=headers,
        method=method,
    )
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            return json_mod.loads(resp.read())
    except urllib.error.HTTPError as exc:
        logger.warning("Peer request to %s failed: HTTP %s", url, exc.code)
        raise HTTPException(status_code=502, detail=f"Peer returned HTTP {exc.code}")
    except Exception as exc:
        logger.warning("Peer request to %s failed: %s", url, exc)
        raise HTTPException(status_code=502, detail="Could not reach peer instance")


# ──────────────── PRIVATE ENDPOINTS (require user session) ────────────────

@router.get("/api/federation/identity")
def get_identity(request: Request):
    """Return our federation identity, or indicate it is not yet configured."""
    require_user(request)
    with get_db() as db:
        row = db.execute("SELECT * FROM federation_identity WHERE id = 1").fetchone()
        if not row:
            return {"configured": False}
        d = dict(row)
        d["configured"] = True
        d["key_fingerprint"] = get_key_fingerprint(d["public_key"])
        del d["private_key"]  # never expose private key
        return d


@router.post("/api/federation/setup")
def setup_identity(body: FederationSetup, request: Request):
    """Generate keypair and create/update our federation identity (idempotent)."""
    require_admin(request)
    public_key, private_key = generate_keypair()
    instance_id = generate_instance_id()
    now = _now_iso()

    with get_db() as db:
        # Check if already configured — if so, preserve existing keys/instance_id
        existing = db.execute(
            "SELECT * FROM federation_identity WHERE id = 1"
        ).fetchone()

        if existing:
            # Update mutable fields only; keep keypair and instance_id stable
            db.execute(
                """UPDATE federation_identity
                   SET display_name = ?, instance_url = ?, coarse_location = ?
                   WHERE id = 1""",
                (
                    body.display_name,
                    body.instance_url,
                    body.coarse_location,
                ),
            )
            db.commit()
            row = db.execute("SELECT * FROM federation_identity WHERE id = 1").fetchone()
        else:
            db.execute(
                """INSERT INTO federation_identity
                   (id, instance_id, display_name, public_key, private_key,
                    instance_url, coarse_location, created_at)
                   VALUES (1, ?, ?, ?, ?, ?, ?, ?)""",
                (
                    instance_id,
                    body.display_name,
                    public_key,
                    encrypt_private_key(private_key),
                    body.instance_url,
                    body.coarse_location,
                    now,
                ),
            )
            db.commit()
            row = db.execute("SELECT * FROM federation_identity WHERE id = 1").fetchone()

        d = dict(row)
        d["configured"] = True
        d["key_fingerprint"] = get_key_fingerprint(d["public_key"])
        del d["private_key"]
        return d


@router.post("/api/federation/invite")
def create_invite(request: Request):
    """Generate a single-use invite code with a 24-hour TTL."""
    user = require_user(request)
    with get_db() as db:
        identity = db.execute(
            "SELECT * FROM federation_identity WHERE id = 1"
        ).fetchone()
        if not identity:
            raise HTTPException(
                status_code=400,
                detail="Federation identity not configured. Run setup first.",
            )

        code = generate_invite_code()
        now = datetime.now(timezone.utc)
        expires_at = (now + timedelta(hours=24)).isoformat().replace("+00:00", "Z")

        db.execute(
            """INSERT INTO federation_pairing_codes
               (code, created_by_user_id, expires_at, created_at)
               VALUES (?, ?, ?, ?)""",
            (code, user["id"], expires_at, now.isoformat().replace("+00:00", "Z")),
        )
        db.commit()

        instance_url = identity["instance_url"] or ""
        pair_url = f"{instance_url}/coop/pair?code={code}" if instance_url else None

        return {"code": code, "expires_at": expires_at, "pair_url": pair_url}


@router.post("/api/federation/connect")
def connect_to_peer(body: FederationConnectRequest, request: Request):
    """Initiate an outbound connection request to a peer instance."""
    require_user(request)
    with get_db() as db:
        identity = db.execute(
            "SELECT * FROM federation_identity WHERE id = 1"
        ).fetchone()
        if not identity:
            raise HTTPException(
                status_code=400,
                detail="Federation identity not configured. Run setup first.",
            )
        identity = dict(identity)

    payload = {
        "instance_id": identity["instance_id"],
        "display_name": identity["display_name"],
        "public_key": identity["public_key"],
        "instance_url": identity["instance_url"],
        "invite_code": body.invite_code,
    }

    peer_url = body.peer_url.rstrip("/")
    response_data = _make_signed_request(
        f"{peer_url}/api/federation/pair-request",
        "POST",
        payload,
        identity,
    )

    # MITM protection: cross-check public key from pair-request response against the
    # peer's public /api/federation/profile endpoint.
    # Full TOFU protection requires out-of-band key verification (e.g., QR code scanning).
    # This double-fetch reduces but does not eliminate MITM risk.
    pair_public_key = response_data.get("public_key", "")
    key_verified = False
    if pair_public_key:
        try:
            profile_req = urllib.request.Request(
                f"{peer_url}/api/federation/profile",
                method="GET",
            )
            with urllib.request.urlopen(profile_req, timeout=10) as resp:
                profile_data = json_mod.loads(resp.read())
            profile_public_key = profile_data.get("public_key", "")
            if profile_public_key and profile_public_key != pair_public_key:
                logger.warning(
                    "Public key mismatch for peer %s: pair-request key differs from profile key. "
                    "Possible MITM — rejecting connection.",
                    peer_url,
                )
                raise HTTPException(
                    status_code=502,
                    detail="Peer public key mismatch between pair-request and profile — possible MITM attack",
                )
            elif profile_public_key:
                key_verified = True
        except HTTPException:
            raise
        except Exception as exc:
            logger.warning(
                "Could not verify peer public key via profile fetch — storing as unverified: %s",
                exc,
            )

    status = "pending" if key_verified else "unverified"
    peer_instance_id = response_data.get("instance_id") or body.peer_url
    now = _now_iso()

    with get_db() as db:
        existing = db.execute(
            "SELECT id FROM federation_peers WHERE peer_id = ?", (peer_instance_id,)
        ).fetchone()
        if existing:
            db.execute(
                """UPDATE federation_peers
                   SET status = ?, peer_url = ?, last_seen = ?
                   WHERE peer_id = ?""",
                (status, peer_url, now, peer_instance_id),
            )
        else:
            db.execute(
                """INSERT INTO federation_peers
                   (peer_id, peer_url, display_name, public_key, status, created_at, last_seen)
                   VALUES (?, ?, ?, ?, ?, ?, ?)""",
                (
                    peer_instance_id,
                    peer_url,
                    response_data.get("display_name", ""),
                    response_data.get("public_key", ""),
                    status,
                    now,
                    now,
                ),
            )
        db.commit()

        peer_row = db.execute(
            "SELECT id FROM federation_peers WHERE peer_id = ?", (peer_instance_id,)
        ).fetchone()

    return {"status": status, "key_verified": key_verified, "peer_id": peer_row["id"] if peer_row else None}


@router.get("/api/federation/peers")
def list_peers(request: Request):
    """List all known federation peers."""
    require_user(request)
    with get_db() as db:
        rows = db.execute(
            "SELECT * FROM federation_peers ORDER BY created_at DESC"
        ).fetchall()
        return [dict(r) for r in rows]


@router.patch("/api/federation/peers/{peer_id}")
def update_peer(peer_id: int, body: FederationPeerUpdate, request: Request):
    """Update a peer's status (accept/block) or display name."""
    require_user(request)
    with get_db() as db:
        peer = db.execute(
            "SELECT * FROM federation_peers WHERE id = ?", (peer_id,)
        ).fetchone()
        if not peer:
            raise HTTPException(status_code=404, detail="Peer not found")
        peer = dict(peer)

        if body.status and body.status not in ("active", "blocked", "unverified"):
            raise HTTPException(400, "status must be 'active', 'blocked', or 'unverified'")

        updates = []
        params = []
        if body.status is not None:
            updates.append("status = ?")
            params.append(body.status)
        if body.display_name is not None:
            updates.append("display_name = ?")
            params.append(body.display_name)

        if updates:
            params.append(peer_id)
            db.execute(
                f"UPDATE federation_peers SET {', '.join(updates)} WHERE id = ?", params
            )
            db.commit()

        # If accepting, notify the peer
        if body.status == "active":
            identity = db.execute(
                "SELECT * FROM federation_identity WHERE id = 1"
            ).fetchone()
            if identity:
                identity = dict(identity)
                accept_payload = {
                    "instance_id": identity["instance_id"],
                    "display_name": identity["display_name"],
                    "public_key": identity["public_key"],
                    "instance_url": identity["instance_url"],
                }
                peer_url = peer.get("peer_url", "").rstrip("/")
                try:
                    _make_signed_request(
                        f"{peer_url}/api/federation/pair-accept",
                        "POST",
                        accept_payload,
                        identity,
                    )
                except Exception as exc:
                    logger.warning(
                        "Could not notify peer %s of acceptance: %s", peer_url, exc
                    )

        row = db.execute(
            "SELECT * FROM federation_peers WHERE id = ?", (peer_id,)
        ).fetchone()
        return dict(row)


@router.delete("/api/federation/peers/{peer_id}")
def delete_peer(peer_id: int, request: Request):
    """Remove a peer and delete all cached data for that peer."""
    require_user(request)
    with get_db() as db:
        peer = db.execute(
            "SELECT * FROM federation_peers WHERE id = ?", (peer_id,)
        ).fetchone()
        if not peer:
            raise HTTPException(status_code=404, detail="Peer not found")

        db.execute("DELETE FROM federation_peer_data WHERE peer_id = ?", (peer_id,))
        db.execute("DELETE FROM federation_peers WHERE id = ?", (peer_id,))
        db.commit()

    return {"ok": True, "deleted_id": peer_id}


@router.get("/api/federation/prefs")
def get_prefs(request: Request):
    """Return current federation sharing preferences."""
    require_user(request)
    with get_db() as db:
        row = db.execute(
            "SELECT * FROM federation_sharing_prefs WHERE id = 1"
        ).fetchone()
        if not row:
            return {
                "share_plant_list": False,
                "share_harvest_offers": False,
                "share_seed_swaps": False,
                "share_journal_public": False,
                "share_alerts": False,
            }
        return dict(row)


@router.patch("/api/federation/prefs")
def update_prefs(body: FederationPrefsUpdate, request: Request):
    """Update federation sharing preferences (upsert)."""
    require_user(request)
    now = _now_iso()
    with get_db() as db:
        existing = db.execute(
            "SELECT * FROM federation_sharing_prefs WHERE id = 1"
        ).fetchone()

        if existing:
            updates = []
            params = []
            field_map = {
                "share_plant_list": body.share_plant_list,
                "share_harvest_offers": body.share_harvest_offers,
                "share_seed_swaps": body.share_seed_swaps,
                "share_journal_public": body.share_journal_public,
                "share_alerts": body.share_alerts,
            }
            for field, value in field_map.items():
                if value is not None:
                    updates.append(f"{field} = ?")
                    params.append(value)
            updates.append("updated_at = ?")
            params.append(now)
            params.append(1)
            db.execute(
                f"UPDATE federation_sharing_prefs SET {', '.join(updates)} WHERE id = ?",
                params,
            )
        else:
            db.execute(
                """INSERT INTO federation_sharing_prefs
                   (id, share_plant_list, share_harvest_offers, share_seed_swaps,
                    share_journal_public, share_alerts, updated_at)
                   VALUES (1, ?, ?, ?, ?, ?, ?)""",
                (
                    body.share_plant_list or False,
                    body.share_harvest_offers or False,
                    body.share_seed_swaps or False,
                    body.share_journal_public or False,
                    body.share_alerts or False,
                    now,
                ),
            )
        db.commit()

        row = db.execute(
            "SELECT * FROM federation_sharing_prefs WHERE id = 1"
        ).fetchone()
        return dict(row)


@router.post("/api/federation/peers/{peer_id}/sync")
def trigger_sync(peer_id: int, request: Request):
    """Manually trigger a data sync pull from a peer instance."""
    require_user(request)
    with get_db() as db:
        peer = db.execute(
            "SELECT * FROM federation_peers WHERE id = ?", (peer_id,)
        ).fetchone()
        if not peer:
            raise HTTPException(status_code=404, detail="Peer not found")
        peer = dict(peer)

        if peer["status"] != "active":
            raise HTTPException(
                status_code=400, detail="Peer is not active; cannot sync"
            )

        identity = db.execute(
            "SELECT * FROM federation_identity WHERE id = 1"
        ).fetchone()
        if not identity:
            raise HTTPException(
                status_code=400, detail="Federation identity not configured"
            )
        identity = dict(identity)

    peer_url = peer["peer_url"].rstrip("/")
    last_seq = peer.get("last_sync_seq") or 0

    sync_url = f"{peer_url}/api/federation/sync?since={last_seq}"
    # Build signed GET request manually (no body for GET)
    timestamp = _now_iso()
    path = f"/api/federation/sync"
    signature = sign_request(
        decrypt_private_key(identity["private_key"]),
        "GET",
        path,
        timestamp,
        b"",
    )
    headers = {
        "X-GG-Instance-Id": identity["instance_id"],
        "X-GG-Timestamp": timestamp,
        "X-GG-Signature": signature,
    }
    req = urllib.request.Request(sync_url, headers=headers, method="GET")
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            sync_data = json_mod.loads(resp.read())
    except Exception as exc:
        logger.warning("Sync from peer %s failed: %s", peer_url, exc)
        raise HTTPException(status_code=502, detail=f"Sync failed: {exc}")

    now = _now_iso()
    data_types_synced = []

    with get_db() as db:
        items = sync_data.get("items", [])
        new_seq = last_seq
        for item in items:
            data_type = item.get("data_type", "unknown")
            seq = item.get("seq", 0)
            payload = json_mod.dumps(item.get("payload", {}))
            expires_at = item.get("expires_at")
            new_seq = max(new_seq, seq)

            db.execute(
                """INSERT OR REPLACE INTO federation_peer_data
                   (peer_id, data_type, seq, payload, expires_at, fetched_at)
                   VALUES (?, ?, ?, ?, ?, ?)""",
                (peer_id, data_type, seq, payload, expires_at, now),
            )
            if data_type not in data_types_synced:
                data_types_synced.append(data_type)

        db.execute(
            "UPDATE federation_peers SET last_seen = ?, last_sync_seq = ? WHERE id = ?",
            (now, new_seq, peer_id),
        )
        db.commit()

    return {"synced": True, "data_types": data_types_synced}


# ──────────────── PUBLIC PEER-TO-PEER ENDPOINTS ────────────────
# These are called by remote GG instances, NOT by user sessions.
# Auth is via Ed25519 request signatures, except pair-request which uses invite codes.

@router.post("/api/federation/pair-request")
async def receive_pair_request(body: FederationPairRequest, request: Request):
    """Receive an inbound pairing request from a remote instance."""
    with get_db() as db:
        identity = db.execute(
            "SELECT * FROM federation_identity WHERE id = 1"
        ).fetchone()
        if not identity:
            raise HTTPException(
                status_code=503,
                detail="This instance has not configured federation.",
            )

        # Atomically claim the invite code — prevents double-use under concurrent requests
        cursor = db.execute(
            """UPDATE federation_pairing_codes
               SET used_at = datetime('now'), used_by_peer_id = ?
               WHERE code = ?
                 AND used_at IS NULL
                 AND expires_at > datetime('now')""",
            (body.instance_id, body.invite_code),
        )
        db.commit()

        if cursor.rowcount == 0:
            raise HTTPException(400, "Invalid, expired, or already-used invite code")

        now = _now_iso()

        # Upsert the peer
        existing = db.execute(
            "SELECT id FROM federation_peers WHERE peer_id = ?", (body.instance_id,)
        ).fetchone()
        if existing:
            db.execute(
                """UPDATE federation_peers
                   SET peer_url = ?, display_name = ?, public_key = ?,
                       status = 'pending', last_seen = ?
                   WHERE peer_id = ?""",
                (
                    body.instance_url,
                    body.display_name,
                    body.public_key,
                    now,
                    body.instance_id,
                ),
            )
            peer_id = existing["id"]
        else:
            cur = db.execute(
                """INSERT INTO federation_peers
                   (peer_id, peer_url, display_name, public_key, status, created_at, last_seen)
                   VALUES (?, ?, ?, ?, 'pending', ?, ?)""",
                (
                    body.instance_id,
                    body.instance_url,
                    body.display_name,
                    body.public_key,
                    now,
                    now,
                ),
            )
            peer_id = cur.lastrowid

        db.commit()

    return {
        "status": "pending",
        "message": "Pairing request received. Awaiting approval.",
    }


@router.post("/api/federation/pair-accept")
async def receive_pair_accept(body: FederationPairAccept, request: Request):
    """Receive pairing acceptance from a peer we previously sent a pair-request to."""
    # Read body bytes for signature verification before Pydantic parses it
    body_bytes = await request.body()
    request.state._body_bytes = body_bytes

    # Signature verification is REQUIRED — headers must be present
    timestamp = request.headers.get("X-GG-Timestamp")
    signature = request.headers.get("X-GG-Signature")
    if not timestamp or not signature:
        raise HTTPException(status_code=401, detail="Invalid or missing signature")

    if not verify_timestamp(timestamp):
        raise HTTPException(status_code=401, detail="Invalid or missing signature")

    with get_db() as db:
        peer = db.execute(
            "SELECT * FROM federation_peers WHERE peer_id = ?", (body.instance_id,)
        ).fetchone()

        if not peer:
            # No pending row — we never initiated pairing with this instance
            raise HTTPException(403, "No pending pairing request found for this instance")

        if peer["status"] != "pending":
            raise HTTPException(409, "Peer is already active or blocked")

        # Known peer: verify using their stored public key
        verify_key = dict(peer)["public_key"]

        valid = verify_request(
            verify_key,
            request.method,
            request.url.path,
            timestamp,
            body_bytes,
            signature,
        )
        if not valid:
            raise HTTPException(status_code=401, detail="Invalid or missing signature")

        now = _now_iso()
        db.execute(
            """UPDATE federation_peers
               SET status = 'active', last_seen = ?,
                   display_name = ?, public_key = ?, peer_url = ?
               WHERE peer_id = ?""",
            (
                now,
                body.display_name,
                body.public_key,
                body.instance_url,
                body.instance_id,
            ),
        )
        db.commit()

    return {"status": "active"}


@router.get("/api/federation/profile")
async def get_public_profile(request: Request):
    """Return our public identity profile to a verified peer."""
    body_bytes = await request.body()
    request.state._body_bytes = body_bytes

    with get_db() as db:
        peer = _verify_peer_request(request, db)

        identity = db.execute(
            "SELECT * FROM federation_identity WHERE id = 1"
        ).fetchone()
        if not identity:
            raise HTTPException(status_code=503, detail="Federation not configured")

        identity = dict(identity)
        return {
            "instance_id": identity["instance_id"],
            "display_name": identity["display_name"],
            "public_key": identity["public_key"],
            "coarse_location": identity.get("coarse_location"),
            "instance_url": identity.get("instance_url"),
        }


@router.get("/api/federation/plant-list")
async def get_public_plant_list(request: Request):
    """Return our plant list to a verified peer, if sharing is enabled."""
    body_bytes = await request.body()
    request.state._body_bytes = body_bytes

    with get_db() as db:
        _verify_peer_request(request, db)

        prefs = db.execute(
            "SELECT * FROM federation_sharing_prefs WHERE id = 1"
        ).fetchone()
        if not prefs or not prefs["share_plant_list"]:
            raise HTTPException(
                status_code=403,
                detail="This instance has disabled plant list sharing.",
            )

        # Return plant names currently being grown (active plantings)
        rows = db.execute(
            """SELECT DISTINCT p.name
               FROM plantings pl
               JOIN plants p ON pl.plant_id = p.id
               WHERE pl.status = 'active'
               ORDER BY p.name"""
        ).fetchall()

        return {"plants": [r["name"] for r in rows]}


@router.get("/api/federation/sync")
async def get_sync_feed(since: int = 0, request: Request = None):
    """Return a paginated sync feed of changes since a given sequence number."""
    body_bytes = await request.body()
    request.state._body_bytes = body_bytes

    with get_db() as db:
        _verify_peer_request(request, db)

        prefs_row = db.execute(
            "SELECT * FROM federation_sharing_prefs WHERE id = 1"
        ).fetchone()
        prefs = dict(prefs_row) if prefs_row else {}

        items = []
        seq = since

        # Share plant list if enabled
        if prefs.get("share_plant_list"):
            rows = db.execute(
                """SELECT p.name, pl.created_at, pl.id as seq_id
                   FROM plantings pl
                   JOIN plants p ON pl.plant_id = p.id
                   WHERE pl.status = 'active' AND pl.id > ?
                   ORDER BY pl.id""",
                (since,),
            ).fetchall()
            for r in rows:
                seq = max(seq, r["seq_id"])
                items.append(
                    {
                        "data_type": "plant",
                        "seq": r["seq_id"],
                        "payload": {"name": r["name"]},
                        "expires_at": None,
                    }
                )

        # Share harvest offers if enabled
        if prefs.get("share_harvest_offers"):
            rows = db.execute(
                """SELECT h.id, h.notes, h.harvest_date, h.id as seq_id
                   FROM harvests h
                   WHERE h.id > ?
                   ORDER BY h.id""",
                (since,),
            ).fetchall()
            for r in rows:
                seq = max(seq, r["seq_id"])
                items.append(
                    {
                        "data_type": "harvest_offer",
                        "seq": r["seq_id"],
                        "payload": {
                            "notes": r["notes"],
                            "harvest_date": r["harvest_date"],
                        },
                        "expires_at": None,
                    }
                )

        return {"items": items, "next_seq": seq}
