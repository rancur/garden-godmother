"""Seed tray endpoints."""
from __future__ import annotations

import json
from datetime import date, datetime, timedelta
from typing import Optional

from fastapi import APIRouter, HTTPException, Query, Request
from fastapi.responses import Response

from db import get_db, row_to_dict
from auth import require_user, require_admin
from models import TrayCreate, TrayCellSeed, TrayCellUpdate, TrayCellTransplant, TrayUpdate, ReorderRequest, TrayDuplicate
from constants import CURRENT_YEAR, create_undo_action

router = APIRouter()

@router.get("/api/trays")
def list_trays():
    with get_db() as db:
        rows = db.execute("""
            SELECT st.*, a.name as area_name, a.color as area_color
            FROM seed_trays st
            LEFT JOIN areas a ON st.area_id = a.id
            ORDER BY COALESCE(a.sort_order, 999999), st.sort_order, st.created_at DESC
        """).fetchall()
        trays = []
        for r in rows:
            t = dict(r)
            stats = db.execute("""
                SELECT status, COUNT(*) as cnt FROM seed_tray_cells
                WHERE tray_id = ? GROUP BY status
            """, (t["id"],)).fetchall()
            t["cell_counts"] = {s["status"]: s["cnt"] for s in stats}
            trays.append(t)
        return trays


@router.post("/api/trays")
def create_tray(tray: TrayCreate):
    with get_db() as db:
        cursor = db.execute(
            "INSERT INTO seed_trays (name, rows, cols, cell_size, location, notes) VALUES (?, ?, ?, ?, ?, ?)",
            (tray.name, tray.rows, tray.cols, tray.cell_size, tray.location, tray.notes),
        )
        tray_id = cursor.lastrowid
        # Pre-create all cells as empty
        for r in range(tray.rows):
            for c in range(tray.cols):
                db.execute(
                    "INSERT INTO seed_tray_cells (tray_id, row, col, status) VALUES (?, ?, ?, 'empty')",
                    (tray_id, r, c),
                )
        db.commit()
        return {"id": tray_id, **tray.dict()}


@router.get("/api/trays/{tray_id}")
def get_tray(tray_id: int):
    with get_db() as db:
        tray = db.execute("SELECT * FROM seed_trays WHERE id = ?", (tray_id,)).fetchone()
        if not tray:
            raise HTTPException(404, "Tray not found")
        cells = db.execute("""
            SELECT c.*, p.name as plant_name, p.category as plant_category
            FROM seed_tray_cells c
            LEFT JOIN plants p ON c.plant_id = p.id
            WHERE c.tray_id = ?
            ORDER BY c.row, c.col
        """, (tray_id,)).fetchall()
        return {**dict(tray), "cells": [dict(c) for c in cells]}


@router.get("/api/trays/{tray_id}/grid")
def get_tray_grid(tray_id: int):
    """Get tray as a 2D grid with cell status."""
    with get_db() as db:
        tray = db.execute("SELECT * FROM seed_trays WHERE id = ?", (tray_id,)).fetchone()
        if not tray:
            raise HTTPException(404, "Tray not found")
        tray = dict(tray)

        cells = db.execute("""
            SELECT c.*, p.name as plant_name, p.category as plant_category
            FROM seed_tray_cells c
            LEFT JOIN plants p ON c.plant_id = p.id
            WHERE c.tray_id = ?
        """, (tray_id,)).fetchall()

        grid = [[None for _ in range(tray["cols"])] for _ in range(tray["rows"])]
        for cell in cells:
            cell = dict(cell)
            r, c = cell["row"], cell["col"]
            if 0 <= r < tray["rows"] and 0 <= c < tray["cols"]:
                grid[r][c] = {
                    "cell_id": cell["id"],
                    "plant_id": cell["plant_id"],
                    "plant_name": cell["plant_name"],
                    "plant_category": cell["plant_category"],
                    "status": cell["status"],
                    "seed_date": cell["seed_date"],
                    "germination_date": cell["germination_date"],
                    "notes": cell["notes"],
                }

        # Summary stats
        statuses = [grid[r][c]["status"] if grid[r][c] else "empty" for r in range(tray["rows"]) for c in range(tray["cols"])]
        summary = {s: statuses.count(s) for s in set(statuses)}

        return {"tray": tray, "grid": grid, "summary": summary}


