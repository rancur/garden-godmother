"""Journal entry endpoints."""
from __future__ import annotations

import json
import uuid
from datetime import date, datetime, timedelta
from pathlib import Path
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

# ──────────────── JOURNAL SUGGESTIONS ────────────────


@router.get("/api/journal/suggestions")
async def get_journal_suggestions(request: Request):
    """Generate context-aware journal suggestions based on garden state."""
    require_user(request)
    with get_db() as db:
        suggestions = []

        # 1. Plants not observed recently
        # Get all active plantings with their last observation date
        plantings = db.execute("""
            SELECT pl.id, pl.plant_id, pl.status, pl.planted_date,
                   p.name as plant_name, p.category,
                   gb.name as bed_name, gb.id as bed_id,
                   v.name as variety_name,
                   (SELECT MAX(je.created_at) FROM journal_entries je WHERE je.planting_id = pl.id) as last_observed
            FROM plantings pl
            JOIN plants p ON pl.plant_id = p.id
            LEFT JOIN garden_beds gb ON pl.bed_id = gb.id
            LEFT JOIN varieties v ON pl.variety_id = v.id
            WHERE pl.status NOT IN ('planned', 'removed', 'failed', 'harvested')
            ORDER BY last_observed ASC NULLS FIRST
        """).fetchall()

        now = datetime.utcnow()

        for row in plantings:
            d = dict(row)
            plant_name = d["plant_name"]
            variety = d.get("variety_name")
            display_name = f"{plant_name} ({variety})" if variety else plant_name
            bed_name = d.get("bed_name") or "garden"
            status = d["status"]
            planted_date = d.get("planted_date")
            age_days = (now.date() - date.fromisoformat(planted_date)).days if planted_date else 0

            # Calculate days since last observation
            last_obs = d.get("last_observed")
            if last_obs:
                try:
                    last_obs_dt = datetime.fromisoformat(last_obs.replace("Z", "+00:00").replace("+00:00", ""))
                    days_since = (now - last_obs_dt).days
                except (ValueError, TypeError):
                    days_since = 999
            else:
                days_since = 999

            if days_since < 3:
                continue

            suggestion = {
                "id": f"checkin-planting:{d['id']}",
                "type": "check-in",
                "title": display_name,
                "subtitle": f"Day {age_days}, {bed_name}",
                "plant_name": plant_name,
                "category": d.get("category"),
                "planting_id": d["id"],
                "plant_id": d["plant_id"],
                "container_type": "planting",
                "days_since_observed": days_since,
                "status": status,
                "age_days": age_days,
                "priority": 0 if days_since > 7 else 1,
            }

            # Tailor prompt and quick actions based on growth stage
            if status in ("seeded", "planted"):
                suggestion["prompt"] = "Any sprouts yet?"
                suggestion["quick_actions"] = [
                    {"label": "Sprouted!", "content": f"{plant_name} has sprouted on day {age_days}.", "entry_type": "milestone", "milestone_type": "sprouted"},
                    {"label": "Not yet", "content": f"Checked {plant_name} on day {age_days} - no sprouts yet.", "entry_type": "observation"},
                    {"label": "Problem spotted", "content": f"Issue noticed with {plant_name} on day {age_days}.", "entry_type": "problem"},
                ]
            elif status == "sprouted":
                suggestion["prompt"] = "How is it growing?"
                suggestion["quick_actions"] = [
                    {"label": "Growing well", "content": f"{plant_name} growing well on day {age_days}.", "entry_type": "observation", "mood": "good"},
                    {"label": "Problem spotted", "content": f"Issue noticed with {plant_name} on day {age_days}.", "entry_type": "problem"},
                ]
            elif status == "growing":
                suggestion["prompt"] = "Flowering yet?"
                suggestion["quick_actions"] = [
                    {"label": "Yes, flowering!", "content": f"{plant_name} started flowering on day {age_days}!", "entry_type": "milestone", "milestone_type": "flowering", "mood": "great"},
                    {"label": "Not yet", "content": f"Checked {plant_name} on day {age_days} - still growing, no flowers yet.", "entry_type": "observation"},
                    {"label": "Problem spotted", "content": f"Issue noticed with {plant_name} on day {age_days}.", "entry_type": "problem"},
                ]
            elif status == "flowering":
                suggestion["prompt"] = "Setting fruit yet?"
                suggestion["quick_actions"] = [
                    {"label": "Fruiting!", "content": f"{plant_name} is setting fruit on day {age_days}!", "entry_type": "milestone", "milestone_type": "fruiting", "mood": "great"},
                    {"label": "Still flowering", "content": f"{plant_name} still flowering on day {age_days}, looking good.", "entry_type": "observation", "mood": "good"},
                    {"label": "Problem spotted", "content": f"Issue noticed with {plant_name} on day {age_days}.", "entry_type": "problem"},
                ]
            elif status == "fruiting":
                suggestion["type"] = "harvest-check"
                suggestion["prompt"] = "Ready to harvest?"
                suggestion["priority"] = 1
                suggestion["quick_actions"] = [
                    {"label": "Harvested today", "content": f"Harvested {plant_name} on day {age_days}!", "entry_type": "harvest", "mood": "great"},
                    {"label": "Not ready", "content": f"Checked {plant_name} on day {age_days} - fruit not ready yet.", "entry_type": "observation"},
                    {"label": "Problem spotted", "content": f"Issue noticed with {plant_name} fruit on day {age_days}.", "entry_type": "problem"},
                ]
            else:
                suggestion["prompt"] = f"Haven't checked in {days_since} days" if days_since > 7 else "How does it look?"
                suggestion["quick_actions"] = [
                    {"label": "All good", "content": f"{plant_name} looking healthy on day {age_days}.", "entry_type": "observation", "mood": "good"},
                    {"label": "Spotted an issue", "content": f"Issue noticed with {plant_name} on day {age_days}.", "entry_type": "problem"},
                ]

            suggestions.append(suggestion)

        # Ground plants not observed recently
        ground_plants = db.execute("""
            SELECT gp.id, gp.plant_id, gp.name as gp_name, gp.status, gp.planted_date,
                   p.name as plant_name, p.category,
                   a.name as area_name,
                   (SELECT MAX(je.created_at) FROM journal_entries je WHERE je.ground_plant_id = gp.id) as last_observed
            FROM ground_plants gp
            JOIN plants p ON gp.plant_id = p.id
            LEFT JOIN areas a ON gp.area_id = a.id
            WHERE gp.status NOT IN ('removed', 'died', 'planned')
        """).fetchall()

        for row in ground_plants:
            d = dict(row)
            plant_name = d.get("gp_name") or d["plant_name"]
            area = d.get("area_name") or "garden"
            planted_date = d.get("planted_date")
            age_days = (now.date() - date.fromisoformat(planted_date)).days if planted_date else 0

            last_obs = d.get("last_observed")
            if last_obs:
                try:
                    last_obs_dt = datetime.fromisoformat(last_obs.replace("Z", "+00:00").replace("+00:00", ""))
                    days_since = (now - last_obs_dt).days
                except (ValueError, TypeError):
                    days_since = 999
            else:
                days_since = 999

            if days_since < 3:
                continue

            suggestions.append({
                "id": f"checkin-ground:{d['id']}",
                "type": "check-in",
                "title": plant_name,
                "subtitle": f"Day {age_days}, {area}",
                "plant_name": plant_name,
                "category": d.get("category"),
                "ground_plant_id": d["id"],
                "plant_id": d["plant_id"],
                "container_type": "ground",
                "days_since_observed": days_since,
                "status": d.get("status"),
                "age_days": age_days,
                "priority": 0 if days_since > 7 else 3,
                "prompt": f"Haven't checked in {days_since} days" if days_since > 7 else "How does it look?",
                "quick_actions": [
                    {"label": "All good", "content": f"{plant_name} looking healthy.", "entry_type": "observation", "mood": "good"},
                    {"label": "Spotted an issue", "content": f"Issue noticed with {plant_name}.", "entry_type": "problem"},
                ],
            })

        # ── Weather-aware prompts ──
        try:
            from routes.sensors import (
                _ha_is_configured, _ha_get_states_bulk, _get_entity_mappings,
                WEATHER_SENSORS, WEATHER_ENTITY, _safe_float, fetch_weather_forecast,
            )
            if _ha_is_configured():
                mappings = _get_entity_mappings()
                effective = dict(WEATHER_SENSORS)
                _role_map = {
                    "outdoor_temperature": "temperature",
                    "outdoor_humidity": "humidity",
                    "wind_speed": "wind_speed",
                    "rain_accumulation": "rain_today",
                }
                for role, key in _role_map.items():
                    mapped = mappings.get(role)
                    if mapped:
                        effective[key] = mapped

                weather_entity = WEATHER_ENTITY
                temp_entity = mappings.get("outdoor_temperature", "")
                if temp_entity:
                    station_name = temp_entity.replace("sensor.", "")
                    for suffix in ("_air_temperature", "_temperature"):
                        if station_name.endswith(suffix):
                            station_name = station_name[: -len(suffix)]
                            break
                    candidate = f"weather.{station_name}"
                    if candidate != "weather.":
                        weather_entity = candidate

                needed = [effective.get("temperature", ""), effective.get("wind_speed", ""),
                          effective.get("rain_today", ""), weather_entity]
                states = await _ha_get_states_bulk([e for e in needed if e])

                temp_val = _safe_float(states.get(effective.get("temperature", ""), {}).get("state") if states.get(effective.get("temperature", "")) else None)
                wind_val = _safe_float(states.get(effective.get("wind_speed", ""), {}).get("state") if states.get(effective.get("wind_speed", "")) else None)
                rain_val = _safe_float(states.get(effective.get("rain_today", ""), {}).get("state") if states.get(effective.get("rain_today", "")) else None)
                condition = (states.get(weather_entity) or {}).get("state")

                if temp_val is not None and temp_val > 105:
                    suggestions.append({
                        "id": "weather_extreme_heat",
                        "type": "weather",
                        "title": "Extreme Heat",
                        "subtitle": f"{temp_val:.0f}\u00b0F today",
                        "prompt": "Extreme heat \u2014 did you add shade cloth?",
                        "quick_actions": [
                            {"label": "Shade cloth up", "entry_type": "observation", "content": "Shade cloth deployed for extreme heat"},
                            {"label": "Some wilting", "entry_type": "problem", "content": "Seeing wilting from extreme heat", "severity": "medium"},
                            {"label": "Heat damage", "entry_type": "problem", "content": "Heat damage visible \u2014 need shade cloth ASAP", "severity": "high"},
                        ],
                        "priority": 0,
                    })
                elif temp_val is not None and temp_val > 100:
                    suggestions.append({
                        "id": "weather_heat",
                        "type": "weather",
                        "title": "Heat Check",
                        "subtitle": f"{temp_val:.0f}\u00b0F today",
                        "prompt": "Any heat stress signs? Wilting, sunburn, or leaf curl?",
                        "quick_actions": [
                            {"label": "All good", "entry_type": "observation", "content": "Plants handling the heat well"},
                            {"label": "Some wilting", "entry_type": "problem", "content": "Seeing wilting from the heat", "severity": "medium"},
                            {"label": "Need shade", "entry_type": "problem", "content": "Plants need shade cloth \u2014 heat damage visible", "severity": "high"},
                        ],
                        "priority": 2,
                    })

                if rain_val is not None and rain_val > 0:
                    suggestions.append({
                        "id": "weather_rain",
                        "type": "weather",
                        "title": "Rain Check",
                        "subtitle": f"{rain_val:.2f} in rain today",
                        "prompt": "How did plants handle the rain?",
                        "quick_actions": [
                            {"label": "Loved it", "entry_type": "observation", "content": "Plants look refreshed after the rain", "mood": "good"},
                            {"label": "Some damage", "entry_type": "problem", "content": "Some rain/wind damage to plants", "severity": "medium"},
                            {"label": "Drainage issue", "entry_type": "problem", "content": "Standing water or drainage issues after rain", "severity": "medium"},
                        ],
                        "priority": 3,
                    })

                if wind_val is not None and wind_val > 20:
                    suggestions.append({
                        "id": "weather_wind",
                        "type": "weather",
                        "title": "Wind Alert",
                        "subtitle": f"{wind_val:.0f} mph winds",
                        "prompt": "High winds today \u2014 check stakes and supports",
                        "quick_actions": [
                            {"label": "All secure", "entry_type": "observation", "content": "Stakes and supports holding up in high winds"},
                            {"label": "Need staking", "entry_type": "problem", "content": "Plants need additional staking \u2014 wind damage risk", "severity": "medium"},
                            {"label": "Wind damage", "entry_type": "problem", "content": "Wind damage to plants or supports", "severity": "high"},
                        ],
                        "priority": 2,
                    })

                # Check forecast for frost
                try:
                    forecast = await fetch_weather_forecast(days=2)
                    if forecast:
                        for day in forecast[:2]:
                            low_f = day.get("low_f") or day.get("templow")
                            if low_f is not None and low_f < 40:
                                suggestions.append({
                                    "id": f"weather_frost_{day.get('date', 'soon')}",
                                    "type": "weather",
                                    "title": "Frost Warning",
                                    "subtitle": f"Low of {low_f}\u00b0F forecast",
                                    "prompt": "Frost coming \u2014 are tender plants protected?",
                                    "quick_actions": [
                                        {"label": "Protected", "entry_type": "observation", "content": "Frost protection in place for tender plants"},
                                        {"label": "Need to cover", "entry_type": "observation", "content": "Need to cover tender plants before frost tonight"},
                                        {"label": "Lost plants", "entry_type": "problem", "content": "Frost damage to unprotected plants", "severity": "high"},
                                    ],
                                    "priority": 1,
                                })
                                break  # Only one frost warning
                except Exception:
                    pass
        except Exception:
            pass

        # ── Follow-up prompts for recent problems ──
        try:
            recent_problems = db.execute("""
                SELECT je.id, je.title, je.content, je.created_at, je.planting_id, je.ground_plant_id,
                       p.name as plant_name, pi.id as instance_id
                FROM journal_entries je
                LEFT JOIN plantings pl ON je.planting_id = pl.id
                LEFT JOIN plant_instances pi ON pl.id IS NOT NULL AND pi.id = (SELECT instance_id FROM plantings WHERE id = pl.id LIMIT 1)
                LEFT JOIN plants p ON (pl.plant_id = p.id OR je.ground_plant_id IS NOT NULL AND p.id = (SELECT plant_id FROM ground_plants WHERE id = je.ground_plant_id))
                WHERE je.entry_type = 'problem'
                AND je.created_at > datetime('now', '-5 days')
                AND je.created_at < datetime('now', '-1 day')
                ORDER BY je.created_at DESC
                LIMIT 3
            """).fetchall()

            for prob in recent_problems:
                d = dict(prob)
                try:
                    created = datetime.fromisoformat(d["created_at"].replace("Z", "+00:00").replace("+00:00", ""))
                    days_ago = (now - created).days
                except (ValueError, TypeError):
                    days_ago = 3
                plant_name = d.get("plant_name") or "a plant"
                content_preview = (d.get("content") or "an issue")[:60]
                suggestions.append({
                    "id": f"followup_{d['id']}",
                    "type": "follow_up",
                    "title": f"Follow up: {plant_name}",
                    "subtitle": f"Problem logged {days_ago} day{'s' if days_ago != 1 else ''} ago",
                    "prompt": f"You noted: \"{content_preview}\" \u2014 any improvement?",
                    "quick_actions": [
                        {"label": "Resolved!", "entry_type": "observation", "content": f"Follow-up: issue with {plant_name} resolved", "mood": "good"},
                        {"label": "Still an issue", "entry_type": "problem", "content": f"Follow-up: issue with {plant_name} persists", "severity": "medium"},
                        {"label": "Getting worse", "entry_type": "problem", "content": f"Follow-up: issue with {plant_name} worsening", "severity": "high"},
                    ],
                    "priority": 1,
                    "planting_id": d.get("planting_id"),
                    "ground_plant_id": d.get("ground_plant_id"),
                })
        except Exception:
            pass

        # ── Recent transplants needing check-in ──
        try:
            recent_transplants = db.execute("""
                SELECT pl.id as planting_id, pl.planted_date, pl.source,
                       p.name as plant_name, gb.name as bed_name
                FROM plantings pl
                JOIN plants p ON pl.plant_id = p.id
                LEFT JOIN garden_beds gb ON pl.bed_id = gb.id
                WHERE pl.source = 'nursery'
                AND pl.planted_date > date('now', '-7 days')
                AND pl.status NOT IN ('removed', 'failed', 'harvested')
                AND NOT EXISTS (
                    SELECT 1 FROM journal_entries je
                    WHERE je.planting_id = pl.id
                    AND je.created_at > datetime(pl.planted_date, '+1 day')
                )
                LIMIT 3
            """).fetchall()

            for t in recent_transplants:
                d = dict(t)
                plant_name = d.get("plant_name") or "plant"
                bed = d.get("bed_name") or "garden"
                suggestions.append({
                    "id": f"transplant_{d['planting_id']}",
                    "type": "follow_up",
                    "title": f"Transplant check: {plant_name}",
                    "subtitle": f"Nursery transplant in {bed}",
                    "prompt": f"How is {plant_name} settling in after transplant?",
                    "quick_actions": [
                        {"label": "Settling in", "entry_type": "observation", "content": f"{plant_name} adjusting well after transplant", "mood": "good"},
                        {"label": "Some stress", "entry_type": "problem", "content": f"{plant_name} showing transplant shock", "severity": "medium"},
                        {"label": "Not looking good", "entry_type": "problem", "content": f"{plant_name} struggling after transplant", "severity": "high"},
                    ],
                    "priority": 2,
                    "planting_id": d["planting_id"],
                })
        except Exception:
            pass

        # ── Time-of-day context suggestions ──
        try:
            import zoneinfo
            # Use Phoenix timezone since this is a Phoenix garden
            tz = zoneinfo.ZoneInfo("America/Phoenix")
            local_hour = datetime.now(tz).hour

            if 5 <= local_hour < 10:
                suggestions.append({
                    "id": "time_morning",
                    "type": "time_context",
                    "title": "Morning Check",
                    "subtitle": "Start of day",
                    "prompt": "Morning garden check \u2014 anything new overnight?",
                    "quick_actions": [
                        {"label": "All good", "entry_type": "observation", "content": "Morning check: garden looking good overnight"},
                        {"label": "New growth", "entry_type": "observation", "content": "Morning check: noticed new growth overnight", "mood": "good"},
                        {"label": "Issue spotted", "entry_type": "problem", "content": "Morning check: spotted an issue"},
                    ],
                    "priority": 4,
                })
            elif 10 <= local_hour < 15:
                suggestions.append({
                    "id": "time_midday",
                    "type": "time_context",
                    "title": "Midday Observation",
                    "subtitle": "Peak sun hours",
                    "prompt": "How are plants handling the midday sun and heat?",
                    "quick_actions": [
                        {"label": "Thriving", "entry_type": "observation", "content": "Midday check: plants thriving in the sun", "mood": "good"},
                        {"label": "Need water", "entry_type": "observation", "content": "Midday check: some plants look thirsty"},
                        {"label": "Wilting", "entry_type": "problem", "content": "Midday check: wilting in the heat", "severity": "medium"},
                    ],
                    "priority": 4,
                })
            elif 17 <= local_hour < 20:
                suggestions.append({
                    "id": "time_evening",
                    "type": "time_context",
                    "title": "Evening Walkthrough",
                    "subtitle": "End of day",
                    "prompt": "Evening walkthrough \u2014 how did everything do today?",
                    "quick_actions": [
                        {"label": "Great day", "entry_type": "observation", "content": "Evening check: garden had a great day", "mood": "great"},
                        {"label": "Some issues", "entry_type": "problem", "content": "Evening check: noticed some issues today", "severity": "medium"},
                        {"label": "Watered", "entry_type": "observation", "content": "Evening check: gave everything a good watering"},
                    ],
                    "priority": 4,
                })
        except Exception:
            pass

        # Sort by priority (lower = more important), then by days_since_observed desc
        suggestions.sort(key=lambda s: (s.get("priority", 5), -s.get("days_since_observed", 0)))
        return suggestions[:15]


