"""Route module — routes/calendar.py"""
from __future__ import annotations

import json
import uuid
from datetime import date, datetime, timedelta
from typing import Optional

from fastapi import APIRouter, HTTPException, Query, Request, UploadFile, File, Form
from fastapi.responses import FileResponse, Response

from db import get_db, row_to_dict
from auth import require_user, require_admin, audit_log, get_request_user
from constants import (
    _get_harvest_flags, _get_configured_timezone, parse_md, CURRENT_YEAR,
    _ics_escape, _ics_fold, _task_type_emoji,
)

router = APIRouter()

# ──────────────── CALENDAR ────────────────

def parse_md(md_str: str, year: int = None) -> date:
    """Parse MM-DD string to date."""
    if year is None:
        year = CURRENT_YEAR
    m, d = md_str.split("-")
    return date(year, int(m), int(d))

@router.get("/api/calendar/now")
def whats_plantable_now():
    """What can be planted right now based on today's date?"""
    today = date.today()
    results = []

    with get_db() as db:
        rows = db.execute("SELECT * FROM plants ORDER BY name").fetchall()
        for row in rows:
            plant = row_to_dict(row)
            actions = []

            # Check if we can sow outdoors now
            sow = plant.get("desert_sow_outdoor")
            if sow:
                start = parse_md(sow[0])
                end = parse_md(sow[1])
                # Handle wrap-around (e.g., Sep-Feb)
                if start <= end:
                    if start <= today <= end:
                        actions.append("direct_sow")
                else:
                    if today >= start or today <= end:
                        actions.append("direct_sow")

            # Check if we can transplant now
            trans = plant.get("desert_transplant")
            if trans:
                start = parse_md(trans[0])
                end = parse_md(trans[1])
                if start <= end:
                    if start <= today <= end:
                        actions.append("transplant")
                else:
                    if today >= start or today <= end:
                        actions.append("transplant")

            # Check if we should start seeds indoors
            weeks = plant.get("sow_indoor_weeks_before_transplant", 0)
            if weeks and trans:
                trans_start = parse_md(trans[0])
                seed_start = trans_start - timedelta(weeks=weeks)
                seed_end = seed_start + timedelta(weeks=4)  # 4 week window
                if seed_start <= today <= seed_end:
                    actions.append("start_seeds_indoors")

            # Check if currently harvestable (only for harvestable plants)
            harv = plant.get("desert_harvest")
            if harv:
                is_h, ss, _ = _get_harvest_flags(plant["name"], plant["category"], plant.get("subcategory", ""))
                if is_h:
                    start = parse_md(harv[0])
                    end = parse_md(harv[1])
                    if start <= end:
                        if start <= today <= end:
                            actions.append("harvest_window")
                    else:
                        if today >= start or today <= end:
                            actions.append("harvest_window")

            if actions:
                results.append({
                    "id": plant["id"],
                    "name": plant["name"],
                    "category": plant["category"],
                    "actions": actions,
                    "notes": plant.get("notes", ""),
                })

    return {"date": today.isoformat(), "plantable": results}


@router.get("/api/calendar/plant/{plant_id}")
def plant_calendar(plant_id: int, year: int = None):
    """Get the full planting calendar for a specific plant."""
    if year is None:
        year = CURRENT_YEAR

    with get_db() as db:
        row = db.execute("SELECT * FROM plants WHERE id = ?", (plant_id,)).fetchone()
        if not row:
            raise HTTPException(404, "Plant not found")
        plant = row_to_dict(row)

    events = []

    sow = plant.get("desert_sow_outdoor")
    if sow:
        events.append({
            "type": "direct_sow",
            "start": f"{year}-{sow[0]}",
            "end": f"{year}-{sow[1]}",
            "label": f"Direct sow {plant['name']}",
        })

    trans = plant.get("desert_transplant")
    if trans:
        events.append({
            "type": "transplant",
            "start": f"{year}-{trans[0]}",
            "end": f"{year}-{trans[1]}",
            "label": f"Transplant {plant['name']}",
        })

    weeks = plant.get("sow_indoor_weeks_before_transplant", 0)
    if weeks and trans:
        trans_start = parse_md(trans[0], year)
        seed_start = trans_start - timedelta(weeks=weeks)
        events.append({
            "type": "start_seeds",
            "start": seed_start.isoformat(),
            "end": (seed_start + timedelta(weeks=2)).isoformat(),
            "label": f"Start {plant['name']} seeds indoors",
        })

    harv = plant.get("desert_harvest")
    is_h, ss, sd = _get_harvest_flags(plant["name"], plant["category"], plant.get("subcategory", ""))
    if harv:
        if is_h:
            events.append({
                "type": "harvest",
                "start": f"{year}-{harv[0]}",
                "end": f"{year}-{harv[1]}",
                "label": f"Harvest {plant['name']}",
            })
        else:
            events.append({
                "type": "success",
                "start": f"{year}-{harv[0]}",
                "end": f"{year}-{harv[1]}",
                "label": f"{plant['name']} {ss}",
            })

    return {
        "plant": plant["name"],
        "year": year,
        "zone": _get_configured_zone(),
        "events": events,
        "days_to_maturity": f"{plant['days_to_maturity_min']}-{plant['days_to_maturity_max']}",
        "is_harvestable": is_h,
        "success_state": ss,
    }


