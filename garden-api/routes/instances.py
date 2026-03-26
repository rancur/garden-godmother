"""Plant Instance endpoints — unified plant identity across all locations."""
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, HTTPException, Query, Request

from db import get_db
from auth import require_user

router = APIRouter()


# ──────────────── LIST PLANT INSTANCES ────────────────

@router.get("/api/plant-instances")
def list_plant_instances(
    request: Request,
    status: Optional[str] = Query(None),
    plant_id: Optional[int] = Query(None),
    location_type: Optional[str] = Query(None),
):
    """List all plant instances with optional filters."""
    require_user(request)
    with get_db() as db:
        query = """
            SELECT pi.*, p.name as plant_name, p.category as plant_category,
                   v.name as variety_name,
                   pil.location_type, pil.bed_id, pil.cell_x, pil.cell_y,
                   pil.ground_plant_id, pil.tray_id, pil.tray_row, pil.tray_col,
                   gb.name as bed_name,
                   gp_name.name as ground_plant_label,
                   st.name as tray_name
            FROM plant_instances pi
            JOIN plants p ON pi.plant_id = p.id
            LEFT JOIN varieties v ON pi.variety_id = v.id
            LEFT JOIN plant_instance_locations pil ON pil.instance_id = pi.id AND pil.is_current = 1
            LEFT JOIN garden_beds gb ON pil.bed_id = gb.id
            LEFT JOIN ground_plants gp_name ON pil.ground_plant_id = gp_name.id
            LEFT JOIN seed_trays st ON pil.tray_id = st.id
            WHERE 1=1
        """
        params = []

        if status:
            query += " AND pi.status = ?"
            params.append(status)
        if plant_id:
            query += " AND pi.plant_id = ?"
            params.append(plant_id)
        if location_type:
            query += " AND pil.location_type = ?"
            params.append(location_type)

        query += " ORDER BY pi.created_at DESC"
        rows = db.execute(query, params).fetchall()

        results = []
        for r in rows:
            d = dict(r)
            # Build a display name
            d["display_name"] = d.get("label") or d.get("plant_name") or "Unknown"
            # Build link to this instance
            d["link"] = f"/plant/{d['id']}"
            # Build container info
            loc = d.get("location_type")
            if loc == "planter" and d.get("bed_id"):
                d["container_name"] = d.get("bed_name")
                d["container_link"] = f"/planters/{d['bed_id']}"
            elif loc == "ground" and d.get("ground_plant_id"):
                d["container_name"] = d.get("ground_plant_label")
                d["container_link"] = f"/ground-plants/{d['ground_plant_id']}"
            elif loc == "tray" and d.get("tray_id"):
                d["container_name"] = d.get("tray_name")
                d["container_link"] = f"/trays/{d['tray_id']}"
            else:
                d["container_name"] = None
                d["container_link"] = None
            results.append(d)

        return results


# ──────────────── GET SINGLE PLANT INSTANCE ────────────────

