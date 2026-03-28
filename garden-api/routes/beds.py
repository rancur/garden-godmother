"""Planter/bed endpoints."""
from __future__ import annotations

import json
import uuid
from datetime import date, datetime, timedelta
from typing import Optional

from fastapi import APIRouter, HTTPException, Query, Request
from fastapi.responses import Response

from db import get_db, row_to_dict
from auth import require_user, require_admin, audit_log, get_request_user
from models import (
    BedCreate, BedUpdate, ReorderRequest, PlantingCreate, PlantingUpdate,
    PlantingMove, PlantingMoveToGround, GroundPlantMoveToPlanter,
    TrayCellMoveToPlanter, BedPositionUpdate, BedSectionCreate, BedSectionUpdate,
    AreaCreate, AreaUpdate,
)
from constants import CURRENT_YEAR, create_undo_action

router = APIRouter()


# ──────────────── GARDEN BED TEMPLATES ────────────────

GARDEN_TEMPLATES = [
    {
        "id": "salsa",
        "name": "Salsa Garden",
        "description": "Everything you need for fresh salsa",
        "emoji": "\U0001F336\uFE0F",
        "plants": ["Tomato", "Jalape\u00f1o", "Cilantro", "Onion"],
        "min_cells": 4,
    },
    {
        "id": "three_sisters",
        "name": "Three Sisters",
        "description": "Traditional Native American companion planting",
        "emoji": "\U0001F33D",
        "plants": ["Corn", "Beans", "Squash"],
        "min_cells": 6,
    },
    {
        "id": "pizza",
        "name": "Pizza Garden",
        "description": "Grow your own pizza toppings",
        "emoji": "\U0001F355",
        "plants": ["Tomato", "Basil", "Oregano", "Bell Pepper"],
        "min_cells": 4,
    },
    {
        "id": "herb",
        "name": "Herb Garden",
        "description": "Essential cooking herbs",
        "emoji": "\U0001F33F",
        "plants": ["Basil", "Rosemary", "Thyme", "Parsley", "Mint", "Oregano"],
        "min_cells": 6,
    },
    {
        "id": "pollinator",
        "name": "Pollinator Garden",
        "description": "Attract bees and butterflies",
        "emoji": "\U0001F98B",
        "plants": ["Lavender", "Sunflower", "Zinnia", "Marigold", "Cosmos"],
        "min_cells": 5,
    },
    {
        "id": "desert_salad",
        "name": "Desert Salad Bowl",
        "description": "Heat-tolerant salad greens",
        "emoji": "\U0001F957",
        "plants": ["Lettuce", "Spinach", "Arugula", "Radish", "Carrot"],
        "min_cells": 5,
    },
]


@router.get("/api/beds/templates")
def list_templates(request: Request):
    require_user(request)
    return GARDEN_TEMPLATES


@router.post("/api/beds/{bed_id}/apply-template")
async def apply_template(bed_id: int, request: Request):
    """Apply a garden template to a bed, auto-placing plants in the grid."""
    require_user(request)
    body = await request.json()
    template_id = body.get("template_id")

    template = next((t for t in GARDEN_TEMPLATES if t["id"] == template_id), None)
    if not template:
        raise HTTPException(404, "Template not found")

    with get_db() as db:
        bed = db.execute("SELECT * FROM garden_beds WHERE id = ?", (bed_id,)).fetchone()
        if not bed:
            raise HTTPException(404, "Bed not found")

        total_cells = bed["width_cells"] * bed["height_cells"]
        if total_cells < template["min_cells"]:
            raise HTTPException(400, f"Bed needs at least {template['min_cells']} cells for this template")

        placed = 0
        for plant_name in template["plants"]:
            plant = db.execute("SELECT id FROM plants WHERE name LIKE ?", (f"%{plant_name}%",)).fetchone()
            if not plant:
                continue

            # Find next empty cell
            found = False
            for y in range(bed["height_cells"]):
                for x in range(bed["width_cells"]):
                    existing = db.execute(
                        "SELECT id FROM plantings WHERE bed_id = ? AND cell_x = ? AND cell_y = ? AND status NOT IN ('removed', 'harvested', 'died')",
                        (bed_id, x, y)
                    ).fetchone()
                    if not existing:
                        db.execute(
                            "INSERT INTO plantings (plant_id, bed_id, cell_x, cell_y, status, planted_date) VALUES (?, ?, ?, ?, 'planned', date('now'))",
                            (plant["id"], bed_id, x, y)
                        )
                        placed += 1
                        found = True
                        break
                if found:
                    break

        db.commit()
        return {"ok": True, "placed": placed, "template": template["name"]}


# ──────────────── AREAS ────────────────

@router.get("/api/areas")
def list_areas(type: Optional[str] = Query(None)):
    """List all areas. The 'type' param is accepted for backward compat but ignored."""
    with get_db() as db:
        rows = db.execute("""
            SELECT a.*, z.name as zone_name, z.zone_type as zone_type
            FROM areas a
            LEFT JOIN zones z ON a.zone_id = z.id
            ORDER BY a.sort_order, a.name
        """).fetchall()
        return [dict(r) for r in rows]

