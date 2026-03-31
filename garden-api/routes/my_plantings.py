"""Unified view of all plantings across beds, ground, and trays."""
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Query, Request

from db import get_db
from auth import require_user

router = APIRouter()


@router.get("/api/my-plantings")
def get_all_plantings(request: Request, status: Optional[str] = Query(None), include_historical: bool = Query(False)):
    """Unified view of all plantings across beds, ground, and trays.

    By default excludes removed/died/harvested. Set include_historical=true to see everything.
    """
    require_user(request)
    with get_db() as db:
        results = []

        # Bed plantings
        bed_where = "" if include_historical else "WHERE p.status NOT IN ('removed', 'died', 'harvested')"
        bed_plantings = db.execute(f"""
            SELECT p.id, p.plant_id, p.status, p.planted_date, p.cell_x, p.cell_y,
                   p.instance_id,
                   pl.name as plant_name, pl.category,
                   gb.name as container_name, 'planter' as container_type, gb.id as container_id,
                   gb.width_cells, gb.height_cells,
                   v.name as variety_name,
                   pi_label.label as instance_label
            FROM plantings p
            JOIN plants pl ON p.plant_id = pl.id
            LEFT JOIN garden_beds gb ON p.bed_id = gb.id
            LEFT JOIN varieties v ON p.variety_id = v.id
            LEFT JOIN plant_instances pi_label ON p.instance_id = pi_label.id
            {bed_where}
        """).fetchall()
        for r in bed_plantings:
            d = dict(r)
            if d.get("instance_id"):
                d["link"] = f"/plant/{d['instance_id']}"
            else:
                d["link"] = f"/planters/{d['container_id']}"
            results.append(d)

        # Ground plants
        ground_where = "" if include_historical else "WHERE gp.status NOT IN ('removed', 'dead')"
        ground_plants = db.execute(f"""
            SELECT gp.id, gp.plant_id, gp.status, gp.planted_date,
                   gp.name as custom_name, gp.instance_id,
                   pl.name as plant_name, pl.category,
                   a.name as container_name, 'ground' as container_type, gp.id as container_id
            FROM ground_plants gp
            JOIN plants pl ON gp.plant_id = pl.id
            LEFT JOIN areas a ON gp.area_id = a.id
            {ground_where}
        """).fetchall()
        for r in ground_plants:
            d = dict(r)
            d["variety_name"] = None
            d["cell_x"] = None
            d["cell_y"] = None
            d["width_cells"] = None
            d["height_cells"] = None
            d["instance_label"] = None
            if d.get("instance_id"):
                d["link"] = f"/plant/{d['instance_id']}"
            else:
                d["link"] = f"/ground-plants/{d['container_id']}"
            if d.get("custom_name"):
                d["plant_name"] = d["custom_name"]
            results.append(d)

        # Tray cells with plants
        tray_status_filter = "" if include_historical else "AND stc.status IN ('seeded', 'germinated')"
        tray_cells = db.execute(f"""
            SELECT stc.id, stc.plant_id, stc.status, stc.seed_date as planted_date,
                   stc.row as tray_row, stc.col as tray_col,
                   (stc.row || '-' || stc.col) as cell_label,
                   pl.name as plant_name, pl.category,
                   st.name as container_name, 'tray' as container_type, st.id as container_id,
                   st.rows as tray_rows, st.cols as tray_cols
            FROM seed_tray_cells stc
            JOIN plants pl ON stc.plant_id = pl.id
            LEFT JOIN seed_trays st ON stc.tray_id = st.id
            WHERE stc.plant_id IS NOT NULL
            {tray_status_filter}
        """).fetchall()
        for r in tray_cells:
            d = dict(r)
            d["cell_x"] = d.get("tray_col")
            d["cell_y"] = d.get("tray_row")
            d["width_cells"] = d.get("tray_cols")
            d["height_cells"] = d.get("tray_rows")
            d["variety_name"] = None
            d["instance_label"] = None
            d["link"] = f"/trays/{d['container_id']}"
            results.append(d)

        # Sort by plant name
        results.sort(key=lambda x: (x.get("plant_name") or "").lower())

        if status:
            results = [r for r in results if r["status"] == status]

        return results
