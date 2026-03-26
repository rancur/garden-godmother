"""Journal entry endpoints."""
from __future__ import annotations

import json
import uuid
from datetime import date, datetime, timedelta
from typing import Optional

import httpx
from fastapi import APIRouter, HTTPException, Query, Request, UploadFile, File, Form
from fastapi.responses import FileResponse, Response

from db import get_db
from auth import require_user, audit_log, get_request_user
from models import JournalEntryCreate, JournalEntryUpdate
from constants import PHOTOS_DIR, ALLOWED_PHOTO_TYPES, MAX_PHOTO_SIZE, PHOTO_EXTENSIONS, create_undo_action
from services.integrations import get_openai_key

router = APIRouter()

# ──────────────── JOURNAL ────────────────






def _enrich_journal_entry(db, entry: dict) -> dict:
    """Add plant_name, bed_name, tray_name, ground_plant_name, planting info to a journal entry dict."""
    # Enrich from planting_id (bed planting)
    if entry.get("planting_id"):
        pl_row = db.execute("""
            SELECT p.name as plant_name, p.id as plant_id, gb.name as bed_name, gb.id as bed_id
            FROM plantings pl
            JOIN plants p ON pl.plant_id = p.id
            LEFT JOIN garden_beds gb ON pl.bed_id = gb.id
            WHERE pl.id = ?
        """, (entry["planting_id"],)).fetchone()
        if pl_row:
            entry.setdefault("plant_name", pl_row["plant_name"])
            entry.setdefault("bed_name", pl_row["bed_name"])
            if not entry.get("plant_name"):
                entry["plant_name"] = pl_row["plant_name"]
            if not entry.get("bed_name"):
                entry["bed_name"] = pl_row["bed_name"]
            if not entry.get("plant_id"):
                entry["plant_id"] = pl_row["plant_id"]
            if not entry.get("bed_id"):
                entry["bed_id"] = pl_row["bed_id"]

    if entry.get("plant_id") and not entry.get("plant_name"):
        p = db.execute("SELECT name FROM plants WHERE id = ?", (entry["plant_id"],)).fetchone()
        entry["plant_name"] = p["name"] if p else None
    elif not entry.get("plant_name"):
        entry["plant_name"] = None
    if entry.get("bed_id") and not entry.get("bed_name"):
        b = db.execute("SELECT name FROM garden_beds WHERE id = ?", (entry["bed_id"],)).fetchone()
        entry["bed_name"] = b["name"] if b else None
    elif not entry.get("bed_name"):
        entry["bed_name"] = None
    if entry.get("tray_id"):
        t = db.execute("SELECT name FROM seed_trays WHERE id = ?", (entry["tray_id"],)).fetchone()
        entry["tray_name"] = t["name"] if t else None
    else:
        entry["tray_name"] = None
    if entry.get("ground_plant_id"):
        gp = db.execute("""
            SELECT gp.name as gp_name, pl.name as plant_name, a.name as area_name
            FROM ground_plants gp
            JOIN plants pl ON gp.plant_id = pl.id
            LEFT JOIN areas a ON gp.area_id = a.id
            WHERE gp.id = ?
        """, (entry["ground_plant_id"],)).fetchone()
        entry["ground_plant_name"] = (gp["gp_name"] or gp["plant_name"]) if gp else None
        entry["area_name"] = gp["area_name"] if gp else None
    else:
        entry["ground_plant_name"] = None
        entry["area_name"] = None
    # Parse tags JSON
    if entry.get("tags"):
        try:
            entry["tags"] = json.loads(entry["tags"])
        except (json.JSONDecodeError, TypeError):
            entry["tags"] = []
    else:
        entry["tags"] = []
    # Attach journal entry photos
    if isinstance(entry.get("id"), int):
        photo_rows = db.execute(
            "SELECT id, filename, original_filename, caption, created_at FROM journal_entry_photos WHERE journal_entry_id = ? ORDER BY created_at ASC",
            (entry["id"],),
        ).fetchall()
        entry["photos"] = [dict(r) for r in photo_rows]
        entry["photo_count"] = len(photo_rows)
    else:
        entry["photos"] = []
        entry["photo_count"] = 0
    return entry


