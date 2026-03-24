"""Route module — routes/plants.py"""
from __future__ import annotations

import json
import uuid
from datetime import date, datetime, timedelta
from typing import Optional

from fastapi import APIRouter, HTTPException, Query, Request, UploadFile, File, Form
from fastapi.responses import FileResponse, Response

from db import get_db, row_to_dict
from auth import require_user, require_admin, audit_log, get_request_user
from constants import _get_harvest_flags, _is_plantable_now, CURRENT_YEAR
from plant_knowledge import get_knowledge, generate_seed_sources, calculate_data_quality, PLANT_KNOWLEDGE

router = APIRouter()


# ──────────────── PLANTS ────────────────

@router.get("/api/plants/stats")
def plant_stats():
    """Return aggregate counts for filter UI badges."""
    with get_db() as db:
        total = db.execute("SELECT COUNT(*) FROM plants").fetchone()[0]

        cats = db.execute("SELECT category, COUNT(*) as cnt FROM plants GROUP BY category").fetchall()
        by_category = {r["category"]: r["cnt"] for r in cats}

        # seasons stored as JSON array, need to unpack
        all_plants = db.execute("SELECT desert_seasons FROM plants").fetchall()
        by_season: dict[str, int] = {}
        for row in all_plants:
            if row["desert_seasons"]:
                for s in json.loads(row["desert_seasons"]):
                    by_season[s] = by_season.get(s, 0) + 1

        ht = db.execute("SELECT heat_tolerance, COUNT(*) as cnt FROM plants WHERE heat_tolerance IS NOT NULL GROUP BY heat_tolerance").fetchall()
        by_heat_tolerance = {r["heat_tolerance"]: r["cnt"] for r in ht}

        sn = db.execute("SELECT sun, COUNT(*) as cnt FROM plants WHERE sun IS NOT NULL GROUP BY sun").fetchall()
        by_sun = {r["sun"]: r["cnt"] for r in sn}

        return {
            "total": total,
            "by_category": by_category,
            "by_season": by_season,
            "by_heat_tolerance": by_heat_tolerance,
            "by_sun": by_sun,
        }


@router.get("/api/plants")
def list_plants(
    category: Optional[str] = None,
    season: Optional[str] = None,
    sun: Optional[str] = None,
    water: Optional[str] = None,
    heat_tolerance: Optional[str] = None,
    spacing_max: Optional[int] = None,
    spacing_min: Optional[int] = None,
    search: Optional[str] = None,
    sort: Optional[str] = None,
    companion_of: Optional[str] = None,
    plantable_now: Optional[bool] = None,
    growth_habit: Optional[str] = None,
    needs_trellis: Optional[bool] = None,
    needs_cage: Optional[bool] = None,
    needs_staking: Optional[bool] = None,
    no_support: Optional[bool] = None,
    edible: Optional[bool] = None,
    pollinator: Optional[bool] = None,
    drought_tolerant: Optional[bool] = None,
    deer_resistant: Optional[bool] = None,
    nitrogen_fixer: Optional[bool] = None,
    maturity_max: Optional[int] = None,
    maturity_min: Optional[int] = None,
):
    with get_db() as db:
        # Determine if we need to join plant_details
        needs_details_join = any([
            growth_habit, needs_trellis, needs_cage, needs_staking, no_support,
            edible, pollinator, drought_tolerant, deer_resistant, nitrogen_fixer,
        ])

        query = "SELECT p.* FROM plants p"
        if needs_details_join:
            query += " LEFT JOIN plant_details pd ON pd.plant_id = p.id"
        params: list = []
        conditions: list[str] = []

        # companion_of filter: join through companions table
        if companion_of:
            # Find the plant id for the given name
            ref = db.execute("SELECT id FROM plants WHERE name = ? COLLATE NOCASE", (companion_of,)).fetchone()
            if ref:
                detail_join = " LEFT JOIN plant_details pd ON pd.plant_id = p.id" if needs_details_join else ""
                query = (
                    "SELECT p.* FROM plants p "
                    "INNER JOIN companions c ON c.companion_name = p.name "
                    + detail_join +
                    " WHERE c.plant_id = ? AND c.relationship = 'companion'"
                )
                params.append(ref["id"])
            else:
                return []

        if category:
            conditions.append("p.category = ?")
            params.append(category)
        if season:
            conditions.append("p.desert_seasons LIKE ?")
            params.append(f'%"{season}"%')
        if sun:
            conditions.append("p.sun = ?")
            params.append(sun)
        if water:
            conditions.append("p.water = ?")
            params.append(water)
        if heat_tolerance:
            conditions.append("p.heat_tolerance = ?")
            params.append(heat_tolerance)
        if spacing_max is not None:
            conditions.append("p.spacing_inches <= ?")
            params.append(spacing_max)
        if spacing_min is not None:
            conditions.append("p.spacing_inches >= ?")
            params.append(spacing_min)
        if search:
            conditions.append("(p.name LIKE ? OR p.notes LIKE ?)")
            params.append(f"%{search}%")
            params.append(f"%{search}%")
        if maturity_max is not None:
            conditions.append("p.days_to_maturity_min <= ?")
            params.append(maturity_max)
        if maturity_min is not None:
            conditions.append("p.days_to_maturity_min >= ?")
            params.append(maturity_min)

        # plant_details filters
        if growth_habit:
            conditions.append("LOWER(pd.growth_habit) = LOWER(?)")
            params.append(growth_habit)
        if needs_trellis:
            conditions.append("pd.needs_trellis = 1")
        if needs_cage:
            conditions.append("pd.needs_cage = 1")
        if needs_staking:
            conditions.append("pd.needs_staking = 1")
        if no_support:
            conditions.append("COALESCE(pd.needs_trellis, 0) = 0 AND COALESCE(pd.needs_cage, 0) = 0 AND COALESCE(pd.needs_staking, 0) = 0")
        if edible:
            conditions.append("pd.edible_parts IS NOT NULL AND pd.edible_parts != '[]' AND pd.edible_parts != ''")
        if pollinator:
            conditions.append("pd.attracts_pollinators = 1")
        if drought_tolerant:
            conditions.append("pd.drought_tolerant = 1")
        if deer_resistant:
            conditions.append("pd.deer_resistant = 1")
        if nitrogen_fixer:
            conditions.append("pd.nitrogen_fixer = 1")

        if conditions:
            if companion_of:
                query += " AND " + " AND ".join(conditions)
            else:
                query += " WHERE " + " AND ".join(conditions)

        # Sorting
        order = "p.name"
        if sort == "maturity":
            order = "p.days_to_maturity_min"
        elif sort == "spacing":
            order = "p.spacing_inches"
        elif sort == "water":
            order = "CASE p.water WHEN 'low' THEN 1 WHEN 'moderate' THEN 2 WHEN 'high' THEN 3 ELSE 4 END"
        elif sort == "heat":
            order = "CASE p.heat_tolerance WHEN 'high' THEN 1 WHEN 'moderate' THEN 2 WHEN 'low' THEN 3 ELSE 4 END"
        query += f" ORDER BY {order}"

        rows = db.execute(query, params).fetchall()
        plants = [row_to_dict(r) for r in rows]

        # Filter to only plants currently in their planting window
        if plantable_now:
            plants = [p for p in plants if _is_plantable_now(p)]

        # Attach companions/antagonists for each plant
        for plant in plants:
            comps = db.execute(
                "SELECT companion_name, relationship FROM companions WHERE plant_id = ?",
                (plant["id"],),
            ).fetchall()
            plant["companions"] = [c["companion_name"] for c in comps if c["relationship"] == "companion"]
            plant["antagonists"] = [c["companion_name"] for c in comps if c["relationship"] == "antagonist"]

        return plants


