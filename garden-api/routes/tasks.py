"""Task generation + management endpoints."""
from __future__ import annotations

import json
from datetime import date, datetime, timedelta
from typing import Optional

from fastapi import APIRouter, HTTPException, Query, Request
from fastapi.responses import Response

from db import get_db, row_to_dict
from auth import require_user, require_admin, get_request_user
from models import TaskCreate, TaskUpdate, LifecyclePlanRequest
from constants import (
    _get_harvest_flags, get_frost_dates_from_property, CURRENT_YEAR,
    _get_configured_timezone,
)
from services.integrations import get_ha_config
from routes.sensors import _fetch_forecast_sync, _analyze_forecast_weather

router = APIRouter()

# ──────────────── TASKS ────────────────





def _task_row_to_dict(row):
    return dict(row)


def _enrich_tasks(db, tasks):
    """Add plant_name, bed_name, tray_name to task dicts."""
    for t in tasks:
        if t.get("plant_id"):
            p = db.execute("SELECT name FROM plants WHERE id = ?", (t["plant_id"],)).fetchone()
            t["plant_name"] = p["name"] if p else None
        else:
            t["plant_name"] = None
        if t.get("bed_id"):
            b = db.execute("SELECT name FROM garden_beds WHERE id = ?", (t["bed_id"],)).fetchone()
            t["bed_name"] = b["name"] if b else None
        else:
            t["bed_name"] = None
        if t.get("tray_id"):
            tr = db.execute("SELECT name FROM seed_trays WHERE id = ?", (t["tray_id"],)).fetchone()
            t["tray_name"] = tr["name"] if tr else None
        else:
            t["tray_name"] = None
    return tasks


@router.get("/api/tasks")
def list_tasks(
    status: Optional[str] = None,
    priority: Optional[str] = None,
    task_type: Optional[str] = None,
    due_before: Optional[str] = None,
    due_after: Optional[str] = None,
    overdue: Optional[bool] = None,
    plant_id: Optional[int] = None,
    bed_id: Optional[int] = None,
):
    with get_db() as db:
        clauses = []
        params = []
        if status:
            clauses.append("status = ?")
            params.append(status)
        if priority:
            clauses.append("priority = ?")
            params.append(priority)
        if task_type:
            clauses.append("task_type = ?")
            params.append(task_type)
        if due_before:
            clauses.append("due_date <= ?")
            params.append(due_before)
        if due_after:
            clauses.append("due_date >= ?")
            params.append(due_after)
        if overdue:
            today_iso = date.today().isoformat()
            clauses.append("due_date < ? AND status NOT IN ('completed', 'skipped')")
            params.append(today_iso)
        if plant_id is not None:
            clauses.append("plant_id = ?")
            params.append(plant_id)
        if bed_id is not None:
            clauses.append("bed_id = ?")
            params.append(bed_id)
        where = " AND ".join(clauses)
        sql = "SELECT * FROM garden_tasks"
        if where:
            sql += " WHERE " + where
        sql += " ORDER BY CASE priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 WHEN 'low' THEN 3 END, due_date ASC NULLS LAST"
        rows = db.execute(sql, params).fetchall()
        tasks = [_task_row_to_dict(r) for r in rows]
        return _enrich_tasks(db, tasks)


@router.post("/api/tasks")
def create_task(task: TaskCreate):
    with get_db() as db:
        cursor = db.execute(
            """INSERT INTO garden_tasks (task_type, title, description, priority, due_date, plant_id, planting_id, bed_id, tray_id, notes, auto_generated, source)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 'manual')""",
            (task.task_type, task.title, task.description, task.priority, task.due_date,
             task.plant_id, task.planting_id, task.bed_id, task.tray_id, task.notes),
        )
        db.commit()
        row = db.execute("SELECT * FROM garden_tasks WHERE id = ?", (cursor.lastrowid,)).fetchone()
        tasks = [_task_row_to_dict(row)]
        return _enrich_tasks(db, tasks)[0]


@router.patch("/api/tasks/{task_id}")
def update_task(task_id: int, data: TaskUpdate):
    with get_db() as db:
        existing = db.execute("SELECT * FROM garden_tasks WHERE id = ?", (task_id,)).fetchone()
        if not existing:
            raise HTTPException(status_code=404, detail="Task not found")
        fields = []
        params = []
        for field_name in ("status", "priority", "due_date", "notes", "title", "description"):
            val = getattr(data, field_name)
            if val is not None:
                fields.append(f"{field_name} = ?")
                params.append(val)
        if not fields:
            raise HTTPException(status_code=400, detail="No fields to update")
        params.append(task_id)
        db.execute(f"UPDATE garden_tasks SET {', '.join(fields)} WHERE id = ?", params)
        db.commit()
        row = db.execute("SELECT * FROM garden_tasks WHERE id = ?", (task_id,)).fetchone()
        tasks = [_task_row_to_dict(row)]
        return _enrich_tasks(db, tasks)[0]


@router.delete("/api/tasks/{task_id}")
def delete_task(task_id: int):
    with get_db() as db:
        existing = db.execute("SELECT * FROM garden_tasks WHERE id = ?", (task_id,)).fetchone()
        if not existing:
            raise HTTPException(status_code=404, detail="Task not found")
        db.execute("DELETE FROM garden_tasks WHERE id = ?", (task_id,))
        db.commit()
        return {"deleted": True}


@router.post("/api/tasks/{task_id}/complete")
def complete_task(task_id: int):
    with get_db() as db:
        existing = db.execute("SELECT * FROM garden_tasks WHERE id = ?", (task_id,)).fetchone()
        if not existing:
            raise HTTPException(status_code=404, detail="Task not found")
        now = datetime.now().isoformat()
        db.execute("UPDATE garden_tasks SET status = 'completed', completed_date = ? WHERE id = ?", (now, task_id))
        db.commit()
        row = db.execute("SELECT * FROM garden_tasks WHERE id = ?", (task_id,)).fetchone()
        tasks = [_task_row_to_dict(row)]
        return _enrich_tasks(db, tasks)[0]


@router.post("/api/tasks/{task_id}/skip")
def skip_task(task_id: int):
    with get_db() as db:
        existing = db.execute("SELECT * FROM garden_tasks WHERE id = ?", (task_id,)).fetchone()
        if not existing:
            raise HTTPException(status_code=404, detail="Task not found")
        db.execute("UPDATE garden_tasks SET status = 'skipped' WHERE id = ?", (task_id,))
        db.commit()
        row = db.execute("SELECT * FROM garden_tasks WHERE id = ?", (task_id,)).fetchone()
        tasks = [_task_row_to_dict(row)]
        return _enrich_tasks(db, tasks)[0]


