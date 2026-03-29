"""Harvest tracking endpoints."""
from __future__ import annotations

import json
from datetime import date, datetime, timedelta
from typing import Optional

from fastapi import APIRouter, HTTPException, Query, Request
from fastapi.responses import Response

from db import get_db, row_to_dict
from auth import require_user, audit_log
from models import HarvestCreate
from constants import create_undo_action
from routes.beds import _trigger_growth_stage_tasks

router = APIRouter()

# ──────────────── HARVESTS ────────────────

# Approximate grocery prices per oz for ROI estimation
GROCERY_PRICE_PER_OZ = {
    "tomato": 0.15,
    "pepper": 0.20,
    "cucumber": 0.10,
    "lettuce": 0.12,
    "spinach": 0.25,
    "kale": 0.22,
    "carrot": 0.08,
    "radish": 0.10,
    "bean": 0.12,
    "pea": 0.18,
    "squash": 0.10,
    "melon": 0.08,
    "watermelon": 0.06,
    "corn": 0.10,
    "onion": 0.06,
    "garlic": 0.40,
    "herb": 0.50,
    "basil": 0.50,
    "cilantro": 0.50,
    "parsley": 0.50,
    "dill": 0.50,
    "mint": 0.50,
    "rosemary": 0.50,
    "sage": 0.50,
    "thyme": 0.50,
    "oregano": 0.50,
    "chive": 0.50,
    "lavender": 0.50,
    "eggplant": 0.12,
    "okra": 0.15,
    "beet": 0.10,
    "turnip": 0.08,
    "potato": 0.06,
    "sweet potato": 0.08,
    "sunflower": 0.20,
    "strawberry": 0.25,
    "fig": 0.30,
    "pomegranate": 0.20,
    "citrus": 0.10,
}


def _estimate_price_per_oz(plant_name: str) -> float:
    """Estimate grocery price per oz based on plant name."""
    name_lower = plant_name.lower()
    for key, price in GROCERY_PRICE_PER_OZ.items():
        if key in name_lower:
            return price
    # Check category
    if any(h in name_lower for h in ("basil", "cilantro", "parsley", "dill", "mint", "rosemary", "sage", "thyme", "oregano", "chive", "lavender")):
        return 0.50
    return 0.12  # default estimate