@router.get("/api/plant-instances/{instance_id}")
def get_plant_instance(request: Request, instance_id: int):
    """Get full detail for a plant instance: plant info, current location, timeline summary."""
    require_user(request)
    with get_db() as db:
        row = db.execute("""
            SELECT pi.*, p.name as plant_name, p.category as plant_category,
                   p.sun, p.water, p.days_to_maturity_min, p.days_to_maturity_max,
                   v.name as variety_name
            FROM plant_instances pi
            JOIN plants p ON pi.plant_id = p.id
            LEFT JOIN varieties v ON pi.variety_id = v.id
            WHERE pi.id = ?
        """, (instance_id,)).fetchone()

        if not row:
            raise HTTPException(status_code=404, detail="Plant instance not found")

        d = dict(row)

        # Current location
        loc = db.execute("""
            SELECT pil.*, gb.name as bed_name, st.name as tray_name,
                   gp.name as ground_plant_label
            FROM plant_instance_locations pil
            LEFT JOIN garden_beds gb ON pil.bed_id = gb.id
            LEFT JOIN seed_trays st ON pil.tray_id = st.id
            LEFT JOIN ground_plants gp ON pil.ground_plant_id = gp.id
            WHERE pil.instance_id = ? AND pil.is_current = 1
        """, (instance_id,)).fetchone()

        d["current_location"] = dict(loc) if loc else None

        # Location history
        locations = db.execute("""
            SELECT pil.*, gb.name as bed_name, st.name as tray_name,
                   gp.name as ground_plant_label
            FROM plant_instance_locations pil
            LEFT JOIN garden_beds gb ON pil.bed_id = gb.id
            LEFT JOIN seed_trays st ON pil.tray_id = st.id
            LEFT JOIN ground_plants gp ON pil.ground_plant_id = gp.id
            WHERE pil.instance_id = ?
            ORDER BY pil.placed_at DESC
        """, (instance_id,)).fetchall()
        d["location_history"] = [dict(l) for l in locations]

        # Get linked planting / ground_plant IDs for journal/harvest lookups
        planting_row = db.execute(
            "SELECT id FROM plantings WHERE instance_id = ?", (instance_id,)
        ).fetchone()
        ground_plant_row = db.execute(
            "SELECT id FROM ground_plants WHERE instance_id = ?", (instance_id,)
        ).fetchone()

        d["planting_id"] = planting_row["id"] if planting_row else None
        d["ground_plant_id"] = ground_plant_row["id"] if ground_plant_row else None

        # Journal entries (via linked planting or ground_plant)
        journal_entries = []
        if d["planting_id"]:
            journal_entries += db.execute("""
                SELECT je.*, 'journal' as timeline_type
                FROM journal_entries je
                WHERE je.planting_id = ?
                ORDER BY je.created_at DESC
            """, (d["planting_id"],)).fetchall()
        if d["ground_plant_id"]:
            journal_entries += db.execute("""
                SELECT je.*, 'journal' as timeline_type
                FROM journal_entries je
                WHERE je.ground_plant_id = ?
                ORDER BY je.created_at DESC
            """, (d["ground_plant_id"],)).fetchall()
        d["journal_entries"] = [dict(j) for j in journal_entries]

        # Harvests (harvests table only has planting_id)
        harvests = []
        if d["planting_id"]:
            harvests += db.execute("""
                SELECT h.*, 'harvest' as timeline_type
                FROM harvests h
                WHERE h.planting_id = ?
                ORDER BY h.harvest_date DESC
            """, (d["planting_id"],)).fetchall()
        d["harvests"] = [dict(h) for h in harvests]

        # Photos (planting_photos table, linked via planting_id)
        photos = []
        if d["planting_id"]:
            photos += db.execute("""
                SELECT * FROM planting_photos WHERE planting_id = ? ORDER BY created_at DESC
            """, (d["planting_id"],)).fetchall()
        d["photos"] = [dict(ph) for ph in photos]

        return d


# ──────────────── UPDATE PLANT INSTANCE ────────────────