@router.post("/api/tasks/generate")
def generate_tasks():
    """Auto-generate tasks from planting calendar, seed inventory, plantings, sensor data, and pest alerts."""
    today = date.today()
    today_str = today.isoformat()
    four_weeks = (today + timedelta(days=28)).isoformat()
    created_count = 0

    with get_db() as db:
        def task_exists(task_type, plant_id=None, planting_id=None, bed_id=None, tray_id=None):
            sql = "SELECT id FROM garden_tasks WHERE task_type = ? AND status NOT IN ('completed', 'skipped')"
            params = [task_type]
            if plant_id is not None:
                sql += " AND plant_id = ?"
                params.append(plant_id)
            else:
                sql += " AND plant_id IS NULL"
            if planting_id is not None:
                sql += " AND planting_id = ?"
                params.append(planting_id)
            else:
                sql += " AND planting_id IS NULL"
            if bed_id is not None:
                sql += " AND bed_id = ?"
                params.append(bed_id)
            else:
                sql += " AND bed_id IS NULL"
            if tray_id is not None:
                sql += " AND tray_id = ?"
                params.append(tray_id)
            else:
                sql += " AND tray_id IS NULL"
            return db.execute(sql, params).fetchone() is not None

        def insert_task(task_type, title, description, priority, due_date, plant_id=None, planting_id=None, bed_id=None, tray_id=None, source="auto"):
            nonlocal created_count
            if task_exists(task_type, plant_id, planting_id, bed_id, tray_id):
                return
            db.execute(
                """INSERT INTO garden_tasks (task_type, title, description, priority, status, due_date, plant_id, planting_id, bed_id, tray_id, auto_generated, source)
                   VALUES (?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, 1, ?)""",
                (task_type, title, description, priority, due_date, plant_id, planting_id, bed_id, tray_id, source),
            )
            created_count += 1

        today_md = today.strftime("%m-%d")

        # 1. Purchase seeds: ONLY for plants with an active lifecycle plan that need seeds the user doesn't have
        # We do NOT auto-suggest buying seeds for every plantable plant — the shopping list handles suggestions.
        all_plants = db.execute("SELECT * FROM plants").fetchall()
        lifecycle_plant_ids = set()
        try:
            lc_rows = db.execute(
                """SELECT DISTINCT plant_id FROM garden_tasks
                   WHERE lifecycle_group_id IS NOT NULL
                   AND status IN ('pending', 'in_progress')
                   AND plant_id IS NOT NULL"""
            ).fetchall()
            lifecycle_plant_ids = {r["plant_id"] for r in lc_rows}
        except Exception:
            pass
        for plant_id in lifecycle_plant_ids:
            seed_count = db.execute(
                "SELECT COALESCE(SUM(quantity_seeds), 0) as total FROM seed_inventory WHERE plant_id = ?",
                (plant_id,)
            ).fetchone()["total"]
            if seed_count == 0:
                # Check if the lifecycle plan has a seed-start or direct-sow step (needs seeds)
                needs_seeds = db.execute(
                    """SELECT id FROM garden_tasks
                       WHERE lifecycle_group_id IS NOT NULL AND plant_id = ?
                       AND task_type IN ('start_seeds', 'direct_sow')
                       AND status IN ('pending', 'in_progress')
                       LIMIT 1""",
                    (plant_id,)
                ).fetchone()
                if needs_seeds:
                    plant_row = db.execute("SELECT name FROM plants WHERE id = ?", (plant_id,)).fetchone()
                    if plant_row:
                        insert_task(
                            "purchase_seeds",
                            f"Buy {plant_row['name']} seeds",
                            f"Active lifecycle plan needs seeds for {plant_row['name']} but none in inventory.",
                            "high",
                            today_str,
                            plant_id=plant_id,
                            source="auto:lifecycle_needs_seeds",
                        )

        # 2. Start seeds indoors — ONLY if the user has seeds in inventory for this plant
        for plant in all_plants:
            plant_d = dict(plant)
            weeks_before = plant_d.get("sow_indoor_weeks_before_transplant")
            transplant_raw = plant_d.get("desert_transplant")
            if weeks_before and transplant_raw:
                # Check seed inventory first — don't suggest starting seeds the user doesn't have
                seed_count = db.execute(
                    "SELECT COALESCE(SUM(quantity_seeds), 0) as total FROM seed_inventory WHERE plant_id = ?",
                    (plant_d["id"],)
                ).fetchone()["total"]
                if seed_count == 0:
                    continue
                try:
                    transplant_window = json.loads(transplant_raw)
                    if len(transplant_window) == 2:
                        t_start_str = f"{today.year}-{transplant_window[0]}"
                        try:
                            t_start = date.fromisoformat(t_start_str)
                        except ValueError:
                            continue
                        indoor_start = t_start - timedelta(weeks=weeks_before)
                        indoor_end = t_start - timedelta(weeks=max(1, weeks_before - 2))
                        if indoor_start <= today <= indoor_end:
                            insert_task(
                                "start_seeds",
                                f"Start {plant_d['name']} seeds indoors",
                                f"Start seeds {weeks_before} weeks before transplant window ({transplant_window[0]}). You have {seed_count} seeds in inventory.",
                                "high",
                                indoor_start.isoformat(),
                                plant_id=plant_d["id"],
                                source="auto:calendar",
                            )
                except (json.JSONDecodeError, TypeError):
                    pass

        # 3. Transplant: tray cells ready_to_transplant
        ready_cells = db.execute(
            """SELECT stc.*, st.name as tray_name, p.name as plant_name, stc.tray_id, stc.plant_id
               FROM seed_tray_cells stc
               JOIN seed_trays st ON stc.tray_id = st.id
               JOIN plants p ON stc.plant_id = p.id
               WHERE stc.status = 'ready_to_transplant'"""
        ).fetchall()
        for cell in ready_cells:
            cell_d = dict(cell)
            insert_task(
                "transplant",
                f"Transplant {cell_d['plant_name']} from {cell_d['tray_name']}",
                f"Seedlings in {cell_d['tray_name']} (row {cell_d['row']}, col {cell_d['col']}) are ready to transplant to a bed.",
                "high",
                today_str,
                plant_id=cell_d["plant_id"],
                tray_id=cell_d["tray_id"],
                source="auto:tray",
            )

        # 4. Direct sow: ONLY if user has seeds in inventory OR an active lifecycle plan with direct_sow method
        for plant in all_plants:
            plant_d = dict(plant)
            sow_raw = plant_d.get("desert_sow_outdoor")
            if sow_raw:
                # Check if user has seeds OR an active lifecycle plan for this plant
                seed_count = db.execute(
                    "SELECT COALESCE(SUM(quantity_seeds), 0) as total FROM seed_inventory WHERE plant_id = ?",
                    (plant_d["id"],)
                ).fetchone()["total"]
                has_lifecycle = db.execute(
                    """SELECT id FROM garden_tasks
                       WHERE lifecycle_group_id IS NOT NULL AND plant_id = ?
                       AND task_type = 'direct_sow'
                       AND status IN ('pending', 'in_progress')
                       LIMIT 1""",
                    (plant_d["id"],)
                ).fetchone()
                if seed_count == 0 and not has_lifecycle:
                    continue
                try:
                    sow_window = json.loads(sow_raw)
                    if len(sow_window) == 2:
                        start, end = sow_window
                        if start <= today_md <= end:
                            existing_planting = db.execute(
                                "SELECT id FROM plantings WHERE plant_id = ? AND year = ? AND status NOT IN ('removed', 'failed')",
                                (plant_d["id"], today.year),
                            ).fetchone()
                            existing_ground = db.execute(
                                "SELECT id FROM ground_plants WHERE plant_id = ? AND status NOT IN ('removed')",
                                (plant_d["id"],),
                            ).fetchone()
                            if not existing_planting and not existing_ground:
                                desc = f"{plant_d['name']} can be direct sown now (window: {start} to {end})."
                                if seed_count > 0:
                                    desc += f" You have {seed_count} seeds in inventory."
                                insert_task(
                                    "direct_sow",
                                    f"Direct sow {plant_d['name']}",
                                    desc,
                                    "medium",
                                    today_str,
                                    plant_id=plant_d["id"],
                                    source="auto:calendar",
                                )
                except (json.JSONDecodeError, TypeError):
                    pass

        # 5. Harvest / Success: plantings past expected harvest date
        #    Only create "harvest" tasks for harvestable plants.
        #    For non-harvestable (ornamental), create "success" tasks when they reach their success state.
        harvestable = db.execute(
            """SELECT pl.*, p.name as plant_name, p.category as plant_category,
                      p.subcategory as plant_subcategory, gb.name as bed_name
               FROM plantings pl
               JOIN plants p ON pl.plant_id = p.id
               LEFT JOIN garden_beds gb ON pl.bed_id = gb.id
               WHERE pl.expected_harvest_date IS NOT NULL
               AND pl.expected_harvest_date <= ?
               AND pl.status NOT IN ('harvested', 'established', 'removed', 'failed')""",
            (today_str,)
        ).fetchall()
        for pl in harvestable:
            pl_d = dict(pl)
            is_h, ss, sd = _get_harvest_flags(pl_d["plant_name"], pl_d.get("plant_category", ""), pl_d.get("plant_subcategory", ""))
            bed_desc = f" from {pl_d['bed_name']}" if pl_d.get("bed_name") else ""
            if is_h:
                insert_task(
                    "harvest",
                    f"Harvest {pl_d['plant_name']}{bed_desc}",
                    f"Expected harvest date was {pl_d['expected_harvest_date']}.",
                    "high",
                    pl_d["expected_harvest_date"],
                    plant_id=pl_d["plant_id"],
                    planting_id=pl_d["id"],
                    bed_id=pl_d.get("bed_id"),
                    source="auto:harvest",
                )
            else:
                insert_task(
                    "custom",
                    f"{pl_d['plant_name']} reached success: {sd}{bed_desc}",
                    f"{pl_d['plant_name']} is now {ss}. {sd}.",
                    "low",
                    pl_d["expected_harvest_date"],
                    plant_id=pl_d["plant_id"],
                    planting_id=pl_d["id"],
                    bed_id=pl_d.get("bed_id"),
                    source="auto:success",
                )

        # 6. Water tasks — smart generation with 10 rules
        # Rules:
        #   1. Auto-watered (rachio_controller/rachio_hose_timer) → NEVER generate water tasks
        #   2. Empty planters (no active plants) → NO water tasks
        #   3. irrigation_type='none' → NO water tasks
        #   4. Only manual (or NULL) irrigation with active plants → generate water tasks
        #   5. Seedlings (<14 days, seeded/sprouted) → water daily
        #   6. Season-aware frequency (AZ climate)
        #   7. No duplicate pending water tasks within watering interval
        #   8. Weather-aware (rain skip, extreme heat urgent)
        #   9. Seed trays: same rules — manual + has seeded/germinated cells
        #  10. Ground plants: manual + active status → water based on plant needs
        try:
            latest_temp = db.execute(
                "SELECT value FROM sensor_readings WHERE sensor_type = 'weather' AND sensor_name LIKE '%temperature%' ORDER BY recorded_at DESC LIMIT 1"
            ).fetchone()
            recent_rain = db.execute(
                "SELECT value FROM sensor_readings WHERE sensor_name LIKE '%rain%' AND recorded_at > datetime('now', '-24 hours') AND value > 0 LIMIT 1"
            ).fetchone()
            rain_today = recent_rain["value"] if recent_rain else 0.0
            temp_val = latest_temp["value"] if latest_temp and latest_temp["value"] else None

            # Fetch current wind speed from DB
            latest_wind = db.execute(
                "SELECT value FROM sensor_readings WHERE sensor_type = 'weather' AND sensor_name LIKE '%wind_speed%' ORDER BY recorded_at DESC LIMIT 1"
            ).fetchone()
            wind_val = latest_wind["value"] if latest_wind and latest_wind["value"] else None

            # Fetch multi-day forecast for smarter task generation
            forecast = _fetch_forecast_sync(days=5)
            wx = _analyze_forecast_weather(forecast, current_temp=temp_val, current_wind=wind_val, current_rain=rain_today)

            # ── Weather-based special tasks (forecast-aware) ──

            # Heat wave: generate "Prepare shade cloth" task if 3+ days above 105F
            if wx["heat_wave"]:
                temps_str = ", ".join(f"{t}\u00b0F" for t in wx["heat_wave_temps"])
                insert_task(
                    "custom",
                    "Prepare shade cloth for heat wave",
                    f"Heat wave forecast \u2014 {len(wx['heat_wave_temps'])} days above 105\u00b0F ({temps_str}). Install shade cloth over sensitive plants.",
                    "high",
                    today_str,
                    source="auto:weather",
                )

            # Frost risk: generate frost protection tasks
            if wx["frost_risk"]:
                frost_str = ", ".join(f"{d}: {t}\u00b0F" for d, t in wx["frost_risk_temps"])
                insert_task(
                    "custom",
                    "Protect plants from frost",
                    f"Frost risk \u2014 lows below 40\u00b0F in next 3 days ({frost_str}). Cover tender plants, move pots indoors, water soil deeply before freeze.",
                    "urgent",
                    today_str,
                    source="auto:weather",
                )

            # High wind: generate "Secure plants/stakes" task
            if wx["high_wind"]:
                insert_task(
                    "custom",
                    "Secure plants and stakes (high wind)",
                    f"High wind \u2014 {wx['high_wind_speed']}mph. Check stakes, trellises, and row covers. Delay granular fertilizer application.",
                    "high",
                    today_str,
                    source="auto:weather",
                )

            # High wind: skip fertilizer tasks (mark pending ones with wind warning)
            if wx["high_wind"]:
                pending_fert = db.execute(
                    "SELECT id, description FROM garden_tasks WHERE task_type = 'fertilize' AND status = 'pending' AND due_date = ?",
                    (today_str,)
                ).fetchall()
                for fert in pending_fert:
                    fert_d = dict(fert)
                    if "wind" not in (fert_d.get("description") or "").lower():
                        db.execute(
                            "UPDATE garden_tasks SET description = ?, due_date = ? WHERE id = ?",
                            (
                                (fert_d.get("description") or "") + f" [Delayed \u2014 high wind ({wx['high_wind_speed']}mph) would disperse granular fertilizer.]",
                                (today + timedelta(days=1)).isoformat(),
                                fert_d["id"],
                            ),
                        )

            # Season detection for AZ (Rule 6)
            month = today.month
            if month in (6, 7, 8, 9):
                season = "summer"
            elif month in (11, 12, 1, 2):
                season = "winter"
            else:
                season = "normal"  # spring (Mar-May) / fall (Oct)

            # Season-adjusted watering intervals (days between waterings)
            def get_water_interval(water_need, has_seedlings):
                """Return (interval_days, priority) based on water need, season, and seedling status."""
                if has_seedlings:
                    return (1, "high")  # Rule 5: seedlings always daily
                if season == "summer":
                    intervals = {"high": (1, "high"), "moderate": (2, "high"), "low": (3, "medium")}
                elif season == "winter":
                    intervals = {"high": (3, "medium"), "moderate": (5, "medium"), "low": (7, "low")}
                else:  # normal (spring/fall)
                    intervals = {"high": (1, "high"), "moderate": (3, "medium"), "low": (5, "low")}
                return intervals.get(water_need, (3, "medium"))

            def pending_water_task_exists(bed_id=None, tray_id=None, interval_days=1):
                """Rule 7: Check if a pending water task already exists within the next interval."""
                cutoff = (today + timedelta(days=interval_days)).isoformat()
                if bed_id is not None:
                    row = db.execute(
                        "SELECT id FROM garden_tasks WHERE task_type = 'water' AND bed_id = ? AND status IN ('pending', 'overdue') AND due_date >= ? AND due_date <= ?",
                        (bed_id, today_str, cutoff)
                    ).fetchone()
                elif tray_id is not None:
                    row = db.execute(
                        "SELECT id FROM garden_tasks WHERE task_type = 'water' AND tray_id = ? AND status IN ('pending', 'overdue') AND due_date >= ? AND due_date <= ?",
                        (tray_id, today_str, cutoff)
                    ).fetchone()
                else:
                    return False
                return row is not None

            def last_water_days_ago(bed_id=None, tray_id=None):
                """Days since last completed water task for this bed/tray."""
                if bed_id is not None:
                    last = db.execute(
                        "SELECT due_date FROM garden_tasks WHERE task_type = 'water' AND bed_id = ? AND status = 'completed' ORDER BY due_date DESC LIMIT 1",
                        (bed_id,)
                    ).fetchone()
                elif tray_id is not None:
                    last = db.execute(
                        "SELECT due_date FROM garden_tasks WHERE task_type = 'water' AND tray_id = ? AND status = 'completed' ORDER BY due_date DESC LIMIT 1",
                        (tray_id,)
                    ).fetchone()
                else:
                    return 999
                if not last:
                    return 999
                return (today - date.fromisoformat(last["due_date"])).days

            # ── 6a. Planter/bed water tasks (Rules 1-8) ──
            # Only manual or NULL irrigation beds
            manual_beds = db.execute(
                "SELECT id, name FROM garden_beds WHERE irrigation_type = 'manual' OR irrigation_type IS NULL"
            ).fetchall()

            for bed in manual_beds:
                bed_d = dict(bed)
                # Rule 2: Check for active plantings
                active_plantings = db.execute(
                    """SELECT pl.id, pl.status, pl.planted_date, p.water
                       FROM plantings pl
                       JOIN plants p ON pl.plant_id = p.id
                       WHERE pl.bed_id = ? AND pl.status IN ('seeded', 'sprouted', 'growing', 'flowering', 'fruiting', 'established')""",
                    (bed_d["id"],)
                ).fetchall()
                if not active_plantings:
                    continue  # Rule 2: empty bed, skip

                water_needs = [r["water"] for r in active_plantings if r["water"]]
                if not water_needs:
                    continue

                # Rule 5: detect seedlings (<14 days old, seeded/sprouted)
                has_seedlings = False
                for pl in active_plantings:
                    if pl["status"] in ("seeded", "sprouted") and pl["planted_date"]:
                        try:
                            days_old = (today - date.fromisoformat(pl["planted_date"])).days
                            if days_old < 14:
                                has_seedlings = True
                                break
                        except (ValueError, TypeError):
                            pass

                # Rule 8: Skip if significant rain today OR forecast rain in next 2 days (>0.25in)
                rain_skip = (rain_today and rain_today > 0.25) or wx.get("rain_skip", False)
                if rain_skip and not has_seedlings:
                    continue  # seedlings still need checking even with rain

                # Determine highest water need
                if "high" in water_needs:
                    top_need = "high"
                elif "moderate" in water_needs:
                    top_need = "moderate"
                else:
                    top_need = "low"

                interval, base_priority = get_water_interval(top_need, has_seedlings)

                # Rule 8: Extreme heat override (>110F = urgent for ALL manual beds with plants)
                if temp_val and temp_val > 110:
                    interval = 1
                    base_priority = "urgent"
                    reason = f"Urgent watering \u2014 {temp_val}\u00b0F high today."
                elif temp_val and temp_val > 100:
                    interval = 1
                    base_priority = "urgent" if top_need == "high" else "high"
                    reason = f"High heat ({temp_val}\u00b0F) \u2014 water today."
                elif has_seedlings:
                    reason = f"Seedlings in {bed_d['name']} need daily watering."
                else:
                    reason = f"{top_need.capitalize()}-water plants, {season} schedule: every {interval} day(s)."

                # Rule 7: Don't duplicate pending water tasks
                if pending_water_task_exists(bed_id=bed_d["id"], interval_days=interval):
                    continue

                # Check if enough time has passed since last completed watering
                days_ago = last_water_days_ago(bed_id=bed_d["id"])
                if days_ago < interval:
                    continue

                insert_task(
                    "water",
                    f"Water {bed_d['name']}",
                    reason,
                    base_priority,
                    today_str,
                    bed_id=bed_d["id"],
                    source="auto:weather",
                )

            # ── 6b. Seed tray water tasks (Rule 9) ──
            manual_trays = db.execute(
                "SELECT id, name FROM seed_trays WHERE irrigation_type = 'manual' OR irrigation_type IS NULL"
            ).fetchall()
            for tray in manual_trays:
                tray_d = dict(tray)
                # Only if tray has seeded or germinated cells
                active_cells = db.execute(
                    "SELECT COUNT(*) as c FROM seed_tray_cells WHERE tray_id = ? AND status IN ('seeded', 'germinated')",
                    (tray_d["id"],)
                ).fetchone()["c"]
                if active_cells == 0:
                    continue

                # Seed trays with active cells → daily watering (seedlings are delicate)
                interval = 1
                priority = "high"
                reason = f"{active_cells} active cell(s) in {tray_d['name']} need daily watering."

                if pending_water_task_exists(tray_id=tray_d["id"], interval_days=interval):
                    continue
                if last_water_days_ago(tray_id=tray_d["id"]) < interval:
                    continue

                # Rain doesn't help indoor trays
                insert_task(
                    "water",
                    f"Water {tray_d['name']}",
                    reason,
                    priority,
                    today_str,
                    tray_id=tray_d["id"],
                    source="auto:tray_water",
                )

            # ── 6c. Ground plant water tasks (Rule 10) ──
            manual_ground = db.execute(
                """SELECT gp.id, gp.name, gp.status, gp.planted_date, gp.irrigation_type, p.water, p.name as plant_name
                   FROM ground_plants gp
                   JOIN plants p ON gp.plant_id = p.id
                   WHERE (gp.irrigation_type = 'manual' OR gp.irrigation_type IS NULL)
                   AND gp.status IN ('planted', 'growing', 'established')"""
            ).fetchall()
            for gp in manual_ground:
                gp_d = dict(gp)
                water_need = gp_d.get("water") or "moderate"
                gp_name = gp_d.get("name") or gp_d.get("plant_name", "Ground plant")

                # Established plants (trees etc) → very infrequent (weekly max)
                if gp_d["status"] == "established":
                    interval = 7
                    priority = "low"
                    reason = f"Established {gp_name} — weekly deep watering check."
                else:
                    has_seedlings_gp = False
                    if gp_d.get("planted_date"):
                        try:
                            days_old = (today - date.fromisoformat(gp_d["planted_date"])).days
                            if days_old < 14 and gp_d["status"] == "planted":
                                has_seedlings_gp = True
                        except (ValueError, TypeError):
                            pass
                    interval, priority = get_water_interval(water_need, has_seedlings_gp)
                    if has_seedlings_gp:
                        reason = f"New {gp_name} needs daily watering to establish."
                    else:
                        reason = f"{gp_name} ({water_need} water), {season} schedule: every {interval} day(s)."

                # Extreme heat override for ground plants too
                if temp_val and temp_val > 110:
                    interval = 1
                    priority = "urgent"
                    reason = f"Urgent watering \u2014 {temp_val}\u00b0F high today. Water {gp_name} immediately."

                # Rain skip: today's rain OR forecast rain in next 2 days (but not for newly planted)
                rain_skip_gp = (rain_today and rain_today > 0.25) or wx.get("rain_skip", False)
                if rain_skip_gp and gp_d["status"] != "planted":
                    continue

                # Ground plants don't have bed_id in tasks, use plant_id for dedup
                # Check for existing pending water task with matching title
                existing = db.execute(
                    "SELECT id FROM garden_tasks WHERE task_type = 'water' AND title = ? AND status IN ('pending', 'overdue') AND due_date >= ?",
                    (f"Water {gp_name}", today_str)
                ).fetchone()
                if existing:
                    continue

                # Check last completed water task for this ground plant
                last = db.execute(
                    "SELECT due_date FROM garden_tasks WHERE task_type = 'water' AND title = ? AND status = 'completed' ORDER BY due_date DESC LIMIT 1",
                    (f"Water {gp_name}",)
                ).fetchone()
                if last and (today - date.fromisoformat(last["due_date"])).days < interval:
                    continue

                insert_task(
                    "water",
                    f"Water {gp_name}",
                    reason,
                    priority,
                    today_str,
                    plant_id=gp_d.get("plant_id") if "plant_id" in gp_d else None,
                    source="auto:ground_water",
                )

            # ── 6d. Low moisture sensor alerts — only for manual beds (unchanged) ──
            low_moisture = db.execute(
                """SELECT sensor_name, value FROM sensor_readings
                   WHERE sensor_type = 'moisture' AND value IS NOT NULL AND value < 30
                   AND recorded_at > datetime('now', '-6 hours')
                   ORDER BY recorded_at DESC"""
            ).fetchall()
            seen_beds_moisture = set()
            for reading in low_moisture:
                r = dict(reading)
                bed_match = db.execute(
                    """SELECT id, name, irrigation_type FROM garden_beds
                       WHERE (LOWER(name) LIKE '%' || LOWER(?) || '%' OR LOWER(?) LIKE '%' || LOWER(name) || '%')
                       AND (irrigation_type = 'manual' OR irrigation_type IS NULL)""",
                    (r["sensor_name"], r["sensor_name"])
                ).fetchone()
                if bed_match and bed_match["id"] not in seen_beds_moisture:
                    # Rule 2: also check bed has active plantings
                    has_plants = db.execute(
                        "SELECT id FROM plantings WHERE bed_id = ? AND status IN ('seeded', 'sprouted', 'growing', 'flowering', 'fruiting', 'established') LIMIT 1",
                        (bed_match["id"],)
                    ).fetchone()
                    if not has_plants:
                        continue
                    seen_beds_moisture.add(bed_match["id"])
                    if not pending_water_task_exists(bed_id=bed_match["id"], interval_days=1):
                        insert_task(
                            "water",
                            f"Water {bed_match['name']} (low moisture)",
                            f"Moisture sensor '{r['sensor_name']}' reads {r['value']}%.",
                            "high",
                            today_str,
                            bed_id=bed_match["id"],
                            source="auto:moisture",
                        )
        except Exception:
            pass

        # 6-cleanup. Remove bad water tasks that shouldn't exist
        # Auto-watered planters, empty planters, irrigation_type='none'
        try:
            # Delete pending/overdue water tasks for auto-watered beds
            db.execute("""
                DELETE FROM garden_tasks WHERE task_type = 'water' AND status IN ('pending', 'overdue')
                AND bed_id IN (SELECT id FROM garden_beds WHERE irrigation_type IN ('rachio_controller', 'rachio_hose_timer', 'none'))
            """)
            # Delete pending/overdue water tasks for empty beds (no active plantings)
            db.execute("""
                DELETE FROM garden_tasks WHERE task_type = 'water' AND status IN ('pending', 'overdue')
                AND bed_id IS NOT NULL
                AND bed_id NOT IN (
                    SELECT DISTINCT bed_id FROM plantings
                    WHERE bed_id IS NOT NULL AND status IN ('seeded', 'sprouted', 'growing', 'flowering', 'fruiting', 'established')
                )
            """)
            # Delete pending/overdue water tasks for auto-watered trays
            db.execute("""
                DELETE FROM garden_tasks WHERE task_type = 'water' AND status IN ('pending', 'overdue')
                AND tray_id IN (SELECT id FROM seed_trays WHERE irrigation_type IN ('rachio_hose_timer', 'none'))
            """)
            # Delete pending/overdue water tasks for empty trays (no seeded/germinated cells)
            db.execute("""
                DELETE FROM garden_tasks WHERE task_type = 'water' AND status IN ('pending', 'overdue')
                AND tray_id IS NOT NULL
                AND tray_id NOT IN (
                    SELECT DISTINCT tray_id FROM seed_tray_cells
                    WHERE status IN ('seeded', 'germinated')
                )
            """)
            # Delete pending/overdue water tasks for ground plants that switched to auto irrigation
            auto_ground = db.execute(
                "SELECT gp.name, p.name as plant_name FROM ground_plants gp JOIN plants p ON gp.plant_id = p.id WHERE gp.irrigation_type NOT IN ('manual') AND gp.irrigation_type IS NOT NULL"
            ).fetchall()
            for ag in auto_ground:
                gp_name = ag["name"] or ag["plant_name"]
                db.execute(
                    "DELETE FROM garden_tasks WHERE task_type = 'water' AND status IN ('pending', 'overdue') AND title = ?",
                    (f"Water {gp_name}",)
                )
        except Exception:
            pass

        # 7. Pest check: recent pest issues — ONLY for planters with active plants
        try:
            pest_notes = db.execute(
                """SELECT pn.*, pl.plant_id, pl.bed_id, p.name as plant_name, gb.name as bed_name
                   FROM planting_notes pn
                   JOIN plantings pl ON pn.planting_id = pl.id
                   JOIN plants p ON pl.plant_id = p.id
                   LEFT JOIN garden_beds gb ON pl.bed_id = gb.id
                   WHERE pn.note_type = 'pest_issue'
                   AND pn.severity IN ('warning', 'critical')
                   AND pn.recorded_at > datetime('now', '-7 days')
                   AND pl.status IN ('seeded', 'sprouted', 'growing', 'flowering', 'fruiting', 'established')"""
            ).fetchall()
            for note in pest_notes:
                n = dict(note)
                bed_desc = f" in {n['bed_name']}" if n.get("bed_name") else ""
                insert_task(
                    "pest_check",
                    f"Check {n['plant_name']}{bed_desc} for pests",
                    f"Recent pest issue noted: {n['content'][:100]}",
                    "urgent" if n.get("severity") == "critical" else "high",
                    today_str,
                    plant_id=n.get("plant_id"),
                    bed_id=n.get("bed_id"),
                    source="auto:pest_alert",
                )
        except Exception:
            pass

        # 9. Frost alert — check forecast for lows below 40F in next 3 days
        try:
            forecast_days = []
            if _ha_is_configured():
                import httpx as _httpx_sync
                with _httpx_sync.Client(timeout=10) as _fc:
                    _fr = _fc.post(
                        f"{_ha_url()}/api/services/weather/get_forecasts?return_response",
                        headers=_ha_headers(),
                        json={"entity_id": WEATHER_ENTITY, "type": "daily"},
                    )
                    if _fr.status_code == 200:
                        _fdata = _fr.json()
                        _sr = _fdata.get("service_response", _fdata)
                        _entity_data = _sr.get(WEATHER_ENTITY, {})
                        forecast_days = _entity_data.get("forecast", [])
                if not forecast_days:
                    # Fallback: entity state attributes
                    with _httpx_sync.Client(timeout=10) as _fc:
                        _sr2 = _fc.get(
                            f"{_ha_url()}/api/states/{WEATHER_ENTITY}",
                            headers=_ha_headers(),
                        )
                        if _sr2.status_code == 200:
                            forecast_days = _sr2.json().get("attributes", {}).get("forecast", [])

            # Check next 3 days for frost
            frost_tasks_created = []
            for entry in forecast_days[:3]:
                low_temp = entry.get("templow")
                if low_temp is None:
                    continue
                try:
                    low_f = float(low_temp)
                except (ValueError, TypeError):
                    continue
                if low_f < 40:
                    dt_str = entry.get("datetime", "")
                    try:
                        frost_date = datetime.fromisoformat(dt_str.replace("Z", "+00:00")).strftime("%Y-%m-%d")
                    except Exception:
                        frost_date = dt_str[:10] if len(dt_str) >= 10 else today_str
                    # Check if frost task already exists for this date
                    existing_frost = db.execute(
                        "SELECT id FROM garden_tasks WHERE task_type = 'custom' AND title LIKE '%Frost Protection%' AND status IN ('pending', 'overdue') AND due_date = ?",
                        (frost_date,)
                    ).fetchone()
                    if not existing_frost:
                        frost_priority = "urgent" if low_f < 32 else "high"
                        insert_task(
                            "custom",
                            f"Frost Protection \u2014 {low_f:.0f}\u00b0F forecast",
                            f"Low of {low_f:.0f}\u00b0F expected on {frost_date}. Cover tender plants, move potted plants under shelter, and check irrigation for freeze protection.",
                            frost_priority,
                            frost_date,
                            source="auto:frost_alert",
                        )
                        frost_tasks_created.append({"date": frost_date, "low_f": low_f, "priority": frost_priority})

            # Notify admins about new frost tasks
            if frost_tasks_created:
                try:
                    admins = db.execute("SELECT id FROM users WHERE role = 'admin' AND is_active = 1").fetchall()
                    for ft in frost_tasks_created:
                        for admin in admins:
                            asyncio.get_event_loop().call_soon_threadsafe(
                                lambda uid=admin["id"], lf=ft["low_f"], fd=ft["date"]: asyncio.ensure_future(
                                    send_notification(
                                        uid, "frost_warning",
                                        f"Frost Warning: {lf:.0f}\u00b0F",
                                        f"Temperature dropping to {lf:.0f}\u00b0F on {fd}. Cover tender plants!"
                                    )
                                )
                            )
                except Exception:
                    pass
        except Exception:
            pass

        # Cleanup: delete auto-generated purchase_seeds/start_seeds/direct_sow tasks
        # that don't match any seed inventory or active lifecycle plan
        try:
            # Delete all pending auto-generated purchase_seeds that aren't tied to a lifecycle plan needing seeds
            db.execute("""
                DELETE FROM garden_tasks
                WHERE task_type = 'purchase_seeds' AND auto_generated = 1
                AND status IN ('pending', 'overdue')
                AND (plant_id IS NULL OR plant_id NOT IN (
                    SELECT DISTINCT gt2.plant_id FROM garden_tasks gt2
                    WHERE gt2.lifecycle_group_id IS NOT NULL
                    AND gt2.task_type IN ('start_seeds', 'direct_sow')
                    AND gt2.status IN ('pending', 'in_progress')
                    AND gt2.plant_id IS NOT NULL
                ))
            """)
            # Delete all pending auto-generated start_seeds where user has no seeds
            db.execute("""
                DELETE FROM garden_tasks
                WHERE task_type = 'start_seeds' AND auto_generated = 1
                AND status IN ('pending', 'overdue')
                AND lifecycle_group_id IS NULL
                AND (plant_id IS NULL OR plant_id NOT IN (
                    SELECT DISTINCT plant_id FROM seed_inventory WHERE quantity_seeds > 0
                ))
            """)
            # Delete all pending auto-generated direct_sow where user has no seeds AND no lifecycle plan
            db.execute("""
                DELETE FROM garden_tasks
                WHERE task_type = 'direct_sow' AND auto_generated = 1
                AND status IN ('pending', 'overdue')
                AND lifecycle_group_id IS NULL
                AND (plant_id IS NULL OR (
                    plant_id NOT IN (
                        SELECT DISTINCT plant_id FROM seed_inventory WHERE quantity_seeds > 0
                    )
                    AND plant_id NOT IN (
                        SELECT DISTINCT plant_id FROM garden_tasks
                        WHERE lifecycle_group_id IS NOT NULL
                        AND task_type = 'direct_sow'
                        AND status IN ('pending', 'in_progress')
                        AND plant_id IS NOT NULL
                    )
                ))
            """)
        except Exception:
            pass

        # 8. Amendment reminders — auto-generate fertilize tasks from soil_amendments.next_due_date
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
                  AND sa.next_due_date <= ?
                  AND sa.next_due_date >= ?
            """, (four_weeks, today_str)).fetchall()
            for am in upcoming_amendments:
                amd = dict(am)
                target = amd.get("bed_name") or amd.get("target_name") or "garden"
                product = f" ({amd['product_name']})" if amd.get("product_name") else ""
                title = f"Fertilize {target}" if amd["amendment_type"] in ("fertilizer", "fish_emulsion", "bone_meal", "worm_castings") else f"Apply {amd['amendment_type']} to {target}"
                desc = f"{amd['amendment_type'].replace('_', ' ').title()}{product} due on {amd['next_due_date']}."
                days_until = (date.fromisoformat(amd["next_due_date"]) - today).days
                priority = "high" if days_until <= 3 else "medium"
                insert_task(
                    "fertilize",
                    title,
                    desc,
                    priority,
                    amd["next_due_date"],
                    bed_id=amd.get("bed_id"),
                    source="auto:amendment",
                )
        except Exception:
            pass

        # ── Template-based tasks ──
        try:
            templates = db.execute("SELECT * FROM plant_task_templates").fetchall()
            for template in templates:
                t = dict(template)
                # Find active plantings matching this plant
                if t["plant_id"]:
                    plantings = db.execute(
                        "SELECT p.*, pl.name as plant_name FROM plantings p JOIN plants pl ON p.plant_id = pl.id WHERE p.plant_id = ? AND p.status NOT IN ('removed','died','harvested')",
                        (t["plant_id"],)
                    ).fetchall()
                else:
                    plantings = db.execute(
                        "SELECT p.*, pl.name as plant_name FROM plantings p JOIN plants pl ON p.plant_id = pl.id WHERE pl.name = ? AND p.status NOT IN ('removed','died','harvested')",
                        (t["plant_name"],)
                    ).fetchall()

                for planting in plantings:
                    p = dict(planting)
                    planted_date = p.get("effective_planted_date") or p.get("planted_date")
                    if not planted_date:
                        continue

                    title = t["title_template"].replace("{plant_name}", p["plant_name"])

                    if t["trigger_type"] == "days_after_planting":
                        days = int(t["trigger_value"])
                        due = (date.fromisoformat(planted_date) + timedelta(days=days)).isoformat()
                        if due < today_str:
                            continue  # Past due date for one-time tasks
                        # Check if already exists
                        existing = db.execute(
                            "SELECT id FROM garden_tasks WHERE title = ? AND plant_id = ? AND bed_id = ? AND status IN ('pending','overdue')",
                            (title, p["plant_id"], p.get("bed_id"))
                        ).fetchone()
                        if not existing:
                            insert_task(t["task_type"], title, t["description_template"] or "", t["priority"], due,
                                       plant_id=p["plant_id"], bed_id=p.get("bed_id"), source="auto:template")

                    elif t["trigger_type"] == "recurring":
                        interval = int(t["trigger_value"])
                        # Check last completed/pending
                        last = db.execute(
                            "SELECT due_date FROM garden_tasks WHERE title = ? AND plant_id = ? AND bed_id = ? ORDER BY due_date DESC LIMIT 1",
                            (title, p["plant_id"], p.get("bed_id"))
                        ).fetchone()
                        if last:
                            next_due = (date.fromisoformat(last["due_date"]) + timedelta(days=interval)).isoformat()
                        else:
                            next_due = today_str
                        if next_due <= today_str or (not last):
                            existing = db.execute(
                                "SELECT id FROM garden_tasks WHERE title = ? AND plant_id = ? AND status IN ('pending','overdue')",
                                (title, p["plant_id"])
                            ).fetchone()
                            if not existing:
                                insert_task(t["task_type"], title, t["description_template"] or "", t["priority"], next_due,
                                           plant_id=p["plant_id"], bed_id=p.get("bed_id"), source="auto:template")

                    elif t["trigger_type"] == "growth_stage":
                        if p.get("status") == t["trigger_value"]:
                            existing = db.execute(
                                "SELECT id FROM garden_tasks WHERE title = ? AND plant_id = ? AND bed_id = ? AND status IN ('pending','overdue')",
                                (title, p["plant_id"], p.get("bed_id"))
                            ).fetchone()
                            if not existing:
                                insert_task(t["task_type"], title, t["description_template"] or "", t["priority"], today_str,
                                           plant_id=p["plant_id"], bed_id=p.get("bed_id"), source="auto:template")

                    elif t["trigger_type"] == "one_time":
                        days = int(t["trigger_value"])
                        due = (date.fromisoformat(planted_date) + timedelta(days=days)).isoformat()
                        existing = db.execute(
                            "SELECT id FROM garden_tasks WHERE title = ? AND plant_id = ? AND bed_id = ?",
                            (title, p["plant_id"], p.get("bed_id"))
                        ).fetchone()
                        if not existing:
                            insert_task(t["task_type"], title, t["description_template"] or "", t["priority"], due,
                                       plant_id=p["plant_id"], bed_id=p.get("bed_id"), source="auto:template")
        except Exception:
            pass

        # Mark overdue tasks
        db.execute(
            "UPDATE garden_tasks SET status = 'overdue' WHERE due_date < ? AND status = 'pending'",
            (today_str,)
        )

        db.commit()
        return {"tasks_created": created_count}


@router.get("/api/tasks/templates")
def list_task_templates(request: Request):
    """List all plant task templates."""
    require_user(request)
    with get_db() as db:
        rows = db.execute("SELECT * FROM plant_task_templates ORDER BY plant_name, trigger_type").fetchall()
        return [dict(r) for r in rows]


@router.get("/api/tasks/weather-insights")
def get_weather_insights(request: Request):
    """Return weather-based task adjustment summary with forecast analysis."""
    require_user(request)

    # Current sensor readings from DB
    with get_db() as db:
        latest_temp = db.execute(
            "SELECT value FROM sensor_readings WHERE sensor_type = 'weather' AND sensor_name LIKE '%temperature%' ORDER BY recorded_at DESC LIMIT 1"
        ).fetchone()
        latest_wind = db.execute(
            "SELECT value FROM sensor_readings WHERE sensor_type = 'weather' AND sensor_name LIKE '%wind_speed%' ORDER BY recorded_at DESC LIMIT 1"
        ).fetchone()
        recent_rain = db.execute(
            "SELECT value FROM sensor_readings WHERE sensor_name LIKE '%rain%' AND recorded_at > datetime('now', '-24 hours') AND value > 0 LIMIT 1"
        ).fetchone()

    temp_val = latest_temp["value"] if latest_temp and latest_temp["value"] else None
    wind_val = latest_wind["value"] if latest_wind and latest_wind["value"] else None
    rain_today = recent_rain["value"] if recent_rain else 0.0

    # Fetch forecast and analyze
    forecast = _fetch_forecast_sync(days=5)
    wx = _analyze_forecast_weather(forecast, current_temp=temp_val, current_wind=wind_val, current_rain=rain_today)

    # Build adjustments list
    adjustments = []
    if wx["rain_skip"]:
        adjustments.append({
            "type": "rain_skip",
            "action": "Watering tasks skipped",
            "reason": wx["rain_skip_reason"],
            "rain_forecast_inches": wx["rain_forecast_2d"],
        })
    if wx["heat_wave"]:
        adjustments.append({
            "type": "heat_wave",
            "action": "Shade cloth task generated",
            "reason": f"Heat wave: {', '.join(str(t) for t in wx['heat_wave_temps'])}\u00b0F",
            "temps": wx["heat_wave_temps"],
        })
    if wx["frost_risk"]:
        adjustments.append({
            "type": "frost_risk",
            "action": "Frost protection task generated",
            "reason": "Frost risk: " + ", ".join(f"{d} {t}\u00b0F" for d, t in wx["frost_risk_temps"]),
            "dates": [{"date": d, "low_f": t} for d, t in wx["frost_risk_temps"]],
        })
    if wx["high_wind"]:
        adjustments.append({
            "type": "high_wind",
            "action": "Secure plants task generated, fertilizer tasks delayed",
            "reason": f"Wind speed: {wx['high_wind_speed']}mph",
            "wind_speed_mph": wx["high_wind_speed"],
        })
    if temp_val and temp_val > 110:
        adjustments.append({
            "type": "extreme_heat",
            "action": "All watering tasks marked urgent",
            "reason": f"Current temperature: {temp_val}\u00b0F",
        })

    return {
        "current": {
            "temperature_f": temp_val,
            "wind_speed_mph": wind_val,
            "rain_today_in": rain_today,
        },
        "forecast": forecast[:5],
        "analysis": {
            "rain_forecast_2d_in": wx["rain_forecast_2d"],
            "rain_skip": wx["rain_skip"],
            "heat_wave": wx["heat_wave"],
            "frost_risk": wx["frost_risk"],
            "high_wind": wx["high_wind"],
        },
        "adjustments": adjustments,
        "insights": wx["insights"],
    }


@router.get("/api/tasks/today")
def tasks_today():
    today_str = date.today().isoformat()
    with get_db() as db:
        rows = db.execute(
            """SELECT * FROM garden_tasks
               WHERE (due_date <= ? OR status = 'overdue') AND status NOT IN ('completed', 'skipped')
               ORDER BY CASE priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 WHEN 'low' THEN 3 END, due_date ASC""",
            (today_str,)
        ).fetchall()
        tasks = [_task_row_to_dict(r) for r in rows]
        # Belt + suspenders: filter out water tasks for auto-watered or empty planters
        filtered = []
        for t in tasks:
            if t.get("task_type") == "water":
                if t.get("bed_id"):
                    bed = db.execute("SELECT irrigation_type FROM garden_beds WHERE id = ?", (t["bed_id"],)).fetchone()
                    if bed and bed["irrigation_type"] in ("rachio_controller", "rachio_hose_timer", "none"):
                        continue
                    has_plants = db.execute(
                        "SELECT id FROM plantings WHERE bed_id = ? AND status IN ('seeded', 'sprouted', 'growing', 'flowering', 'fruiting', 'established') LIMIT 1",
                        (t["bed_id"],)
                    ).fetchone()
                    if not has_plants:
                        continue
                if t.get("tray_id"):
                    tray = db.execute("SELECT irrigation_type FROM seed_trays WHERE id = ?", (t["tray_id"],)).fetchone()
                    if tray and tray["irrigation_type"] in ("rachio_hose_timer", "none"):
                        continue
                    has_cells = db.execute(
                        "SELECT id FROM seed_tray_cells WHERE tray_id = ? AND status IN ('seeded', 'germinated') LIMIT 1",
                        (t["tray_id"],)
                    ).fetchone()
                    if not has_cells:
                        continue
            filtered.append(t)
        return _enrich_tasks(db, filtered)


@router.get("/api/tasks/week")
def tasks_week():
    today = date.today()
    today_str = today.isoformat()
    week_end = (today + timedelta(days=7)).isoformat()
    with get_db() as db:
        rows = db.execute(
            """SELECT * FROM garden_tasks
               WHERE ((due_date >= ? AND due_date <= ?) OR status = 'overdue') AND status NOT IN ('completed', 'skipped')
               ORDER BY due_date ASC, CASE priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 WHEN 'low' THEN 3 END""",
            (today_str, week_end)
        ).fetchall()
        tasks = [_task_row_to_dict(r) for r in rows]
        enriched = _enrich_tasks(db, tasks)
        grouped: dict[str, list] = {}
        for t in enriched:
            day = t.get("due_date") or "unscheduled"
            grouped.setdefault(day, []).append(t)
        return grouped


@router.get("/api/tasks/summary")
def tasks_summary():
    today_str = date.today().isoformat()
    week_end = (date.today() + timedelta(days=7)).isoformat()
    with get_db() as db:
        total = db.execute("SELECT COUNT(*) as c FROM garden_tasks").fetchone()["c"]
        by_status = db.execute("SELECT status, COUNT(*) as c FROM garden_tasks GROUP BY status").fetchall()
        overdue = db.execute(
            "SELECT COUNT(*) as c FROM garden_tasks WHERE (status = 'overdue' OR (due_date < ? AND status = 'pending'))",
            (today_str,)
        ).fetchone()["c"]
        due_today = db.execute(
            "SELECT COUNT(*) as c FROM garden_tasks WHERE due_date = ? AND status NOT IN ('completed', 'skipped')",
            (today_str,)
        ).fetchone()["c"]
        due_this_week = db.execute(
            "SELECT COUNT(*) as c FROM garden_tasks WHERE due_date >= ? AND due_date <= ? AND status NOT IN ('completed', 'skipped')",
            (today_str, week_end)
        ).fetchone()["c"]
        return {
            "total": total,
            "by_status": {r["status"]: r["c"] for r in by_status},
            "overdue": overdue,
            "due_today": due_today,
            "due_this_week": due_this_week,
        }



# ──────────────── LIFECYCLE PLANNER ────────────────



def _lifecycle_task_type(label: str) -> str:
    """Map a lifecycle step label to a valid garden_tasks.task_type."""
    mapping = {
        "start_seeds": "start_seeds",
        "water_seed": "water",
        "check_germination": "custom",
        "thin_seedlings": "custom",
        "harden_off": "custom",
        "transplant": "transplant",
        "water_transplant": "water",
        "fertilize": "fertilize",
        "watch_flowers": "custom",
        "harvest_check": "harvest",
        "harvest": "harvest",
        "direct_sow": "direct_sow",
        "water_sow": "water",
        "purchase_starts": "purchase_seeds",
        "harden_purchased": "custom",
    }
    return mapping.get(label, "custom")


def _build_lifecycle_tasks(plant: dict, method: str, start: date,
                           target_bed_id: Optional[int], target_cell_x: Optional[int],
                           target_cell_y: Optional[int], tray_id: Optional[int],
                           bed_name: Optional[str]) -> list[dict]:
    """Build the ordered list of lifecycle task dicts (not yet inserted)."""
    plant_name = plant["name"]
    is_harvestable, success_state, success_desc = _get_harvest_flags(
        plant_name, plant.get("category", ""), plant.get("subcategory", ""))
    bed_label = f"{bed_name} cell ({target_cell_x},{target_cell_y})" if bed_name and target_cell_x is not None else (bed_name or "bed")
    days_to_maturity_min = plant.get("days_to_maturity_min") or 60
    days_to_maturity_max = plant.get("days_to_maturity_max") or days_to_maturity_min + 14
    days_avg = (days_to_maturity_min + days_to_maturity_max) // 2

    tasks: list[dict] = []

    def add(label: str, title: str, desc: str, priority: str, due: date,
            task_plant_id: int = plant["id"], bed_id: Optional[int] = None,
            t_id: Optional[int] = None):
        tasks.append({
            "label": label,
            "task_type": _lifecycle_task_type(label),
            "title": title,
            "description": desc,
            "priority": priority,
            "due_date": due.isoformat(),
            "plant_id": task_plant_id,
            "bed_id": bed_id,
            "tray_id": t_id,
        })

    if method == "seed":
        # Indoor seed starting sequence
        add("start_seeds", f"Start {plant_name} seeds indoors",
            f"Plant {plant_name} seeds in seed tray. Keep moist and warm (70-80F).",
            "high", start, t_id=tray_id)
        add("water_seed", f"Water {plant_name} seed tray",
            "Keep soil evenly moist but not waterlogged.", "medium", start, t_id=tray_id)
        add("check_germination", f"Check {plant_name} for germination",
            f"Look for first sprouts emerging from soil. {plant_name} typically germinates in 7-14 days.",
            "medium", start + timedelta(days=10), t_id=tray_id)
        add("thin_seedlings", f"Thin {plant_name} seedlings to strongest",
            "Remove weaker seedlings, keeping the strongest in each cell.", "medium",
            start + timedelta(days=18), t_id=tray_id)

        # Calculate transplant date: ~4-6 weeks from seed start depending on plant
        weeks_before = plant.get("sow_indoor_weeks_before_transplant") or 4
        transplant_date = start + timedelta(weeks=weeks_before)

        # Hardening off sequence
        add("harden_off", f"Begin hardening off {plant_name} — move outside 2hrs in shade",
            "Start acclimating seedlings to outdoor conditions gradually.", "high",
            transplant_date - timedelta(days=10), t_id=tray_id)
        add("harden_off", f"Increase {plant_name} outdoor time to 4hrs with some sun",
            "Gradually increase sun exposure.", "medium",
            transplant_date - timedelta(days=7), t_id=tray_id)
        add("harden_off", f"{plant_name}: full day outside, bring in at night",
            "Nearly ready for transplant. Leave outside during the day.", "medium",
            transplant_date - timedelta(days=4), t_id=tray_id)
        add("harden_off", f"Leave {plant_name} outside overnight (if no frost risk)",
            "Final hardening step before transplant.", "medium",
            transplant_date - timedelta(days=1), t_id=tray_id)

        # Transplant
        add("transplant", f"Transplant {plant_name} to {bed_label}",
            f"Dig hole twice the size of root ball. Water well before and after transplanting.",
            "high", transplant_date, bed_id=target_bed_id, t_id=tray_id)
        add("water_transplant", f"Water {plant_name} deeply after transplanting",
            "Thorough deep watering to settle roots.", "high", transplant_date,
            bed_id=target_bed_id)

        # Post-transplant care
        base_date = transplant_date
        add("fertilize", f"First fertilize {plant_name}",
            "Apply balanced fertilizer one week after transplant.", "medium",
            base_date + timedelta(days=7), bed_id=target_bed_id)

        # Flower/fruit watch
        flower_day = days_avg // 2
        add("watch_flowers", f"Watch for first {plant_name} flowers/fruit",
            f"Around {flower_day} days after transplant, watch for flowering.", "low",
            base_date + timedelta(days=flower_day), bed_id=target_bed_id)

        # Harvest (only for harvestable plants) / Success checkpoint for ornamentals
        if is_harvestable:
            harvest_start = base_date + timedelta(days=days_to_maturity_min)
            harvest_end = base_date + timedelta(days=days_to_maturity_max)
            add("harvest_check", f"Begin checking {plant_name} for harvest daily",
                f"Expected maturity {days_to_maturity_min}-{days_to_maturity_max} days after transplant.",
                "medium", harvest_start, bed_id=target_bed_id)
            d = harvest_start + timedelta(days=3)
            while d <= harvest_end:
                add("harvest", f"Harvest {plant_name}",
                    "Check for ripe produce and harvest.", "medium", d, bed_id=target_bed_id)
                d += timedelta(days=3)
        else:
            success_date = base_date + timedelta(days=days_to_maturity_min)
            add("watch_flowers", f"Check {plant_name} — should be {success_state} soon",
                f"{success_desc}. Expected around {days_to_maturity_min} days after transplant.",
                "low", success_date, bed_id=target_bed_id)

    elif method == "direct_sow":
        add("direct_sow", f"Direct sow {plant_name} in {bed_label}",
            f"Sow {plant_name} seeds directly into the bed at proper depth and spacing.",
            "high", start, bed_id=target_bed_id)
        add("water_sow", f"Water {plant_name} after sowing",
            "Water gently to avoid displacing seeds.", "high", start, bed_id=target_bed_id)
        add("check_germination", f"Check {plant_name} for germination",
            "Look for sprouts emerging. Keep soil moist.", "medium",
            start + timedelta(days=8), bed_id=target_bed_id)
        add("thin_seedlings", f"Thin {plant_name} seedlings",
            f"Thin to proper spacing ({plant.get('spacing_inches', '?')} inches).", "medium",
            start + timedelta(days=14), bed_id=target_bed_id)
        add("fertilize", f"First fertilize {plant_name}",
            "Apply balanced fertilizer.", "medium",
            start + timedelta(days=21), bed_id=target_bed_id)

        flower_day = days_avg // 2
        add("watch_flowers", f"Watch for first {plant_name} flowers/fruit",
            "Monitor for flowering and fruit set.", "low",
            start + timedelta(days=flower_day), bed_id=target_bed_id)

        if is_harvestable:
            harvest_start = start + timedelta(days=days_to_maturity_min)
            harvest_end = start + timedelta(days=days_to_maturity_max)
            add("harvest_check", f"Begin checking {plant_name} for harvest daily",
                f"Expected maturity {days_to_maturity_min}-{days_to_maturity_max} days from sowing.",
                "medium", harvest_start, bed_id=target_bed_id)
            d = harvest_start + timedelta(days=3)
            while d <= harvest_end:
                add("harvest", f"Harvest {plant_name}",
                    "Check for ripe produce and harvest.", "medium", d, bed_id=target_bed_id)
                d += timedelta(days=3)
        else:
            success_date = start + timedelta(days=days_to_maturity_min)
            add("watch_flowers", f"Check {plant_name} — should be {success_state} soon",
                f"{success_desc}. Expected around {days_to_maturity_min} days from sowing.",
                "low", success_date, bed_id=target_bed_id)

    elif method == "transplant":
        # Buying starts from nursery
        add("purchase_starts", f"Purchase {plant_name} starts from nursery",
            "Buy healthy transplants. Look for compact growth, no yellowing.", "high", start)
        add("harden_purchased", f"Harden off purchased {plant_name} starts",
            "Even nursery starts benefit from a few days of acclimation to your yard.", "medium",
            start + timedelta(days=3))
        transplant_date = start + timedelta(days=7)
        add("transplant", f"Transplant {plant_name} to {bed_label}",
            "Dig hole twice root ball size. Water before and after.", "high",
            transplant_date, bed_id=target_bed_id)
        add("water_transplant", f"Water {plant_name} deeply after transplanting",
            "Thorough deep watering to settle roots.", "high", transplant_date,
            bed_id=target_bed_id)
        add("fertilize", f"First fertilize {plant_name}",
            "Apply balanced fertilizer one week after transplant.", "medium",
            transplant_date + timedelta(days=7), bed_id=target_bed_id)

        flower_day = days_avg // 2
        add("watch_flowers", f"Watch for first {plant_name} flowers/fruit",
            "Monitor for flowering.", "low",
            transplant_date + timedelta(days=flower_day), bed_id=target_bed_id)

        if is_harvestable:
            harvest_start = transplant_date + timedelta(days=days_to_maturity_min)
            harvest_end = transplant_date + timedelta(days=days_to_maturity_max)
            add("harvest_check", f"Begin checking {plant_name} for harvest daily",
                f"Expected maturity {days_to_maturity_min}-{days_to_maturity_max} days after transplant.",
                "medium", harvest_start, bed_id=target_bed_id)
            d = harvest_start + timedelta(days=3)
            while d <= harvest_end:
                add("harvest", f"Harvest {plant_name}",
                    "Check for ripe produce and harvest.", "medium", d, bed_id=target_bed_id)
                d += timedelta(days=3)
        else:
            success_date = transplant_date + timedelta(days=days_to_maturity_min)
            add("watch_flowers", f"Check {plant_name} — should be {success_state} soon",
                f"{success_desc}. Expected around {days_to_maturity_min} days after transplant.",
                "low", success_date, bed_id=target_bed_id)

    return tasks


@router.post("/api/lifecycle/plan")
def create_lifecycle_plan(req: LifecyclePlanRequest):
    """Generate a full lifecycle plan from seed/sow/transplant through harvest."""
    if req.method not in ("seed", "direct_sow", "transplant"):
        raise HTTPException(status_code=400, detail="method must be 'seed', 'direct_sow', or 'transplant'")

    start = date.fromisoformat(req.start_date) if req.start_date else date.today()
    lifecycle_id = str(uuid.uuid4())

    with get_db() as db:
        plant_row = db.execute("SELECT * FROM plants WHERE id = ?", (req.plant_id,)).fetchone()
        if not plant_row:
            raise HTTPException(status_code=404, detail="Plant not found")
        plant = row_to_dict(plant_row)

        bed_name = None
        if req.target_bed_id:
            bed_row = db.execute("SELECT name FROM garden_beds WHERE id = ?", (req.target_bed_id,)).fetchone()
            bed_name = bed_row["name"] if bed_row else None

        task_defs = _build_lifecycle_tasks(
            plant, req.method, start,
            req.target_bed_id, req.target_cell_x, req.target_cell_y,
            req.tray_id, bed_name,
        )

        # Auto-create seed tray cell if method=seed and tray info provided
        tray_cell_id = None
        if req.method == "seed" and req.tray_id is not None and req.tray_row is not None and req.tray_col is not None:
            existing_cell = db.execute(
                "SELECT id, status FROM seed_tray_cells WHERE tray_id = ? AND row = ? AND col = ?",
                (req.tray_id, req.tray_row, req.tray_col),
            ).fetchone()
            if existing_cell and existing_cell["status"] != "empty":
                raise HTTPException(status_code=409, detail=f"Tray cell ({req.tray_row},{req.tray_col}) is already in use")
            if existing_cell:
                db.execute(
                    "UPDATE seed_tray_cells SET plant_id = ?, seed_date = ?, status = 'seeded' WHERE id = ?",
                    (req.plant_id, start.isoformat(), existing_cell["id"]),
                )
                tray_cell_id = existing_cell["id"]
            else:
                cursor = db.execute(
                    "INSERT INTO seed_tray_cells (tray_id, row, col, plant_id, seed_date, status) VALUES (?, ?, ?, ?, ?, 'seeded')",
                    (req.tray_id, req.tray_row, req.tray_col, req.plant_id, start.isoformat()),
                )
                tray_cell_id = cursor.lastrowid

        # Auto-create planting if bed info provided and method involves eventual planting
        planting_id = None
        if req.target_bed_id and req.target_cell_x is not None and req.target_cell_y is not None:
            planted_date = start.isoformat() if req.method == "direct_sow" else None
            status = "seeded" if req.method == "direct_sow" else "planned"
            cursor = db.execute(
                """INSERT INTO plantings (bed_id, plant_id, cell_x, cell_y, planted_date, status, season, year)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
                (req.target_bed_id, req.plant_id, req.target_cell_x, req.target_cell_y,
                 planted_date, status, _current_desert_season(), date.today().year),
            )
            planting_id = cursor.lastrowid

        # Insert tasks
        created_tasks = []
        prev_task_id = None
        for order, tdef in enumerate(task_defs, 1):
            cursor = db.execute(
                """INSERT INTO garden_tasks
                   (task_type, title, description, priority, status, due_date,
                    plant_id, planting_id, bed_id, tray_id,
                    auto_generated, source, lifecycle_group_id, lifecycle_order, depends_on_task_id)
                   VALUES (?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, 1, 'lifecycle', ?, ?, ?)""",
                (tdef["task_type"], tdef["title"], tdef["description"], tdef["priority"],
                 tdef["due_date"], tdef["plant_id"], planting_id, tdef.get("bed_id"),
                 tdef.get("tray_id"), lifecycle_id, order, prev_task_id),
            )
            task_id = cursor.lastrowid
            prev_task_id = task_id
            row = db.execute("SELECT * FROM garden_tasks WHERE id = ?", (task_id,)).fetchone()
            created_tasks.append(_task_row_to_dict(row))

        db.commit()
        enriched = _enrich_tasks(db, created_tasks)

        # Determine estimated harvest date
        harvest_tasks = [t for t in enriched if t.get("task_type") == "harvest" and t.get("due_date")]
        estimated_harvest = harvest_tasks[0]["due_date"] if harvest_tasks else None

        return {
            "lifecycle_id": lifecycle_id,
            "plant_name": plant["name"],
            "method": req.method,
            "tasks_created": len(enriched),
            "tasks": enriched,
            "start_date": start.isoformat(),
            "estimated_harvest": estimated_harvest,
            "planting_id": planting_id,
            "tray_cell_id": tray_cell_id,
        }