@router.post("/api/harvests")
def create_harvest(harvest: HarvestCreate, request: Request):
    with get_db() as db:
        instance_id = harvest.instance_id
        planting_id = harvest.planting_id
        plant_id = None
        bed_id = None

        # If instance_id provided, resolve planting_id and plant_id from it
        if instance_id:
            inst = db.execute("SELECT id, plant_id FROM plant_instances WHERE id = ?", (instance_id,)).fetchone()
            if not inst:
                raise HTTPException(404, "Plant instance not found")
            plant_id = inst["plant_id"]
            # Find a matching planting for this instance
            if not planting_id:
                p_row = db.execute("SELECT id, bed_id FROM plantings WHERE instance_id = ? LIMIT 1", (instance_id,)).fetchone()
                if p_row:
                    planting_id = p_row["id"]
                    bed_id = p_row["bed_id"]

        # Verify planting if we have one
        if planting_id:
            planting = db.execute("SELECT id, plant_id, bed_id FROM plantings WHERE id = ?", (planting_id,)).fetchone()
            if not planting:
                raise HTTPException(404, "Planting not found")
            plant_id = planting["plant_id"]
            bed_id = planting["bed_id"]
            # Auto-resolve instance_id from planting if not provided
            if not instance_id:
                inst_row = db.execute("SELECT instance_id FROM plantings WHERE id = ?", (planting_id,)).fetchone()
                if inst_row and inst_row["instance_id"]:
                    instance_id = inst_row["instance_id"]
        elif not instance_id:
            raise HTTPException(400, "Either planting_id or instance_id is required")

        cur = db.execute("""
            INSERT INTO harvests (planting_id, instance_id, harvest_date, weight_oz, quantity, quality, notes)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        """, (planting_id, instance_id, harvest.harvest_date, harvest.weight_oz, harvest.quantity, harvest.quality, harvest.notes))
        harvest_id = cur.lastrowid
        db.commit()

        # If final harvest, mark planting (and plant instance) as harvested
        if harvest.final_harvest:
            if planting_id:
                db.execute("UPDATE plantings SET status = 'harvested' WHERE id = ?", (planting_id,))
                try:
                    _trigger_growth_stage_tasks(db, planting_id, 'harvested', date.today().isoformat())
                except Exception:
                    pass
            if instance_id:
                db.execute("UPDATE plant_instances SET status = 'harvested' WHERE id = ?", (instance_id,))
            elif planting_id:
                inst_check = db.execute("SELECT instance_id FROM plantings WHERE id = ?", (planting_id,)).fetchone()
                if inst_check and inst_check["instance_id"]:
                    db.execute("UPDATE plant_instances SET status = 'harvested' WHERE id = ?", (inst_check["instance_id"],))
            db.commit()

        row = db.execute("""
            SELECT h.*, pl.name as plant_name
            FROM harvests h
            LEFT JOIN plant_instances pi ON h.instance_id = pi.id
            LEFT JOIN plantings p ON h.planting_id = p.id
            JOIN plants pl ON pl.id = COALESCE(pi.plant_id, p.plant_id)
            WHERE h.id = ?
        """, (harvest_id,)).fetchone()
        result = dict(row)
        result["plant_id"] = plant_id

        user = getattr(request.state, 'user', None)
        if user:
            audit_log(db, user['id'], 'create', 'harvest', harvest_id,
                      {'plant_name': result.get('plant_name'), 'weight_oz': harvest.weight_oz, 'quantity': harvest.quantity},
                      request.client.host if request.client else None)

        # Auto-create journal entry if requested
        if harvest.create_journal_entry:
            plant_name = result.get("plant_name", "unknown")
            bed_row = db.execute("SELECT name FROM garden_beds WHERE id = ?", (bed_id,)).fetchone() if bed_id else None
            bed_name = bed_row["name"] if bed_row else None

            parts = []
            if harvest.weight_oz:
                parts.append(f"{harvest.weight_oz} oz")
            if harvest.quantity:
                parts.append(f"{harvest.quantity} items")
            amount_str = " and ".join(parts) if parts else "some"

            content = f"Harvested {amount_str} of {plant_name}"
            if bed_name:
                content += f" from {bed_name}"
            content += "."
            if harvest.notes:
                content += f" {harvest.notes}"

            journal_cur = db.execute(
                """INSERT INTO journal_entries (entry_type, title, content, plant_id, planting_id, bed_id, harvest_id)
                   VALUES (?, ?, ?, ?, ?, ?, ?)""",
                ("harvest", f"Harvest: {plant_name}", content, plant_id, planting_id, bed_id, harvest_id),
            )
            db.commit()
            result["journal_entry_id"] = journal_cur.lastrowid

        return result


@router.get("/api/harvests")
def list_harvests(planting_id: Optional[int] = None):
    with get_db() as db:
        query = """
            SELECT h.*,
                   COALESCE(pi.plant_id, p.plant_id) as plant_id,
                   pl.name as plant_name,
                   je.id as journal_entry_id,
                   pil.bed_id as loc_bed_id, pil.cell_x, pil.cell_y,
                   gb.name as bed_name,
                   pil.location_type
            FROM harvests h
            LEFT JOIN plantings p ON h.planting_id = p.id
            LEFT JOIN plant_instances pi ON h.instance_id = pi.id
            JOIN plants pl ON pl.id = COALESCE(pi.plant_id, p.plant_id)
            LEFT JOIN journal_entries je ON je.harvest_id = h.id
            LEFT JOIN plant_instance_locations pil ON pil.instance_id = h.instance_id AND pil.is_current = 1
            LEFT JOIN garden_beds gb ON pil.bed_id = gb.id
        """
        params = []
        if planting_id is not None:
            query += " WHERE h.planting_id = ?"
            params.append(planting_id)
        query += " ORDER BY h.harvest_date DESC, h.created_at DESC"
        rows = db.execute(query, params).fetchall()
        results = []
        for r in rows:
            d = dict(r)
            # Build location display string
            loc_parts = []
            if d.get("bed_name"):
                loc_parts.append(d["bed_name"])
            if d.get("cell_x") is not None and d.get("cell_y") is not None:
                loc_parts.append(f"cell {d['cell_x']},{d['cell_y']}")
            d["location_display"] = ", ".join(loc_parts) if loc_parts else None
            results.append(d)
        return results