@router.get("/api/plants/{plant_id}")
def get_plant(plant_id: int):
    with get_db() as db:
        row = db.execute("SELECT * FROM plants WHERE id = ?", (plant_id,)).fetchone()
        if not row:
            raise HTTPException(404, "Plant not found")
        plant = row_to_dict(row)

        companions = db.execute(
            "SELECT companion_name, relationship FROM companions WHERE plant_id = ?",
            (plant_id,),
        ).fetchall()
        plant["companions"] = [c["companion_name"] for c in companions if c["relationship"] == "companion"]
        plant["antagonists"] = [c["companion_name"] for c in companions if c["relationship"] == "antagonist"]
        return plant


@router.get("/api/plants/name/{name}")
def get_plant_by_name(name: str):
    with get_db() as db:
        row = db.execute("SELECT * FROM plants WHERE name = ? COLLATE NOCASE", (name,)).fetchone()
        if not row:
            raise HTTPException(404, "Plant not found")
        plant = row_to_dict(row)
        companions = db.execute(
            "SELECT companion_name, relationship FROM companions WHERE plant_id = ?",
            (plant["id"],),
        ).fetchall()
        plant["companions"] = [c["companion_name"] for c in companions if c["relationship"] == "companion"]
        plant["antagonists"] = [c["companion_name"] for c in companions if c["relationship"] == "antagonist"]
        return plant


# ──────────────── COMPANIONS ────────────────

@router.get("/api/companions/check")
def check_companion(plant1: str, plant2: str):
    """Check if two plants are companions, antagonists, or neutral."""
    with get_db() as db:
        row = db.execute("""
            SELECT c.relationship FROM companions c
            JOIN plants p ON c.plant_id = p.id
            WHERE p.name = ? COLLATE NOCASE AND c.companion_name = ? COLLATE NOCASE
        """, (plant1, plant2)).fetchone()

        if row:
            return {"plant1": plant1, "plant2": plant2, "relationship": row["relationship"]}

        # Check reverse
        row = db.execute("""
            SELECT c.relationship FROM companions c
            JOIN plants p ON c.plant_id = p.id
            WHERE p.name = ? COLLATE NOCASE AND c.companion_name = ? COLLATE NOCASE
        """, (plant2, plant1)).fetchone()

        if row:
            return {"plant1": plant1, "plant2": plant2, "relationship": row["relationship"]}

        return {"plant1": plant1, "plant2": plant2, "relationship": "neutral"}


@router.get("/api/companions/{plant_id}")
def get_companions(plant_id: int):
    with get_db() as db:
        rows = db.execute(
            "SELECT companion_name, relationship FROM companions WHERE plant_id = ?",
            (plant_id,),
        ).fetchall()
        return {
            "companions": [r["companion_name"] for r in rows if r["relationship"] == "companion"],
            "antagonists": [r["companion_name"] for r in rows if r["relationship"] == "antagonist"],
        }


