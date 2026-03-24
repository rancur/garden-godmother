"""Ground plant (in-ground individual plants) endpoints."""
from __future__ import annotations

import json
from datetime import date, datetime, timedelta
from typing import Optional

from fastapi import APIRouter, HTTPException, Query, Request
from fastapi.responses import Response

from db import get_db, row_to_dict
from auth import require_user
from models import GroundPlantCreate, GroundPlantUpdate, GroundPlantReorder
from constants import create_undo_action, _auto_assign_area_from_position

router = APIRouter()

# ──────────────── GROUND PLANTS (in-ground individual plants) ────────────────










@router.get("/api/ground-plants")
def list_ground_plants():
    with get_db() as db:
        rows = db.execute("""
            SELECT gp.*, p.name as plant_name, p.category as plant_category,
                   z.name as zone_name, a.name as area_name, a.color as area_color,
                   a.default_irrigation_type as area_default_irrigation_type,
                   a.default_irrigation_zone_name as area_default_irrigation_zone_name,
                   a.zone_id as area_zone_id
            FROM ground_plants gp
            JOIN plants p ON gp.plant_id = p.id
            LEFT JOIN zones z ON gp.zone_id = z.id
            LEFT JOIN areas a ON gp.area_id = a.id
            WHERE gp.status != 'removed'
            ORDER BY gp.sort_order, gp.name, gp.created_at
        """).fetchall()
        results = []
        for r in rows:
            d = dict(r)
            # Compute effective irrigation: plant override > area default > manual
            d["effective_irrigation_zone_name"] = d["irrigation_zone_name"] or d.get("area_default_irrigation_zone_name")
            d["effective_irrigation_type"] = (
                d["irrigation_type"] if d.get("irrigation_zone_name")
                else d.get("area_default_irrigation_type") if d.get("area_default_irrigation_zone_name")
                else d["irrigation_type"]
            )
            d["irrigation_inherited"] = (
                not d["irrigation_zone_name"] and bool(d.get("area_default_irrigation_zone_name"))
            )
            # Flag if this plant's area was auto-assigned from a zone-linked area and has map position
            d["area_auto_assigned"] = bool(
                d.get("area_zone_id") and d.get("x_feet") is not None and d.get("y_feet") is not None
            )
            results.append(d)
        return results


@router.get("/api/ground-plants/{gp_id}")
def get_ground_plant(gp_id: int):
    with get_db() as db:
        row = db.execute("""
            SELECT gp.*, p.name as plant_name, p.category as plant_category,
                   z.name as zone_name, a.name as area_name, a.color as area_color,
                   a.default_irrigation_type as area_default_irrigation_type,
                   a.default_irrigation_zone_name as area_default_irrigation_zone_name,
                   a.zone_id as area_zone_id,
                   v.name as variety_name, v.desert_rating as variety_desert_rating,
                   v.description as variety_description
            FROM ground_plants gp
            JOIN plants p ON gp.plant_id = p.id
            LEFT JOIN zones z ON gp.zone_id = z.id
            LEFT JOIN areas a ON gp.area_id = a.id
            LEFT JOIN varieties v ON gp.variety_id = v.id
            WHERE gp.id = ?
        """, (gp_id,)).fetchone()
        if not row:
            raise HTTPException(404, "Ground plant not found")
        d = dict(row)
        d["effective_irrigation_zone_name"] = d["irrigation_zone_name"] or d.get("area_default_irrigation_zone_name")
        d["effective_irrigation_type"] = (
            d["irrigation_type"] if d.get("irrigation_zone_name")
            else d.get("area_default_irrigation_type") if d.get("area_default_irrigation_zone_name")
            else d["irrigation_type"]
        )
        d["irrigation_inherited"] = (
            not d["irrigation_zone_name"] and bool(d.get("area_default_irrigation_zone_name"))
        )
        d["area_auto_assigned"] = bool(
            d.get("area_zone_id") and d.get("x_feet") is not None and d.get("y_feet") is not None
        )
        return d