@router.post("/api/areas")
def create_area(data: AreaCreate):
    with get_db() as db:
        max_order = db.execute("SELECT COALESCE(MAX(sort_order), -1) FROM areas").fetchone()[0]
        cursor = db.execute(
            "INSERT INTO areas (name, area_type, sort_order, color, notes, default_irrigation_type, default_irrigation_zone_name, zone_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            (data.name, "all", max_order + 1, data.color, data.notes,
             data.default_irrigation_type or "manual", data.default_irrigation_zone_name, data.zone_id),
        )
        db.commit()
        row = db.execute("SELECT * FROM areas WHERE id = ?", (cursor.lastrowid,)).fetchone()
        return dict(row) if row else {"id": cursor.lastrowid, "name": data.name}

@router.patch("/api/areas/{area_id}")
def update_area(area_id: int, data: AreaUpdate):
    with get_db() as db:
        existing = db.execute("SELECT * FROM areas WHERE id = ?", (area_id,)).fetchone()
        if not existing:
            raise HTTPException(404, "Area not found")
        updates = []
        params = []
        for field in ("name", "color", "notes", "sort_order", "map_x_feet", "map_y_feet", "map_width_feet", "map_height_feet", "map_polygon_points",
                       "default_irrigation_type", "zone_id"):
            val = getattr(data, field)
            if val is not None:
                updates.append(f"{field} = ?")
                params.append(val)
        if data.default_irrigation_zone_name is not None:
            updates.append("default_irrigation_zone_name = ?")
            params.append(data.default_irrigation_zone_name or None)
        if updates:
            params.append(area_id)
            db.execute(f"UPDATE areas SET {', '.join(updates)} WHERE id = ?", params)
            db.commit()
        row = db.execute("SELECT * FROM areas WHERE id = ?", (area_id,)).fetchone()
        return dict(row) if row else {"ok": True}

@router.delete("/api/areas/{area_id}")
def delete_area(area_id: int):
    with get_db() as db:
        existing = db.execute("SELECT * FROM areas WHERE id = ?", (area_id,)).fetchone()
        if not existing:
            raise HTTPException(404, "Area not found")
        db.execute("UPDATE garden_beds SET area_id = NULL WHERE area_id = ?", (area_id,))
        db.execute("UPDATE seed_trays SET area_id = NULL WHERE area_id = ?", (area_id,))
        db.execute("UPDATE ground_plants SET area_id = NULL WHERE area_id = ?", (area_id,))
        db.execute("DELETE FROM areas WHERE id = ?", (area_id,))
        db.commit()
        return {"ok": True}

@router.get("/api/areas/{area_id}/contents")
def get_area_contents(area_id: int):
    """Return everything in an area: beds, trays, and ground plants."""
    with get_db() as db:
        area = db.execute("SELECT * FROM areas WHERE id = ?", (area_id,)).fetchone()
        if not area:
            raise HTTPException(404, "Area not found")

        beds = db.execute("""
            SELECT gb.*, a.name as area_name, a.color as area_color,
                   (SELECT COUNT(*) FROM plantings WHERE bed_id = gb.id AND status NOT IN ('removed', 'harvested', 'died', 'failed')) as active_plantings
            FROM garden_beds gb
            LEFT JOIN areas a ON gb.area_id = a.id
            WHERE gb.area_id = ?
            ORDER BY gb.sort_order, gb.name
        """, (area_id,)).fetchall()

        trays = db.execute("""
            SELECT st.*, a.name as area_name, a.color as area_color
            FROM seed_trays st
            LEFT JOIN areas a ON st.area_id = a.id
            WHERE st.area_id = ?
            ORDER BY st.sort_order, st.name
        """, (area_id,)).fetchall()

        ground_plants = db.execute("""
            SELECT gp.*, p.name as plant_name, p.category as plant_category,
                   z.name as zone_name, a.name as area_name, a.color as area_color,
                   a.default_irrigation_type as area_default_irrigation_type,
                   a.default_irrigation_zone_name as area_default_irrigation_zone_name
            FROM ground_plants gp
            JOIN plants p ON gp.plant_id = p.id
            LEFT JOIN zones z ON gp.zone_id = z.id
            LEFT JOIN areas a ON gp.area_id = a.id
            WHERE gp.area_id = ? AND gp.status != 'removed'
            ORDER BY gp.sort_order, gp.name
        """, (area_id,)).fetchall()

        gp_results = []
        for r in ground_plants:
            d = dict(r)
            d["effective_irrigation_zone_name"] = d["irrigation_zone_name"] or d.get("area_default_irrigation_zone_name")
            d["effective_irrigation_type"] = (
                d["irrigation_type"] or d.get("area_default_irrigation_type") or "manual"
            )
            d["irrigation_inherited"] = (
                not d["irrigation_zone_name"] and bool(d.get("area_default_irrigation_zone_name"))
            )
            gp_results.append(d)

        return {
            "area": dict(area),
            "beds": [dict(r) for r in beds],
            "trays": [dict(r) for r in trays],
            "ground_plants": gp_results,
        }


# ──────────────── GARDEN BEDS ────────────────