@router.get("/api/calendar/month/{month}")
def month_calendar(month: int, year: int = None):
    """Get all planting events for a given month."""
    if year is None:
        year = CURRENT_YEAR

    month_start = date(year, month, 1)
    if month == 12:
        month_end = date(year + 1, 1, 1) - timedelta(days=1)
    else:
        month_end = date(year, month + 1, 1) - timedelta(days=1)

    results = []
    with get_db() as db:
        rows = db.execute("SELECT * FROM plants ORDER BY name").fetchall()
        for row in rows:
            plant = row_to_dict(row)
            events = []

            sow = plant.get("desert_sow_outdoor")
            if sow:
                try:
                    s = parse_md(sow[0], year)
                    e = parse_md(sow[1], year)
                    if s <= e:
                        if s <= month_end and e >= month_start:
                            events.append("direct_sow")
                    else:
                        if month_start >= s or month_end <= e:
                            events.append("direct_sow")
                except ValueError:
                    pass

            trans = plant.get("desert_transplant")
            if trans:
                try:
                    s = parse_md(trans[0], year)
                    e = parse_md(trans[1], year)
                    if s <= e:
                        if s <= month_end and e >= month_start:
                            events.append("transplant")
                    else:
                        if month_start >= s or month_end <= e:
                            events.append("transplant")
                except ValueError:
                    pass

            harv = plant.get("desert_harvest")
            if harv:
                try:
                    s = parse_md(harv[0], year)
                    e = parse_md(harv[1], year)
                    is_h, ss, _ = _get_harvest_flags(plant["name"], plant["category"], plant.get("subcategory", ""))
                    event_type = "harvest" if is_h else "success"
                    if s <= e:
                        if s <= month_end and e >= month_start:
                            events.append(event_type)
                    else:
                        if month_start >= s or month_end <= e:
                            events.append(event_type)
                except ValueError:
                    pass

            if events:
                results.append({
                    "id": plant["id"],
                    "name": plant["name"],
                    "category": plant["category"],
                    "events": events,
                })

    return {"month": month, "year": year, "plants": results}


