"""Federation data exchange routes — harvest offers, seed swaps, alerts, co-op board."""
from __future__ import annotations

import json
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException, Request
from db import get_db
from auth import require_admin, require_user
from models import (
    HarvestOfferCreate,
    HarvestOfferUpdate,
    SeedSwapCreate,
    SeedSwapUpdate,
    FederationAlertCreate,
)

router = APIRouter()


# ── Harvest Offers ────────────────────────────────────────────────────

@router.get("/api/harvest-offers/suggestions")
def get_surplus_suggestions(request: Request):
    """Suggest plants the user likely has excess of, based on harvest history and active plantings."""
    require_user(request)
    with get_db() as db:
        # Plants harvested more than 3 times in last 60 days
        frequent = db.execute("""
            SELECT plant_name, COUNT(*) as harvest_count,
                   SUM(COALESCE(weight_oz, 0)) as total_oz,
                   SUM(COALESCE(quantity, 0)) as total_qty
            FROM harvests
            WHERE harvest_date >= date('now', '-60 days')
            GROUP BY plant_name
            HAVING COUNT(*) >= 3
            ORDER BY harvest_count DESC
            LIMIT 8
        """).fetchall()

        # Active plantings of known high-yield plants
        high_yield = ['Tomato', 'Zucchini', 'Cucumber', 'Basil', 'Kale', 'Chard',
                      'Lettuce', 'Pepper', 'Green Bean', 'Herbs']
        active = db.execute("""
            SELECT DISTINCT p.name as plant_name, COUNT(*) as planting_count
            FROM plantings pl
            JOIN plants p ON pl.plant_id = p.id
            WHERE pl.status = 'active'
            AND (""" + " OR ".join(["p.name LIKE ?"] * len(high_yield)) + """)
            GROUP BY p.name
            HAVING COUNT(*) >= 2
        """, [f"%{h}%" for h in high_yield]).fetchall()

        # Already posted offers (don't re-suggest)
        posted = {row["plant_name"] for row in db.execute(
            "SELECT plant_name FROM harvest_offers WHERE status='available'"
        ).fetchall()}

        suggestions = []
        seen = set()
        for row in frequent:
            if row["plant_name"] not in posted and row["plant_name"] not in seen:
                suggestions.append({
                    "plant_name": row["plant_name"],
                    "reason": f"You harvested this {row['harvest_count']} times recently",
                    "total_oz": row["total_oz"],
                    "total_qty": row["total_qty"],
                })
                seen.add(row["plant_name"])
        for row in active:
            if row["plant_name"] not in posted and row["plant_name"] not in seen:
                suggestions.append({
                    "plant_name": row["plant_name"],
                    "reason": f"You have {row['planting_count']} active plantings",
                    "total_oz": 0,
                    "total_qty": 0,
                })
                seen.add(row["plant_name"])

        return suggestions[:6]