@router.post("/api/trays/{tray_id}/cells")
def seed_tray_cell(tray_id: int, data: TrayCellSeed):
    with get_db() as db:
        tray = db.execute("SELECT * FROM seed_trays WHERE id = ?", (tray_id,)).fetchone()
        if not tray:
            raise HTTPException(404, "Tray not found")

        plant = db.execute("SELECT * FROM plants WHERE id = ?", (data.plant_id,)).fetchone()
        if not plant:
            raise HTTPException(404, "Plant not found")

        cell = db.execute(
            "SELECT * FROM seed_tray_cells WHERE tray_id = ? AND row = ? AND col = ?",
            (tray_id, data.row, data.col),
        ).fetchone()

        seed_date = data.seed_date or date.today().isoformat()

        if cell:
            db.execute(
                "UPDATE seed_tray_cells SET plant_id = ?, seed_date = ?, status = 'seeded' WHERE id = ?",
                (data.plant_id, seed_date, cell["id"]),
            )
            cell_id = cell["id"]
        else:
            cursor = db.execute(
                "INSERT INTO seed_tray_cells (tray_id, row, col, plant_id, seed_date, status) VALUES (?, ?, ?, ?, ?, 'seeded')",
                (tray_id, data.row, data.col, data.plant_id, seed_date),
            )
            cell_id = cursor.lastrowid
        db.commit()
        return {"cell_id": cell_id, "status": "seeded"}


@router.patch("/api/trays/{tray_id}/cells/{cell_id}")
def update_tray_cell(tray_id: int, cell_id: int, data: TrayCellUpdate):
    with get_db() as db:
        cell = db.execute(
            "SELECT * FROM seed_tray_cells WHERE id = ? AND tray_id = ?",
            (cell_id, tray_id),
        ).fetchone()
        if not cell:
            raise HTTPException(404, "Cell not found")

        updates = []
        params = []
        if data.status:
            updates.append("status = ?")
            params.append(data.status)
        if data.germination_date:
            updates.append("germination_date = ?")
            params.append(data.germination_date)
        if data.notes is not None:
            updates.append("notes = ?")
            params.append(data.notes)

        if updates:
            params.append(cell_id)
            db.execute(f"UPDATE seed_tray_cells SET {', '.join(updates)} WHERE id = ?", params)
            db.commit()

        return {"ok": True}


@router.post("/api/trays/{tray_id}/cells/{cell_id}/transplant")
def transplant_tray_cell(tray_id: int, cell_id: int, data: TrayCellTransplant):
    with get_db() as db:
        cell = db.execute(
            "SELECT * FROM seed_tray_cells WHERE id = ? AND tray_id = ?",
            (cell_id, tray_id),
        ).fetchone()
        if not cell:
            raise HTTPException(404, "Cell not found")

        # Mark cell as transplanted
        db.execute("UPDATE seed_tray_cells SET status = 'transplanted' WHERE id = ?", (cell_id,))

        planting_id = None
        # Optionally create a planting in a bed
        if data.bed_id is not None and cell["plant_id"]:
            plant = db.execute("SELECT * FROM plants WHERE id = ?", (cell["plant_id"],)).fetchone()
            expected_harvest = None
            if plant and plant["days_to_maturity_min"]:
                avg_days = (plant["days_to_maturity_min"] + plant["days_to_maturity_max"]) // 2
                expected_harvest = (date.today() + timedelta(days=avg_days)).isoformat()

            cursor = db.execute("""
                INSERT INTO plantings (bed_id, plant_id, cell_x, cell_y, planted_date,
                                       expected_harvest_date, status, year, notes)
                VALUES (?, ?, ?, ?, ?, ?, 'seeded', ?, ?)
            """, (
                data.bed_id, cell["plant_id"], data.cell_x, data.cell_y,
                date.today().isoformat(), expected_harvest, CURRENT_YEAR,
                f"Transplanted from tray cell #{cell_id}",
            ))
            planting_id = cursor.lastrowid

        db.commit()
        return {"ok": True, "planting_id": planting_id}




@router.patch("/api/trays/{tray_id}")
def update_tray(tray_id: int, data: TrayUpdate):
    with get_db() as db:
        existing = db.execute("SELECT * FROM seed_trays WHERE id = ?", (tray_id,)).fetchone()
        if not existing:
            raise HTTPException(404, "Tray not found")
        if data.irrigation_type and data.irrigation_type not in ("rachio_hose_timer", "manual", "none"):
            raise HTTPException(400, "Invalid irrigation_type for tray")
        updates = []
        params = []
        for field in ("name", "location", "notes", "irrigation_type", "irrigation_zone_name", "sort_order"):
            val = getattr(data, field)
            if val is not None:
                updates.append(f"{field} = ?")
                params.append(val)
        # area_id can be set to None (unassign) so handle specially
        if data.area_id is not None:
            updates.append("area_id = ?")
            params.append(data.area_id if data.area_id != 0 else None)
        if updates:
            params.append(tray_id)
            db.execute(f"UPDATE seed_trays SET {', '.join(updates)} WHERE id = ?", params)
            db.commit()
        return {"ok": True}