def _current_desert_season() -> str:
    month = date.today().month
    if month >= 10 or month <= 2:
        return "cool"
    elif month >= 7:
        return "monsoon"
    else:
        return "warm"


@router.get("/api/lifecycle/recommend/{plant_id}")
def lifecycle_recommend(plant_id: int):
    """Recommend the best lifecycle method for a plant based on current date, seed inventory, and tray space."""
    today = date.today()

    with get_db() as db:
        plant_row = db.execute("SELECT * FROM plants WHERE id = ?", (plant_id,)).fetchone()
        if not plant_row:
            raise HTTPException(status_code=404, detail="Plant not found")
        plant = row_to_dict(plant_row)

        # Check seed inventory
        seed_row = db.execute(
            "SELECT COALESCE(SUM(quantity_seeds), 0) as total FROM seed_inventory WHERE plant_id = ?",
            (plant_id,),
        ).fetchone()
        has_seeds = (seed_row["total"] if seed_row else 0) > 0

        # Check available tray space
        tray_space = db.execute(
            """SELECT t.id, t.name, t.rows, t.cols,
                      (t.rows * t.cols) - COUNT(CASE WHEN c.status IS NOT NULL AND c.status != 'empty' THEN 1 END) as empty_cells
               FROM seed_trays t
               LEFT JOIN seed_tray_cells c ON c.tray_id = t.id
               GROUP BY t.id
               HAVING empty_cells > 0
               ORDER BY empty_cells DESC""",
        ).fetchall()
        has_tray_space = len(tray_space) > 0
        available_trays = [{"id": r["id"], "name": r["name"], "empty_cells": r["empty_cells"]} for r in tray_space]

        # Determine windows
        sow_outdoor = plant.get("desert_sow_outdoor")
        transplant_window = plant.get("desert_transplant")
        weeks_before = plant.get("sow_indoor_weeks_before_transplant") or 0

        in_direct_sow_window = False
        in_transplant_window = False
        in_seed_start_window = False
        sow_window_note = None
        transplant_window_note = None
        seed_window_note = None
        suggested_start_date = today.isoformat()

        if sow_outdoor:
            try:
                sow_start = parse_md(sow_outdoor[0])
                sow_end = parse_md(sow_outdoor[1])
                sow_window_note = f"Direct sow window: {sow_outdoor[0]} to {sow_outdoor[1]}"
                if sow_start <= sow_end:
                    in_direct_sow_window = sow_start <= today <= sow_end
                else:
                    in_direct_sow_window = today >= sow_start or today <= sow_end
            except Exception:
                pass

        if transplant_window:
            try:
                trans_start = parse_md(transplant_window[0])
                trans_end = parse_md(transplant_window[1])
                transplant_window_note = f"Transplant window: {transplant_window[0]} to {transplant_window[1]}"
                if trans_start <= trans_end:
                    in_transplant_window = trans_start <= today <= trans_end
                else:
                    in_transplant_window = today >= trans_start or today <= trans_end
            except Exception:
                pass

        if weeks_before > 0 and transplant_window:
            try:
                trans_start = parse_md(transplant_window[0])
                seed_start = trans_start - timedelta(weeks=weeks_before)
                seed_end = seed_start + timedelta(weeks=4)
                seed_window_note = f"Indoor seed start window: {seed_start.strftime('%m-%d')} to {seed_end.strftime('%m-%d')}"
                in_seed_start_window = seed_start <= today <= seed_end
                if in_seed_start_window:
                    suggested_start_date = today.isoformat()
                elif today < seed_start:
                    suggested_start_date = seed_start.isoformat()
            except Exception:
                pass

        # Determine recommended method
        recommended_method = "transplant"
        reason_parts = []

        if in_seed_start_window and weeks_before > 0:
            recommended_method = "seed"
            reason_parts.append(f"You're in the indoor seed start window ({weeks_before} weeks before transplant)")
            if has_seeds:
                reason_parts.append(f"You have {plant['name']} seeds in inventory")
            if has_tray_space:
                reason_parts.append(f"Tray space available in {available_trays[0]['name']}")
        elif in_direct_sow_window:
            recommended_method = "direct_sow"
            reason_parts.append("You're in the direct sow window")
            if has_seeds:
                reason_parts.append(f"You have {plant['name']} seeds in inventory")
        elif in_transplant_window:
            recommended_method = "transplant"
            reason_parts.append("You're in the transplant window -- buy transplants from a nursery")
        else:
            # Not in any window currently
            if in_seed_start_window is False and weeks_before > 0 and transplant_window:
                try:
                    trans_start = parse_md(transplant_window[0])
                    seed_start = trans_start - timedelta(weeks=weeks_before)
                    if today < seed_start:
                        recommended_method = "seed"
                        reason_parts.append(f"Seed start window opens {seed_start.strftime('%b %d')}")
                        suggested_start_date = seed_start.isoformat()
                    else:
                        recommended_method = "transplant"
                        reason_parts.append("Seed start and direct sow windows have passed -- buy transplants")
                except Exception:
                    reason_parts.append("No active planting window")
            elif sow_outdoor:
                try:
                    sow_start = parse_md(sow_outdoor[0])
                    if today < sow_start:
                        recommended_method = "direct_sow"
                        reason_parts.append(f"Direct sow window opens {sow_start.strftime('%b %d')}")
                        suggested_start_date = sow_start.isoformat()
                    else:
                        recommended_method = "transplant"
                        reason_parts.append("Direct sow window has passed -- buy transplants if available")
                except Exception:
                    reason_parts.append("No active planting window")

        # Adjust for seed inventory
        if recommended_method in ("seed", "direct_sow") and not has_seeds:
            reason_parts.append("Note: no seeds in inventory -- you may need to purchase seeds first")
        if recommended_method == "seed" and not has_tray_space:
            reason_parts.append("Note: no tray space available -- consider direct sow or buying transplants")

        reason = ". ".join(reason_parts) + "." if reason_parts else "No specific recommendation available."

        # Build alternatives
        alternatives = []
        if recommended_method != "direct_sow":
            alternatives.append({
                "method": "direct_sow",
                "available": in_direct_sow_window,
                "note": sow_window_note or "No direct sow data for this plant",
            })
        if recommended_method != "seed":
            alternatives.append({
                "method": "seed",
                "available": in_seed_start_window,
                "note": seed_window_note or ("Start indoors if tray space available" if weeks_before > 0 else "This plant does not benefit from indoor seed starting"),
            })
        if recommended_method != "transplant":
            alternatives.append({
                "method": "transplant",
                "available": in_transplant_window,
                "note": transplant_window_note or "Buy transplants from nursery if you want to skip seed starting",
            })

        return {
            "recommended_method": recommended_method,
            "reason": reason,
            "alternatives": alternatives,
            "has_seeds": has_seeds,
            "has_tray_space": has_tray_space,
            "available_trays": available_trays[:3],
            "suggested_start_date": suggested_start_date,
        }


