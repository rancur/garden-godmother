"""Photo upload + AI analysis endpoints."""
from __future__ import annotations

import json
import logging
import uuid
from pathlib import Path
from typing import Optional

import httpx
from fastapi import APIRouter, HTTPException, Query, Request, UploadFile, File, Form
from fastapi.responses import FileResponse, Response

from db import get_db
from auth import require_user, require_admin, audit_log
from constants import PHOTOS_DIR, ALLOWED_PHOTO_TYPES, MAX_PHOTO_SIZE, PHOTO_EXTENSIONS, _get_configured_zone
from services.integrations import get_openai_key
from services.notifications import send_notification

logger = logging.getLogger(__name__)

router = APIRouter()

# ──────────────── PLANTING PHOTOS ────────────────

PHOTO_EXTENSIONS = {"image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp"}


@router.post("/api/plantings/{planting_id}/photos")
async def upload_planting_photo(
    request: Request,
    planting_id: int,
    file: UploadFile = File(...),
    caption: str = Form(None),
    taken_at: str = Form(None),
):
    """Upload a photo for a planting."""
    with get_db() as db:
        existing = db.execute("SELECT id FROM plantings WHERE id = ?", (planting_id,)).fetchone()
        if not existing:
            raise HTTPException(404, "Planting not found")

    if file.content_type not in ALLOWED_PHOTO_TYPES:
        raise HTTPException(400, f"File type {file.content_type} not allowed. Use JPEG, PNG, or WebP.")

    contents = await file.read()
    if len(contents) > MAX_PHOTO_SIZE:
        raise HTTPException(400, "File too large. Maximum size is 10MB.")

    ext = PHOTO_EXTENSIONS.get(file.content_type, ".jpg")
    unique_name = f"{uuid.uuid4().hex}{ext}"
    photo_path = PHOTOS_DIR / unique_name

    # Try to resize if Pillow is available
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
        pass  # Pillow not installed — save original

    photo_path.write_bytes(contents)

    with get_db() as db:
        cursor = db.execute(
            "INSERT INTO planting_photos (planting_id, filename, caption, taken_at) VALUES (?, ?, ?, ?)",
            (planting_id, unique_name, caption, taken_at),
        )
        db.commit()
        photo_id = cursor.lastrowid

    return {
        "id": photo_id,
        "planting_id": planting_id,
        "filename": unique_name,
        "caption": caption,
        "taken_at": taken_at,
    }


@router.get("/api/plantings/{planting_id}/photos")
def list_planting_photos(planting_id: int):
    """List all photos for a planting."""
    with get_db() as db:
        existing = db.execute("SELECT id FROM plantings WHERE id = ?", (planting_id,)).fetchone()
        if not existing:
            raise HTTPException(404, "Planting not found")
        rows = db.execute(
            "SELECT * FROM planting_photos WHERE planting_id = ? ORDER BY created_at DESC",
            (planting_id,),
        ).fetchall()
        return [dict(r) for r in rows]


@router.get("/api/photos/recent")
def list_recent_photos(limit: int = Query(50, ge=1, le=200)):
    """List recent photos across all plantings with plant/bed info."""
    with get_db() as db:
        rows = db.execute("""
            SELECT pp.*, p.plant_id, pl.name as plant_name, pl.category,
                   p.bed_id, gb.name as bed_name
            FROM planting_photos pp
            JOIN plantings p ON pp.planting_id = p.id
            JOIN plants pl ON p.plant_id = pl.id
            LEFT JOIN garden_beds gb ON p.bed_id = gb.id
            ORDER BY pp.created_at DESC
            LIMIT ?
        """, (limit,)).fetchall()
        return [dict(r) for r in rows]