@router.post("/api/trays/reorder")
def reorder_trays(data: ReorderRequest):
    with get_db() as db:
        for item in data.orders:
            if item.area_id is not None:
                db.execute("UPDATE seed_trays SET sort_order = ?, area_id = ? WHERE id = ?",
                           (item.sort_order, item.area_id if item.area_id != 0 else None, item.id))
            else:
                db.execute("UPDATE seed_trays SET sort_order = ? WHERE id = ?",
                           (item.sort_order, item.id))
        db.commit()
    return {"ok": True}


@router.delete("/api/trays/{tray_id}")
def delete_tray(tray_id: int):
    with get_db() as db:
        existing = db.execute("SELECT * FROM seed_trays WHERE id = ?", (tray_id,)).fetchone()
        if not existing:
            raise HTTPException(404, "Tray not found")
        # Snapshot for undo
        cells = [dict(r) for r in db.execute("SELECT * FROM seed_tray_cells WHERE tray_id = ?", (tray_id,)).fetchall()]
        undo_id = create_undo_action(db, "delete_tray", {
            "tray": dict(existing), "cells": cells,
        })
        db.execute("DELETE FROM seed_tray_cells WHERE tray_id = ?", (tray_id,))
        db.execute("DELETE FROM seed_trays WHERE id = ?", (tray_id,))
        db.commit()
        return {"ok": True, "undo_id": undo_id}


@router.delete("/api/trays/{tray_id}/cells/{cell_id}")
def clear_tray_cell(tray_id: int, cell_id: int):
    """Reset a seeded cell back to empty."""
    with get_db() as db:
        cell = db.execute(
            "SELECT * FROM seed_tray_cells WHERE id = ? AND tray_id = ?",
            (cell_id, tray_id),
        ).fetchone()
        if not cell:
            raise HTTPException(404, "Cell not found")
        db.execute(
            "UPDATE seed_tray_cells SET plant_id = NULL, seed_date = NULL, germination_date = NULL, status = 'empty', notes = NULL WHERE id = ?",
            (cell_id,),
        )
        db.commit()
        return {"ok": True}




@router.post("/api/trays/{tray_id}/duplicate")
def duplicate_tray(tray_id: int, data: TrayDuplicate):
    """Duplicate a tray, optionally copying cell plantings."""
    with get_db() as db:
        original = db.execute("SELECT * FROM seed_trays WHERE id = ?", (tray_id,)).fetchone()
        if not original:
            raise HTTPException(404, "Tray not found")
        original = dict(original)

        new_name = data.name or f"{original['name']} (Copy)"
        cursor = db.execute(
            "INSERT INTO seed_trays (name, rows, cols, cell_size, location, notes) VALUES (?, ?, ?, ?, ?, ?)",
            (new_name, original["rows"], original["cols"], original["cell_size"], original["location"], original["notes"]),
        )
        new_tray_id = cursor.lastrowid

        if data.copy_cells:
            cells = db.execute(
                "SELECT row, col, plant_id, status FROM seed_tray_cells WHERE tray_id = ?",
                (tray_id,),
            ).fetchall()
            today = date.today().isoformat()
            for cell in cells:
                cell = dict(cell)
                if cell["plant_id"] and cell["status"] != "empty":
                    db.execute(
                        "INSERT INTO seed_tray_cells (tray_id, row, col, plant_id, seed_date, status) VALUES (?, ?, ?, ?, ?, 'seeded')",
                        (new_tray_id, cell["row"], cell["col"], cell["plant_id"], today),
                    )
                else:
                    db.execute(
                        "INSERT INTO seed_tray_cells (tray_id, row, col, status) VALUES (?, ?, ?, 'empty')",
                        (new_tray_id, cell["row"], cell["col"]),
                    )
        else:
            for r in range(original["rows"]):
                for c in range(original["cols"]):
                    db.execute(
                        "INSERT INTO seed_tray_cells (tray_id, row, col, status) VALUES (?, ?, ?, 'empty')",
                        (new_tray_id, r, c),
                    )

        db.commit()

        # Return the new tray with cell counts
        new_tray = dict(db.execute("SELECT * FROM seed_trays WHERE id = ?", (new_tray_id,)).fetchone())
        stats = db.execute(
            "SELECT status, COUNT(*) as cnt FROM seed_tray_cells WHERE tray_id = ? GROUP BY status",
            (new_tray_id,),
        ).fetchall()
        new_tray["cell_counts"] = {s["status"]: s["cnt"] for s in stats}
        return new_tray