@router.post("/api/lifecycle/{lifecycle_id}/cancel")
def cancel_lifecycle(lifecycle_id: str):
    """Cancel all pending/in_progress tasks in a lifecycle and mark related resources as failed."""
    with get_db() as db:
        tasks = db.execute(
            "SELECT * FROM garden_tasks WHERE lifecycle_group_id = ? AND status IN ('pending', 'in_progress') ORDER BY lifecycle_order",
            (lifecycle_id,),
        ).fetchall()
        if not tasks:
            raise HTTPException(status_code=404, detail="No pending tasks found for this lifecycle")

        task_ids = [t["id"] for t in tasks]
        db.execute(
            f"DELETE FROM garden_tasks WHERE id IN ({','.join('?' * len(task_ids))})",
            task_ids,
        )

        # Mark any tray cells as failed
        tray_ids = {t["tray_id"] for t in tasks if t["tray_id"]}
        plant_ids = {t["plant_id"] for t in tasks if t["plant_id"]}
        for tray_id in tray_ids:
            for plant_id in plant_ids:
                db.execute(
                    "UPDATE seed_tray_cells SET status = 'failed' WHERE tray_id = ? AND plant_id = ? AND status NOT IN ('transplanted', 'failed')",
                    (tray_id, plant_id),
                )

        # Mark plantings as failed
        planting_ids = {t["planting_id"] for t in tasks if t["planting_id"]}
        for pid in planting_ids:
            db.execute("UPDATE plantings SET status = 'failed' WHERE id = ? AND status NOT IN ('harvested', 'removed')", (pid,))

        db.commit()
        return {"cancelled": True, "tasks_removed": len(task_ids), "lifecycle_id": lifecycle_id}


