"""Pest and disease outbreak tracking endpoints."""
from __future__ import annotations

from datetime import datetime
from typing import Optional

from fastapi import APIRouter, HTTPException, Query, Request

from db import get_db
from auth import require_user, audit_log

router = APIRouter()


def _enrich_incident(row: dict) -> dict:
    """Add plant_name, bed_name, ground_plant_name to an incident dict."""
    return row


@router.get("/api/pests")
def list_pest_incidents(
    request: Request,
    status: Optional[str] = Query(None),
    severity: Optional[str] = Query(None),
    pest_type: Optional[str] = Query(None),
    plant_id: Optional[int] = Query(None),
    bed_id: Optional[int] = Query(None),
    ground_plant_id: Optional[int] = Query(None),
    date_from: Optional[str] = Query(None),
    date_to: Optional[str] = Query(None),
):
    """List all pest/disease incidents with optional filters."""
    require_user(request)
    with get_db() as db:
        conditions = []
        params = []

        if status:
            conditions.append("pi.status = ?")
            params.append(status)
        if severity:
            conditions.append("pi.severity = ?")
            params.append(severity)
        if pest_type:
            conditions.append("pi.pest_type = ?")
            params.append(pest_type)
        if plant_id:
            conditions.append("pi.plant_id = ?")
            params.append(plant_id)
        if bed_id:
            conditions.append("pi.bed_id = ?")
            params.append(bed_id)
        if ground_plant_id:
            conditions.append("pi.ground_plant_id = ?")
            params.append(ground_plant_id)
        if date_from:
            conditions.append("pi.detected_date >= ?")
            params.append(date_from)
        if date_to:
            conditions.append("pi.detected_date <= ?")
            params.append(date_to)

        where = " AND ".join(conditions) if conditions else "1=1"

        rows = db.execute(f"""
            SELECT pi.*,
                   p.name as plant_name,
                   gb.name as bed_name,
                   gp.name as ground_plant_display_name,
                   gp2.name as ground_plant_species
            FROM pest_incidents pi
            LEFT JOIN plants p ON pi.plant_id = p.id
            LEFT JOIN garden_beds gb ON pi.bed_id = gb.id
            LEFT JOIN ground_plants gp ON pi.ground_plant_id = gp.id
            LEFT JOIN plants gp2 ON gp.plant_id = gp2.id
            WHERE {where}
            ORDER BY
                CASE pi.status
                    WHEN 'active' THEN 0
                    WHEN 'monitoring' THEN 1
                    WHEN 'treated' THEN 2
                    WHEN 'resolved' THEN 3
                END,
                pi.detected_date DESC
        """, params).fetchall()

        results = []
        for r in rows:
            d = dict(r)
            # Compute ground_plant_name from display name or species
            d["ground_plant_name"] = d.pop("ground_plant_display_name") or d.pop("ground_plant_species")
            results.append(d)

        return results


