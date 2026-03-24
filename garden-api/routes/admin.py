"""Admin endpoints — audit log, backups, updates."""
from __future__ import annotations

import json
import logging
import sqlite3
import shutil
import subprocess
import asyncio

logger = logging.getLogger(__name__)
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, HTTPException, Query, Request
from fastapi.responses import FileResponse, Response

from db import get_db, DB_PATH
from auth import require_user, require_admin, audit_log
from models import AutoUpdateSettings

router = APIRouter()

# ──────────────── AUDIT LOG ENDPOINTS ────────────────

@router.get("/api/audit")
def get_audit_log(request: Request, limit: int = 50, offset: int = 0, entity_type: str = None, user_id: int = None, action: str = None):
    admin = require_admin(request)
    with get_db() as db:
        query = """
            SELECT al.*, u.display_name as user_name, u.username
            FROM audit_log al
            JOIN users u ON al.user_id = u.id
            WHERE 1=1
        """
        params = []
        if entity_type:
            query += " AND al.entity_type = ?"
            params.append(entity_type)
        if user_id:
            query += " AND al.user_id = ?"
            params.append(user_id)
        if action:
            query += " AND al.action = ?"
            params.append(action)
        query += " ORDER BY al.created_at DESC LIMIT ? OFFSET ?"
        params.extend([limit, offset])
        rows = db.execute(query, params).fetchall()
        return [dict(r) for r in rows]

@router.get("/api/audit/entity/{entity_type}/{entity_id}")
def get_entity_audit(entity_type: str, entity_id: str, request: Request):
    require_user(request)
    with get_db() as db:
        rows = db.execute("""
            SELECT al.*, u.display_name as user_name, u.username
            FROM audit_log al
            JOIN users u ON al.user_id = u.id
            WHERE al.entity_type = ? AND al.entity_id = ?
            ORDER BY al.created_at DESC
            LIMIT 50
        """, (entity_type, entity_id)).fetchall()
        return [dict(r) for r in rows]

@router.post("/api/undo/{action_id}")
def undo_action(action_id: str):
    """Reverse a recent destructive action if it hasn't expired."""
    with get_db() as db:
        action = db.execute("SELECT * FROM undo_actions WHERE id = ?", (action_id,)).fetchone()
        if not action:
            raise HTTPException(404, "Undo action not found")
        if action["undone"]:
            raise HTTPException(400, "Action already undone")
        if datetime.utcnow().isoformat() > action["expires_at"]:
            raise HTTPException(410, "Undo window expired")

        data = json.loads(action["entity_data"])
        action_type = action["action_type"]

        if action_type == "delete_planting":
            _restore_rows(db, "plantings", [data["planting"]])
            _restore_rows(db, "planting_notes", data.get("notes", []))
            _restore_rows(db, "planting_photos", data.get("photos", []))
            _restore_rows(db, "harvests", data.get("harvests", []))
        elif action_type == "delete_bed":
            _restore_rows(db, "garden_beds", [data["bed"]])
            _restore_rows(db, "plantings", data.get("plantings", []))
            _restore_rows(db, "bed_sections", data.get("sections", []))
        elif action_type == "delete_tray":
            _restore_rows(db, "seed_trays", [data["tray"]])
            _restore_rows(db, "seed_tray_cells", data.get("cells", []))
        elif action_type == "delete_ground_plant":
            _restore_rows(db, "ground_plants", [data["ground_plant"]])
        elif action_type == "delete_journal":
            _restore_rows(db, "journal_entries", [data["entry"]])
            _restore_rows(db, "journal_entry_photos", data.get("photos", []))
        elif action_type == "delete_harvest":
            _restore_rows(db, "harvests", [data["harvest"]])
        elif action_type == "delete_expense":
            _restore_rows(db, "expenses", [data["expense"]])
        else:
            raise HTTPException(400, f"Unknown action type: {action_type}")

        db.execute("UPDATE undo_actions SET undone = 1 WHERE id = ?", (action_id,))
        cleanup_expired_undo_actions(db)
        db.commit()
        return {"ok": True, "action_type": action_type}

# ──────────────── BACKUP SYSTEM ────────────────

BACKUP_DIR = Path("/app/data/backups")
BACKUP_RETENTION_DAYS = 14


def _create_backup(prefix: str = "plants") -> dict | None:
    """Create a backup of the SQLite database using the SQLite backup API."""
    BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    src = Path("/app/data/plants.db")
    if not src.exists():
        return None
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    filename = f"{prefix}_{timestamp}.db"
    backup_path = BACKUP_DIR / filename
    source_db = sqlite3.connect(str(src))
    backup_db = sqlite3.connect(str(backup_path))
    source_db.backup(backup_db)
    backup_db.close()
    source_db.close()
    size = backup_path.stat().st_size
    return {"filename": filename, "timestamp": timestamp, "size": size}