@router.get("/api/calendar/personal")
def personal_calendar(months: int = 3):
    """Build a personalized calendar based on active plantings, lifecycles, trays, seeds, and tasks."""
    today = date.today()
    year = today.year
    # End date = today + N months
    end_month = today.month + months
    end_year = year
    while end_month > 12:
        end_month -= 12
        end_year += 1
    end_date = date(end_year, end_month, 1)

    events = []
    month_stats: dict[tuple[int, int], dict] = {}

    def _add(evt: dict):
        events.append(evt)
        d = evt.get("date")
        if d:
            try:
                dt = date.fromisoformat(d)
            except (ValueError, TypeError):
                return
            key = (dt.month, dt.year)
            if key not in month_stats:
                month_stats[key] = {"month": dt.month, "year": dt.year, "harvests": 0, "plantings": 0, "seed_starts": 0, "transplants": 0}
            t = evt.get("type", "")
            if t == "harvest":
                month_stats[key]["harvests"] += 1
            elif t in ("lifecycle_task",) and "sow" in evt.get("title", "").lower():
                month_stats[key]["plantings"] += 1
            elif t == "seed_opportunity":
                month_stats[key]["seed_starts"] += 1
            elif t in ("transplant_ready",):
                month_stats[key]["transplants"] += 1
            elif t == "lifecycle_task" and "transplant" in evt.get("title", "").lower():
                month_stats[key]["transplants"] += 1
            elif t == "lifecycle_task" and ("seed" in evt.get("title", "").lower() or "start" in evt.get("title", "").lower()):
                month_stats[key]["seed_starts"] += 1

    with get_db() as db:
        # ── 1. Active plantings → expected harvest/success dates ──
        active_plantings = db.execute("""
            SELECT p.*, pl.name as plant_name, pl.category, pl.subcategory,
                   pl.days_to_maturity_min, pl.days_to_maturity_max,
                   b.name as bed_name, b.id as bed_id_ref
            FROM plantings p
            JOIN plants pl ON p.plant_id = pl.id
            LEFT JOIN garden_beds b ON p.bed_id = b.id
            WHERE p.status IN ('seeded', 'sprouted', 'growing', 'flowering', 'fruiting', 'established')
        """).fetchall()

        for row in active_plantings:
            r = dict(row)
            is_h, ss, sd = _get_harvest_flags(r["plant_name"], r.get("category", ""), r.get("subcategory", ""))
            # If expected_harvest_date is set, use it; otherwise estimate from planted_date + days_to_maturity
            harvest_date = r.get("expected_harvest_date")
            if not harvest_date and r.get("planted_date") and r.get("days_to_maturity_min"):
                try:
                    pd = date.fromisoformat(r["planted_date"])
                    avg_days = ((r["days_to_maturity_min"] or 60) + (r["days_to_maturity_max"] or r["days_to_maturity_min"] or 60)) // 2
                    harvest_date = (pd + timedelta(days=avg_days)).isoformat()
                except (ValueError, TypeError):
                    pass

            if harvest_date:
                try:
                    hd = date.fromisoformat(harvest_date)
                except (ValueError, TypeError):
                    continue
                if today <= hd <= end_date:
                    bed_name = r.get("bed_name") or "Unknown bed"
                    if is_h:
                        _add({
                            "date": harvest_date,
                            "type": "harvest",
                            "title": f"Harvest {r['plant_name']} from {bed_name}",
                            "plant_name": r["plant_name"],
                            "plant_id": r["plant_id"],
                            "planting_id": r["id"],
                            "bed_name": bed_name,
                            "link": f"/planters/{r['bed_id_ref']}" if r.get("bed_id_ref") else "/planters",
                            "priority": "medium",
                        })
                    else:
                        _add({
                            "date": harvest_date,
                            "type": "success",
                            "title": f"{r['plant_name']} {ss} in {bed_name}",
                            "plant_name": r["plant_name"],
                            "plant_id": r["plant_id"],
                            "planting_id": r["id"],
                            "bed_name": bed_name,
                            "link": f"/planters/{r['bed_id_ref']}" if r.get("bed_id_ref") else "/planters",
                            "priority": "low",
                        })

            # Also show planting window events for active plants
            plant_row = db.execute("SELECT * FROM plants WHERE id = ?", (r["plant_id"],)).fetchone()
            if plant_row:
                plant = row_to_dict(plant_row)
                sow = plant.get("desert_sow_outdoor")
                if sow:
                    try:
                        s = parse_md(sow[0], year)
                        e = parse_md(sow[1], year)
                        if s <= e:
                            if s >= today and s <= end_date:
                                _add({
                                    "date": s.isoformat(),
                                    "type": "planting_window",
                                    "title": f"Direct sow window opens for {r['plant_name']}",
                                    "plant_name": r["plant_name"],
                                    "plant_id": r["plant_id"],
                                    "link": f"/lifecycle?plant_id={r['plant_id']}",
                                    "priority": "low",
                                })
                    except (ValueError, TypeError):
                        pass

        # ── 1b. Active ground plants → estimated maturity/success dates ──
        active_ground_plants = db.execute("""
            SELECT gp.*, p.name as plant_name, p.category, p.subcategory,
                   p.days_to_maturity_min, p.days_to_maturity_max,
                   a.name as area_name
            FROM ground_plants gp
            JOIN plants p ON gp.plant_id = p.id
            LEFT JOIN areas a ON gp.area_id = a.id
            WHERE gp.status IN ('planted', 'growing', 'established')
        """).fetchall()

        for row in active_ground_plants:
            r = dict(row)
            is_h, ss, sd = _get_harvest_flags(r["plant_name"], r.get("category", ""), r.get("subcategory", ""))
            # Estimate maturity date from planted_date + days_to_maturity
            if r.get("planted_date") and r.get("days_to_maturity_min"):
                try:
                    pd = date.fromisoformat(r["planted_date"])
                    avg_days = ((r["days_to_maturity_min"] or 60) + (r["days_to_maturity_max"] or r["days_to_maturity_min"] or 60)) // 2
                    maturity_date = (pd + timedelta(days=avg_days)).isoformat()
                    md = date.fromisoformat(maturity_date)
                    if today <= md <= end_date:
                        area_name = r.get("area_name") or "in ground"
                        gp_name = r.get("name") or r["plant_name"]
                        if is_h:
                            _add({
                                "date": maturity_date,
                                "type": "harvest",
                                "title": f"Harvest {gp_name} ({area_name})",
                                "plant_name": r["plant_name"],
                                "plant_id": r["plant_id"],
                                "link": "/ground-plants",
                                "priority": "medium",
                            })
                        else:
                            _add({
                                "date": maturity_date,
                                "type": "success",
                                "title": f"{gp_name} {ss} ({area_name})",
                                "plant_name": r["plant_name"],
                                "plant_id": r["plant_id"],
                                "link": "/ground-plants",
                                "priority": "low",
                            })
                except (ValueError, TypeError):
                    pass

        # ── 2. Lifecycle plans → upcoming tasks ──
        lifecycle_tasks = db.execute("""
            SELECT gt.*, pl.name as plant_name
            FROM garden_tasks gt
            LEFT JOIN plants pl ON gt.plant_id = pl.id
            WHERE gt.lifecycle_group_id IS NOT NULL
              AND gt.status IN ('pending', 'in_progress')
              AND gt.due_date IS NOT NULL
              AND gt.due_date >= ?
              AND gt.due_date < ?
            ORDER BY gt.due_date ASC
        """, (today.isoformat(), end_date.isoformat())).fetchall()

        for row in lifecycle_tasks:
            r = dict(row)
            priority = "high" if r.get("priority") == "high" or r.get("priority") == "urgent" else "medium"
            _add({
                "date": r["due_date"],
                "type": "lifecycle_task",
                "title": r["title"],
                "plant_name": r.get("plant_name") or "Unknown",
                "plant_id": r.get("plant_id"),
                "planting_id": r.get("planting_id"),
                "lifecycle_id": r.get("lifecycle_group_id"),
                "link": "/lifecycle",
                "priority": priority,
            })

        # ── 3. Seed trays → cells ready to transplant or recently seeded ──
        tray_cells = db.execute("""
            SELECT stc.*, st.name as tray_name, pl.name as plant_name, pl.id as ref_plant_id,
                   pl.days_to_maturity_min
            FROM seed_tray_cells stc
            JOIN seed_trays st ON stc.tray_id = st.id
            LEFT JOIN plants pl ON stc.plant_id = pl.id
            WHERE stc.status IN ('seeded', 'germinated', 'ready_to_transplant')
        """).fetchall()

        for row in tray_cells:
            r = dict(row)
            if r["status"] == "ready_to_transplant":
                _add({
                    "date": today.isoformat(),
                    "type": "transplant_ready",
                    "title": f"{r.get('plant_name', 'Unknown')} in {r.get('tray_name', 'tray')} ready to transplant",
                    "plant_name": r.get("plant_name") or "Unknown",
                    "plant_id": r.get("ref_plant_id"),
                    "link": f"/trays",
                    "priority": "high",
                })
            elif r["status"] == "seeded" and r.get("seed_date"):
                # Estimate germination: ~7-14 days from seed date
                try:
                    sd = date.fromisoformat(r["seed_date"])
                    germ_date = sd + timedelta(days=10)
                    if today <= germ_date <= end_date:
                        _add({
                            "date": germ_date.isoformat(),
                            "type": "lifecycle_task",
                            "title": f"Check germination: {r.get('plant_name', 'Unknown')} in {r.get('tray_name', 'tray')}",
                            "plant_name": r.get("plant_name") or "Unknown",
                            "plant_id": r.get("ref_plant_id"),
                            "link": "/trays",
                            "priority": "low",
                        })
                except (ValueError, TypeError):
                    pass

        # ── 4. Seed inventory → planting opportunities ──
        seeds = db.execute("""
            SELECT si.*, pl.name as plant_name, pl.id as ref_plant_id, pl.category,
                   pl.desert_sow_outdoor, pl.desert_transplant, pl.sow_indoor_weeks_before_transplant
            FROM seed_inventory si
            JOIN plants pl ON si.plant_id = pl.id
            WHERE si.quantity_seeds > 0 OR si.quantity_seeds IS NULL
        """).fetchall()

        # Collect plant IDs that already have active lifecycles, plantings, or ground plants
        active_plant_ids = set()
        for row in active_plantings:
            active_plant_ids.add(dict(row)["plant_id"])
        for row in active_ground_plants:
            active_plant_ids.add(dict(row)["plant_id"])
        active_lifecycle_plant_ids = set()
        lc_plants = db.execute("""
            SELECT DISTINCT plant_id FROM garden_tasks
            WHERE lifecycle_group_id IS NOT NULL AND status IN ('pending', 'in_progress')
        """).fetchall()
        for row in lc_plants:
            active_lifecycle_plant_ids.add(dict(row)["plant_id"])

        for row in seeds:
            r = dict(row)
            pid = r["ref_plant_id"]
            # Skip if already actively growing or has an active lifecycle
            if pid in active_plant_ids or pid in active_lifecycle_plant_ids:
                continue

            plant_name = r["plant_name"]
            # Check if currently in sow window
            sow_raw = r.get("desert_sow_outdoor")
            if sow_raw:
                try:
                    sow = json.loads(sow_raw) if isinstance(sow_raw, str) else sow_raw
                    if sow and len(sow) >= 2:
                        s = parse_md(sow[0], year)
                        e = parse_md(sow[1], year)
                        in_window = False
                        if s <= e:
                            in_window = s <= today <= e
                        else:
                            in_window = today >= s or today <= e
                        if in_window:
                            _add({
                                "date": today.isoformat(),
                                "type": "seed_opportunity",
                                "title": f"You have {plant_name} seeds — direct sow window is now",
                                "plant_name": plant_name,
                                "plant_id": pid,
                                "link": f"/lifecycle?plant_id={pid}",
                                "priority": "low",
                            })
                            continue
                except (json.JSONDecodeError, ValueError, TypeError):
                    pass

            # Check transplant window + indoor start
            trans_raw = r.get("desert_transplant")
            weeks = r.get("sow_indoor_weeks_before_transplant") or 0
            if trans_raw and weeks:
                try:
                    trans = json.loads(trans_raw) if isinstance(trans_raw, str) else trans_raw
                    if trans and len(trans) >= 2:
                        trans_start = parse_md(trans[0], year)
                        seed_start = trans_start - timedelta(weeks=weeks)
                        seed_end = seed_start + timedelta(weeks=4)
                        if seed_start <= today <= seed_end:
                            _add({
                                "date": today.isoformat(),
                                "type": "seed_opportunity",
                                "title": f"You have {plant_name} seeds — start indoors now",
                                "plant_name": plant_name,
                                "plant_id": pid,
                                "link": f"/lifecycle?plant_id={pid}",
                                "priority": "low",
                            })
                except (json.JSONDecodeError, ValueError, TypeError):
                    pass

        # ── 5. Pending tasks with due dates ──
        tasks = db.execute("""
            SELECT gt.*, pl.name as plant_name
            FROM garden_tasks gt
            LEFT JOIN plants pl ON gt.plant_id = pl.id
            WHERE gt.lifecycle_group_id IS NULL
              AND gt.status IN ('pending', 'in_progress')
              AND gt.due_date IS NOT NULL
              AND gt.due_date >= ?
              AND gt.due_date < ?
            ORDER BY gt.due_date ASC
        """, (today.isoformat(), end_date.isoformat())).fetchall()

        for row in tasks:
            r = dict(row)
            _add({
                "date": r["due_date"],
                "type": "task",
                "title": r["title"],
                "plant_name": r.get("plant_name"),
                "plant_id": r.get("plant_id"),
                "planting_id": r.get("planting_id"),
                "link": "/tasks",
                "priority": r.get("priority", "medium"),
            })

    # Sort events by date
    events.sort(key=lambda e: e.get("date", "9999-99-99"))

    # Build month summaries for the requested range
    summaries = []
    m, y = today.month, today.year
    for _ in range(months):
        key = (m, y)
        stats = month_stats.get(key, {"month": m, "year": y, "harvests": 0, "plantings": 0, "seed_starts": 0, "transplants": 0})
        summaries.append(stats)
        m += 1
        if m > 12:
            m = 1
            y += 1

    return {"events": events, "month_summaries": summaries}