@router.post("/api/tasks/{task_id}/fail")
def fail_task(task_id: int):
    """Mark a task as failed and cascade-delete all downstream tasks in the same lifecycle."""
    with get_db() as db:
        task = db.execute("SELECT * FROM garden_tasks WHERE id = ?", (task_id,)).fetchone()
        if not task:
            raise HTTPException(status_code=404, detail="Task not found")

        task_d = dict(task)
        db.execute("UPDATE garden_tasks SET status = 'skipped', notes = COALESCE(notes || ' | ', '') || 'FAILED' WHERE id = ?", (task_id,))

        downstream_deleted = 0
        lifecycle_id = task_d.get("lifecycle_group_id")
        lifecycle_order = task_d.get("lifecycle_order")

        if lifecycle_id and lifecycle_order:
            downstream = db.execute(
                "SELECT id FROM garden_tasks WHERE lifecycle_group_id = ? AND lifecycle_order > ? AND status IN ('pending', 'in_progress')",
                (lifecycle_id, lifecycle_order),
            ).fetchall()
            downstream_ids = [r["id"] for r in downstream]
            if downstream_ids:
                db.execute(
                    f"DELETE FROM garden_tasks WHERE id IN ({','.join('?' * len(downstream_ids))})",
                    downstream_ids,
                )
                downstream_deleted = len(downstream_ids)

            # If germination check failed → mark tray cell as failed
            if task_d.get("title") and "germination" in task_d["title"].lower() and task_d.get("tray_id"):
                db.execute(
                    "UPDATE seed_tray_cells SET status = 'failed' WHERE tray_id = ? AND plant_id = ? AND status NOT IN ('transplanted', 'failed')",
                    (task_d["tray_id"], task_d["plant_id"]),
                )

            # If transplant failed → mark planting as failed
            if task_d.get("task_type") == "transplant" and task_d.get("planting_id"):
                db.execute(
                    "UPDATE plantings SET status = 'failed' WHERE id = ?",
                    (task_d["planting_id"],),
                )

        db.commit()

        updated = db.execute("SELECT * FROM garden_tasks WHERE id = ?", (task_id,)).fetchone()
        result = _task_row_to_dict(updated)
        _enrich_tasks(db, [result])
        return {
            "task": result,
            "downstream_deleted": downstream_deleted,
        }