@router.get("/api/harvest/surplus-suggestions")
def get_surplus_suggestions_v2(request: Request):
    """Suggest plants the user likely has surplus of, based on harvest history and active plantings."""
    require_user(request)
    with get_db() as db:
        # Plants harvested frequently in last 60 days
        try:
            frequent = db.execute("""
                SELECT plant_name,
                       COUNT(*) as harvest_count,
                       SUM(COALESCE(weight_oz, 0)) as total_oz,
                       SUM(COALESCE(quantity, 0)) as total_qty
                FROM harvests
                WHERE harvest_date >= date('now', '-60 days')
                GROUP BY plant_name
                HAVING COUNT(*) >= 3
                ORDER BY harvest_count DESC
                LIMIT 10
            """).fetchall()
        except Exception:
            frequent = []

        # Active plantings (high-yield plants with 2+ instances)
        high_yield_patterns = ['Tomato', 'Zucchini', 'Cucumber', 'Basil', 'Kale',
                                'Chard', 'Lettuce', 'Pepper', 'Bean', 'Squash', 'Herb']
        try:
            conditions = " OR ".join(["p.name LIKE ?" for _ in high_yield_patterns])
            active = db.execute(f"""
                SELECT p.name as plant_name, COUNT(*) as planting_count
                FROM plantings pl
                JOIN plants p ON pl.plant_id = p.id
                WHERE pl.status = 'active'
                AND ({conditions})
                GROUP BY p.name
                HAVING COUNT(*) >= 2
                ORDER BY planting_count DESC
                LIMIT 10
            """, [f"%{h}%" for h in high_yield_patterns]).fetchall()
        except Exception:
            active = []

        # Already-posted offers (don't re-suggest)
        try:
            posted = {row["plant_name"] for row in db.execute(
                "SELECT plant_name FROM harvest_offers WHERE status='available'"
            ).fetchall()}
        except Exception:
            posted = set()

        suggestions = []
        seen = set()
        for row in frequent:
            name = row["plant_name"]
            if name not in posted and name not in seen:
                suggestions.append({
                    "plant_name": name,
                    "reason": f"Harvested {row['harvest_count']} times in the last 60 days",
                    "total_oz": round(row["total_oz"], 1),
                    "total_qty": int(row["total_qty"]),
                    "source": "harvest_history",
                })
                seen.add(name)

        for row in active:
            name = row["plant_name"]
            if name not in posted and name not in seen:
                suggestions.append({
                    "plant_name": name,
                    "reason": f"{row['planting_count']} active plantings — likely producing more than you need",
                    "total_oz": 0,
                    "total_qty": 0,
                    "source": "active_plantings",
                })
                seen.add(name)

        return suggestions[:6]


@router.get("/api/harvest-offers")
def list_harvest_offers(request: Request, status: str = None, published: bool = None):
    require_user(request)
    with get_db() as db:
        query = "SELECT * FROM harvest_offers WHERE 1=1"
        params = []
        if status is not None:
            query += " AND status = ?"
            params.append(status)
        if published is not None:
            query += " AND published = ?"
            params.append(1 if published else 0)
        query += " ORDER BY created_at DESC"
        rows = db.execute(query, params).fetchall()
        return [dict(r) for r in rows]


@router.post("/api/harvest-offers", status_code=201)
def create_harvest_offer(request: Request, body: HarvestOfferCreate):
    require_user(request)
    with get_db() as db:
        cur = db.execute(
            """INSERT INTO harvest_offers
               (plant_name, quantity_description, notes, available_from, available_until, published)
               VALUES (?, ?, ?, ?, ?, ?)""",
            (
                body.plant_name,
                body.quantity_description,
                body.notes,
                body.available_from,
                body.available_until,
                1 if body.published else 0,
            ),
        )
        db.commit()
        row = db.execute("SELECT * FROM harvest_offers WHERE id = ?", (cur.lastrowid,)).fetchone()
        return dict(row)