# ──────────────── JOURNAL ────────────────


@router.get("/api/journal/plant-timeline/{plant_type}/{plant_id}")
def get_plant_timeline(plant_type: str, plant_id: int, request: Request):
    """Get all journal entries, harvests, and milestones for a specific planting."""
    require_user(request)
    with get_db() as db:
        entries = []

        if plant_type == "planting":
            # Journal entries for this bed planting
            journal = db.execute("""
                SELECT je.id, je.title, je.content, je.entry_type, je.severity,
                       je.milestone_type, je.created_at, 'journal' as timeline_type
                FROM journal_entries je
                WHERE je.planting_id = ?
                ORDER BY je.created_at DESC
            """, (plant_id,)).fetchall()
            entries.extend([dict(r) for r in journal])

            # Harvests for this planting
            harvests = db.execute("""
                SELECT h.id, h.amount, h.unit, h.quality_rating, h.harvested_date as created_at,
                       h.notes as content, 'harvest' as timeline_type,
                       'Harvested ' || COALESCE(h.amount, '') || ' ' || COALESCE(h.unit, '') as title
                FROM harvests h
                WHERE h.planting_id = ?
                ORDER BY h.harvested_date DESC
            """, (plant_id,)).fetchall()
            entries.extend([dict(r) for r in harvests])

        elif plant_type == "ground_plant":
            # Journal entries for this ground plant
            journal = db.execute("""
                SELECT je.id, je.title, je.content, je.entry_type, je.severity,
                       je.milestone_type, je.created_at, 'journal' as timeline_type
                FROM journal_entries je
                WHERE je.ground_plant_id = ?
                ORDER BY je.created_at DESC
            """, (plant_id,)).fetchall()
            entries.extend([dict(r) for r in journal])

        # Sort by date descending
        entries.sort(key=lambda x: x.get("created_at", ""), reverse=True)
        return entries


