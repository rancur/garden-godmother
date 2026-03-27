"""Aggregated dashboard endpoint — returns all dashboard data in one call."""
from __future__ import annotations

import json
import logging
from datetime import date, datetime, timedelta

from fastapi import APIRouter, Request

from db import get_db
from auth import require_user
from constants import _get_harvest_flags

logger = logging.getLogger(__name__)

router = APIRouter()


@router.get("/api/dashboard")
def get_dashboard(request: Request):
    """Aggregated dashboard data: stats, recent activity, planter fill rates, tasks."""
    require_user(request)
    today_str = date.today().isoformat()

    with get_db() as db:
        # ── Stats ──
        active_planter_plants = db.execute(
            "SELECT COUNT(*) as c FROM plantings WHERE status IN ('seeded','sprouted','growing','flowering','fruiting','established')"
        ).fetchone()["c"]
        active_ground_plants = db.execute(
            "SELECT COUNT(*) as c FROM ground_plants WHERE status IN ('planted','growing','established')"
        ).fetchone()["c"]
        active_tray_plants = db.execute(
            "SELECT COUNT(*) as c FROM seed_tray_cells WHERE plant_id IS NOT NULL AND status NOT IN ('empty', 'failed')"
        ).fetchone()["c"]
        active_plants = active_planter_plants + active_ground_plants + active_tray_plants

        # Vacant planter cells
        beds = db.execute("SELECT id, name, width_cells, height_cells FROM garden_beds").fetchall()
        total_bed_cells = 0
        occupied_bed_cells = 0
        planter_fill = []
        for bed in beds:
            total = bed["width_cells"] * bed["height_cells"]
            total_bed_cells += total
            occ = db.execute(
                "SELECT COUNT(*) as c FROM plantings WHERE bed_id = ? AND status IN ('seeded','sprouted','growing','flowering','fruiting','established')",
                (bed["id"],)
            ).fetchone()["c"]
            occupied_bed_cells += occ
            planter_fill.append({
                "id": bed["id"],
                "name": bed["name"],
                "total_cells": total,
                "occupied": occ,
            })
        vacant_planter_cells = total_bed_cells - occupied_bed_cells

        # Vacant tray cells
        vacant_tray_cells = db.execute(
            "SELECT COUNT(*) as c FROM seed_tray_cells WHERE status = 'empty'"
        ).fetchone()["c"]
        total_vacant = vacant_planter_cells + vacant_tray_cells

        # Next harvest
        next_harvest_candidates = db.execute(
            """SELECT p.expected_harvest_date, pl.name as plant_name, pl.category as plant_category,
                      pl.subcategory as plant_subcategory, b.name as bed_name
               FROM plantings p
               JOIN plants pl ON p.plant_id = pl.id
               LEFT JOIN garden_beds b ON p.bed_id = b.id
               WHERE p.status IN ('seeded','sprouted','growing','flowering','fruiting','established')
               AND p.expected_harvest_date IS NOT NULL
               AND p.expected_harvest_date >= ?
               ORDER BY p.expected_harvest_date ASC""",
            (today_str,)
        ).fetchall()
        next_harvest = None
        for nhr in next_harvest_candidates:
            is_h, _, _ = _get_harvest_flags(nhr["plant_name"], nhr["plant_category"], nhr["plant_subcategory"] or "")
            if is_h:
                harvest_date = nhr["expected_harvest_date"]
                days_until = (date.fromisoformat(harvest_date) - date.today()).days
                next_harvest = {
                    "plant_name": nhr["plant_name"],
                    "days": days_until,
                    "date": harvest_date,
                    "bed_name": nhr["bed_name"],
                }
                break

        # Tasks
        tasks_due_today = db.execute(
            "SELECT COUNT(*) as c FROM garden_tasks WHERE due_date = ? AND status NOT IN ('completed','skipped')",
            (today_str,)
        ).fetchone()["c"]
        tasks_overdue = db.execute(
            "SELECT COUNT(*) as c FROM garden_tasks WHERE (status = 'overdue' OR (due_date < ? AND status = 'pending'))",
            (today_str,)
        ).fetchone()["c"]

        # ── Recent Activity (from audit_log) ──
        recent_activity = []
        try:
            audit_rows = db.execute(
                """SELECT al.action, al.entity_type, al.entity_id, al.details, al.created_at
                   FROM audit_log al
                   ORDER BY al.created_at DESC
                   LIMIT 10"""
            ).fetchall()
            for row in audit_rows:
                details = None
                if row["details"]:
                    try:
                        details = json.loads(row["details"])
                    except (json.JSONDecodeError, TypeError):
                        details = {"raw": row["details"]}
                recent_activity.append({
                    "action": row["action"],
                    "entity_type": row["entity_type"],
                    "entity_id": row["entity_id"],
                    "details": details,
                    "created_at": row["created_at"],
                })
        except Exception:
            pass

        # ── Recent Harvests (last 5) ──
        recent_harvests = []
        try:
            harvest_rows = db.execute(
                """SELECT h.harvest_date, h.weight_oz, h.quantity, h.quality,
                          pl.name as plant_name, b.name as bed_name
                   FROM harvests h
                   JOIN plantings p ON h.planting_id = p.id
                   JOIN plants pl ON p.plant_id = pl.id
                   LEFT JOIN garden_beds b ON p.bed_id = b.id
                   ORDER BY h.harvest_date DESC, h.id DESC
                   LIMIT 5"""
            ).fetchall()
            for row in harvest_rows:
                recent_harvests.append({
                    "harvest_date": row["harvest_date"],
                    "weight_oz": row["weight_oz"],
                    "quantity": row["quantity"],
                    "quality": row["quality"],
                    "plant_name": row["plant_name"],
                    "bed_name": row["bed_name"],
                })
        except Exception:
            pass

        # ── Recent Journal Entries (last 5) ──
        recent_journal = []
        try:
            journal_rows = db.execute(
                """SELECT je.entry_type, je.title, je.content, je.created_at,
                          je.plant_id, pl.name as plant_name,
                          je.bed_id, b.name as bed_name
                   FROM journal_entries je
                   LEFT JOIN plants pl ON je.plant_id = pl.id
                   LEFT JOIN garden_beds b ON je.bed_id = b.id
                   ORDER BY je.created_at DESC
                   LIMIT 5"""
            ).fetchall()
            for row in journal_rows:
                recent_journal.append({
                    "entry_type": row["entry_type"],
                    "title": row["title"],
                    "content": row["content"],
                    "created_at": row["created_at"],
                    "plant_name": row["plant_name"],
                    "bed_name": row["bed_name"],
                })
        except Exception:
            pass

        # ── Recent Plantings (last 5) ──
        recent_plantings = []
        try:
            planting_rows = db.execute(
                """SELECT p.planted_date, p.status, pl.name as plant_name, b.name as bed_name
                   FROM plantings p
                   JOIN plants pl ON p.plant_id = pl.id
                   LEFT JOIN garden_beds b ON p.bed_id = b.id
                   WHERE p.planted_date IS NOT NULL
                   ORDER BY p.planted_date DESC, p.id DESC
                   LIMIT 5"""
            ).fetchall()
            for row in planting_rows:
                recent_plantings.append({
                    "planted_date": row["planted_date"],
                    "status": row["status"],
                    "plant_name": row["plant_name"],
                    "bed_name": row["bed_name"],
                })
        except Exception:
            pass

        # ── Plant Health Summary ──
        health_summary = None
        try:
            total_active = active_plants
            # Count plants with pest/disease issues
            issues_count = db.execute(
                """SELECT COUNT(DISTINCT planting_id) as c FROM pest_observations
                   WHERE status IN ('active', 'monitoring')"""
            ).fetchone()["c"]
            healthy_count = total_active - issues_count if total_active > issues_count else total_active
            if total_active > 0:
                health_summary = {
                    "total": total_active,
                    "healthy": healthy_count,
                    "issues": issues_count,
                }
        except Exception:
            pass

        return {
            "stats": {
                "active_plants": active_plants,
                "active_in_planters": active_planter_plants,
                "active_in_ground": active_ground_plants,
                "active_in_trays": active_tray_plants,
                "vacant_planter_cells": vacant_planter_cells,
                "vacant_tray_cells": vacant_tray_cells,
                "total_vacant": total_vacant,
                "next_harvest": next_harvest,
                "tasks_due_today": tasks_due_today,
                "tasks_overdue": tasks_overdue,
            },
            "planter_fill": planter_fill,
            "recent_activity": recent_activity,
            "recent_harvests": recent_harvests,
            "recent_journal": recent_journal,
            "recent_plantings": recent_plantings,
            "health_summary": health_summary,
        }