# ──────────────── iCAL FEED ────────────────

def _ics_escape(text: str) -> str:
    """Escape special characters for iCalendar text fields."""
    if not text:
        return ""
    return text.replace("\\", "\\\\").replace(";", "\\;").replace(",", "\\,").replace("\n", "\\n")


def _ics_fold(line: str) -> str:
    """Fold long lines per RFC 5545 (max 75 octets per line)."""
    result = []
    while len(line.encode("utf-8")) > 75:
        # Find a safe split point
        cut = 75
        while cut > 0 and len(line[:cut].encode("utf-8")) > 75:
            cut -= 1
        if cut == 0:
            cut = 1
        result.append(line[:cut])
        line = " " + line[cut:]
    result.append(line)
    return "\r\n".join(result)


def _task_type_emoji(task_type: str, title: str = "") -> str:
    """Return emoji prefix based on task/event type."""
    title_lower = (title or "").lower()
    if task_type in ("harvest", "success"):
        return "\U0001F345"  # tomato
    if task_type == "planting_window" or task_type == "seed_opportunity":
        return "\U0001F331"  # seedling
    if "water" in title_lower:
        return "\U0001F4A7"  # droplet
    if "fertiliz" in title_lower or "amend" in title_lower or task_type == "amendment":
        return "\U0001F9EA"  # test tube
    if task_type in ("lifecycle_task", "task"):
        return "\U0001F4CB"  # clipboard
    if task_type == "transplant_ready":
        return "\U0001F331"  # seedling
    return "\U0001F4CB"  # clipboard