@router.get("/api/lifecycle")
def list_lifecycles():
    """List all active lifecycles with progress info."""
    with get_db() as db:
        groups = db.execute(
            """SELECT lifecycle_group_id, plant_id,
                      MIN(due_date) as start_date,
                      COUNT(*) as total_tasks,
                      SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed_tasks,
                      SUM(CASE WHEN status IN ('pending', 'in_progress') THEN 1 ELSE 0 END) as pending_tasks
               FROM garden_tasks
               WHERE lifecycle_group_id IS NOT NULL
               GROUP BY lifecycle_group_id
               ORDER BY MIN(due_date) DESC""",
        ).fetchall()

        result = []
        for g in groups:
            gd = dict(g)
            plant_name = None
            method = None
            if gd["plant_id"]:
                p = db.execute("SELECT name FROM plants WHERE id = ?", (gd["plant_id"],)).fetchone()
                plant_name = p["name"] if p else None

            # Determine method from first task
            first = db.execute(
                "SELECT task_type, title FROM garden_tasks WHERE lifecycle_group_id = ? ORDER BY lifecycle_order ASC LIMIT 1",
                (gd["lifecycle_group_id"],),
            ).fetchone()
            if first:
                ft = first["task_type"]
                if ft == "start_seeds":
                    method = "seed"
                elif ft == "direct_sow":
                    method = "direct_sow"
                elif ft == "purchase_seeds":
                    method = "transplant"
                else:
                    method = "unknown"

            # Next pending task
            next_task = db.execute(
                "SELECT title, due_date FROM garden_tasks WHERE lifecycle_group_id = ? AND status IN ('pending', 'in_progress') ORDER BY lifecycle_order ASC LIMIT 1",
                (gd["lifecycle_group_id"],),
            ).fetchone()

            # Estimated harvest = last harvest task due_date
            harvest = db.execute(
                "SELECT MAX(due_date) as d FROM garden_tasks WHERE lifecycle_group_id = ? AND task_type = 'harvest'",
                (gd["lifecycle_group_id"],),
            ).fetchone()

            result.append({
                "lifecycle_id": gd["lifecycle_group_id"],
                "plant_id": gd["plant_id"],
                "plant_name": plant_name,
                "method": method,
                "start_date": gd["start_date"],
                "total_tasks": gd["total_tasks"],
                "completed_tasks": gd["completed_tasks"],
                "pending_tasks": gd["pending_tasks"],
                "current_stage": next_task["title"] if next_task else "Complete",
                "current_stage_due": next_task["due_date"] if next_task else None,
                "estimated_harvest": harvest["d"] if harvest else None,
            })

        return result