@router.get("/api/harvests/upcoming")
def get_upcoming_harvests():
    """Return active plantings approaching their expected harvest date."""
    with get_db() as db:
        rows = db.execute("""
            SELECT p.id, p.plant_id, p.bed_id, p.status, p.planted_date,
                   pl.name as plant_name, pl.days_to_maturity_min, pl.days_to_maturity_max, pl.category,
                   gb.name as bed_name,
                   CASE WHEN p.planted_date IS NOT NULL AND pl.days_to_maturity_min IS NOT NULL
                        THEN date(p.planted_date, '+' || COALESCE(pl.days_to_maturity_max, pl.days_to_maturity_min) || ' days')
                        ELSE NULL END as expected_harvest_date
            FROM plantings p
            JOIN plants pl ON p.plant_id = pl.id
            LEFT JOIN garden_beds gb ON p.bed_id = gb.id
            WHERE p.status IN ('growing', 'flowering', 'fruiting')
            AND p.planted_date IS NOT NULL
            AND pl.days_to_maturity_min IS NOT NULL
            ORDER BY expected_harvest_date ASC
            LIMIT 20
        """).fetchall()

        today = date.today().isoformat()
        results = []
        for r in rows:
            d = dict(r)
            if d["expected_harvest_date"]:
                days_until = (date.fromisoformat(d["expected_harvest_date"]) - date.today()).days
                d["days_until_harvest"] = days_until
                results.append(d)
        return results


@router.get("/api/harvests/summary")
def harvest_summary():
    with get_db() as db:
        # Totals
        totals = db.execute("""
            SELECT COUNT(*) as total_harvests,
                   COALESCE(SUM(weight_oz), 0) as total_weight_oz
            FROM harvests
        """).fetchone()

        # By plant
        by_plant = db.execute("""
            SELECT pl.name as plant_name,
                   COUNT(*) as harvest_count,
                   COALESCE(SUM(h.weight_oz), 0) as total_weight_oz
            FROM harvests h
            JOIN plantings p ON h.planting_id = p.id
            JOIN plants pl ON p.plant_id = pl.id
            GROUP BY pl.name
            ORDER BY total_weight_oz DESC
        """).fetchall()

        # By month
        by_month = db.execute("""
            SELECT strftime('%Y-%m', harvest_date) as month,
                   COUNT(*) as harvest_count,
                   COALESCE(SUM(weight_oz), 0) as total_weight_oz
            FROM harvests
            GROUP BY month
            ORDER BY month
        """).fetchall()

        return {
            "total_harvests": totals["total_harvests"],
            "total_weight_oz": totals["total_weight_oz"],
            "by_plant": [dict(r) for r in by_plant],
            "by_month": [dict(r) for r in by_month],
        }


@router.delete("/api/harvests/{harvest_id}")
def delete_harvest(harvest_id: int, request: Request):
    with get_db() as db:
        existing = db.execute("SELECT * FROM harvests WHERE id = ?", (harvest_id,)).fetchone()
        if not existing:
            raise HTTPException(404, "Harvest not found")
        undo_id = create_undo_action(db, "delete_harvest", {"harvest": dict(existing)})
        db.execute("DELETE FROM harvests WHERE id = ?", (harvest_id,))
        user = getattr(request.state, 'user', None)
        if user:
            audit_log(db, user['id'], 'delete', 'harvest', harvest_id,
                      {'planting_id': existing['planting_id']},
                      request.client.host if request.client else None)
        db.commit()
        return {"ok": True, "undo_id": undo_id}


