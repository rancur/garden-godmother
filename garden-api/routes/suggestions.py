"""Proactive garden suggestions endpoint."""
from __future__ import annotations

from datetime import date, datetime, timedelta
from typing import Any

from fastapi import APIRouter, Request

from auth import require_user
from db import get_db

router = APIRouter()

# ─── helpers ────────────────────────────────────────────────────────────────


def _priority_key(s: dict) -> tuple:
    order = {"high": 0, "medium": 1, "low": 2}
    return (order.get(s["priority"], 9),)


# ─── suggestion builders ─────────────────────────────────────────────────────


def _watering_suggestions(db: Any, today: date) -> list[dict]:
    """Flag active plantings whose last watering journal entry is overdue."""
    rows = db.execute("""
        SELECT p.id, p.plant_id, p.bed_id, p.status, p.planted_date,
               pl.name as plant_name, pl.category,
               gb.name as bed_name,
               (
                   SELECT MAX(je.created_at)
                   FROM journal_entries je
                   WHERE je.planting_id = p.id
                     AND je.entry_type = 'watering'
               ) as last_watered_at
        FROM plantings p
        JOIN plants pl ON p.plant_id = pl.id
        LEFT JOIN garden_beds gb ON p.bed_id = gb.id
        WHERE p.status IN ('seeded','sprouted','growing','flowering','fruiting','established')
    """).fetchall()

    suggestions = []
    for r in rows:
        d = dict(r)
        last_watered_at = d.get("last_watered_at")
        if last_watered_at:
            try:
                lw = datetime.fromisoformat(last_watered_at.replace("Z", ""))
                days_since = (datetime.utcnow() - lw).days
            except (ValueError, TypeError):
                days_since = 999
        else:
            days_since = 999

        # Only flag if not watered in 3+ days
        if days_since < 3:
            continue

        plant_name = d["plant_name"]
        bed_name = d.get("bed_name") or "garden"
        priority = "high" if days_since >= 7 else "medium"

        suggestions.append({
            "id": f"water-planting:{d['id']}",
            "type": "watering",
            "priority": priority,
            "title": f"Water your {plant_name}",
            "body": (
                f"{plant_name} in {bed_name} hasn't been watered in "
                f"{'over a week' if days_since >= 7 else f'{days_since} days'}."
            ),
            "action_label": "Log Watering",
            "action_url": "/journal?new=true",
            "entity_id": d["id"],
            "entity_type": "planting",
        })

    return suggestions


def _harvest_suggestions(db: Any, today: date) -> list[dict]:
    """Flag plantings that have reached or passed days_to_maturity."""
    rows = db.execute("""
        SELECT p.id, p.plant_id, p.bed_id, p.planted_date,
               pl.name as plant_name,
               gb.name as bed_name,
               COALESCE(pl.days_to_maturity_max, pl.days_to_maturity_min) as days_to_maturity
        FROM plantings p
        JOIN plants pl ON p.plant_id = pl.id
        LEFT JOIN garden_beds gb ON p.bed_id = gb.id
        WHERE p.status IN ('growing','flowering','fruiting','established')
          AND p.planted_date IS NOT NULL
          AND COALESCE(pl.days_to_maturity_max, pl.days_to_maturity_min) IS NOT NULL
    """).fetchall()

    suggestions = []
    for r in rows:
        d = dict(r)
        try:
            planted = date.fromisoformat(d["planted_date"])
        except (ValueError, TypeError):
            continue
        days_growing = (today - planted).days
        dtm = d["days_to_maturity"]
        if dtm is None or days_growing < dtm:
            continue

        plant_name = d["plant_name"]
        bed_name = d.get("bed_name") or "garden"
        over = days_growing - dtm
        priority = "high" if over >= 7 else "medium"

        suggestions.append({
            "id": f"harvest-planting:{d['id']}",
            "type": "harvest",
            "priority": priority,
            "title": f"Time to harvest your {plant_name}",
            "body": (
                f"{plant_name} in {bed_name} was planted {days_growing} days ago "
                f"and should be ready to harvest (maturity: {dtm} days)."
            ),
            "action_label": "Log Harvest",
            "action_url": "/harvest",
            "entity_id": d["id"],
            "entity_type": "planting",
        })

    return suggestions