@router.post("/api/journal/quick-add")
async def quick_add_journal(request: Request):
    """Create a journal entry with minimal input - pre-fills from planting context."""
    require_user(request)
    body = await request.json()

    planting_id = body.get("planting_id")
    ground_plant_id = body.get("ground_plant_id")
    entry_type = body.get("entry_type", "observation")
    content = body.get("content", "")
    severity = body.get("severity")
    milestone_type = body.get("milestone_type")

    # Auto-generate title from context
    with get_db() as db:
        title = ""
        if planting_id:
            row = db.execute("""
                SELECT p.name as plant_name, gb.name as bed_name
                FROM plantings pl JOIN plants p ON pl.plant_id = p.id
                LEFT JOIN garden_beds gb ON pl.bed_id = gb.id
                WHERE pl.id = ?
            """, (planting_id,)).fetchone()
            if row:
                plant_name = row["plant_name"]
                title = f"{entry_type.title()}: {plant_name}"
        elif ground_plant_id:
            row = db.execute("""
                SELECT gp.name, p.name as plant_name
                FROM ground_plants gp JOIN plants p ON gp.plant_id = p.id
                WHERE gp.id = ?
            """, (ground_plant_id,)).fetchone()
            if row:
                plant_name = row["name"] or row["plant_name"]
                title = f"{entry_type.title()}: {plant_name}"

        if not title:
            title = f"{entry_type.title()} entry"

        cursor = db.execute(
            """INSERT INTO journal_entries (title, content, entry_type, planting_id, ground_plant_id, severity, milestone_type)
               VALUES (?, ?, ?, ?, ?, ?, ?)""",
            (title, content, entry_type, planting_id, ground_plant_id, severity, milestone_type)
        )
        user = getattr(request.state, 'user', None)
        if user:
            audit_log(db, user['id'], 'create', 'journal', cursor.lastrowid,
                      {'title': title, 'entry_type': entry_type},
                      request.client.host if request.client else None)
        db.commit()
        return {"ok": True, "id": cursor.lastrowid, "title": title}