@router.get("/api/beds")
def list_beds():
    with get_db() as db:
        rows = db.execute("""
            SELECT gb.*, a.name as area_name, a.color as area_color,
                   pt.name as planter_type_name, pt.brand as planter_brand,
                   pt.tiers as planter_tiers, pt.pockets_per_tier as planter_pockets_per_tier,
                   pt.total_pockets as planter_total_pockets, pt.form_factor as planter_form_factor,
                   sp.brand as soil_product_brand, sp.product_name as soil_product_name,
                   (SELECT COUNT(*) FROM plantings WHERE bed_id = gb.id AND status NOT IN ('removed', 'harvested', 'died', 'failed')) as active_plantings
            FROM garden_beds gb
            LEFT JOIN areas a ON gb.area_id = a.id
            LEFT JOIN planter_types pt ON gb.planter_type_id = pt.id
            LEFT JOIN soil_products sp ON gb.soil_product_id = sp.id
            ORDER BY COALESCE(a.sort_order, 999999), gb.sort_order, gb.name
        """).fetchall()
        return [dict(r) for r in rows]


@router.post("/api/beds")
def create_bed(bed: BedCreate):
    if bed.bed_type not in ("grid", "linear", "single", "freeform", "vertical"):
        raise HTTPException(400, "Invalid bed_type")
    # Enforce constraints for special bed types
    w = bed.width_cells
    h = bed.height_cells
    if bed.bed_type == "single":
        w, h = 1, 1
    # For vertical beds, auto-set dimensions from planter type
    planter_type_id = bed.planter_type_id
    if bed.bed_type == "vertical" and planter_type_id:
        with get_db() as db:
            pt = db.execute("SELECT * FROM planter_types WHERE id = ?", (planter_type_id,)).fetchone()
            if pt:
                w = pt["pockets_per_tier"] or w
                h = pt["tiers"] or h
    with get_db() as db:
        cursor = db.execute(
            "INSERT INTO garden_beds (name, width_cells, height_cells, cell_size_inches, bed_type, description, location, notes, planter_type_id, depth_inches, physical_width_inches, physical_length_inches, soil_type, soil_mix, soil_product_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (bed.name, w, h, bed.cell_size_inches, bed.bed_type, bed.description, bed.location, bed.notes, planter_type_id, bed.depth_inches, bed.physical_width_inches, bed.physical_length_inches, bed.soil_type, bed.soil_mix, bed.soil_product_id),
        )
        db.commit()
        return {"id": cursor.lastrowid, **bed.dict(), "width_cells": w, "height_cells": h}


@router.get("/api/beds/positions")
def list_bed_positions():
    with get_db() as db:
        rows = db.execute("""
            SELECT bp.*, gb.name as bed_name, gb.width_cells, gb.height_cells, gb.cell_size_inches,
                   gb.bed_type, gb.physical_width_inches, gb.physical_length_inches, gb.depth_inches
            FROM bed_positions bp
            JOIN garden_beds gb ON bp.bed_id = gb.id
            ORDER BY bp.bed_id
        """).fetchall()
        return [dict(r) for r in rows]



@router.patch("/api/beds/{bed_id}")
def update_bed(bed_id: int, data: BedUpdate):
    with get_db() as db:
        existing = db.execute("SELECT * FROM garden_beds WHERE id = ?", (bed_id,)).fetchone()
        if not existing:
            raise HTTPException(404, "Bed not found")
        if data.irrigation_type and data.irrigation_type not in ("rachio_controller", "rachio_hose_timer", "manual", "drip", "sprinkler", "bubbler", "none"):
            raise HTTPException(400, "Invalid irrigation_type")
        if data.bed_type and data.bed_type not in ("grid", "linear", "single", "freeform", "vertical"):
            raise HTTPException(400, "Invalid bed_type")

        # Determine effective bed_type and dimensions
        effective_type = data.bed_type or existing["bed_type"] or "grid"
        new_width = data.width_cells
        new_height = data.height_cells

        # If changing TO single, force 1x1
        if data.bed_type == "single":
            new_width = 1
            new_height = 1

        # If changing TO vertical with planter_type_id, auto-set dims from planter
        if effective_type == "vertical" and data.planter_type_id:
            pt = db.execute("SELECT * FROM planter_types WHERE id = ?", (data.planter_type_id,)).fetchone()
            if pt:
                new_width = pt["pockets_per_tier"] or new_width or existing["width_cells"]
                new_height = pt["tiers"] or new_height or existing["height_cells"]

        # Check if resizing would remove plantings
        removed_plantings = []
        final_width = new_width if new_width is not None else existing["width_cells"]
        final_height = new_height if new_height is not None else existing["height_cells"]
        if final_width < existing["width_cells"] or final_height < existing["height_cells"]:
            out_of_bounds = db.execute(
                "SELECT id FROM plantings WHERE bed_id = ? AND (cell_x >= ? OR cell_y >= ?)",
                (bed_id, final_width, final_height)
            ).fetchall()
            removed_plantings = [r["id"] for r in out_of_bounds]
            if removed_plantings:
                placeholders = ",".join("?" * len(removed_plantings))
                db.execute(f"DELETE FROM plantings WHERE id IN ({placeholders})", removed_plantings)

        updates = []
        params = []
        for field in ("name", "location", "notes", "irrigation_type", "irrigation_zone_name", "irrigation_schedule", "sort_order", "bed_type", "cell_size_inches", "description", "depth_inches", "physical_width_inches", "physical_length_inches"):
            val = getattr(data, field)
            if val is not None:
                updates.append(f"{field} = ?")
                params.append(val)
        # width/height use computed values (may be overridden for single/vertical)
        if new_width is not None:
            updates.append("width_cells = ?")
            params.append(new_width)
        if new_height is not None:
            updates.append("height_cells = ?")
            params.append(new_height)
        # planter_type_id can be set to None (unassign) so handle specially
        if data.planter_type_id is not None:
            updates.append("planter_type_id = ?")
            params.append(data.planter_type_id if data.planter_type_id != 0 else None)
        # area_id can be set to None (unassign) so handle specially
        if data.area_id is not None:
            updates.append("area_id = ?")
            params.append(data.area_id if data.area_id != 0 else None)
        # Soil fields
        if data.soil_type is not None:
            updates.append("soil_type = ?")
            params.append(data.soil_type if data.soil_type else None)
        if data.soil_mix is not None:
            updates.append("soil_mix = ?")
            params.append(data.soil_mix if data.soil_mix else None)
        if data.soil_product_id is not None:
            updates.append("soil_product_id = ?")
            params.append(data.soil_product_id if data.soil_product_id != 0 else None)
        if updates:
            params.append(bed_id)
            db.execute(f"UPDATE garden_beds SET {', '.join(updates)} WHERE id = ?", params)
            db.commit()
        return {"ok": True, "removed_plantings": len(removed_plantings)}