@router.get("/api/calendar/ical")
def calendar_ical_feed(types: Optional[str] = Query(None, description="Comma-separated event types to include: harvests,plantings,tasks,amendments,lifecycle. Omit for all.")):
    """Generate an iCalendar (.ics) feed of garden events, optionally filtered by type."""
    # Parse type filter
    allowed_types = {"harvests", "plantings", "tasks", "amendments", "lifecycle"}
    if types:
        type_filter = set(t.strip().lower() for t in types.split(",")) & allowed_types
        if not type_filter:
            type_filter = allowed_types  # invalid filter = return all
    else:
        type_filter = allowed_types  # no filter = return all

    today = date.today()
    year = today.year
    # Look 6 months ahead
    end_month = today.month + 6
    end_year = year
    while end_month > 12:
        end_month -= 12
        end_year += 1
    end_date = date(end_year, end_month, 1)

    ical_events = []

    with get_db() as db:
        # ── 1. Active plantings → expected harvest dates ──
        active_plantings = db.execute("""
            SELECT p.*, pl.name as plant_name, pl.category, pl.subcategory,
                   pl.days_to_maturity_min, pl.days_to_maturity_max,
                   b.name as bed_name, b.id as bed_id_ref
            FROM plantings p
            JOIN plants pl ON p.plant_id = pl.id
            LEFT JOIN garden_beds b ON p.bed_id = b.id
            WHERE p.status IN ('seeded', 'sprouted', 'growing', 'flowering', 'fruiting', 'established')
        """).fetchall()

        for row in active_plantings:
            r = dict(row)
            is_h, ss, sd = _get_harvest_flags(r["plant_name"], r.get("category", ""), r.get("subcategory", ""))
            harvest_date = r.get("expected_harvest_date")
            if not harvest_date and r.get("planted_date") and r.get("days_to_maturity_min"):
                try:
                    pd_val = date.fromisoformat(r["planted_date"])
                    avg_days = ((r["days_to_maturity_min"] or 60) + (r["days_to_maturity_max"] or r["days_to_maturity_min"] or 60)) // 2
                    harvest_date = (pd_val + timedelta(days=avg_days)).isoformat()
                except (ValueError, TypeError):
                    pass

            if harvest_date:
                try:
                    hd = date.fromisoformat(harvest_date)
                except (ValueError, TypeError):
                    continue
                if hd >= today and hd <= end_date:
                    bed_name = r.get("bed_name") or "Unknown bed"
                    planted_info = f" planted {r['planted_date']}" if r.get("planted_date") else ""
                    if is_h:
                        ical_events.append({
                            "uid": f"gg-harvest-planting-{r['id']}@garden-godmother",
                            "dtstart": harvest_date.replace("-", ""),
                            "summary": f"\U0001F345 Harvest {r['plant_name']} ({bed_name})",
                            "description": f"Expected harvest date for {r['plant_name']}{planted_info}",
                            "type": "harvest",
                        })
                    else:
                        ical_events.append({
                            "uid": f"gg-success-planting-{r['id']}@garden-godmother",
                            "dtstart": harvest_date.replace("-", ""),
                            "summary": f"\U0001F345 {r['plant_name']} {ss} ({bed_name})",
                            "description": f"{r['plant_name']} expected to {sd}{planted_info}",
                            "type": "harvest",
                        })

            # Planting window events
            plant_row = db.execute("SELECT * FROM plants WHERE id = ?", (r["plant_id"],)).fetchone()
            if plant_row:
                plant = row_to_dict(plant_row)
                sow = plant.get("desert_sow_outdoor")
                if sow:
                    try:
                        s = parse_md(sow[0], year)
                        e = parse_md(sow[1], year)
                        if s <= e and s >= today and s <= end_date:
                            ical_events.append({
                                "uid": f"gg-sowwindow-{r['plant_id']}-{year}@garden-godmother",
                                "dtstart": s.isoformat().replace("-", ""),
                                "summary": f"\U0001F331 Sow window opens: {r['plant_name']}",
                                "description": f"Direct sow window for {r['plant_name']} opens {s.isoformat()} through {e.isoformat()}",
                                "type": "planting",
                            })
                    except (ValueError, TypeError):
                        pass

        # ── 1b. Active ground plants → estimated maturity dates ──
        active_ground_plants = db.execute("""
            SELECT gp.*, p.name as plant_name, p.category, p.subcategory,
                   p.days_to_maturity_min, p.days_to_maturity_max,
                   a.name as area_name
            FROM ground_plants gp
            JOIN plants p ON gp.plant_id = p.id
            LEFT JOIN areas a ON gp.area_id = a.id
            WHERE gp.status IN ('planted', 'growing', 'established')
        """).fetchall()

        for row in active_ground_plants:
            r = dict(row)
            is_h, ss, sd = _get_harvest_flags(r["plant_name"], r.get("category", ""), r.get("subcategory", ""))
            if r.get("planted_date") and r.get("days_to_maturity_min"):
                try:
                    pd_val = date.fromisoformat(r["planted_date"])
                    avg_days = ((r["days_to_maturity_min"] or 60) + (r["days_to_maturity_max"] or r["days_to_maturity_min"] or 60)) // 2
                    maturity_date = (pd_val + timedelta(days=avg_days)).isoformat()
                    md = date.fromisoformat(maturity_date)
                    if md >= today and md <= end_date:
                        area_name = r.get("area_name") or "in ground"
                        gp_name = r.get("name") or r["plant_name"]
                        emoji = "\U0001F345" if is_h else "\U0001F345"
                        label = f"Harvest {gp_name}" if is_h else f"{gp_name} {ss}"
                        ical_events.append({
                            "uid": f"gg-harvest-gp-{r['id']}@garden-godmother",
                            "dtstart": maturity_date.replace("-", ""),
                            "summary": f"{emoji} {label} ({area_name})",
                            "description": f"Estimated maturity for {gp_name} planted {r['planted_date']}",
                            "type": "harvest",
                        })
                except (ValueError, TypeError):
                    pass

        # ── 2. Lifecycle tasks with due dates ──
        lifecycle_tasks = db.execute("""
            SELECT gt.*, pl.name as plant_name
            FROM garden_tasks gt
            LEFT JOIN plants pl ON gt.plant_id = pl.id
            WHERE gt.lifecycle_group_id IS NOT NULL
              AND gt.status IN ('pending', 'in_progress')
              AND gt.due_date IS NOT NULL
              AND gt.due_date >= ?
              AND gt.due_date < ?
            ORDER BY gt.due_date ASC
        """, (today.isoformat(), end_date.isoformat())).fetchall()

        for row in lifecycle_tasks:
            r = dict(row)
            emoji = _task_type_emoji("lifecycle_task", r.get("title", ""))
            plant_label = f" - {r['plant_name']}" if r.get("plant_name") else ""
            ical_events.append({
                "uid": f"gg-lifecycle-task-{r['id']}@garden-godmother",
                "dtstart": r["due_date"].replace("-", ""),
                "summary": f"{emoji} {r['title']}",
                "description": f"Lifecycle task{plant_label}. Priority: {r.get('priority', 'medium')}",
                "type": "lifecycle",
            })

        # ── 3. Pending tasks (non-lifecycle) ──
        tasks = db.execute("""
            SELECT gt.*, pl.name as plant_name
            FROM garden_tasks gt
            LEFT JOIN plants pl ON gt.plant_id = pl.id
            WHERE gt.lifecycle_group_id IS NULL
              AND gt.status IN ('pending', 'in_progress')
              AND gt.due_date IS NOT NULL
              AND gt.due_date >= ?
              AND gt.due_date < ?
            ORDER BY gt.due_date ASC
        """, (today.isoformat(), end_date.isoformat())).fetchall()

        for row in tasks:
            r = dict(row)
            emoji = _task_type_emoji(r.get("task_type", "task"), r.get("title", ""))
            plant_label = f" - {r['plant_name']}" if r.get("plant_name") else ""
            ical_events.append({
                "uid": f"gg-task-{r['id']}@garden-godmother",
                "dtstart": r["due_date"].replace("-", ""),
                "summary": f"{emoji} {r['title']}",
                "description": f"Garden task{plant_label}. Priority: {r.get('priority', 'medium')}",
                "type": "task",
            })

        # ── 4. Amendment reminders ──
        try:
            upcoming_amendments = db.execute("""
                SELECT sa.id, sa.bed_id, sa.ground_plant_id, sa.amendment_type, sa.product_name, sa.next_due_date,
                       gb.name as bed_name,
                       COALESCE(gp.name, p.name) as target_name
                FROM soil_amendments sa
                LEFT JOIN garden_beds gb ON sa.bed_id = gb.id
                LEFT JOIN ground_plants gp ON sa.ground_plant_id = gp.id
                LEFT JOIN plants p ON gp.plant_id = p.id
                WHERE sa.next_due_date IS NOT NULL
                  AND sa.next_due_date >= ?
                  AND sa.next_due_date <= ?
            """, (today.isoformat(), end_date.isoformat())).fetchall()

            for am in upcoming_amendments:
                amd = dict(am)
                target = amd.get("bed_name") or amd.get("target_name") or "garden"
                product = f" ({amd['product_name']})" if amd.get("product_name") else ""
                if amd["amendment_type"] in ("fertilizer", "fish_emulsion", "bone_meal", "worm_castings"):
                    title = f"Fertilize {target}"
                else:
                    title = f"Apply {amd['amendment_type'].replace('_', ' ')} to {target}"
                ical_events.append({
                    "uid": f"gg-amendment-{amd['id']}@garden-godmother",
                    "dtstart": amd["next_due_date"].replace("-", ""),
                    "summary": f"\U0001F9EA {title}",
                    "description": f"{amd['amendment_type'].replace('_', ' ').title()}{product} due on {amd['next_due_date']}",
                    "type": "amendment",
                })
        except Exception:
            pass

    # Map event types to filter categories
    _type_to_filter = {
        "harvest": "harvests",
        "planting": "plantings",
        "task": "tasks",
        "lifecycle": "lifecycle",
        "amendment": "amendments",
    }
    ical_events = [evt for evt in ical_events if _type_to_filter.get(evt.get("type", ""), "") in type_filter]

    # Dynamic calendar name based on filter
    _filter_cal_names = {
        frozenset({"harvests"}): "\U0001F345 Garden Harvests",
        frozenset({"plantings"}): "\U0001F331 Planting Windows",
        frozenset({"tasks"}): "\U0001F4CB Garden Tasks",
        frozenset({"amendments"}): "\U0001F9EA Soil Amendments",
        frozenset({"lifecycle"}): "\U0001F504 Lifecycle Plans",
    }
    cal_name = _filter_cal_names.get(frozenset(type_filter), "Garden Godmother")

    # Build ICS output
    now_stamp = datetime.utcnow().strftime("%Y%m%dT%H%M%SZ")
    lines = [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//Garden Godmother//EN",
        "CALSCALE:GREGORIAN",
        "METHOD:PUBLISH",
        f"X-WR-CALNAME:{cal_name}",
        f"X-WR-TIMEZONE:{_get_configured_timezone()}",
        "REFRESH-INTERVAL;VALUE=DURATION:PT1H",
        "X-PUBLISHED-TTL:PT1H",
    ]

    for evt in ical_events:
        dt = evt["dtstart"]
        # Ensure YYYYMMDD format
        if len(dt) == 8:
            dtstart = dt
        else:
            dtstart = dt.replace("-", "")[:8]
        # All-day event: DTEND is the next day
        try:
            d = date(int(dtstart[:4]), int(dtstart[4:6]), int(dtstart[6:8]))
            dtend = (d + timedelta(days=1)).strftime("%Y%m%d")
        except (ValueError, IndexError):
            dtend = dtstart

        lines.append("BEGIN:VEVENT")
        lines.append(f"UID:{evt['uid']}")
        lines.append(f"DTSTAMP:{now_stamp}")
        lines.append(f"DTSTART;VALUE=DATE:{dtstart}")
        lines.append(f"DTEND;VALUE=DATE:{dtend}")
        lines.append(_ics_fold(f"SUMMARY:{_ics_escape(evt['summary'])}"))
        if evt.get("description"):
            lines.append(_ics_fold(f"DESCRIPTION:{_ics_escape(evt['description'])}"))
        lines.append("TRANSP:TRANSPARENT")
        lines.append("END:VEVENT")

    lines.append("END:VCALENDAR")

    ics_content = "\r\n".join(lines) + "\r\n"

    return Response(
        content=ics_content,
        media_type="text/calendar",
        headers={
            "Content-Disposition": "inline; filename=garden-godmother.ics",
            "Cache-Control": "no-cache, no-store, must-revalidate",
            "Pragma": "no-cache",
            "Expires": "0",
        },
    )