@router.patch("/api/harvest-offers/{offer_id}")
def update_harvest_offer(request: Request, offer_id: int, body: HarvestOfferUpdate):
    # TODO: replace with per-user ownership check once user_id column is added to harvest_offers
    require_admin(request)
    with get_db() as db:
        row = db.execute("SELECT id FROM harvest_offers WHERE id = ?", (offer_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Harvest offer not found")
        fields = []
        params = []
        if body.quantity_description is not None:
            fields.append("quantity_description = ?")
            params.append(body.quantity_description)
        if body.notes is not None:
            fields.append("notes = ?")
            params.append(body.notes)
        if body.available_until is not None:
            fields.append("available_until = ?")
            params.append(body.available_until)
        if body.status is not None:
            fields.append("status = ?")
            params.append(body.status)
        if body.published is not None:
            fields.append("published = ?")
            params.append(1 if body.published else 0)
        if not fields:
            raise HTTPException(status_code=400, detail="No fields to update")
        fields.append("updated_at = datetime('now')")
        params.append(offer_id)
        db.execute(f"UPDATE harvest_offers SET {', '.join(fields)} WHERE id = ?", params)
        db.commit()
        updated = db.execute("SELECT * FROM harvest_offers WHERE id = ?", (offer_id,)).fetchone()
        return dict(updated)


@router.delete("/api/harvest-offers/{offer_id}", status_code=204)
def delete_harvest_offer(request: Request, offer_id: int):
    # TODO: replace with per-user ownership check once user_id column is added to harvest_offers
    require_admin(request)
    with get_db() as db:
        row = db.execute("SELECT id FROM harvest_offers WHERE id = ?", (offer_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Harvest offer not found")
        db.execute("DELETE FROM harvest_offers WHERE id = ?", (offer_id,))
        db.commit()


@router.post("/api/harvest-offers/{offer_id}/claim")
def claim_harvest_offer(request: Request, offer_id: int):
    """Mark a harvest offer as claimed by the current user."""
    user = require_user(request)
    now = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")

    with get_db() as db:
        offer = db.execute("SELECT * FROM harvest_offers WHERE id = ?", (offer_id,)).fetchone()
        if not offer:
            raise HTTPException(status_code=404, detail="Harvest offer not found")
        offer = dict(offer)

        if offer.get("status") == "claimed":
            raise HTTPException(status_code=409, detail="This offer has already been claimed")

        # Ensure claim columns exist (guard for DBs not yet migrated)
        columns = [row[1] for row in db.execute("PRAGMA table_info(harvest_offers)").fetchall()]
        if "claimed_by_user_id" not in columns:
            try:
                db.execute("ALTER TABLE harvest_offers ADD COLUMN claimed_by_user_id INTEGER")
                db.execute("ALTER TABLE harvest_offers ADD COLUMN claimed_at TEXT")
                db.commit()
            except Exception:
                pass

        db.execute(
            """UPDATE harvest_offers
               SET status = 'claimed', claimed_by_user_id = ?, claimed_at = ?, updated_at = datetime('now')
               WHERE id = ?""",
            (user["id"], now, offer_id),
        )
        db.commit()

        # Notify — best-effort insert into notification_log for the offer creator
        try:
            display_name = user.get("display_name") or user.get("username", "Someone")
            plant_name = offer.get("plant_name", "harvest")
            db.execute(
                """INSERT INTO notification_log (user_id, channel_type, event_type, title, body, status, error)
                   VALUES (1, 'in_app', 'harvest_claimed', 'Harvest offer claimed', ?, 'sent', NULL)""",
                (f"{display_name} claimed your {plant_name} offer.",),
            )
            db.commit()
        except Exception:
            pass  # notifications are best-effort

        updated = db.execute("SELECT * FROM harvest_offers WHERE id = ?", (offer_id,)).fetchone()
        return dict(updated)


@router.delete("/api/harvest-offers/{offer_id}/claim", status_code=200)
def unclaim_harvest_offer(request: Request, offer_id: int):
    """Un-claim a harvest offer, reverting it to available. Only the claimer may un-claim."""
    user = require_user(request)

    with get_db() as db:
        offer = db.execute("SELECT * FROM harvest_offers WHERE id = ?", (offer_id,)).fetchone()
        if not offer:
            raise HTTPException(status_code=404, detail="Harvest offer not found")
        offer = dict(offer)

        if offer.get("status") != "claimed":
            raise HTTPException(status_code=400, detail="Offer is not claimed")

        if offer.get("claimed_by_user_id") != user["id"]:
            raise HTTPException(status_code=403, detail="You did not claim this offer")

        db.execute(
            """UPDATE harvest_offers
               SET status = 'available', claimed_by_user_id = NULL, claimed_at = NULL,
                   updated_at = datetime('now')
               WHERE id = ?""",
            (offer_id,),
        )
        db.commit()

        updated = db.execute("SELECT * FROM harvest_offers WHERE id = ?", (offer_id,)).fetchone()
        return dict(updated)


# ── Seed Swaps ────────────────────────────────────────────────────────

@router.get("/api/seed-swaps")
def list_seed_swaps(request: Request, status: str = None, published: bool = None):
    require_user(request)
    with get_db() as db:
        query = "SELECT * FROM seed_swaps WHERE 1=1"
        params = []
        if status is not None:
            query += " AND status = ?"
            params.append(status)
        if published is not None:
            query += " AND published = ?"
            params.append(1 if published else 0)
        query += " ORDER BY created_at DESC"
        rows = db.execute(query, params).fetchall()
        return [dict(r) for r in rows]


@router.post("/api/seed-swaps", status_code=201)
def create_seed_swap(request: Request, body: SeedSwapCreate):
    require_user(request)
    with get_db() as db:
        cur = db.execute(
            """INSERT INTO seed_swaps
               (plant_name, variety, quantity_description, looking_for, notes, published)
               VALUES (?, ?, ?, ?, ?, ?)""",
            (
                body.plant_name,
                body.variety,
                body.quantity_description,
                body.looking_for,
                body.notes,
                1 if body.published else 0,
            ),
        )
        db.commit()
        row = db.execute("SELECT * FROM seed_swaps WHERE id = ?", (cur.lastrowid,)).fetchone()
        return dict(row)


@router.patch("/api/seed-swaps/{swap_id}")
def update_seed_swap(request: Request, swap_id: int, body: SeedSwapUpdate):
    # TODO: replace with per-user ownership check once user_id column is added to seed_swaps
    require_admin(request)
    with get_db() as db:
        row = db.execute("SELECT id FROM seed_swaps WHERE id = ?", (swap_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Seed swap not found")
        fields = []
        params = []
        if body.quantity_description is not None:
            fields.append("quantity_description = ?")
            params.append(body.quantity_description)
        if body.looking_for is not None:
            fields.append("looking_for = ?")
            params.append(body.looking_for)
        if body.notes is not None:
            fields.append("notes = ?")
            params.append(body.notes)
        if body.status is not None:
            fields.append("status = ?")
            params.append(body.status)
        if body.published is not None:
            fields.append("published = ?")
            params.append(1 if body.published else 0)
        if not fields:
            raise HTTPException(status_code=400, detail="No fields to update")
        fields.append("updated_at = datetime('now')")
        params.append(swap_id)
        db.execute(f"UPDATE seed_swaps SET {', '.join(fields)} WHERE id = ?", params)
        db.commit()
        updated = db.execute("SELECT * FROM seed_swaps WHERE id = ?", (swap_id,)).fetchone()
        return dict(updated)


@router.delete("/api/seed-swaps/{swap_id}", status_code=204)
def delete_seed_swap(request: Request, swap_id: int):
    # TODO: replace with per-user ownership check once user_id column is added to seed_swaps
    require_admin(request)
    with get_db() as db:
        row = db.execute("SELECT id FROM seed_swaps WHERE id = ?", (swap_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Seed swap not found")
        db.execute("DELETE FROM seed_swaps WHERE id = ?", (swap_id,))
        db.commit()


# ── Federation Alerts ─────────────────────────────────────────────────

@router.get("/api/federation-alerts")
def list_federation_alerts(request: Request):
    require_user(request)
    with get_db() as db:
        rows = db.execute(
            "SELECT * FROM federation_alerts ORDER BY created_at DESC"
        ).fetchall()
        return [dict(r) for r in rows]


@router.post("/api/federation-alerts", status_code=201)
def create_federation_alert(request: Request, body: FederationAlertCreate):
    require_user(request)
    affects_plants_json = json.dumps(body.affects_plants) if body.affects_plants is not None else None
    with get_db() as db:
        cur = db.execute(
            """INSERT INTO federation_alerts
               (source_peer_id, alert_type, title, body, severity, affects_plants, published, expires_at)
               VALUES (NULL, ?, ?, ?, ?, ?, ?, ?)""",
            (
                body.alert_type,
                body.title,
                body.body,
                body.severity,
                affects_plants_json,
                1 if body.published else 0,
                body.expires_at,
            ),
        )
        db.commit()
        row = db.execute("SELECT * FROM federation_alerts WHERE id = ?", (cur.lastrowid,)).fetchone()
        return dict(row)


@router.delete("/api/federation-alerts/{alert_id}", status_code=204)
def delete_federation_alert(request: Request, alert_id: int):
    require_user(request)
    with get_db() as db:
        row = db.execute("SELECT id FROM federation_alerts WHERE id = ?", (alert_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Alert not found")
        db.execute("DELETE FROM federation_alerts WHERE id = ?", (alert_id,))
        db.commit()


# ── Co-op Board ───────────────────────────────────────────────────────

@router.get("/api/coop/board")
def get_coop_board(request: Request):
    require_user(request)
    with get_db() as db:
        # Only pull data from active peers
        active_peers = {
            r["peer_id"]
            for r in db.execute(
                "SELECT peer_id FROM federation_peers WHERE status = 'active'"
            ).fetchall()
        }

        rows = db.execute(
            """SELECT peer_id, data_type, payload
               FROM federation_peer_data
               WHERE data_type IN ('harvest_offers', 'seed_swaps', 'alerts')""",
        ).fetchall()

        harvest_offers = []
        seed_swaps = []
        alerts = []

        for row in rows:
            if row["peer_id"] not in active_peers:
                continue
            try:
                items = json.loads(row["payload"])
            except (json.JSONDecodeError, TypeError):
                continue
            if not isinstance(items, list):
                items = [items]
            if row["data_type"] == "harvest_offers":
                harvest_offers.extend(items)
            elif row["data_type"] == "seed_swaps":
                seed_swaps.extend(items)
            elif row["data_type"] == "alerts":
                alerts.extend(items)

        return {
            "harvest_offers": harvest_offers,
            "seed_swaps": seed_swaps,
            "alerts": alerts,
        }


# ── Co-op Summary ─────────────────────────────────────────────────────

@router.get("/api/coop/summary")
def get_coop_summary(request: Request):
    """Lightweight counts for the dashboard community widget."""
    require_user(request)
    with get_db() as db:
        # Pest alerts from peers this week (severity warning/urgent)
        pest_alerts_week = db.execute("""
            SELECT COUNT(*) FROM federation_alerts
            WHERE created_at >= datetime('now', '-7 days')
            AND (alert_type = 'pest' OR severity IN ('warning', 'urgent'))
        """).fetchone()[0]

        # Peer harvest offers available
        harvest_offer_count = 0
        seed_swap_count = 0
        try:
            board_peers = db.execute(
                "SELECT payload FROM federation_peer_data WHERE data_type='harvest_offers'"
            ).fetchall()
            for row in board_peers:
                offers = json.loads(row["payload"])
                harvest_offer_count += len([o for o in offers if o.get("status") == "available"])

            swap_peers = db.execute(
                "SELECT payload FROM federation_peer_data WHERE data_type='seed_swaps'"
            ).fetchall()
            for row in swap_peers:
                swaps = json.loads(row["payload"])
                seed_swap_count += len([s for s in swaps if s.get("status") == "available"])
        except Exception:
            pass

        # My active offers (harvest_offers)
        my_offers = db.execute(
            "SELECT COUNT(*) FROM harvest_offers WHERE status='available' AND published=1"
        ).fetchone()[0]

        # My published seed swaps
        my_seed_swaps = db.execute(
            "SELECT COUNT(*) FROM seed_swaps WHERE status='available' AND published=1"
        ).fetchone()[0]

        # My published alerts/tips
        my_alerts = db.execute(
            "SELECT COUNT(*) FROM federation_alerts WHERE source_peer_id IS NULL AND published=1"
        ).fetchone()[0]

        my_contributions = my_offers + my_seed_swaps + my_alerts

        # Connected peers (count + names)
        peer_rows = db.execute(
            "SELECT display_name FROM federation_peers WHERE status='active' ORDER BY display_name"
        ).fetchall()
        active_peers = len(peer_rows)
        peer_names = [r["display_name"] for r in peer_rows if r["display_name"]]

        return {
            "active_peers": active_peers,
            "peer_names": peer_names,
            "harvest_offers": harvest_offer_count,
            "seed_swaps": seed_swap_count,
            "pest_alerts_week": pest_alerts_week,
            "my_contributions": my_contributions,
            # keep legacy field for backward-compat
            "recent_alerts": pest_alerts_week,
            "my_active_offers": my_offers,
        }


# ── Co-op Feed ────────────────────────────────────────────────────────

@router.get("/api/coop/feed")
def get_coop_feed(request: Request, limit: int = 20, type: str = None):
    """Unified activity feed from all co-op peers."""
    require_user(request)
    import json

    items = []

    with get_db() as db:
        # Local alerts (our own and from peers)
        alerts = db.execute("""
            SELECT 'alert' as item_type, id, alert_type, title, severity,
                   source_peer_id, created_at,
                   COALESCE(view_count, 0) as view_count,
                   CASE WHEN source_peer_id IS NULL THEN 'You' ELSE source_peer_id END as actor
            FROM federation_alerts
            ORDER BY created_at DESC LIMIT ?
        """, (limit,)).fetchall()

        for a in alerts:
            items.append({
                "type": "alert",
                "id": f"alert-{a['id']}",
                "actor": a["actor"],
                "title": a["title"],
                "alert_type": a["alert_type"],
                "severity": a["severity"],
                "is_mine": a["source_peer_id"] is None,
                "view_count": a["view_count"],
                "created_at": a["created_at"],
            })

        # Peer harvest offers (from federation_peer_data)
        peer_rows = db.execute(
            "SELECT peer_id, payload, fetched_at FROM federation_peer_data WHERE data_type='harvest_offers'"
        ).fetchall()
        for row in peer_rows:
            try:
                offers = json.loads(row["payload"])
                for o in offers:
                    if o.get("status") == "available":
                        items.append({
                            "type": "harvest_offer",
                            "id": f"harvest-{row['peer_id']}-{o.get('offer_id', 0)}",
                            "actor": row["peer_id"],
                            "plant_name": o.get("plant_name", ""),
                            "quantity": o.get("quantity_description", ""),
                            "is_mine": False,
                            "created_at": row["fetched_at"],
                        })
            except Exception:
                pass

        # Our own harvest offers
        my_offers = db.execute(
            "SELECT id, plant_name, quantity_description, status, created_at FROM harvest_offers WHERE published=1"
        ).fetchall()
        for o in my_offers:
            items.append({
                "type": "harvest_offer",
                "id": f"my-harvest-{o['id']}",
                "actor": "You",
                "plant_name": o["plant_name"],
                "quantity": o["quantity_description"],
                "status": o["status"],
                "is_mine": True,
                "created_at": o["created_at"],
            })

        # Peer seed swaps
        swap_rows = db.execute(
            "SELECT peer_id, payload, fetched_at FROM federation_peer_data WHERE data_type='seed_swaps'"
        ).fetchall()
        for row in swap_rows:
            try:
                swaps = json.loads(row["payload"])
                for s in swaps:
                    if s.get("status") == "available":
                        items.append({
                            "type": "seed_swap",
                            "id": f"swap-{row['peer_id']}-{s.get('swap_id', 0)}",
                            "actor": row["peer_id"],
                            "plant_name": s.get("plant_name", ""),
                            "variety": s.get("variety", ""),
                            "looking_for": s.get("looking_for", ""),
                            "is_mine": False,
                            "created_at": row["fetched_at"],
                        })
            except Exception:
                pass

    # Filter by type if requested
    if type:
        items = [i for i in items if i["type"] == type]

    # Sort by created_at descending
    items.sort(key=lambda x: x.get("created_at", ""), reverse=True)

    return items[:limit]