@router.post("/api/beds/reorder")
def reorder_beds(data: ReorderRequest):
    with get_db() as db:
        for item in data.orders:
            if item.area_id is not None:
                db.execute("UPDATE garden_beds SET sort_order = ?, area_id = ? WHERE id = ?",
                           (item.sort_order, item.area_id if item.area_id != 0 else None, item.id))
            else:
                db.execute("UPDATE garden_beds SET sort_order = ? WHERE id = ?",
                           (item.sort_order, item.id))
        db.commit()
    return {"ok": True}


@router.delete("/api/beds/{bed_id}")
def delete_bed(bed_id: int):
    with get_db() as db:
        existing = db.execute("SELECT * FROM garden_beds WHERE id = ?", (bed_id,)).fetchone()
        if not existing:
            raise HTTPException(404, "Bed not found")
        # Snapshot for undo
        plantings = [dict(r) for r in db.execute("SELECT * FROM plantings WHERE bed_id = ?", (bed_id,)).fetchall()]
        sections = [dict(r) for r in db.execute("SELECT * FROM bed_sections WHERE bed_id = ?", (bed_id,)).fetchall()]
        undo_id = create_undo_action(db, "delete_bed", {
            "bed": dict(existing), "plantings": plantings, "sections": sections,
        })
        db.execute("DELETE FROM plantings WHERE bed_id = ?", (bed_id,))
        db.execute("DELETE FROM bed_sections WHERE bed_id = ?", (bed_id,))
        db.execute("DELETE FROM garden_beds WHERE id = ?", (bed_id,))
        db.commit()
        return {"ok": True, "undo_id": undo_id}


@router.get("/api/beds/{bed_id}")
def get_bed(bed_id: int):
    with get_db() as db:
        bed = db.execute("SELECT * FROM garden_beds WHERE id = ?", (bed_id,)).fetchone()
        if not bed:
            raise HTTPException(404, "Bed not found")
        plantings = db.execute("""
            SELECT p.*, pl.name as plant_name, pl.category as plant_category,
                   v.name as variety_name, v.desert_rating as variety_desert_rating
            FROM plantings p
            JOIN plants pl ON p.plant_id = pl.id
            LEFT JOIN varieties v ON p.variety_id = v.id
            WHERE p.bed_id = ? AND p.status != 'removed'
            ORDER BY p.cell_y, p.cell_x
        """, (bed_id,)).fetchall()
        return {**dict(bed), "plantings": [dict(p) for p in plantings]}


