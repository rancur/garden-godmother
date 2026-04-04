"""Federation data exchange routes — harvest offers, seed swaps, alerts, co-op board."""
import json

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