@router.get("/api/lifecycle/{lifecycle_id}")
def get_lifecycle_detail(lifecycle_id: str):
    """Get full detail for a single lifecycle."""
    with get_db() as db:
        tasks = db.execute(
            "SELECT * FROM garden_tasks WHERE lifecycle_group_id = ? ORDER BY lifecycle_order ASC",
            (lifecycle_id,),
        ).fetchall()
        if not tasks:
            raise HTTPException(status_code=404, detail="Lifecycle not found")

        task_dicts = [_task_row_to_dict(r) for r in tasks]
        enriched = _enrich_tasks(db, task_dicts)

        plant_id = enriched[0].get("plant_id")
        plant_name = enriched[0].get("plant_name")

        total = len(enriched)
        completed = sum(1 for t in enriched if t["status"] == "completed")
        pending = sum(1 for t in enriched if t["status"] in ("pending", "in_progress"))

        # Determine method
        first_type = enriched[0]["task_type"]
        if first_type == "start_seeds":
            method = "seed"
        elif first_type == "direct_sow":
            method = "direct_sow"
        elif first_type == "purchase_seeds":
            method = "transplant"
        else:
            method = "unknown"

        next_task = next((t for t in enriched if t["status"] in ("pending", "in_progress")), None)

        harvest_dates = [t["due_date"] for t in enriched if t["task_type"] == "harvest" and t.get("due_date")]
        estimated_harvest = min(harvest_dates) if harvest_dates else None

        return {
            "lifecycle_id": lifecycle_id,
            "plant_id": plant_id,
            "plant_name": plant_name,
            "method": method,
            "start_date": enriched[0].get("due_date"),
            "total_tasks": total,
            "completed_tasks": completed,
            "pending_tasks": pending,
            "current_stage": next_task["title"] if next_task else "Complete",
            "current_stage_due": next_task["due_date"] if next_task else None,
            "estimated_harvest": estimated_harvest,
            "tasks": enriched,
        }