@router.get("/api/beds/{bed_id}/grid")
def get_bed_grid(bed_id: int):
    """Get the bed as a 2D grid with plant placements."""
    with get_db() as db:
        bed = db.execute("SELECT * FROM garden_beds WHERE id = ?", (bed_id,)).fetchone()
        if not bed:
            raise HTTPException(404, "Bed not found")
        bed = dict(bed)

        plantings = db.execute("""
            SELECT p.*, pl.name as plant_name, pl.category as plant_category,
                   pl.spacing_inches, pl.sun, pl.water,
                   v.name as variety_name, v.desert_rating as variety_desert_rating
            FROM plantings p
            JOIN plants pl ON p.plant_id = pl.id
            LEFT JOIN varieties v ON p.variety_id = v.id
            WHERE p.bed_id = ? AND p.status NOT IN ('removed', 'failed')
        """, (bed_id,)).fetchall()

        # Get photo counts per planting
        photo_counts_rows = db.execute("""
            SELECT planting_id, COUNT(*) as cnt FROM planting_photos
            WHERE planting_id IN (SELECT id FROM plantings WHERE bed_id = ?)
            GROUP BY planting_id
        """, (bed_id,)).fetchall()
        photo_counts = {r["planting_id"]: r["cnt"] for r in photo_counts_rows}

        grid = [[None for _ in range(bed["width_cells"])] for _ in range(bed["height_cells"])]
        companions_grid = [[[] for _ in range(bed["width_cells"])] for _ in range(bed["height_cells"])]
        for p in plantings:
            p = dict(p)
            x, y = p.get("cell_x"), p.get("cell_y")
            if x is not None and y is not None and 0 <= y < bed["height_cells"] and 0 <= x < bed["width_cells"]:
                entry = {
                    "planting_id": p["id"],
                    "plant_id": p["plant_id"],
                    "plant_name": p["plant_name"],
                    "category": p["plant_category"],
                    "status": p["status"],
                    "planted_date": p["planted_date"],
                    "photo_count": photo_counts.get(p["id"], 0),
                    "variety_id": p.get("variety_id"),
                    "variety_name": p.get("variety_name"),
                    "variety_desert_rating": p.get("variety_desert_rating"),
                    "cell_role": p.get("cell_role", "primary"),
                    "companion_of": p.get("companion_of"),
                }
                role = p.get("cell_role", "primary")
                if role == "companion":
                    companions_grid[y][x].append(entry)
                else:
                    # Primary planting — keep backward compat (grid[y][x] = single planting or null)
                    grid[y][x] = entry

        # Attach companions list to each cell for the frontend
        for y in range(bed["height_cells"]):
            for x in range(bed["width_cells"]):
                if grid[y][x] is not None:
                    grid[y][x]["companions"] = companions_grid[y][x]

        return {"bed": bed, "grid": grid}


@router.get("/api/beds/{bed_id}/cell/{x}/{y}/companion-suggestions")
def get_companion_suggestions(bed_id: int, x: int, y: int, request: Request):
    """Suggest good companions for the primary plant in this cell."""
    require_user(request)
    with get_db() as db:
        # Find the primary planting in this cell
        primary = db.execute(
            "SELECT p.*, pl.name as plant_name FROM plantings p JOIN plants pl ON p.plant_id = pl.id "
            "WHERE p.bed_id = ? AND p.cell_x = ? AND p.cell_y = ? AND p.cell_role = 'primary' "
            "AND p.status NOT IN ('removed', 'failed')",
            (bed_id, x, y)
        ).fetchone()
        if not primary:
            return {"suggestions": [], "avoid": []}

        primary = dict(primary)

        # Get companion names from the companions table (uses companion_name text, not IDs)
        companion_rows = db.execute(
            "SELECT companion_name FROM companions WHERE plant_id = ? AND relationship = 'companion'",
            (primary["plant_id"],)
        ).fetchall()

        # Look up plant IDs for these companion names
        suggestions = []
        for row in companion_rows:
            name = row["companion_name"]
            plant_row = db.execute(
                "SELECT id, name, category FROM plants WHERE name = ?", (name,)
            ).fetchone()
            if plant_row:
                suggestions.append({
                    "plant_id": plant_row["id"],
                    "plant_name": plant_row["name"],
                    "category": plant_row["category"],
                    "relationship": "companion",
                    "benefit": f"Good companion for {primary['plant_name']}",
                })

        # Get antagonist names
        antagonist_rows = db.execute(
            "SELECT companion_name FROM companions WHERE plant_id = ? AND relationship = 'antagonist'",
            (primary["plant_id"],)
        ).fetchall()
        avoid = []
        for row in antagonist_rows:
            name = row["companion_name"]
            plant_row = db.execute(
                "SELECT id, name, category FROM plants WHERE name = ?", (name,)
            ).fetchone()
            avoid.append({
                "plant_id": plant_row["id"] if plant_row else None,
                "plant_name": name,
                "category": plant_row["category"] if plant_row else None,
                "relationship": "antagonist",
            })

        return {
            "primary": {"name": primary["plant_name"], "plant_id": primary["plant_id"], "planting_id": primary["id"]},
            "suggestions": suggestions,
            "avoid": avoid,
        }


@router.post("/api/plantings")
def create_planting(planting: PlantingCreate):
    with get_db() as db:
        plant = db.execute("SELECT * FROM plants WHERE id = ?", (planting.plant_id,)).fetchone()
        if not plant:
            raise HTTPException(404, "Plant not found")
        plant = row_to_dict(plant)

        cell_role = planting.cell_role or "primary"
        companion_of = planting.companion_of

        # Validate companion_of if provided
        if companion_of:
            primary = db.execute("SELECT * FROM plantings WHERE id = ?", (companion_of,)).fetchone()
            if not primary:
                raise HTTPException(404, "Primary planting not found")
            primary = dict(primary)
            if primary["bed_id"] != planting.bed_id or primary["cell_x"] != planting.cell_x or primary["cell_y"] != planting.cell_y:
                raise HTTPException(400, "Companion must be in the same cell as the primary planting")
            cell_role = "companion"

        # If variety specified, use its DTM for expected harvest if available
        dtm_min = plant["days_to_maturity_min"]
        dtm_max = plant["days_to_maturity_max"]
        if planting.variety_id:
            variety = db.execute("SELECT * FROM varieties WHERE id = ?", (planting.variety_id,)).fetchone()
            if variety:
                variety = dict(variety)
                if variety.get("days_to_maturity_min"):
                    dtm_min = variety["days_to_maturity_min"]
                if variety.get("days_to_maturity_max"):
                    dtm_max = variety["days_to_maturity_max"]

        # Calculate expected harvest date
        expected_harvest = None
        if planting.planted_date and dtm_min:
            planted = date.fromisoformat(planting.planted_date)
            avg_days = (dtm_min + (dtm_max or dtm_min)) // 2
            expected_harvest = (planted + timedelta(days=avg_days)).isoformat()

        cursor = db.execute("""
            INSERT INTO plantings (bed_id, plant_id, variety_id, cell_x, cell_y, planted_date,
                                   expected_harvest_date, status, season, year, notes,
                                   cell_role, companion_of)
            VALUES (?, ?, ?, ?, ?, ?, ?, 'planned', ?, ?, ?, ?, ?)
        """, (
            planting.bed_id, planting.plant_id, planting.variety_id,
            planting.cell_x, planting.cell_y,
            planting.planted_date, expected_harvest,
            planting.season, planting.year or CURRENT_YEAR, planting.notes,
            cell_role, companion_of,
        ))
        db.commit()
        return {"id": cursor.lastrowid, "expected_harvest_date": expected_harvest, "cell_role": cell_role}