@router.post("/api/ground-plants")
def create_ground_plant(data: GroundPlantCreate):
    valid_statuses = ("planned", "planted", "growing", "established", "dormant", "removed")
    if data.status not in valid_statuses:
        raise HTTPException(400, f"Invalid status. Must be one of: {', '.join(valid_statuses)}")
    with get_db() as db:
        plant = db.execute("SELECT id FROM plants WHERE id = ?", (data.plant_id,)).fetchone()
        if not plant:
            raise HTTPException(404, "Plant not found")
        max_order = db.execute("SELECT COALESCE(MAX(sort_order), -1) FROM ground_plants").fetchone()[0]
        # Auto-assign area based on map position if no area explicitly set
        area_id = data.area_id
        area_auto_assigned = False
        if not area_id and data.x_feet is not None and data.y_feet is not None:
            area_id = _auto_assign_area_from_position(db, data.x_feet, data.y_feet)
            area_auto_assigned = area_id is not None
        cursor = db.execute(
            """INSERT INTO ground_plants (name, plant_id, variety_id, x_feet, y_feet, zone_id,
               planted_date, status, irrigation_type, irrigation_zone_name, notes, area_id, sort_order)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (data.name, data.plant_id, data.variety_id, data.x_feet, data.y_feet,
             data.zone_id, data.planted_date, data.status, data.irrigation_type,
             data.irrigation_zone_name, data.notes, area_id, max_order + 1),
        )
        db.commit()
        result = {"id": cursor.lastrowid, **data.dict(), "sort_order": max_order + 1, "area_id": area_id}
        if area_auto_assigned:
            result["area_auto_assigned"] = True
        return result


@router.patch("/api/ground-plants/{gp_id}")
def update_ground_plant(gp_id: int, data: GroundPlantUpdate):
    with get_db() as db:
        existing = db.execute("SELECT * FROM ground_plants WHERE id = ?", (gp_id,)).fetchone()
        if not existing:
            raise HTTPException(404, "Ground plant not found")
        if data.status and data.status not in ("planned", "planted", "growing", "established", "dormant", "removed"):
            raise HTTPException(400, "Invalid status")
        updates = []
        params = []
        for field in ("name", "plant_id", "variety_id", "x_feet", "y_feet", "zone_id",
                       "planted_date", "status", "irrigation_type", "irrigation_zone_name", "notes"):
            val = getattr(data, field)
            if val is not None:
                updates.append(f"{field} = ?")
                params.append(val)
        # area_id can be set to None (unassign) so handle specially
        if data.area_id is not None:
            updates.append("area_id = ?")
            params.append(data.area_id if data.area_id != 0 else None)
        # Auto-assign area when position changes and no explicit area_id was set in this request
        elif data.x_feet is not None or data.y_feet is not None:
            new_x = data.x_feet if data.x_feet is not None else existing["x_feet"]
            new_y = data.y_feet if data.y_feet is not None else existing["y_feet"]
            if new_x is not None and new_y is not None:
                auto_area = _auto_assign_area_from_position(db, new_x, new_y)
                if auto_area:
                    updates.append("area_id = ?")
                    params.append(auto_area)
        if updates:
            params.append(gp_id)
            db.execute(f"UPDATE ground_plants SET {', '.join(updates)} WHERE id = ?", params)
            # If irrigation changed to non-manual, remove pending water tasks immediately
            if data.irrigation_type and data.irrigation_type != 'manual':
                gp_name = existing["name"]
                if not gp_name:
                    plant_row = db.execute("SELECT name FROM plants WHERE id = ?", (existing["plant_id"],)).fetchone()
                    gp_name = plant_row["name"] if plant_row else "Unknown"
                db.execute(
                    "DELETE FROM garden_tasks WHERE task_type = 'water' AND status IN ('pending', 'overdue') AND title = ?",
                    (f"Water {gp_name}",)
                )
            db.commit()
        return {"ok": True}


@router.post("/api/ground-plants/reorder")
def reorder_ground_plants(data: GroundPlantReorder):
    with get_db() as db:
        for item in data.orders:
            if item.area_id is not None:
                db.execute("UPDATE ground_plants SET sort_order = ?, area_id = ? WHERE id = ?",
                           (item.sort_order, item.area_id if item.area_id != 0 else None, item.id))
            else:
                db.execute("UPDATE ground_plants SET sort_order = ? WHERE id = ?",
                           (item.sort_order, item.id))
        db.commit()
    return {"ok": True}


@router.delete("/api/ground-plants/{gp_id}")
def delete_ground_plant(gp_id: int):
    with get_db() as db:
        existing = db.execute("SELECT * FROM ground_plants WHERE id = ?", (gp_id,)).fetchone()
        if not existing:
            raise HTTPException(404, "Ground plant not found")
        undo_id = create_undo_action(db, "delete_ground_plant", {"ground_plant": dict(existing)})
        db.execute("DELETE FROM ground_plants WHERE id = ?", (gp_id,))
        db.commit()
        return {"ok": True, "undo_id": undo_id}