# ──────────────── VOICE NOTE ────────────────


@router.post("/api/journal/voice-note")
async def create_voice_note(
    request: Request,
    file: UploadFile = File(...),
    planting_id: int = Form(None),
    ground_plant_id: int = Form(None),
    entry_type: str = Form("observation"),
):
    """Upload a voice note, transcribe with Whisper, create journal entry."""
    require_user(request)

    openai_key = get_openai_key()
    if not openai_key:
        raise HTTPException(400, "OpenAI not configured — needed for voice transcription")

    # Save the audio file
    audio_dir = Path("/app/data/voice-notes")
    audio_dir.mkdir(parents=True, exist_ok=True)
    filename = f"{uuid.uuid4().hex[:12]}.webm"
    audio_path = audio_dir / filename
    content = await file.read()
    with open(audio_path, "wb") as f:
        f.write(content)

    # Transcribe with Whisper
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.post(
            "https://api.openai.com/v1/audio/transcriptions",
            headers={"Authorization": f"Bearer {openai_key}"},
            files={"file": (filename, content, file.content_type or "audio/webm")},
            data={"model": "whisper-1", "response_format": "text"},
        )
        if resp.status_code != 200:
            raise HTTPException(500, f"Transcription failed: {resp.status_code}")
        transcription = resp.text.strip()

    if not transcription:
        raise HTTPException(400, "Could not transcribe any speech from the recording")

    # Create journal entry with transcription as content
    with get_db() as db:
        title_text = transcription[:50] + ("..." if len(transcription) > 50 else "")
        title = f"Voice: {title_text}"

        cursor = db.execute(
            """INSERT INTO journal_entries (title, content, entry_type, planting_id, ground_plant_id, voice_note_filename)
               VALUES (?, ?, ?, ?, ?, ?)""",
            (title, transcription, entry_type, planting_id or None, ground_plant_id or None, filename),
        )
        user = getattr(request.state, "user", None)
        if user:
            audit_log(
                db, user["id"], "create", "journal", cursor.lastrowid,
                {"title": title, "entry_type": entry_type, "source": "voice_note"},
                request.client.host if request.client else None,
            )
        db.commit()
        return {
            "ok": True,
            "id": cursor.lastrowid,
            "transcription": transcription,
            "title": title,
        }