@router.patch("/api/plantings/{planting_id}")
def update_planting(planting_id: int, update: PlantingUpdate):
    with get_db() as db:
        existing = db.execute("SELECT * FROM plantings WHERE id = ?", (planting_id,)).fetchone()
        if not existing:
            raise HTTPException(404, "Planting not found")

        updates = []
        params = []
        if update.status:
            updates.append("status = ?")
            params.append(update.status)
        if update.actual_harvest_date:
            updates.append("actual_harvest_date = ?")
            params.append(update.actual_harvest_date)
        if update.notes is not None:
            updates.append("notes = ?")
            params.append(update.notes)

        if updates:
            params.append(planting_id)
            db.execute(f"UPDATE plantings SET {', '.join(updates)} WHERE id = ?", params)
            db.commit()

        return {"ok": True}


@router.delete("/api/plantings/{planting_id}")
def delete_planting(planting_id: int):
    with get_db() as db:
        existing = db.execute("SELECT * FROM plantings WHERE id = ?", (planting_id,)).fetchone()
        if not existing:
            raise HTTPException(404, "Planting not found")
        # Snapshot for undo
        notes = [dict(r) for r in db.execute("SELECT * FROM planting_notes WHERE planting_id = ?", (planting_id,)).fetchall()]
        photos = [dict(r) for r in db.execute("SELECT * FROM planting_photos WHERE planting_id = ?", (planting_id,)).fetchall()]
        harvests = [dict(r) for r in db.execute("SELECT * FROM harvests WHERE planting_id = ?", (planting_id,)).fetchall()]
        undo_id = create_undo_action(db, "delete_planting", {
            "planting": dict(existing), "notes": notes, "photos": photos, "harvests": harvests,
        })
        db.execute("DELETE FROM planting_notes WHERE planting_id = ?", (planting_id,))
        db.execute("DELETE FROM planting_photos WHERE planting_id = ?", (planting_id,))
        db.execute("DELETE FROM harvests WHERE planting_id = ?", (planting_id,))
        db.execute("DELETE FROM plantings WHERE id = ?", (planting_id,))
        db.commit()
        return {"ok": True, "undo_id": undo_id}



@router.post("/api/plantings/{planting_id}/move")
def move_planting(planting_id: int, data: PlantingMove):
    """Move a planting to a different bed/cell, preserving all history."""
    with get_db() as db:
        existing = db.execute("SELECT * FROM plantings WHERE id = ?", (planting_id,)).fetchone()
        if not existing:
            raise HTTPException(404, "Planting not found")
        target_bed = db.execute("SELECT * FROM garden_beds WHERE id = ?", (data.target_bed_id,)).fetchone()
        if not target_bed:
            raise HTTPException(404, "Target bed not found")
        old_bed = db.execute("SELECT name FROM garden_beds WHERE id = ?", (existing["bed_id"],)).fetchone()
        old_bed_name = old_bed["name"] if old_bed else f"bed #{existing['bed_id']}"
        new_bed_name = target_bed["name"]
        note = f"Moved from {old_bed_name} ({existing['cell_x']},{existing['cell_y']}) to {new_bed_name} ({data.target_cell_x},{data.target_cell_y})"
        db.execute(
            "UPDATE plantings SET bed_id = ?, cell_x = ?, cell_y = ? WHERE id = ?",
            (data.target_bed_id, data.target_cell_x, data.target_cell_y, planting_id),
        )
        db.execute(
            "INSERT INTO planting_notes (planting_id, note_type, content) VALUES (?, 'move', ?)",
            (planting_id, note),
        )
        db.commit()
        return {"ok": True, "note": note}