@router.post("/api/photos/health-check")
async def run_health_check(request: Request):
    """Analyze recent unanalyzed photos for plant health issues."""
    require_admin(request)
    openai_key = get_openai_key()
    if not openai_key:
        raise HTTPException(400, "OpenAI not configured")
    with get_db() as db:
        photos = db.execute("""
            SELECT pp.id, pp.filename, pp.planting_id, pl.plant_id,
                   p.name as plant_name, gb.name as bed_name
            FROM planting_photos pp
            LEFT JOIN plantings pl ON pp.planting_id = pl.id
            LEFT JOIN plants p ON pl.plant_id = p.id
            LEFT JOIN garden_beds gb ON pl.bed_id = gb.id
            WHERE pp.id NOT IN (SELECT photo_id FROM photo_analyses WHERE photo_id IS NOT NULL)
            AND pp.created_at > datetime('now', '-7 days')
            LIMIT 10
        """).fetchall()
    results = []
    for photo in photos:
        photo_dict = dict(photo)
        try:
            analysis = await _analyze_photo_health(openai_key, photo_dict)
            results.append(analysis)
            health_status = analysis.get("health_status", "healthy")
            if health_status in ("poor", "critical"):
                with get_db() as db:
                    admins = db.execute("SELECT id FROM users WHERE role = 'admin' AND is_active = 1").fetchall()
                    for admin in admins:
                        await send_notification(admin["id"], "plant_health",
                            f"Plant Health Alert: {photo_dict.get('plant_name', 'Unknown')}",
                            f"{analysis.get('summary', 'Health issue detected')} -- {photo_dict.get('bed_name') or 'Unknown location'}")
        except Exception as e:
            logger.error(f"Health check failed for photo {photo_dict['id']}: {e}")
            results.append({"photo_id": photo_dict["id"], "error": str(e)[:200]})
    return {"analyzed": len(results), "results": results}


@router.get("/api/photos/health-summary")
def get_health_summary(request: Request):
    """Get a summary of recent plant health analyses."""
    require_user(request)
    with get_db() as db:
        recent = db.execute("""
            SELECT pa.id, pa.photo_id, pa.plant_identified, pa.growth_stage,
                   pa.health, pa.issues, pa.recommendations, pa.confidence,
                   pa.summary, pa.model, pa.analyzed_at,
                   pp.filename, pp.planting_id,
                   pl.plant_id, p.name as plant_name, gb.name as bed_name
            FROM photo_analyses pa
            JOIN planting_photos pp ON pa.photo_id = pp.id
            LEFT JOIN plantings pl ON pp.planting_id = pl.id
            LEFT JOIN plants p ON pl.plant_id = p.id
            LEFT JOIN garden_beds gb ON pl.bed_id = gb.id
            ORDER BY pa.analyzed_at DESC LIMIT 50
        """).fetchall()
        results = []
        for r in recent:
            row = dict(r)
            row["issues"] = json.loads(row["issues"]) if row["issues"] else []
            row["recommendations"] = json.loads(row["recommendations"]) if row["recommendations"] else []
            row["health_status"] = _map_health_to_status(row.get("health", ""))
            results.append(row)
        return results


@router.get("/api/photos/{photo_id}")
def serve_photo(photo_id: int):
    """Serve a photo file."""
    with get_db() as db:
        row = db.execute("SELECT * FROM planting_photos WHERE id = ?", (photo_id,)).fetchone()
        if not row:
            raise HTTPException(404, "Photo not found")
    photo_path = PHOTOS_DIR / row["filename"]
    if not photo_path.exists():
        raise HTTPException(404, "Photo file missing")
    # Determine media type from extension
    ext = photo_path.suffix.lower()
    media_types = {".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp"}
    return FileResponse(str(photo_path), media_type=media_types.get(ext, "image/jpeg"))


@router.delete("/api/photos/{photo_id}")
def delete_photo(photo_id: int):
    """Delete a photo."""
    with get_db() as db:
        row = db.execute("SELECT * FROM planting_photos WHERE id = ?", (photo_id,)).fetchone()
        if not row:
            raise HTTPException(404, "Photo not found")
        # Delete file
        photo_path = PHOTOS_DIR / row["filename"]
        if photo_path.exists():
            photo_path.unlink()
        db.execute("DELETE FROM planting_photos WHERE id = ?", (photo_id,))
        db.commit()
    return {"ok": True}


# ──────────────── PHOTO AI ANALYSIS ────────────────

import base64

def _get_plant_analysis_prompt() -> str:
    """Build plant analysis prompt with the configured zone info."""
    zone = _get_configured_zone()
    zone_desc = f"USDA Zone {zone}" if zone != "Not set" else "the gardener's local climate"
    return f"""You are an expert gardener specializing in {zone_desc}. You diagnose plant health from photos, considering the local climate conditions.

Analyze the plant photo and return a JSON object with these fields:
- "plant_identified": string — what plant this appears to be
- "growth_stage": one of "seedling", "vegetative", "flowering", "fruiting", "mature"
- "health": one of "healthy", "stressed", "diseased", "dying"
- "issues": array of objects, each with:
  - "type": one of "disease", "pest", "nutrient", "environmental"
  - "name": string (e.g. "powdery mildew", "aphids", "nitrogen deficiency", "sunscald")
  - "severity": one of "low", "medium", "high"
  - "description": string — brief explanation of what you see
- "recommendations": array of strings — specific actionable advice for {zone_desc}
- "confidence": one of "high", "medium", "low"
- "summary": string — 1-2 sentence overall assessment

If the plant looks healthy with no issues, return an empty issues array and positive recommendations for continued care.

Return ONLY valid JSON, no markdown fences or extra text."""