# ──────────────── PHOTO-FIRST ENTRY ────────────────


@router.post("/api/journal/photo-entry")
async def create_photo_journal_entry(
    request: Request,
    file: UploadFile = File(...),
    planting_id: int = Form(None),
    ground_plant_id: int = Form(None),
    content: str = Form(""),
):
    """Upload a photo, optionally run AI analysis, create journal entry."""
    require_user(request)

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

    # AI analysis if OpenAI configured
    openai_key = get_openai_key()
    ai_suggestion = None
    if openai_key and not content:
        try:
            import base64
            b64 = base64.b64encode(contents).decode()
            mime = file.content_type or "image/jpeg"
            async with httpx.AsyncClient(timeout=30) as client:
                resp = await client.post(
                    "https://api.openai.com/v1/chat/completions",
                    headers={"Authorization": f"Bearer {openai_key}"},
                    json={
                        "model": "gpt-4o-mini",
                        "max_tokens": 200,
                        "messages": [
                            {"role": "system", "content": "You are a garden journal assistant. Describe what you see in the garden photo in 1-2 concise sentences suitable for a journal entry. Focus on plant health, growth stage, and any notable observations."},
                            {"role": "user", "content": [
                                {"type": "image_url", "image_url": {"url": f"data:{mime};base64,{b64}", "detail": "low"}},
                            ]},
                        ],
                    },
                )
                if resp.status_code == 200:
                    data = resp.json()
                    ai_suggestion = data.get("choices", [{}])[0].get("message", {}).get("content", "").strip()
        except Exception:
            pass  # AI analysis is optional

    entry_content = content or ai_suggestion or "Photo observation"
    title = entry_content[:50] + ("..." if len(entry_content) > 50 else "")

    with get_db() as db:
        cursor = db.execute(
            "INSERT INTO journal_entries (title, content, entry_type, planting_id, ground_plant_id) VALUES (?, ?, 'observation', ?, ?)",
            (title, entry_content, planting_id or None, ground_plant_id or None),
        )
        entry_id = cursor.lastrowid

        # Link photo to journal entry
        db.execute(
            "INSERT INTO journal_entry_photos (journal_entry_id, filename, original_filename) VALUES (?, ?, ?)",
            (entry_id, unique_name, file.filename),
        )

        user = getattr(request.state, "user", None)
        if user:
            audit_log(
                db, user["id"], "create", "journal", entry_id,
                {"title": title, "entry_type": "observation", "source": "photo_entry"},
                request.client.host if request.client else None,
            )
        db.commit()
        return {"ok": True, "id": entry_id, "ai_suggestion": ai_suggestion, "title": title}




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
def create_journal_entry(entry: JournalEntryCreate, request: Request):
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
        user = getattr(request.state, 'user', None)
        if user:
            audit_log(db, user['id'], 'create', 'journal', cursor.lastrowid,
                      {'title': entry.title, 'entry_type': entry.entry_type},
                      request.client.host if request.client else None)
        db.commit()

        # Co-op tip sharing: broadcast as a federation alert if requested
        if entry.share_with_coop:
            try:
                tip_text = (entry.title or entry.content or '').strip()
                tip_title = tip_text[:80] + ('...' if len(tip_text) > 80 else '')
                tip_body = entry.content.strip() if entry.content else tip_title
                db.execute(
                    """INSERT INTO federation_alerts
                       (source_peer_id, alert_type, title, body, severity, affects_plants, published, expires_at)
                       VALUES (NULL, 'info', ?, ?, 'info', NULL, 1, NULL)""",
                    (tip_title, tip_body),
                )
                db.commit()
            except Exception:
                pass  # co-op share is best-effort; don't fail the journal entry

        row = db.execute("SELECT * FROM journal_entries WHERE id = ?", (cursor.lastrowid,)).fetchone()
        return _enrich_journal_entry(db, dict(row))