@router.post("/api/pests")
async def create_pest_incident(request: Request):
    """Log a new pest/disease incident."""
    require_user(request)
    body = await request.json()

    pest_type = body.get("pest_type", "").strip()
    pest_name = body.get("pest_name", "").strip()
    detected_date = body.get("detected_date", "").strip()

    if not pest_type:
        raise HTTPException(status_code=400, detail="pest_type is required")
    if not pest_name:
        raise HTTPException(status_code=400, detail="pest_name is required")
    if not detected_date:
        raise HTTPException(status_code=400, detail="detected_date is required")

    severity = body.get("severity", "low")
    status = body.get("status", "active")
    plant_id = body.get("plant_id") or None
    bed_id = body.get("bed_id") or None
    ground_plant_id = body.get("ground_plant_id") or None
    treatment = body.get("treatment", "").strip() or None
    notes = body.get("notes", "").strip() or None

    with get_db() as db:
        cur = db.execute("""
            INSERT INTO pest_incidents
                (plant_id, bed_id, ground_plant_id, pest_type, pest_name,
                 severity, status, treatment, notes, detected_date)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (plant_id, bed_id, ground_plant_id, pest_type, pest_name,
              severity, status, treatment, notes, detected_date))
        user = getattr(request.state, 'user', None)
        if user:
            audit_log(db, user['id'], 'create', 'pest', cur.lastrowid,
                      {'pest_name': pest_name, 'severity': severity, 'pest_type': pest_type},
                      request.client.host if request.client else None)
        db.commit()
        row = db.execute("SELECT * FROM pest_incidents WHERE id = ?", (cur.lastrowid,)).fetchone()
        return dict(row)


@router.patch("/api/pests/{incident_id}")
async def update_pest_incident(incident_id: int, request: Request):
    """Update a pest incident (change status, add treatment, etc.)."""
    require_user(request)
    body = await request.json()

    with get_db() as db:
        existing = db.execute("SELECT * FROM pest_incidents WHERE id = ?", (incident_id,)).fetchone()
        if not existing:
            raise HTTPException(status_code=404, detail="Incident not found")

        updates = []
        params = []
        allowed = ("pest_type", "pest_name", "severity", "status", "treatment",
                   "notes", "detected_date", "resolved_date", "plant_id", "bed_id", "ground_plant_id")
        for field in allowed:
            if field in body:
                updates.append(f"{field} = ?")
                params.append(body[field] if body[field] != "" else None)

        if not updates:
            raise HTTPException(status_code=400, detail="No fields to update")

        # Auto-set resolved_date when status changes to resolved
        if body.get("status") == "resolved" and not body.get("resolved_date") and not existing["resolved_date"]:
            updates.append("resolved_date = ?")
            params.append(datetime.utcnow().strftime("%Y-%m-%d"))

        params.append(incident_id)
        db.execute(f"UPDATE pest_incidents SET {', '.join(updates)} WHERE id = ?", params)
        user = getattr(request.state, 'user', None)
        if user:
            audit_log(db, user['id'], 'update', 'pest', incident_id,
                      {'pest_name': existing['pest_name'], 'new_status': body.get('status')},
                      request.client.host if request.client else None)
        db.commit()
        row = db.execute("SELECT * FROM pest_incidents WHERE id = ?", (incident_id,)).fetchone()
        return dict(row)


@router.delete("/api/pests/{incident_id}")
def delete_pest_incident(incident_id: int, request: Request):
    """Remove a pest incident."""
    require_user(request)
    with get_db() as db:
        existing = db.execute("SELECT * FROM pest_incidents WHERE id = ?", (incident_id,)).fetchone()
        if not existing:
            raise HTTPException(status_code=404, detail="Incident not found")
        db.execute("DELETE FROM pest_incidents WHERE id = ?", (incident_id,))
        user = getattr(request.state, 'user', None)
        if user:
            audit_log(db, user['id'], 'delete', 'pest', incident_id,
                      {'pest_name': existing['pest_name']},
                      request.client.host if request.client else None)
        db.commit()
        return {"ok": True}


@router.get("/api/pests/patterns")
def get_pest_patterns(request: Request):
    """Analyze pest/disease patterns — which pests appear when, most affected plants."""
    require_user(request)
    with get_db() as db:
        # Pests by month
        by_month = db.execute("""
            SELECT
                substr(detected_date, 6, 2) as month,
                pest_name,
                pest_type,
                COUNT(*) as incident_count,
                SUM(CASE WHEN severity IN ('high', 'critical') THEN 1 ELSE 0 END) as severe_count
            FROM pest_incidents
            GROUP BY month, pest_name
            ORDER BY month, incident_count DESC
        """).fetchall()

        # Most affected plants
        by_plant = db.execute("""
            SELECT
                p.name as plant_name,
                p.id as plant_id,
                COUNT(*) as incident_count,
                GROUP_CONCAT(DISTINCT pi.pest_name) as pests_seen
            FROM pest_incidents pi
            JOIN plants p ON pi.plant_id = p.id
            WHERE pi.plant_id IS NOT NULL
            GROUP BY pi.plant_id
            ORDER BY incident_count DESC
            LIMIT 20
        """).fetchall()

        # Most affected beds
        by_bed = db.execute("""
            SELECT
                gb.name as bed_name,
                gb.id as bed_id,
                COUNT(*) as incident_count,
                GROUP_CONCAT(DISTINCT pi.pest_name) as pests_seen
            FROM pest_incidents pi
            JOIN garden_beds gb ON pi.bed_id = gb.id
            WHERE pi.bed_id IS NOT NULL
            GROUP BY pi.bed_id
            ORDER BY incident_count DESC
            LIMIT 20
        """).fetchall()

        # Most common pests overall
        by_pest = db.execute("""
            SELECT
                pest_name,
                pest_type,
                COUNT(*) as incident_count,
                ROUND(AVG(CASE severity
                    WHEN 'low' THEN 1
                    WHEN 'medium' THEN 2
                    WHEN 'high' THEN 3
                    WHEN 'critical' THEN 4
                END), 1) as avg_severity,
                SUM(CASE WHEN status = 'resolved' THEN 1 ELSE 0 END) as resolved_count,
                SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) as active_count
            FROM pest_incidents
            GROUP BY pest_name
            ORDER BY incident_count DESC
        """).fetchall()

        # Resolution stats
        resolution = db.execute("""
            SELECT
                pest_name,
                treatment,
                COUNT(*) as times_used,
                SUM(CASE WHEN status = 'resolved' THEN 1 ELSE 0 END) as resolved_count
            FROM pest_incidents
            WHERE treatment IS NOT NULL AND treatment != ''
            GROUP BY pest_name, treatment
            ORDER BY resolved_count DESC
            LIMIT 20
        """).fetchall()

        return {
            "by_month": [dict(r) for r in by_month],
            "by_plant": [dict(r) for r in by_plant],
            "by_bed": [dict(r) for r in by_bed],
            "by_pest": [dict(r) for r in by_pest],
            "effective_treatments": [dict(r) for r in resolution],
        }