def _succession_suggestions(db: Any, today: date) -> list[dict]:
    """Suggest planting in beds with vacant capacity."""
    rows = db.execute("""
        SELECT gb.id, gb.name,
               gb.width_cells * gb.height_cells as total_cells,
               COUNT(p.id) as occupied
        FROM garden_beds gb
        LEFT JOIN plantings p
            ON p.bed_id = gb.id
            AND p.status IN ('seeded','sprouted','growing','flowering','fruiting','established')
        GROUP BY gb.id
        HAVING total_cells > 0 AND occupied < total_cells
        ORDER BY (total_cells - occupied) DESC
        LIMIT 3
    """).fetchall()

    month = today.month
    if 3 <= month <= 5:
        season_hint = "spring crops like lettuce, peas, or radishes"
    elif 6 <= month <= 8:
        season_hint = "heat-loving crops like basil, beans, or cucumbers"
    elif 9 <= month <= 11:
        season_hint = "fall crops like kale, spinach, or carrots"
    else:
        season_hint = "cold-hardy crops like garlic, onions, or cover crops"

    suggestions = []
    for r in rows:
        d = dict(r)
        vacant = d["total_cells"] - d["occupied"]
        suggestions.append({
            "id": f"succession-bed:{d['id']}",
            "type": "succession",
            "priority": "low",
            "title": f"{d['name']} has {vacant} open cell{'s' if vacant != 1 else ''}",
            "body": (
                f"Consider filling the space in {d['name']} with {season_hint}."
            ),
            "action_label": "Plan Planting",
            "action_url": f"/planters/{d['id']}",
            "entity_id": d["id"],
            "entity_type": "bed",
        })

    return suggestions


def _seed_start_suggestions(db: Any, today: date) -> list[dict]:
    """Suggest starting seeds indoors when last frost is ~8 weeks away."""
    prop = db.execute(
        "SELECT last_frost_spring FROM property WHERE id = 1"
    ).fetchone()
    if not prop or not prop["last_frost_spring"]:
        return []

    try:
        frost_str = prop["last_frost_spring"]
        # frost_str is MM-DD; build a date for the current or next year
        year_candidate = today.year
        frost_date = date.fromisoformat(f"{year_candidate}-{frost_str}")
        if frost_date < today:
            frost_date = date.fromisoformat(f"{year_candidate + 1}-{frost_str}")
    except (ValueError, TypeError):
        return []

    days_to_frost = (frost_date - today).days
    # Only surface suggestions in the 4–10 week window before last frost
    if not (28 <= days_to_frost <= 70):
        return []

    rows = db.execute("""
        SELECT s.id, s.plant_id, s.variety, s.quantity_seeds,
               p.name as plant_name
        FROM seed_inventory s
        JOIN plants p ON s.plant_id = p.id
        WHERE s.quantity_seeds > 0
        ORDER BY p.name
        LIMIT 5
    """).fetchall()

    suggestions = []
    for r in rows:
        d = dict(r)
        variety_str = f" ({d['variety']})" if d.get("variety") else ""
        suggestions.append({
            "id": f"seed-start-seed:{d['id']}",
            "type": "seed_start",
            "priority": "medium",
            "title": f"Start {d['plant_name']}{variety_str} seeds indoors",
            "body": (
                f"Last frost is in ~{days_to_frost} days ({frost_date.strftime('%b %d')}). "
                f"Start {d['plant_name']}{variety_str} seeds indoors now for a head start."
            ),
            "action_label": "Log Seed Start",
            "action_url": "/trays",
            "entity_id": d["id"],
            "entity_type": "seed",
        })

    return suggestions


def _seed_swap_suggestions(db: Any, today: date) -> list[dict]:
    """Suggest enabling coop swap for seeds with surplus quantity."""
    rows = db.execute("""
        SELECT s.id, s.plant_id, s.variety, s.quantity_seeds,
               p.name as plant_name
        FROM seed_inventory s
        JOIN plants p ON s.plant_id = p.id
        WHERE s.quantity_seeds > 5
          AND (s.coop_swap_available IS NULL OR s.coop_swap_available = 0)
        ORDER BY s.quantity_seeds DESC
        LIMIT 3
    """).fetchall()

    suggestions = []
    for r in rows:
        d = dict(r)
        variety_str = f" ({d['variety']})" if d.get("variety") else ""
        suggestions.append({
            "id": f"seed-swap-seed:{d['id']}",
            "type": "seed_swap",
            "priority": "low",
            "title": f"Share your extra {d['plant_name']}{variety_str} seeds",
            "body": (
                f"You have {d['quantity_seeds']} {d['plant_name']}{variety_str} seeds — "
                f"enough to swap with the community. Enable seed swap to offer your surplus."
            ),
            "action_label": "Enable Swap",
            "action_url": "/seeds",
            "entity_id": d["id"],
            "entity_type": "seed",
        })

    return suggestions


# ─── endpoint ────────────────────────────────────────────────────────────────


@router.get("/api/suggestions")
def get_suggestions(request: Request):
    """Return up to 10 proactive, actionable garden suggestions."""
    require_user(request)
    today = date.today()

    with get_db() as db:
        suggestions: list[dict] = []

        suggestions.extend(_harvest_suggestions(db, today))
        suggestions.extend(_watering_suggestions(db, today))
        suggestions.extend(_seed_start_suggestions(db, today))
        suggestions.extend(_succession_suggestions(db, today))
        suggestions.extend(_seed_swap_suggestions(db, today))

    # Sort: high → medium → low, then stable (insertion order within priority)
    suggestions.sort(key=_priority_key)

    return suggestions[:10]