@router.post("/api/plantings/{planting_id}/move-to-ground")
def move_planting_to_ground(planting_id: int, data: PlantingMoveToGround):
    """Convert a planting to a ground plant, preserving plant reference and planted date."""
    with get_db() as db:
        existing = db.execute("SELECT * FROM plantings WHERE id = ?", (planting_id,)).fetchone()
        if not existing:
            raise HTTPException(404, "Planting not found")
        plant = db.execute("SELECT name FROM plants WHERE id = ?", (existing["plant_id"],)).fetchone()
        plant_name = plant["name"] if plant else "Unknown"
        old_bed = db.execute("SELECT name FROM garden_beds WHERE id = ?", (existing["bed_id"],)).fetchone()
        old_bed_name = old_bed["name"] if old_bed else f"bed #{existing['bed_id']}"
        gp_name = data.name or plant_name
        max_order = db.execute("SELECT COALESCE(MAX(sort_order), -1) FROM ground_plants").fetchone()[0]
        cursor = db.execute(
            """INSERT INTO ground_plants (name, plant_id, x_feet, y_feet, planted_date, status,
               irrigation_type, notes, area_id, sort_order)
               VALUES (?, ?, ?, ?, ?, 'growing', 'manual', ?, ?, ?)""",
            (gp_name, existing["plant_id"], data.x_feet, data.y_feet,
             existing["planted_date"], f"Moved from planter: {old_bed_name}",
             data.area_id, max_order + 1),
        )
        ground_plant_id = cursor.lastrowid
        db.execute(
            "UPDATE plantings SET status = 'removed', notes = COALESCE(notes || ' | ', '') || ? WHERE id = ?",
            (f"Moved to ground (ground plant #{ground_plant_id})", planting_id),
        )
        db.execute(
            "INSERT INTO planting_notes (planting_id, note_type, content) VALUES (?, 'move', ?)",
            (planting_id, f"Moved to ground as '{gp_name}'"),
        )
        db.commit()
        return {"ok": True, "ground_plant_id": ground_plant_id}



@router.post("/api/ground-plants/{gp_id}/move-to-planter")
def move_ground_plant_to_planter(gp_id: int, data: GroundPlantMoveToPlanter):
    """Convert a ground plant to a planting in a bed."""
    with get_db() as db:
        gp = db.execute("SELECT * FROM ground_plants WHERE id = ?", (gp_id,)).fetchone()
        if not gp:
            raise HTTPException(404, "Ground plant not found")
        target_bed = db.execute("SELECT * FROM garden_beds WHERE id = ?", (data.bed_id,)).fetchone()
        if not target_bed:
            raise HTTPException(404, "Target bed not found")
        plant = db.execute("SELECT * FROM plants WHERE id = ?", (gp["plant_id"],)).fetchone()
        expected_harvest = None
        planted_date = gp["planted_date"] or date.today().isoformat()
        if plant and plant["days_to_maturity_min"]:
            avg_days = (plant["days_to_maturity_min"] + plant["days_to_maturity_max"]) // 2
            expected_harvest = (date.fromisoformat(planted_date) + timedelta(days=avg_days)).isoformat()
        cursor = db.execute("""
            INSERT INTO plantings (bed_id, plant_id, cell_x, cell_y, planted_date,
                                   expected_harvest_date, status, year, notes)
            VALUES (?, ?, ?, ?, ?, ?, 'growing', ?, ?)
        """, (
            data.bed_id, gp["plant_id"], data.cell_x, data.cell_y,
            planted_date, expected_harvest, CURRENT_YEAR,
            f"Moved from ground (ground plant #{gp_id})",
        ))
        planting_id = cursor.lastrowid
        db.execute(
            "UPDATE ground_plants SET status = 'removed', notes = COALESCE(notes || ' | ', '') || ? WHERE id = ?",
            (f"Moved to planter: {target_bed['name']} ({data.cell_x},{data.cell_y})", gp_id),
        )
        db.commit()
        return {"ok": True, "planting_id": planting_id}


@router.post("/api/trays/{tray_id}/cells/{cell_id}/move-to-planter")
def move_tray_cell_to_planter(tray_id: int, cell_id: int, data: TrayCellMoveToPlanter):
    """Move a tray seedling to a planter, preserving seed date as planted date."""
    with get_db() as db:
        cell = db.execute(
            "SELECT * FROM seed_tray_cells WHERE id = ? AND tray_id = ?",
            (cell_id, tray_id),
        ).fetchone()
        if not cell:
            raise HTTPException(404, "Cell not found")
        if not cell["plant_id"]:
            raise HTTPException(400, "Cell has no plant")
        target_bed = db.execute("SELECT * FROM garden_beds WHERE id = ?", (data.bed_id,)).fetchone()
        if not target_bed:
            raise HTTPException(404, "Target bed not found")
        plant = db.execute("SELECT * FROM plants WHERE id = ?", (cell["plant_id"],)).fetchone()
        expected_harvest = None
        planted_date = cell["seed_date"] or date.today().isoformat()
        if plant and plant["days_to_maturity_min"]:
            avg_days = (plant["days_to_maturity_min"] + plant["days_to_maturity_max"]) // 2
            expected_harvest = (date.fromisoformat(planted_date) + timedelta(days=avg_days)).isoformat()
        cursor = db.execute("""
            INSERT INTO plantings (bed_id, plant_id, cell_x, cell_y, planted_date,
                                   expected_harvest_date, status, year, notes)
            VALUES (?, ?, ?, ?, ?, ?, 'seeded', ?, ?)
        """, (
            data.bed_id, cell["plant_id"], data.cell_x, data.cell_y,
            planted_date, expected_harvest, CURRENT_YEAR,
            f"Moved from tray cell #{cell_id}",
        ))
        planting_id = cursor.lastrowid
        db.execute("UPDATE seed_tray_cells SET status = 'transplanted' WHERE id = ?", (cell_id,))
        db.commit()
        return {"ok": True, "planting_id": planting_id}