def _cleanup_old_backups():
    """Delete backups older than retention period."""
    cutoff = datetime.now() - timedelta(days=BACKUP_RETENTION_DAYS)
    for f in BACKUP_DIR.glob("plants_*.db"):
        try:
            ts_str = f.stem.replace("plants_", "").replace("plants_predeploy_", "")
            file_time = datetime.strptime(ts_str, "%Y%m%d_%H%M%S")
            if file_time < cutoff:
                f.unlink()
        except Exception:
            pass
    # Also clean predeploy backups
    for f in BACKUP_DIR.glob("plants_predeploy_*.db"):
        try:
            ts_str = f.stem.replace("plants_predeploy_", "")
            file_time = datetime.strptime(ts_str, "%Y%m%d_%H%M%S")
            if file_time < cutoff:
                f.unlink()
        except Exception:
            pass


async def _backup_loop():
    """Hourly backup of the SQLite database."""
    BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    while True:
        try:
            _create_backup("plants")
            _cleanup_old_backups()
        except Exception as e:
            logger.error(f"Backup error: {e}")
        await asyncio.sleep(3600)  # 1 hour


async def startup_backup_loop():
    asyncio.create_task(_backup_loop())


@router.get("/api/backups")
async def list_backups():
    """List all backups with timestamps and sizes."""
    BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    backups = []
    for f in sorted(BACKUP_DIR.glob("plants*.db"), reverse=True):
        try:
            stat = f.stat()
            backups.append({
                "filename": f.name,
                "size": stat.st_size,
                "created_at": datetime.fromtimestamp(stat.st_mtime).isoformat(),
            })
        except Exception:
            pass
    return {"backups": backups, "retention_days": BACKUP_RETENTION_DAYS}


@router.post("/api/backups/create")
async def create_backup_now():
    """Create a manual backup immediately."""
    result = _create_backup("plants")
    if result is None:
        raise HTTPException(status_code=404, detail="No database found to back up")
    return {"ok": True, "backup": result}


@router.post("/api/backups/{filename}/restore")
async def restore_backup(filename: str, body: dict | None = None):
    """Restore from a specific backup. Requires confirmation_token='RESTORE' in body."""
    if not body or body.get("confirmation_token") != "RESTORE":
        raise HTTPException(status_code=400, detail="Must send {\"confirmation_token\": \"RESTORE\"} to confirm")
    backup_path = BACKUP_DIR / filename
    if not backup_path.exists():
        raise HTTPException(status_code=404, detail="Backup not found")
    # Validate filename to prevent path traversal
    if "/" in filename or "\\" in filename or ".." in filename:
        raise HTTPException(status_code=400, detail="Invalid filename")
    # Create a pre-restore backup first
    _create_backup("plants_prerestore")
    # Restore
    target = Path("/app/data/plants.db")
    source_db = sqlite3.connect(str(backup_path))
    target_db = sqlite3.connect(str(target))
    source_db.backup(target_db)
    target_db.close()
    source_db.close()
    return {"ok": True, "restored_from": filename}


@router.get("/api/backups/{filename}/download")
async def download_backup(filename: str):
    """Download a backup file."""
    if "/" in filename or "\\" in filename or ".." in filename:
        raise HTTPException(status_code=400, detail="Invalid filename")
    backup_path = BACKUP_DIR / filename
    if not backup_path.exists():
        raise HTTPException(status_code=404, detail="Backup not found")
    return FileResponse(
        str(backup_path),
        media_type="application/x-sqlite3",
        filename=filename,
    )


@router.delete("/api/backups/{filename}")
async def delete_backup(filename: str):
    """Delete a specific backup."""
    if "/" in filename or "\\" in filename or ".." in filename:
        raise HTTPException(status_code=400, detail="Invalid filename")
    backup_path = BACKUP_DIR / filename
    if not backup_path.exists():
        raise HTTPException(status_code=404, detail="Backup not found")
    backup_path.unlink()
    return {"ok": True, "deleted": filename}


# ──────────────── UPDATE SYSTEM ────────────────