@router.get("/api/calendar/ical/url")
def calendar_ical_url(request: Request):
    """Return subscription URLs for master and per-type calendar feeds."""
    # Derive base URL from the incoming request so it works on any domain
    base = f"{request.url.scheme}://{request.url.netloc}/api/calendar/ical"
    return {
        "master": {
            "url": base,
            "name": "Garden Godmother (All Events)",
        },
        "feeds": [
            {
                "type": "harvests",
                "url": f"{base}?types=harvests",
                "name": "\U0001F345 Garden Harvests",
                "description": "Expected harvest dates",
            },
            {
                "type": "plantings",
                "url": f"{base}?types=plantings",
                "name": "\U0001F331 Planting Windows",
                "description": "When to plant",
            },
            {
                "type": "tasks",
                "url": f"{base}?types=tasks",
                "name": "\U0001F4CB Garden Tasks",
                "description": "To-do items with due dates",
            },
            {
                "type": "amendments",
                "url": f"{base}?types=amendments",
                "name": "\U0001F9EA Soil Amendments",
                "description": "Fertilizer and amendment reminders",
            },
            {
                "type": "lifecycle",
                "url": f"{base}?types=lifecycle",
                "name": "\U0001F504 Lifecycle Plans",
                "description": "Seed-to-harvest milestones",
            },
        ],
        "instructions": {
            "google": "Open Google Calendar \u2192 Other calendars \u2192 From URL \u2192 paste the URL",
            "apple": "Open Calendar app \u2192 File \u2192 New Calendar Subscription \u2192 paste the URL",
            "outlook": "Settings \u2192 View all Outlook settings \u2192 Calendar \u2192 Shared calendars \u2192 Subscribe from web \u2192 paste the URL",
        },
    }