@router.get("/api/plantings")
def list_plantings(bed_id: Optional[int] = None, status: Optional[str] = None, year: Optional[int] = None):
    with get_db() as db:
        query = """
            SELECT p.*, pl.name as plant_name, pl.category as plant_category,
                   (SELECT COUNT(*) FROM planting_photos pp WHERE pp.planting_id = p.id) as photo_count
            FROM plantings p JOIN plants pl ON p.plant_id = pl.id
        """
        conditions = []
        params = []
        if bed_id:
            conditions.append("p.bed_id = ?")
            params.append(bed_id)
        if status:
            conditions.append("p.status = ?")
            params.append(status)
        if year:
            conditions.append("p.year = ?")
            params.append(year)
        if conditions:
            query += " WHERE " + " AND ".join(conditions)
        query += " ORDER BY p.planted_date DESC"
        return [dict(r) for r in db.execute(query, params).fetchall()]


@router.put("/api/beds/{bed_id}/position")
def set_bed_position(bed_id: int, data: BedPositionUpdate):
    with get_db() as db:
        bed = db.execute("SELECT id FROM garden_beds WHERE id = ?", (bed_id,)).fetchone()
        if not bed:
            raise HTTPException(404, "Bed not found")
        existing = db.execute("SELECT id FROM bed_positions WHERE bed_id = ?", (bed_id,)).fetchone()
        if existing:
            db.execute(
                "UPDATE bed_positions SET zone_id = ?, x_feet = ?, y_feet = ?, rotation_degrees = ? WHERE bed_id = ?",
                (data.zone_id, data.x_feet, data.y_feet, data.rotation_degrees, bed_id),
            )
        else:
            db.execute(
                "INSERT INTO bed_positions (bed_id, zone_id, x_feet, y_feet, rotation_degrees) VALUES (?, ?, ?, ?, ?)",
                (bed_id, data.zone_id, data.x_feet, data.y_feet, data.rotation_degrees),
            )
        db.commit()
        row = db.execute("""
            SELECT bp.*, gb.name as bed_name, gb.width_cells, gb.height_cells, gb.cell_size_inches
            FROM bed_positions bp
            JOIN garden_beds gb ON bp.bed_id = gb.id
            WHERE bp.bed_id = ?
        """, (bed_id,)).fetchone()
        return dict(row)



@router.get("/api/beds/{bed_id}/sections")
def list_bed_sections(bed_id: int):
    with get_db() as db:
        bed = db.execute("SELECT id FROM garden_beds WHERE id = ?", (bed_id,)).fetchone()
        if not bed:
            raise HTTPException(404, "Bed not found")
        rows = db.execute("SELECT * FROM bed_sections WHERE bed_id = ? ORDER BY start_cell", (bed_id,)).fetchall()
        return [dict(r) for r in rows]


@router.post("/api/beds/{bed_id}/sections")
def create_bed_section(bed_id: int, data: BedSectionCreate):
    with get_db() as db:
        bed = db.execute("SELECT id FROM garden_beds WHERE id = ?", (bed_id,)).fetchone()
        if not bed:
            raise HTTPException(404, "Bed not found")
        cursor = db.execute(
            "INSERT INTO bed_sections (bed_id, name, start_cell, end_cell, irrigation_zone_name, notes) VALUES (?, ?, ?, ?, ?, ?)",
            (bed_id, data.name, data.start_cell, data.end_cell, data.irrigation_zone_name, data.notes),
        )
        db.commit()
        return {"id": cursor.lastrowid, "bed_id": bed_id, **data.dict()}


@router.patch("/api/beds/{bed_id}/sections/{section_id}")
def update_bed_section(bed_id: int, section_id: int, data: BedSectionUpdate):
    with get_db() as db:
        existing = db.execute("SELECT * FROM bed_sections WHERE id = ? AND bed_id = ?", (section_id, bed_id)).fetchone()
        if not existing:
            raise HTTPException(404, "Section not found")
        updates = []
        params = []
        for field in ("name", "start_cell", "end_cell", "irrigation_zone_name", "notes"):
            val = getattr(data, field)
            if val is not None:
                updates.append(f"{field} = ?")
                params.append(val)
        if updates:
            params.append(section_id)
            db.execute(f"UPDATE bed_sections SET {', '.join(updates)} WHERE id = ?", params)
            db.commit()
        return {"ok": True}


@router.delete("/api/beds/{bed_id}/sections/{section_id}")
def delete_bed_section(bed_id: int, section_id: int):
    with get_db() as db:
        existing = db.execute("SELECT * FROM bed_sections WHERE id = ? AND bed_id = ?", (section_id, bed_id)).fetchone()
        if not existing:
            raise HTTPException(404, "Section not found")
        db.execute("DELETE FROM bed_sections WHERE id = ?", (section_id,))
        db.commit()
        return {"ok": True}