@router.patch("/api/journal/{entry_id}")
def update_journal_entry(entry_id: int, data: JournalEntryUpdate, request: Request):
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
        user = getattr(request.state, 'user', None)
        if user:
            audit_log(db, user['id'], 'update', 'journal', entry_id,
                      {'title': existing['title']},
                      request.client.host if request.client else None)
        db.commit()

        row = db.execute("SELECT * FROM journal_entries WHERE id = ?", (entry_id,)).fetchone()
        return _enrich_journal_entry(db, dict(row))


@router.delete("/api/journal/{entry_id}")
def delete_journal_entry(entry_id: int, request: Request):
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
        user = getattr(request.state, 'user', None)
        if user:
            audit_log(db, user['id'], 'delete', 'journal', entry_id,
                      {'title': existing['title'], 'entry_type': existing['entry_type']},
                      request.client.host if request.client else None)
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
def delete_journal_photo(photo_id: int, request: Request):
    """Delete a journal photo."""
    with get_db() as db:
        row = db.execute("SELECT * FROM journal_entry_photos WHERE id = ?", (photo_id,)).fetchone()
        if not row:
            raise HTTPException(404, "Journal photo not found")
        photo_path = PHOTOS_DIR / row["filename"]
        if photo_path.exists():
            photo_path.unlink()
        db.execute("DELETE FROM journal_entry_photos WHERE id = ?", (photo_id,))
        user = getattr(request.state, 'user', None)
        if user:
            audit_log(db, user['id'], 'delete', 'journal_photo', photo_id,
                      {'filename': row['filename'], 'journal_entry_id': row['journal_entry_id']},
                      request.client.host if request.client else None)
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