@router.post("/api/photos/{photo_id}/analyze")
async def analyze_photo(photo_id: int):
    """Analyze a photo using GPT-4o vision for plant health assessment."""
    openai_api_key = get_openai_key()
    if not openai_api_key:
        raise HTTPException(500, "OpenAI API key not configured")

    with get_db() as db:
        row = db.execute("SELECT * FROM planting_photos WHERE id = ?", (photo_id,)).fetchone()
        if not row:
            raise HTTPException(404, "Photo not found")

        # Check for existing analysis
        existing = db.execute("SELECT * FROM photo_analyses WHERE photo_id = ?", (photo_id,)).fetchone()
        if existing:
            result = dict(existing)
            result["issues"] = json.loads(result["issues"]) if result["issues"] else []
            result["recommendations"] = json.loads(result["recommendations"]) if result["recommendations"] else []
            return result

    # Read and encode the photo
    photo_path = PHOTOS_DIR / row["filename"]
    if not photo_path.exists():
        raise HTTPException(404, "Photo file missing")

    photo_bytes = photo_path.read_bytes()
    ext = photo_path.suffix.lower()
    mime_map = {".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp"}
    mime_type = mime_map.get(ext, "image/jpeg")
    b64_image = base64.b64encode(photo_bytes).decode("utf-8")

    # Call OpenAI GPT-4o vision
    async with httpx.AsyncClient(timeout=60.0) as client:
        try:
            resp = await client.post(
                "https://api.openai.com/v1/chat/completions",
                headers={
                    "Authorization": f"Bearer {openai_api_key}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": "gpt-4o",
                    "messages": [
                        {"role": "system", "content": _get_plant_analysis_prompt()},
                        {
                            "role": "user",
                            "content": [
                                {"type": "text", "text": "Analyze this plant photo for health, disease, and growing conditions."},
                                {
                                    "type": "image_url",
                                    "image_url": {
                                        "url": f"data:{mime_type};base64,{b64_image}",
                                        "detail": "high",
                                    },
                                },
                            ],
                        },
                    ],
                    "max_tokens": 1500,
                    "temperature": 0.3,
                },
            )
            resp.raise_for_status()
        except httpx.HTTPStatusError as e:
            logger.error(f"OpenAI API error: {e.response.status_code} {e.response.text}")
            raise HTTPException(502, f"OpenAI API error: {e.response.status_code}")
        except httpx.RequestError as e:
            logger.error(f"OpenAI request failed: {e}")
            raise HTTPException(502, "Failed to reach OpenAI API")

    data = resp.json()
    content = data["choices"][0]["message"]["content"].strip()

    # Strip markdown fences if present
    if content.startswith("```"):
        content = content.split("\n", 1)[1] if "\n" in content else content[3:]
        if content.endswith("```"):
            content = content[:-3].strip()

    try:
        analysis = json.loads(content)
    except json.JSONDecodeError:
        logger.error(f"Failed to parse OpenAI response as JSON: {content[:500]}")
        raise HTTPException(502, "OpenAI returned invalid JSON")

    # Store in database
    with get_db() as db:
        db.execute(
            """INSERT OR REPLACE INTO photo_analyses
               (photo_id, plant_identified, growth_stage, health, issues, recommendations, confidence, summary, model)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                photo_id,
                analysis.get("plant_identified", ""),
                analysis.get("growth_stage", ""),
                analysis.get("health", ""),
                json.dumps(analysis.get("issues", [])),
                json.dumps(analysis.get("recommendations", [])),
                analysis.get("confidence", ""),
                analysis.get("summary", ""),
                "gpt-4o",
            ),
        )
        db.commit()

        # Return the stored row
        stored = db.execute("SELECT * FROM photo_analyses WHERE photo_id = ?", (photo_id,)).fetchone()
        result = dict(stored)
        result["issues"] = json.loads(result["issues"]) if result["issues"] else []
        result["recommendations"] = json.loads(result["recommendations"]) if result["recommendations"] else []
        return result


@router.get("/api/photos/{photo_id}/analysis")
def get_photo_analysis(photo_id: int):
    """Retrieve stored analysis for a photo."""
    with get_db() as db:
        row = db.execute("SELECT * FROM planting_photos WHERE id = ?", (photo_id,)).fetchone()
        if not row:
            raise HTTPException(404, "Photo not found")

        analysis = db.execute("SELECT * FROM photo_analyses WHERE photo_id = ?", (photo_id,)).fetchone()
        if not analysis:
            raise HTTPException(404, "No analysis found for this photo")

        result = dict(analysis)
        result["issues"] = json.loads(result["issues"]) if result["issues"] else []
        result["recommendations"] = json.loads(result["recommendations"]) if result["recommendations"] else []
        return result


# ──────────────── HEALTH MONITORING ────────────────


def _map_health_to_status(health: str) -> str:
    """Map the analysis 'health' field to a health_status for monitoring.

    The existing analysis stores health as: healthy, stressed, diseased, dying.
    We map these to the monitoring statuses: healthy, fair, poor, critical.
    """
    mapping = {
        "healthy": "healthy",
        "stressed": "fair",
        "diseased": "poor",
        "dying": "critical",
    }
    return mapping.get(health, "fair")


async def _analyze_photo_health(openai_key: str, photo: dict) -> dict:
    """Analyze a single photo for plant health and store the result.

    Re-uses the existing GPT-4o vision analysis pipeline, then maps results
    into the health monitoring schema.
    """
    photo_path = PHOTOS_DIR / photo["filename"]
    if not photo_path.exists():
        raise FileNotFoundError(f"Photo file missing: {photo['filename']}")

    photo_bytes = photo_path.read_bytes()
    ext = photo_path.suffix.lower()
    mime_map = {".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp"}
    mime_type = mime_map.get(ext, "image/jpeg")
    b64_image = base64.b64encode(photo_bytes).decode("utf-8")

    async with httpx.AsyncClient(timeout=60.0) as client:
        resp = await client.post(
            "https://api.openai.com/v1/chat/completions",
            headers={
                "Authorization": f"Bearer {openai_key}",
                "Content-Type": "application/json",
            },
            json={
                "model": "gpt-4o",
                "messages": [
                    {"role": "system", "content": _get_plant_analysis_prompt()},
                    {
                        "role": "user",
                        "content": [
                            {"type": "text", "text": "Analyze this plant photo for health, disease, and growing conditions."},
                            {
                                "type": "image_url",
                                "image_url": {
                                    "url": f"data:{mime_type};base64,{b64_image}",
                                    "detail": "high",
                                },
                            },
                        ],
                    },
                ],
                "max_tokens": 1500,
                "temperature": 0.3,
            },
        )
        resp.raise_for_status()

    data = resp.json()
    content = data["choices"][0]["message"]["content"].strip()

    # Strip markdown fences if present
    if content.startswith("```"):
        content = content.split("\n", 1)[1] if "\n" in content else content[3:]
        if content.endswith("```"):
            content = content[:-3].strip()

    analysis = json.loads(content)

    # Store in database
    with get_db() as db:
        db.execute(
            """INSERT OR REPLACE INTO photo_analyses
               (photo_id, plant_identified, growth_stage, health, issues, recommendations, confidence, summary, model)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                photo["id"],
                analysis.get("plant_identified", ""),
                analysis.get("growth_stage", ""),
                analysis.get("health", ""),
                json.dumps(analysis.get("issues", [])),
                json.dumps(analysis.get("recommendations", [])),
                analysis.get("confidence", ""),
                analysis.get("summary", ""),
                "gpt-4o",
            ),
        )
        db.commit()

    health_status = _map_health_to_status(analysis.get("health", ""))
    return {
        "photo_id": photo["id"],
        "plant_name": photo.get("plant_name", "Unknown"),
        "bed_name": photo.get("bed_name"),
        "health_status": health_status,
        "health": analysis.get("health", ""),
        "issues": analysis.get("issues", []),
        "recommendations": analysis.get("recommendations", []),
        "summary": analysis.get("summary", ""),
        "confidence": analysis.get("confidence", ""),
    }