@router.patch("/api/plant-instances/{instance_id}")
async def update_plant_instance(request: Request, instance_id: int):
    """Update status, label, or notes for a plant instance."""
    user = require_user(request)
    body = await request.json()
    with get_db() as db:
        row = db.execute("SELECT * FROM plant_instances WHERE id = ?", (instance_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Plant instance not found")

        updates = []
        params = []
        for field in ("status", "label", "notes", "planted_date"):
            if field in body:
                updates.append(f"{field} = ?")
                params.append(body[field])

        if not updates:
            raise HTTPException(status_code=400, detail="No valid fields to update")

        params.append(instance_id)
        db.execute(f"UPDATE plant_instances SET {', '.join(updates)} WHERE id = ?", params)
        db.commit()

        return {"ok": True, "id": instance_id}


# ──────────────── TRANSPLANT (MOVE LOCATION) ────────────────

@router.post("/api/plant-instances/{instance_id}/transplant")
async def transplant_instance(request: Request, instance_id: int):
    """Move a plant instance to a new location. Marks old location as not current."""
    user = require_user(request)
    body = await request.json()
    location_type = body.get("location_type")

    if location_type not in ("planter", "ground", "tray"):
        raise HTTPException(status_code=400, detail="location_type must be 'planter', 'ground', or 'tray'")

    with get_db() as db:
        row = db.execute("SELECT * FROM plant_instances WHERE id = ?", (instance_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Plant instance not found")

        # Mark all current locations as not current
        db.execute(
            "UPDATE plant_instance_locations SET is_current = 0, removed_at = CURRENT_TIMESTAMP WHERE instance_id = ? AND is_current = 1",
            (instance_id,)
        )

        # Insert new location
        if location_type == "planter":
            db.execute(
                "INSERT INTO plant_instance_locations (instance_id, location_type, bed_id, cell_x, cell_y) VALUES (?, 'planter', ?, ?, ?)",
                (instance_id, body.get("bed_id"), body.get("cell_x"), body.get("cell_y"))
            )
        elif location_type == "ground":
            db.execute(
                "INSERT INTO plant_instance_locations (instance_id, location_type, ground_plant_id) VALUES (?, 'ground', ?)",
                (instance_id, body.get("ground_plant_id"))
            )
        elif location_type == "tray":
            db.execute(
                "INSERT INTO plant_instance_locations (instance_id, location_type, tray_id, tray_row, tray_col) VALUES (?, 'tray', ?, ?, ?)",
                (instance_id, body.get("tray_id"), body.get("tray_row"), body.get("tray_col"))
            )

        db.commit()
        return {"ok": True, "id": instance_id}


# ──────────────── TIMELINE ────────────────

@router.get("/api/plant-instances/{instance_id}/timeline")
def get_instance_timeline(request: Request, instance_id: int):
    """Full chronological timeline for a plant instance: journal, harvests, location changes."""
    require_user(request)
    with get_db() as db:
        row = db.execute("SELECT * FROM plant_instances WHERE id = ?", (instance_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Plant instance not found")

        timeline = []

        # Get linked IDs
        planting_row = db.execute("SELECT id FROM plantings WHERE instance_id = ?", (instance_id,)).fetchone()
        ground_plant_row = db.execute("SELECT id FROM ground_plants WHERE instance_id = ?", (instance_id,)).fetchone()
        planting_id = planting_row["id"] if planting_row else None
        ground_plant_id = ground_plant_row["id"] if ground_plant_row else None

        # Journal entries
        if planting_id:
            for je in db.execute("""
                SELECT id, entry_type, title, content, severity, milestone_type, created_at
                FROM journal_entries WHERE planting_id = ?
            """, (planting_id,)).fetchall():
                d = dict(je)
                d["timeline_type"] = "journal"
                timeline.append(d)
        if ground_plant_id:
            for je in db.execute("""
                SELECT id, entry_type, title, content, severity, milestone_type, created_at
                FROM journal_entries WHERE ground_plant_id = ?
            """, (ground_plant_id,)).fetchall():
                d = dict(je)
                d["timeline_type"] = "journal"
                timeline.append(d)

        # Harvests (only planting_id in harvests table)
        if planting_id:
            for h in db.execute("""
                SELECT id, weight_oz, quantity, quality, notes, harvest_date as created_at
                FROM harvests WHERE planting_id = ?
            """, (planting_id,)).fetchall():
                d = dict(h)
                d["timeline_type"] = "harvest"
                timeline.append(d)

        # Location changes
        for loc in db.execute("""
            SELECT pil.id, pil.location_type, pil.bed_id, pil.ground_plant_id, pil.tray_id,
                   pil.placed_at as created_at, pil.removed_at, pil.is_current,
                   gb.name as bed_name, st.name as tray_name, gp.name as ground_plant_label
            FROM plant_instance_locations pil
            LEFT JOIN garden_beds gb ON pil.bed_id = gb.id
            LEFT JOIN seed_trays st ON pil.tray_id = st.id
            LEFT JOIN ground_plants gp ON pil.ground_plant_id = gp.id
            WHERE pil.instance_id = ?
        """, (instance_id,)).fetchall():
            d = dict(loc)
            d["timeline_type"] = "location_change"
            timeline.append(d)

        # Sort by date descending
        timeline.sort(key=lambda x: x.get("created_at") or "", reverse=True)

        return timeline