@router.get("/api/journal")
def list_journal_entries(
    entry_type: Optional[str] = None,
    plant_id: Optional[int] = None,
    bed_id: Optional[int] = None,
    tray_id: Optional[int] = None,
    ground_plant_id: Optional[int] = None,
    limit: int = Query(100, ge=1, le=500),
):
    """List journal entries with optional filters."""
    with get_db() as db:
        clauses = []
        params: list = []
        if entry_type:
            clauses.append("entry_type = ?")
            params.append(entry_type)
        if plant_id:
            clauses.append("plant_id = ?")
            params.append(plant_id)
        if bed_id:
            clauses.append("bed_id = ?")
            params.append(bed_id)
        if tray_id:
            clauses.append("tray_id = ?")
            params.append(tray_id)
        if ground_plant_id:
            clauses.append("ground_plant_id = ?")
            params.append(ground_plant_id)
        where = f"WHERE {' AND '.join(clauses)}" if clauses else ""
        params.append(limit)
        rows = db.execute(f"SELECT * FROM journal_entries {where} ORDER BY created_at DESC LIMIT ?", params).fetchall()
        entries = [dict(r) for r in rows]
        return [_enrich_journal_entry(db, e) for e in entries]


@router.post("/api/journal")
def create_journal_entry(entry: JournalEntryCreate):
    """Create a new journal entry."""
    valid_types = ('note', 'observation', 'milestone', 'problem', 'harvest', 'weather', 'photo')
    if entry.entry_type not in valid_types:
        raise HTTPException(400, f"Invalid entry_type. Must be one of: {', '.join(valid_types)}")
    valid_moods = ('great', 'good', 'okay', 'concerned', 'bad')
    if entry.mood and entry.mood not in valid_moods:
        raise HTTPException(400, f"Invalid mood. Must be one of: {', '.join(valid_moods)}")
    valid_severities = ('low', 'medium', 'high', 'critical')
    if entry.severity and entry.severity not in valid_severities:
        raise HTTPException(400, f"Invalid severity. Must be one of: {', '.join(valid_severities)}")
    valid_milestones = ('sprouted', 'flowering', 'fruiting', 'first_harvest', 'established')
    if entry.milestone_type and entry.milestone_type not in valid_milestones:
        raise HTTPException(400, f"Invalid milestone_type. Must be one of: {', '.join(valid_milestones)}")

    tags_json = json.dumps(entry.tags) if entry.tags else None

    with get_db() as db:
        cursor = db.execute(
            """INSERT INTO journal_entries (entry_type, title, content, plant_id, planting_id, bed_id, tray_id, tray_cell_id, ground_plant_id, photo_id, mood, tags, severity, milestone_type)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (entry.entry_type, entry.title, entry.content, entry.plant_id, entry.planting_id,
             entry.bed_id, entry.tray_id, entry.tray_cell_id, entry.ground_plant_id, entry.photo_id,
             entry.mood, tags_json, entry.severity, entry.milestone_type),
        )
        db.commit()
        row = db.execute("SELECT * FROM journal_entries WHERE id = ?", (cursor.lastrowid,)).fetchone()
        return _enrich_journal_entry(db, dict(row))


@router.patch("/api/journal/{entry_id}")
def update_journal_entry(entry_id: int, data: JournalEntryUpdate):
    """Update an existing journal entry."""
    with get_db() as db:
        existing = db.execute("SELECT * FROM journal_entries WHERE id = ?", (entry_id,)).fetchone()
        if not existing:
            raise HTTPException(404, "Journal entry not found")

        fields = []
        params: list = []
        if data.entry_type is not None:
            valid_types = ('note', 'observation', 'milestone', 'problem', 'harvest', 'weather', 'photo')
            if data.entry_type not in valid_types:
                raise HTTPException(400, f"Invalid entry_type. Must be one of: {', '.join(valid_types)}")
            fields.append("entry_type = ?")
            params.append(data.entry_type)
        if data.title is not None:
            fields.append("title = ?")
            params.append(data.title)
        if data.content is not None:
            fields.append("content = ?")
            params.append(data.content)
        if data.plant_id is not None:
            fields.append("plant_id = ?")
            params.append(data.plant_id)
        if data.planting_id is not None:
            fields.append("planting_id = ?")
            params.append(data.planting_id)
        if data.bed_id is not None:
            fields.append("bed_id = ?")
            params.append(data.bed_id)
        if data.tray_id is not None:
            fields.append("tray_id = ?")
            params.append(data.tray_id)
        if data.ground_plant_id is not None:
            fields.append("ground_plant_id = ?")
            params.append(data.ground_plant_id)
        if data.photo_id is not None:
            fields.append("photo_id = ?")
            params.append(data.photo_id)
        if data.mood is not None:
            valid_moods = ('great', 'good', 'okay', 'concerned', 'bad')
            if data.mood and data.mood not in valid_moods:
                raise HTTPException(400, f"Invalid mood. Must be one of: {', '.join(valid_moods)}")
            fields.append("mood = ?")
            params.append(data.mood)
        if data.tags is not None:
            fields.append("tags = ?")
            params.append(json.dumps(data.tags))
        if data.tray_cell_id is not None:
            fields.append("tray_cell_id = ?")
            params.append(data.tray_cell_id)
        if data.severity is not None:
            valid_severities = ('low', 'medium', 'high', 'critical')
            if data.severity and data.severity not in valid_severities:
                raise HTTPException(400, f"Invalid severity. Must be one of: {', '.join(valid_severities)}")
            fields.append("severity = ?")
            params.append(data.severity)
        if data.milestone_type is not None:
            valid_milestones = ('sprouted', 'flowering', 'fruiting', 'first_harvest', 'established')
            if data.milestone_type and data.milestone_type not in valid_milestones:
                raise HTTPException(400, f"Invalid milestone_type. Must be one of: {', '.join(valid_milestones)}")
            fields.append("milestone_type = ?")
            params.append(data.milestone_type)

        if not fields:
            raise HTTPException(400, "No fields to update")

        params.append(entry_id)
        db.execute(f"UPDATE journal_entries SET {', '.join(fields)} WHERE id = ?", params)
        db.commit()

        row = db.execute("SELECT * FROM journal_entries WHERE id = ?", (entry_id,)).fetchone()
        return _enrich_journal_entry(db, dict(row))


@router.delete("/api/journal/{entry_id}")
def delete_journal_entry(entry_id: int):
    """Delete a journal entry."""
    with get_db() as db:
        existing = db.execute("SELECT * FROM journal_entries WHERE id = ?", (entry_id,)).fetchone()
        if not existing:
            raise HTTPException(404, "Journal entry not found")
        # Snapshot for undo (keep photo files on disk so undo can restore DB references)
        photos = [dict(r) for r in db.execute("SELECT * FROM journal_entry_photos WHERE journal_entry_id = ?", (entry_id,)).fetchall()]
        undo_id = create_undo_action(db, "delete_journal", {
            "entry": dict(existing), "photos": photos,
        })
        db.execute("DELETE FROM journal_entry_photos WHERE journal_entry_id = ?", (entry_id,))
        db.execute("DELETE FROM journal_entries WHERE id = ?", (entry_id,))
        db.commit()
        return {"ok": True, "undo_id": undo_id}


# ──────────────── JOURNAL ENTRY PHOTOS ────────────────


@router.post("/api/journal/{entry_id}/photos")
async def upload_journal_photos(
    entry_id: int,
    files: list[UploadFile] = File(...),
):
    """Upload one or more photos to a journal entry."""
    with get_db() as db:
        existing = db.execute("SELECT id FROM journal_entries WHERE id = ?", (entry_id,)).fetchone()
        if not existing:
            raise HTTPException(404, "Journal entry not found")

    results = []
    for file in files:
        if file.content_type not in ALLOWED_PHOTO_TYPES:
            raise HTTPException(400, f"File type {file.content_type} not allowed. Use JPEG, PNG, or WebP.")

        contents = await file.read()
        if len(contents) > MAX_PHOTO_SIZE:
            raise HTTPException(400, "File too large. Maximum size is 10MB.")

        ext = PHOTO_EXTENSIONS.get(file.content_type, ".jpg")
        unique_name = f"{uuid.uuid4().hex}{ext}"
        photo_path = PHOTOS_DIR / unique_name

        # Resize if Pillow is available
        try:
            from PIL import Image
            import io
            img = Image.open(io.BytesIO(contents))
            if img.width > 1200:
                ratio = 1200 / img.width
                new_size = (1200, int(img.height * ratio))
                img = img.resize(new_size, Image.LANCZOS)
            buf = io.BytesIO()
            fmt = "JPEG" if ext in (".jpg", ".jpeg") else "PNG" if ext == ".png" else "WEBP"
            img.save(buf, format=fmt, quality=85, optimize=True)
            contents = buf.getvalue()
        except ImportError:
            pass

        photo_path.write_bytes(contents)

        with get_db() as db:
            cursor = db.execute(
                "INSERT INTO journal_entry_photos (journal_entry_id, filename, original_filename) VALUES (?, ?, ?)",
                (entry_id, unique_name, file.filename),
            )
            db.commit()
            photo_id = cursor.lastrowid

        results.append({
            "id": photo_id,
            "journal_entry_id": entry_id,
            "filename": unique_name,
            "original_filename": file.filename,
            "caption": None,
        })

    return results


@router.get("/api/journal/{entry_id}/photos")
def list_journal_entry_photos(entry_id: int):
    """List all photos for a journal entry."""
    with get_db() as db:
        existing = db.execute("SELECT id FROM journal_entries WHERE id = ?", (entry_id,)).fetchone()
        if not existing:
            raise HTTPException(404, "Journal entry not found")
        rows = db.execute(
            "SELECT * FROM journal_entry_photos WHERE journal_entry_id = ? ORDER BY created_at DESC",
            (entry_id,),
        ).fetchall()
        return [dict(r) for r in rows]


@router.get("/api/journal/photos/{photo_id}/file")
def serve_journal_photo(photo_id: int):
    """Serve a journal photo file."""
    with get_db() as db:
        row = db.execute("SELECT * FROM journal_entry_photos WHERE id = ?", (photo_id,)).fetchone()
        if not row:
            raise HTTPException(404, "Journal photo not found")
    photo_path = PHOTOS_DIR / row["filename"]
    if not photo_path.exists():
        raise HTTPException(404, "Photo file missing")
    ext = photo_path.suffix.lower()
    media_types = {".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp"}
    return FileResponse(str(photo_path), media_type=media_types.get(ext, "image/jpeg"))


@router.delete("/api/journal/photos/{photo_id}")
def delete_journal_photo(photo_id: int):
    """Delete a journal photo."""
    with get_db() as db:
        row = db.execute("SELECT * FROM journal_entry_photos WHERE id = ?", (photo_id,)).fetchone()
        if not row:
            raise HTTPException(404, "Journal photo not found")
        photo_path = PHOTOS_DIR / row["filename"]
        if photo_path.exists():
            photo_path.unlink()
        db.execute("DELETE FROM journal_entry_photos WHERE id = ?", (photo_id,))
        db.commit()
    return {"ok": True}


@router.get("/api/journal/feed")
def journal_feed(limit: int = Query(100, ge=1, le=500), entry_type: Optional[str] = None):
    """Combined feed of journal entries + photos + planting notes, sorted by date."""
    with get_db() as db:
        feed = []

        # 1. Journal entries
        je_clauses = []
        je_params: list = []
        if entry_type and entry_type not in ("planting_note",):
            je_clauses.append("entry_type = ?")
            je_params.append(entry_type)
        je_where = f"WHERE {' AND '.join(je_clauses)}" if je_clauses else ""
        je_params.append(limit)
        rows = db.execute(f"SELECT * FROM journal_entries {je_where} ORDER BY created_at DESC LIMIT ?", je_params).fetchall()
        for r in rows:
            entry = _enrich_journal_entry(db, dict(r))
            entry["source"] = "journal"
            feed.append(entry)

        # 2. Planting photos (not already linked to a journal entry)
        if not entry_type or entry_type == "photo":
            linked_photo_ids = db.execute("SELECT photo_id FROM journal_entries WHERE photo_id IS NOT NULL").fetchall()
            linked_ids = {r["photo_id"] for r in linked_photo_ids}
            photo_rows = db.execute("""
                SELECT pp.*, p.plant_id, pl.name as plant_name, pl.category,
                       p.bed_id, gb.name as bed_name
                FROM planting_photos pp
                JOIN plantings p ON pp.planting_id = p.id
                JOIN plants pl ON p.plant_id = pl.id
                LEFT JOIN garden_beds gb ON p.bed_id = gb.id
                ORDER BY pp.created_at DESC
                LIMIT ?
            """, (limit,)).fetchall()
            for r in photo_rows:
                photo = dict(r)
                if photo["id"] in linked_ids:
                    continue
                feed.append({
                    "id": f"photo_{photo['id']}",
                    "entry_type": "photo",
                    "title": photo.get("caption"),
                    "content": photo.get("caption") or f"Photo of {photo['plant_name']}",
                    "plant_id": photo.get("plant_id"),
                    "plant_name": photo.get("plant_name"),
                    "planting_id": photo.get("planting_id"),
                    "bed_id": photo.get("bed_id"),
                    "bed_name": photo.get("bed_name"),
                    "tray_id": None,
                    "tray_name": None,
                    "ground_plant_id": None,
                    "ground_plant_name": None,
                    "photo_id": photo["id"],
                    "mood": None,
                    "tags": [],
                    "created_at": photo.get("created_at"),
                    "source": "photo",
                    "category": photo.get("category"),
                    "photos": [],
                    "photo_count": 0,
                })

        # 3. Planting notes
        if not entry_type or entry_type == "planting_note":
            note_rows = db.execute("""
                SELECT pn.*, p.plant_id, pl.name as plant_name, pl.category as plant_category,
                       p.bed_id, gb.name as bed_name
                FROM planting_notes pn
                JOIN plantings p ON pn.planting_id = p.id
                JOIN plants pl ON p.plant_id = pl.id
                LEFT JOIN garden_beds gb ON p.bed_id = gb.id
                ORDER BY pn.recorded_at DESC
                LIMIT ?
            """, (limit,)).fetchall()
            for r in note_rows:
                note = dict(r)
                # Map planting_note types to journal entry_type
                type_map = {
                    "observation": "observation",
                    "problem": "problem",
                    "success": "milestone",
                    "lesson": "note",
                    "weather_impact": "weather",
                    "pest_issue": "problem",
                    "harvest_note": "harvest",
                }
                feed.append({
                    "id": f"note_{note['id']}",
                    "entry_type": type_map.get(note["note_type"], "note"),
                    "title": None,
                    "content": note["content"],
                    "plant_id": note.get("plant_id"),
                    "plant_name": note.get("plant_name"),
                    "planting_id": note.get("planting_id"),
                    "bed_id": note.get("bed_id"),
                    "bed_name": note.get("bed_name"),
                    "tray_id": None,
                    "tray_name": None,
                    "ground_plant_id": None,
                    "ground_plant_name": None,
                    "photo_id": None,
                    "mood": None,
                    "tags": [],
                    "created_at": note.get("recorded_at"),
                    "source": "planting_note",
                    "severity": note.get("severity"),
                    "note_type": note.get("note_type"),
                    "photos": [],
                    "photo_count": 0,
                })

        # Sort combined feed by created_at descending
        feed.sort(key=lambda x: x.get("created_at") or "", reverse=True)
        return feed[:limit]


# ──────────────── AI SUMMARY ────────────────


@router.post("/api/journal/ai-summary")
async def generate_journal_summary(request: Request, days: int = Query(7, ge=1, le=90)):
    """Generate an AI summary of recent garden activity."""
    require_user(request)

    openai_key = get_openai_key()
    if not openai_key:
        raise HTTPException(400, "OpenAI not configured")

    with get_db() as db:
        journal_entries = db.execute(
            "SELECT title, content, entry_type, created_at FROM journal_entries WHERE created_at > datetime('now', ?)",
            (f'-{days} days',)
        ).fetchall()

        completed_tasks = db.execute(
            "SELECT title, task_type, completed_date FROM garden_tasks WHERE status = 'completed' AND completed_date > date('now', ?)",
            (f'-{days} days',)
        ).fetchall()

        harvests = db.execute("""
            SELECT h.amount, h.unit, h.quality_rating, h.harvested_date, p.name as plant_name
            FROM harvests h JOIN plants p ON h.plant_id = p.id
            WHERE h.harvested_date > date('now', ?)
        """, (f'-{days} days',)).fetchall()

        context_parts = []
        if journal_entries:
            context_parts.append(f"Journal entries ({len(journal_entries)}):")
            for j in journal_entries[:10]:
                d = dict(j)
                context_parts.append(f"  - [{d['entry_type']}] {d['title']}: {(d['content'] or '')[:100]}")

        if completed_tasks:
            context_parts.append(f"\nCompleted tasks ({len(completed_tasks)}):")
            for t in completed_tasks[:15]:
                context_parts.append(f"  - {dict(t)['title']}")

        if harvests:
            context_parts.append(f"\nHarvests ({len(harvests)}):")
            for h in harvests:
                d = dict(h)
                context_parts.append(f"  - {d['plant_name']}: {d['amount']} {d['unit']}")

        if not context_parts:
            return {"summary": f"No garden activity recorded in the last {days} days. Get out there and garden!", "days": days, "activity": {"journal_entries": 0, "tasks_completed": 0, "harvests": 0}}

        context = "\n".join(context_parts)

    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.post(
            "https://api.openai.com/v1/chat/completions",
            headers={"Authorization": f"Bearer {openai_key}"},
            json={
                "model": "gpt-4o-mini",
                "messages": [
                    {"role": "system", "content": "You are a friendly garden assistant. Write a brief, encouraging weekly garden summary based on the activity data provided. Include highlights, accomplishments, and gentle suggestions. Keep it warm and concise (2-3 short paragraphs). Use plain text, no markdown."},
                    {"role": "user", "content": f"Summarize this garden activity from the last {days} days:\n\n{context}"}
                ],
                "max_tokens": 500,
            }
        )
        if resp.status_code == 200:
            data = resp.json()
            summary = data["choices"][0]["message"]["content"]
            return {
                "summary": summary,
                "days": days,
                "activity": {
                    "journal_entries": len(journal_entries),
                    "tasks_completed": len(completed_tasks),
                    "harvests": len(harvests),
                },
            }
        else:
            raise HTTPException(500, f"OpenAI API error: {resp.status_code}")