@router.get("/api/admin/update/status")
async def update_status(request: Request):
    """Check current version and if updates are available."""
    require_admin(request)

    current_commit = None
    current_date = None
    try:
        result = subprocess.run(["git", "rev-parse", "--short", "HEAD"], capture_output=True, text=True, cwd="/app")
        current_commit = result.stdout.strip() if result.returncode == 0 else None
        result = subprocess.run(["git", "log", "-1", "--format=%ci"], capture_output=True, text=True, cwd="/app")
        current_date = result.stdout.strip() if result.returncode == 0 else None
    except Exception:
        pass

    remote_commit = None
    remote_date = None
    remote_message = None
    commits_behind = 0
    try:
        subprocess.run(["git", "fetch", "origin", "main"], capture_output=True, text=True, cwd="/app", timeout=30)
        result = subprocess.run(["git", "rev-parse", "--short", "origin/main"], capture_output=True, text=True, cwd="/app")
        remote_commit = result.stdout.strip() if result.returncode == 0 else None
        result = subprocess.run(["git", "log", "-1", "origin/main", "--format=%ci"], capture_output=True, text=True, cwd="/app")
        remote_date = result.stdout.strip() if result.returncode == 0 else None
        result = subprocess.run(["git", "log", "-1", "origin/main", "--format=%s"], capture_output=True, text=True, cwd="/app")
        remote_message = result.stdout.strip() if result.returncode == 0 else None
        result = subprocess.run(["git", "rev-list", "HEAD..origin/main", "--count"], capture_output=True, text=True, cwd="/app")
        commits_behind = int(result.stdout.strip()) if result.returncode == 0 else 0
    except Exception:
        pass

    auto_update = False
    last_update = None
    last_result = None
    with get_db() as db:
        row = db.execute("SELECT value FROM app_config WHERE key = 'auto_update_enabled'").fetchone()
        auto_update = row is not None and row["value"] == "1"
        row = db.execute("SELECT value FROM app_config WHERE key = 'auto_update_schedule'").fetchone()
        auto_schedule = row["value"] if row else "daily"
        row = db.execute("SELECT value FROM app_config WHERE key = 'auto_update_time'").fetchone()
        auto_time = row["value"] if row else "03:00"
        row = db.execute("SELECT value FROM app_config WHERE key = 'last_update_at'").fetchone()
        last_update = row["value"] if row else None
        row = db.execute("SELECT value FROM app_config WHERE key = 'last_update_result'").fetchone()
        last_result = row["value"] if row else None

    return {
        "current_commit": current_commit,
        "current_date": current_date,
        "remote_commit": remote_commit,
        "remote_date": remote_date,
        "remote_message": remote_message,
        "commits_behind": commits_behind,
        "update_available": commits_behind > 0,
        "auto_update_enabled": auto_update,
        "auto_update_schedule": auto_schedule,
        "auto_update_time": auto_time,
        "last_update_at": last_update,
        "last_update_result": last_result,
    }

@router.get("/api/admin/update/changelog")
async def update_changelog(request: Request):
    """Get list of commits between current and remote."""
    require_admin(request)
    try:
        subprocess.run(["git", "fetch", "origin", "main"], capture_output=True, text=True, cwd="/app", timeout=30)
        result = subprocess.run(
            ["git", "log", "HEAD..origin/main", "--format=%h|%s|%ci|%an"],
            capture_output=True, text=True, cwd="/app"
        )
        commits = []
        for line in result.stdout.strip().split("\n"):
            if "|" in line:
                parts = line.split("|", 3)
                commits.append({
                    "hash": parts[0],
                    "message": parts[1] if len(parts) > 1 else "",
                    "date": parts[2] if len(parts) > 2 else "",
                    "author": parts[3] if len(parts) > 3 else "",
                })
        return {"commits": commits}
    except Exception as e:
        return {"commits": [], "error": str(e)}

@router.post("/api/admin/update/apply")
async def apply_update(request: Request):
    """Signal the host to pull latest code and rebuild containers."""
    require_admin(request)

    try:
        # Write a signal file to the shared data volume
        # The host-side auto-update script watches for this file
        signal_path = Path("/app/data/.update-requested")
        signal_path.write_text(datetime.utcnow().isoformat())

        with get_db() as db:
            db.execute(
                "INSERT OR REPLACE INTO app_config (key, value) VALUES (?, ?)",
                ("last_update_at", datetime.utcnow().isoformat()),
            )
            db.execute(
                "INSERT OR REPLACE INTO app_config (key, value) VALUES (?, ?)",
                ("last_update_result", "pending: update requested, waiting for host rebuild"),
            )
            db.commit()

        return {
            "ok": True,
            "message": "Update requested. The host will pull and rebuild containers shortly. The app will restart automatically.",
        }
    except Exception as e:
        with get_db() as db:
            db.execute(
                "INSERT OR REPLACE INTO app_config (key, value) VALUES (?, ?)",
                ("last_update_result", f"failed: {str(e)[:200]}"),
            )
            db.commit()
        raise HTTPException(500, f"Update request failed: {str(e)[:200]}")

@router.put("/api/admin/update/auto")
def toggle_auto_update(body: AutoUpdateSettings, request: Request):
    """Configure automatic update settings."""
    require_admin(request)
    if body.schedule not in ("daily", "twice_daily", "weekly", "manual"):
        raise HTTPException(400, "Invalid schedule. Use: daily, twice_daily, weekly, manual")
    with get_db() as db:
        db.execute("INSERT OR REPLACE INTO app_config (key, value) VALUES (?, ?)",
                   ("auto_update_enabled", "1" if body.enabled else "0"))
        db.execute("INSERT OR REPLACE INTO app_config (key, value) VALUES (?, ?)",
                   ("auto_update_schedule", body.schedule))
        db.execute("INSERT OR REPLACE INTO app_config (key, value) VALUES (?, ?)",
                   ("auto_update_time", body.time))
        db.commit()
    return {"ok": True, "auto_update_enabled": body.enabled, "schedule": body.schedule, "time": body.time}
