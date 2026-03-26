"""Miscellaneous endpoints — recommendations, varieties, notes, history, analytics, etc."""
from __future__ import annotations

import csv
import json
import logging

logger = logging.getLogger(__name__)
import math
from io import StringIO
from datetime import date, datetime, timedelta
from typing import Optional

import httpx
from fastapi import APIRouter, HTTPException, Query, Request
from fastapi.responses import Response

from db import get_db, row_to_dict
from auth import require_user, require_admin, get_request_user
from models import (
    PlantingNoteCreate, SeasonSummaryCreate, AmendmentCreate,
)
from constants import (
    _get_harvest_flags, CURRENT_YEAR, HARVEST_FLAG_MAP, HARVEST_FLAG_DEFAULTS,
    get_frost_dates_from_property, _get_configured_timezone, _get_configured_zone,
    create_undo_action, AMENDMENT_TYPES,
    SOIL_TYPES, DEFAULT_SOIL_PROFILE, parse_md,
)
from services.integrations import get_openai_key, get_ha_config, get_plantbook_config, get_integration_config
from routes.calendar import whats_plantable_now
from routes.sensors import (
    _ha_is_configured, _ha_get_states_bulk, _safe_float,
    WEATHER_SENSORS, WEATHER_ENTITY, MOISTURE_SENSORS,
)

router = APIRouter()

# ──────────────── RECOMMENDATIONS ────────────────

@router.get("/api/recommendations")
def get_recommendations():
    """Get planting recommendations for right now."""
    today = date.today()
    month = today.month

    # Determine current desert season
    if month in (10, 11, 12, 1, 2, 3):
        current_season = "cool"
        season_label = "Cool Season (Oct-Mar)"
    elif month in (4, 5, 6):
        current_season = "warm"
        season_label = "Warm Season (Apr-Jun)"
    else:
        current_season = "monsoon"
        season_label = "Monsoon/Hot Season (Jul-Sep)"

    plantable = whats_plantable_now()

    tips = []
    if current_season == "cool":
        tips = [
            "Prime growing season in the desert — most crops thrive now",
            "Watch for unexpected frost — have frost cloth ready",
            "Succession plant lettuce and radish every 2-3 weeks",
        ]
    elif current_season == "warm":
        tips = [
            "Last chance for warm-season crops before extreme heat",
            "Install shade cloth (50%) for heat-sensitive plants",
            "Mulch heavily to retain soil moisture",
            "Water deeply in early morning — avoid evening watering",
        ]
    else:
        tips = [
            "Extreme heat limits most planting — focus on peppers, eggplant, basil",
            "Monsoon rains can help but watch for root rot",
            "Start planning your fall cool-season garden now",
            "Order seeds for Sep-Oct planting",
        ]

    return {
        "date": today.isoformat(),
        "season": current_season,
        "season_label": season_label,
        "plantable_now": plantable["plantable"],
        "tips": tips,
    }



# ──────────────── SHOPPING LIST ────────────────

SEASON_MONTHS = {
    "cool": [10, 11, 12, 1, 2, 3],
    "warm": [4, 5, 6],
    "monsoon": [7, 8, 9],
}


def _current_desert_season() -> str:
    month = date.today().month
    if month in (10, 11, 12, 1, 2, 3):
        return "cool"
    elif month in (4, 5, 6):
        return "warm"
    return "monsoon"


@router.get("/api/shopping-list")
def get_shopping_list():
    """Generate a shopping list based on planned plantings, calendar recommendations, and low seed stock."""
    today = date.today()

    with get_db() as db:
        # 1. All plantings with status "planned"
        planned = db.execute("""
            SELECT p.plant_id, pl.name as plant_name, pl.category
            FROM plantings p
            JOIN plants pl ON p.plant_id = pl.id
            WHERE p.status = 'planned'
        """).fetchall()
        planned_list = [dict(r) for r in planned]

        # 2. All seed inventory grouped by plant_id
        seeds = db.execute("""
            SELECT s.plant_id, p.name as plant_name, p.category as plant_category,
                   s.variety, s.quantity_seeds, s.id as seed_id
            FROM seed_inventory s
            JOIN plants p ON s.plant_id = p.id
        """).fetchall()
        seed_list = [dict(r) for r in seeds]
        seed_plant_ids = {s["plant_id"] for s in seed_list}

        # 3. Current calendar plantable items
        plantable_now = whats_plantable_now()
        plantable_items = plantable_now.get("plantable", [])

        # 4. All plants currently in any bed or in ground (active)
        active = db.execute("""
            SELECT DISTINCT plant_id FROM plantings
            WHERE status NOT IN ('removed', 'failed')
        """).fetchall()
        active_plant_ids = {r["plant_id"] for r in active}
        # Also include ground plants
        active_ground = db.execute("""
            SELECT DISTINCT plant_id FROM ground_plants
            WHERE status NOT IN ('removed', 'dormant')
        """).fetchall()
        active_plant_ids.update(r["plant_id"] for r in active_ground)

        # Build "needed" list
        needed = []
        seen_plant_ids = set()

        # Planned plantings without seed inventory
        for p in planned_list:
            pid = p["plant_id"]
            if pid not in seed_plant_ids and pid not in seen_plant_ids:
                seen_plant_ids.add(pid)
                needed.append({
                    "plant_name": p["plant_name"],
                    "category": p["category"],
                    "reason": "Planned planting with no seeds in inventory",
                    "suggested_quantity": 1,
                    "varieties": [],
                })

        # Calendar recommendations not planted and not in seed inventory
        for item in plantable_items:
            pid = item["id"]
            if pid not in active_plant_ids and pid not in seed_plant_ids and pid not in seen_plant_ids:
                actions = item.get("actions", [])
                action_str = ", ".join(a.replace("_", " ") for a in actions)
                seen_plant_ids.add(pid)
                needed.append({
                    "plant_name": item["name"],
                    "category": item["category"],
                    "reason": f"Plantable now ({action_str}) but not in any bed or seed inventory",
                    "suggested_quantity": 1,
                    "varieties": [],
                })

        # Low stock items
        low_stock = []
        for s in seed_list:
            qty = s["quantity_seeds"]
            if qty is not None and qty < 10:
                low_stock.append({
                    "plant_name": s["plant_name"],
                    "variety": s["variety"] or "",
                    "remaining": qty,
                })
                # Also add to needed if not already there
                pid = s["plant_id"]
                if pid not in seen_plant_ids:
                    seen_plant_ids.add(pid)
                    needed.append({
                        "plant_name": s["plant_name"],
                        "category": s["plant_category"],
                        "reason": f"Low seed stock ({qty} remaining)",
                        "suggested_quantity": 1,
                        "varieties": [s["variety"]] if s["variety"] else [],
                    })

    return {"needed": needed, "low_stock": low_stock}


@router.get("/api/shopping-list/season/{season}")
def get_season_shopping_list(season: str):
    """Generate a shopping list for a specific season (cool/warm/monsoon)."""
    season = season.lower()
    if season not in SEASON_MONTHS:
        raise HTTPException(400, f"Invalid season. Must be one of: cool, warm, monsoon")

    with get_db() as db:
        # All plants for this season
        rows = db.execute("""
            SELECT * FROM plants
            WHERE desert_seasons LIKE ?
            ORDER BY name
        """, (f'%"{season}"%',)).fetchall()
        season_plants = [row_to_dict(r) for r in rows]

        # Current seed inventory plant_ids
        seeds = db.execute("""
            SELECT s.plant_id, s.variety, s.quantity_seeds
            FROM seed_inventory s
        """).fetchall()
        seed_by_plant: dict[int, list] = {}
        for s in seeds:
            s = dict(s)
            seed_by_plant.setdefault(s["plant_id"], []).append(s)

        # Currently planted plant_ids
        active = db.execute("""
            SELECT DISTINCT plant_id FROM plantings
            WHERE status NOT IN ('removed', 'failed')
        """).fetchall()
        active_plant_ids = {r["plant_id"] for r in active}

        needed = []
        low_stock = []

        for plant in season_plants:
            pid = plant["id"]
            has_seeds = pid in seed_by_plant
            is_planted = pid in active_plant_ids

            if has_seeds:
                # Check if low stock
                for s in seed_by_plant[pid]:
                    qty = s["quantity_seeds"]
                    if qty is not None and qty < 10:
                        low_stock.append({
                            "plant_name": plant["name"],
                            "variety": s["variety"] or "",
                            "remaining": qty,
                        })

            if not has_seeds and not is_planted:
                needed.append({
                    "plant_name": plant["name"],
                    "category": plant["category"],
                    "reason": f"Recommended for {season} season — not planted or in seed inventory",
                    "suggested_quantity": 1,
                    "varieties": [],
                })

        season_labels = {"cool": "Cool Season (Oct-Mar)", "warm": "Warm Season (Apr-Jun)", "monsoon": "Monsoon Season (Jul-Sep)"}

    return {
        "season": season,
        "season_label": season_labels[season],
        "needed": needed,
        "low_stock": low_stock,
    }


# ──────────────── CROP ROTATION ────────────────

# ──────────────── CROP ROTATION ────────────────

# Map plant names (case-insensitive) to botanical families
PLANT_FAMILY_MAP: dict[str, tuple[str, str]] = {}  # plant_name_lower -> (family_name, common_name)

_FAMILY_DEFINITIONS: list[tuple[str, str, list[str]]] = [
    ("Solanaceae", "Nightshades", [
        "Tomato", "Pepper", "Eggplant", "Potato", "Tomatillo", "Ground Cherry",
        "Jalapeño", "Habanero", "Serrano",
    ]),
    ("Cucurbitaceae", "Cucurbits", [
        "Cucumber", "Squash", "Squash (Summer)", "Squash (Winter)", "Zucchini",
        "Pumpkin", "Melon", "Watermelon", "Cantaloupe", "Winter Squash",
        "Butternut Squash", "Armenian Cucumber",
    ]),
    ("Fabaceae", "Legumes", [
        "Bean", "Bean (Bush)", "Bean (Pole)", "Pea", "Tepary Bean",
    ]),
    ("Brassicaceae", "Brassicas", [
        "Broccoli", "Cauliflower", "Brussels Sprouts", "Cabbage", "Kale",
        "Radish", "Turnip", "Arugula", "Bok Choy",
    ]),
    ("Amaranthaceae", "Amaranths", [
        "Beet", "Spinach", "Swiss Chard",
    ]),
    ("Amaryllidaceae", "Alliums", [
        "Onion", "Garlic", "Leek", "Chive", "Green Onion",
    ]),
    ("Apiaceae", "Umbellifers", [
        "Carrot", "Celery", "Parsnip", "Dill", "Parsley", "Cilantro",
    ]),
    ("Asteraceae", "Composites", [
        "Lettuce", "Artichoke", "Sunflower", "Marigold", "Calendula",
        "Zinnia", "Cosmos",
    ]),
    ("Poaceae", "Grasses", [
        "Corn", "Lemongrass",
    ]),
    ("Lamiaceae", "Mints", [
        "Basil", "Mint", "Oregano", "Rosemary", "Sage", "Thyme", "Lavender",
    ]),
    ("Tropaeolaceae", "Nasturtiums", [
        "Nasturtium",
    ]),
]

for _fam, _common, _plants in _FAMILY_DEFINITIONS:
    for _pname in _plants:
        PLANT_FAMILY_MAP[_pname.lower()] = (_fam, _common)


def get_plant_family(plant_name: str) -> tuple[str, str] | None:
    """Return (family_name, common_name) for a plant, or None."""
    return PLANT_FAMILY_MAP.get(plant_name.lower())


@router.get("/api/rotation/bed/{bed_id}")
def rotation_history(bed_id: int):
    """Get crop rotation history for a bed — what families were grown each season/year."""
    with get_db() as db:
        bed = db.execute("SELECT * FROM garden_beds WHERE id = ?", (bed_id,)).fetchone()
        if not bed:
            raise HTTPException(404, "Bed not found")

        plantings = db.execute("""
            SELECT p.id, p.plant_id, p.season, p.year, p.planted_date, p.status,
                   pl.name as plant_name
            FROM plantings p
            JOIN plants pl ON p.plant_id = pl.id
            WHERE p.bed_id = ?
            ORDER BY p.year DESC, p.planted_date DESC
        """, (bed_id,)).fetchall()

        history: list[dict] = []
        families_seen: dict[str, list[str]] = {}  # family -> list of "(year) season"

        for row in plantings:
            p = dict(row)
            fam = get_plant_family(p["plant_name"])
            family_name = fam[0] if fam else "Unknown"
            common_name = fam[1] if fam else "Unknown"
            period = f"{p['year'] or '?'} {p['season'] or 'unknown'}"
            families_seen.setdefault(family_name, []).append(period)
            history.append({
                "planting_id": p["id"],
                "plant_name": p["plant_name"],
                "family_name": family_name,
                "family_common_name": common_name,
                "season": p["season"],
                "year": p["year"],
                "planted_date": p["planted_date"],
                "status": p["status"],
            })

        # Build warnings for repeated families
        warnings = []
        for fam_name, periods in families_seen.items():
            if fam_name == "Unknown":
                continue
            if len(periods) >= 2:
                warnings.append(
                    f"{fam_name} has been planted in this bed across multiple seasons: {', '.join(sorted(set(periods)))}"
                )

        return {"bed_id": bed_id, "history": history, "warnings": warnings}


@router.get("/api/rotation/check")
def rotation_check(bed_id: int, plant_id: int):
    """Check if planting a given plant in a bed would violate crop rotation.

    Violation = same botanical family planted in the same bed within the last 2 seasons/years.
    """
    with get_db() as db:
        plant = db.execute("SELECT * FROM plants WHERE id = ?", (plant_id,)).fetchone()
        if not plant:
            raise HTTPException(404, "Plant not found")
        plant = dict(plant)

        target_family = get_plant_family(plant["name"])
        if not target_family:
            return {"ok": True, "warning": None, "family": None, "last_planted": None}

        family_name, common_name = target_family

        # Gather all plants in the same family
        family_plant_names = [
            name for name, (fam, _) in PLANT_FAMILY_MAP.items() if fam == family_name
        ]

        # Find recent plantings of that family in this bed (last 2 years)
        current_year = date.today().year
        cutoff_year = current_year - 2

        placeholders = ",".join("?" for _ in family_plant_names)
        recent = db.execute(f"""
            SELECT p.id, p.season, p.year, p.planted_date, p.status,
                   pl.name as plant_name
            FROM plantings p
            JOIN plants pl ON p.plant_id = pl.id
            WHERE p.bed_id = ?
              AND LOWER(pl.name) IN ({placeholders})
              AND (p.year >= ? OR p.year IS NULL)
            ORDER BY p.year DESC, p.planted_date DESC
        """, (bed_id, *family_plant_names, cutoff_year)).fetchall()

        if not recent:
            return {
                "ok": True,
                "warning": None,
                "family": family_name,
                "family_common_name": common_name,
                "last_planted": None,
            }

        last = dict(recent[0])
        last_desc = f"{last['plant_name']} ({last['season'] or ''} {last['year'] or ''})"

        return {
            "ok": False,
            "warning": f"{common_name} ({family_name}) were grown in this bed recently: {last_desc}. Consider rotating to a different plant family.",
            "family": family_name,
            "family_common_name": common_name,
            "last_planted": last_desc,
        }



# ──────────────── PEST & DISEASE ALERTS ────────────────

# Which plants are vulnerable to each pest/disease risk
PEST_VULNERABILITY: dict[str, list[str]] = {
    "powdery_mildew": [
        "Squash", "Zucchini", "Cucumber", "Melon", "Watermelon", "Cantaloupe",
        "Pumpkin", "Winter Squash", "Butternut Squash", "Armenian Cucumber",
        "Tomato", "Pepper", "Eggplant", "Basil", "Zinnia", "Cosmos",
    ],
    "aphids": [
        "Tomato", "Pepper", "Eggplant", "Lettuce", "Kale", "Spinach",
        "Cabbage", "Broccoli", "Cauliflower", "Bok Choy", "Swiss Chard",
        "Bean", "Pea", "Cucumber", "Squash", "Melon", "Nasturtium",
        "Marigold", "Calendula", "Sunflower", "Okra",
    ],
    "spider_mites": [
        "Tomato", "Pepper", "Eggplant", "Bean", "Cucumber", "Squash",
        "Melon", "Strawberry", "Corn", "Marigold", "Zinnia",
    ],
    "root_rot": [
        "Tomato", "Pepper", "Basil", "Lettuce", "Spinach", "Cilantro",
        "Bean", "Pea", "Carrot", "Onion", "Garlic", "Strawberry",
    ],
    "heat_stress": [
        "Lettuce", "Spinach", "Kale", "Cilantro", "Pea", "Broccoli",
        "Cauliflower", "Cabbage", "Bok Choy", "Carrot", "Radish",
        "Beet", "Swiss Chard", "Parsley", "Dill",
    ],
    "sunscald": [
        "Tomato", "Pepper", "Eggplant", "Squash", "Cucumber",
        "Watermelon", "Cantaloupe",
    ],
    "whitefly": [
        "Tomato", "Pepper", "Eggplant", "Squash", "Cucumber", "Melon",
        "Sweet Potato", "Okra", "Cabbage", "Broccoli", "Cauliflower",
        "Bean", "Hibiscus",
    ],
}

PEST_PREVENTION: dict[str, list[str]] = {
    "powdery_mildew": [
        "Improve air circulation between plants",
        "Water at soil level, avoid wetting leaves",
        "Apply neem oil preventatively",
        "Remove infected leaves immediately",
    ],
    "aphids": [
        "Spray with strong water jet to dislodge",
        "Introduce or attract ladybugs and lacewings",
        "Apply insecticidal soap or neem oil",
        "Plant companion deterrents like marigolds and chives",
    ],
    "spider_mites": [
        "Mist plants to raise humidity around foliage",
        "Spray undersides of leaves with water",
        "Apply neem oil or insecticidal soap",
        "Avoid drought stress -- keep soil consistently moist",
    ],
    "root_rot": [
        "Reduce watering frequency and check drainage",
        "Add perlite or sand to improve soil drainage",
        "Avoid watering in evening -- water in early morning",
        "Check for compacted soil around root zone",
    ],
    "heat_stress": [
        "Provide 40-50% shade cloth during peak hours",
        "Mulch heavily to keep roots cool",
        "Water deeply in early morning",
        "Consider relocating containers to shaded areas",
    ],
    "sunscald": [
        "Do NOT prune foliage that shades fruit",
        "Use shade cloth during extreme heat",
        "Ensure adequate leaf canopy before fruit set",
        "Harvest fruit slightly early if exposed",
    ],
    "whitefly": [
        "Use yellow sticky traps near affected plants",
        "Spray undersides of leaves with insecticidal soap",
        "Introduce Encarsia formosa parasitic wasps",
        "Remove heavily infested leaves",
    ],
}


@router.get("/api/alerts/pest-disease")
async def get_pest_disease_alerts():
    """Calculate pest and disease risk alerts based on current weather and soil conditions."""
    if not _ha_is_configured():
        raise HTTPException(503, "Home Assistant not configured — add token in Settings > Integrations")

    # Fetch all weather + moisture sensor data
    all_ids = list(WEATHER_SENSORS.values()) + [WEATHER_ENTITY]
    for sensor_group in MOISTURE_SENSORS.values():
        all_ids.extend(sensor_group.values())
    states = await _ha_get_states_bulk(all_ids)

    # Extract weather values
    temp = _safe_float(
        states.get(WEATHER_SENSORS["temperature"], {}).get("state")
        if states.get(WEATHER_SENSORS["temperature"]) else None
    )
    humidity = _safe_float(
        states.get(WEATHER_SENSORS["humidity"], {}).get("state")
        if states.get(WEATHER_SENSORS["humidity"]) else None
    )
    wind = _safe_float(
        states.get(WEATHER_SENSORS["wind_speed"], {}).get("state")
        if states.get(WEATHER_SENSORS["wind_speed"]) else None
    )
    rain_today = _safe_float(
        states.get(WEATHER_SENSORS["rain_today"], {}).get("state")
        if states.get(WEATHER_SENSORS["rain_today"]) else None
    )
    uv = _safe_float(
        states.get(WEATHER_SENSORS["uv_index"], {}).get("state")
        if states.get(WEATHER_SENSORS["uv_index"]) else None
    )

    # Get max soil moisture across all sensors
    moisture_values: list[float] = []
    for _loc, entity_map in MOISTURE_SENSORS.items():
        sm_state = states.get(entity_map["soil_moisture"])
        val = _safe_float(sm_state.get("state") if sm_state else None)
        if val is not None:
            moisture_values.append(val)
    max_moisture = max(moisture_values) if moisture_values else None

    # Get active plants from DB to filter affected_plants
    active_plant_names: set[str] = set()
    with get_db() as db:
        rows = db.execute("""
            SELECT DISTINCT pl.name FROM plantings p
            JOIN plants pl ON p.plant_id = pl.id
            WHERE p.status NOT IN ('removed', 'failed')
        """).fetchall()
        active_plant_names = {r["name"] for r in rows}

    def _affected(risk_type: str) -> list[str]:
        """Return only actively planted plants that are vulnerable to this risk."""
        vulnerable = PEST_VULNERABILITY.get(risk_type, [])
        return sorted(name for name in vulnerable if name in active_plant_names)

    alerts: list[dict] = []

    # Powdery mildew: humidity > 60% AND temp 60-80F AND low rain
    if (humidity is not None and temp is not None
            and humidity > 60 and 60 <= temp <= 80
            and (rain_today is None or rain_today < 0.1)):
        severity = "high" if humidity > 80 else "medium" if humidity > 70 else "low"
        alerts.append({
            "type": "Powdery Mildew",
            "severity": severity,
            "description": f"Humidity at {humidity}% with moderate temps ({temp}F) and dry conditions create ideal powdery mildew conditions.",
            "affected_plants": _affected("powdery_mildew"),
            "prevention_tips": PEST_PREVENTION["powdery_mildew"],
        })

    # Aphids: temp 65-80F AND wind < 5mph
    if (temp is not None and wind is not None
            and 65 <= temp <= 80 and wind < 5):
        severity = "high" if wind < 2 else "medium" if wind < 3.5 else "low"
        alerts.append({
            "type": "Aphids",
            "severity": severity,
            "description": f"Calm winds ({wind} mph) and warm temps ({temp}F) are favorable for aphid populations.",
            "affected_plants": _affected("aphids"),
            "prevention_tips": PEST_PREVENTION["aphids"],
        })

    # Spider mites: temp > 90F AND humidity < 30%
    if (temp is not None and humidity is not None
            and temp > 90 and humidity < 30):
        severity = "high" if temp > 105 and humidity < 15 else "medium" if temp > 100 or humidity < 20 else "low"
        alerts.append({
            "type": "Spider Mites",
            "severity": severity,
            "description": f"Hot ({temp}F) and dry ({humidity}% humidity) conditions are ideal for spider mite outbreaks.",
            "affected_plants": _affected("spider_mites"),
            "prevention_tips": PEST_PREVENTION["spider_mites"],
        })

    # Root rot: soil moisture > 70% OR rain > 0.5in today
    root_rot_trigger = False
    root_rot_reason = ""
    if max_moisture is not None and max_moisture > 70:
        root_rot_trigger = True
        root_rot_reason = f"Soil moisture at {max_moisture}%"
    if rain_today is not None and rain_today > 0.5:
        root_rot_trigger = True
        if root_rot_reason:
            root_rot_reason = f"{root_rot_reason} and heavy rain ({rain_today} in)"
        else:
            root_rot_reason = f"Heavy rain today ({rain_today} in)"
    if root_rot_trigger:
        severity = "high" if (max_moisture and max_moisture > 85) or (rain_today and rain_today > 1.0) else "medium" if (max_moisture and max_moisture > 75) or (rain_today and rain_today > 0.75) else "low"
        alerts.append({
            "type": "Root Rot",
            "severity": severity,
            "description": f"{root_rot_reason} -- waterlogged soil increases root rot risk.",
            "affected_plants": _affected("root_rot"),
            "prevention_tips": PEST_PREVENTION["root_rot"],
        })

    # Heat stress: temp > 105F
    if temp is not None and temp > 105:
        severity = "high" if temp > 115 else "medium" if temp > 110 else "low"
        alerts.append({
            "type": "Heat Stress",
            "severity": severity,
            "description": f"Extreme temperature ({temp}F) can cause wilting, bolting, and leaf scorch on cool-season crops.",
            "affected_plants": _affected("heat_stress"),
            "prevention_tips": PEST_PREVENTION["heat_stress"],
        })

    # Sunscald: temp > 100F AND UV > 8
    if (temp is not None and uv is not None
            and temp > 100 and uv > 8):
        severity = "high" if uv > 10 and temp > 110 else "medium" if uv > 9 or temp > 105 else "low"
        alerts.append({
            "type": "Sunscald",
            "severity": severity,
            "description": f"High UV ({uv}) combined with extreme heat ({temp}F) puts exposed fruit at risk of sunscald.",
            "affected_plants": _affected("sunscald"),
            "prevention_tips": PEST_PREVENTION["sunscald"],
        })

    # Whitefly: temp > 85F AND humidity > 40%
    if (temp is not None and humidity is not None
            and temp > 85 and humidity > 40):
        severity = "high" if temp > 95 and humidity > 60 else "medium" if temp > 90 or humidity > 50 else "low"
        alerts.append({
            "type": "Whitefly",
            "severity": severity,
            "description": f"Warm ({temp}F) and humid ({humidity}%) conditions favor whitefly activity.",
            "affected_plants": _affected("whitefly"),
            "prevention_tips": PEST_PREVENTION["whitefly"],
        })

    # Overall risk
    if not alerts:
        overall_risk = "low"
    else:
        severities = [a["severity"] for a in alerts]
        if "high" in severities:
            overall_risk = "high"
        elif "medium" in severities:
            overall_risk = "medium"
        else:
            overall_risk = "low"

    return {
        "alerts": alerts,
        "overall_risk": overall_risk,
        "conditions": {
            "temperature_f": temp,
            "humidity_pct": humidity,
            "wind_speed_mph": wind,
            "rain_today_in": rain_today,
            "uv_index": uv,
            "max_soil_moisture_pct": max_moisture,
        },
    }


# ──────────────── SMART SUGGESTIONS ────────────────

# ──────────────── SMART SUGGESTIONS ────────────────

def _is_plantable_now(plant: dict) -> list[str]:
    """Return list of actions available right now for this plant (direct_sow, transplant, etc.)."""
    today = date.today()
    actions = []

    sow = plant.get("desert_sow_outdoor")
    if sow:
        start = parse_md(sow[0])
        end = parse_md(sow[1])
        if start <= end:
            if start <= today <= end:
                actions.append("direct_sow")
        else:
            if today >= start or today <= end:
                actions.append("direct_sow")

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

    return actions


def _get_neighbors(grid: list[list], x: int, y: int, width: int, height: int) -> list[dict]:
    """Get all occupied neighboring cells (up/down/left/right/diag)."""
    neighbors = []
    for dy in (-1, 0, 1):
        for dx in (-1, 0, 1):
            if dx == 0 and dy == 0:
                continue
            nx, ny = x + dx, y + dy
            if 0 <= nx < width and 0 <= ny < height and grid[ny][nx] is not None:
                neighbors.append(grid[ny][nx])
    return neighbors


def _check_companion_db(db, plant_name: str, other_name: str) -> str:
    """Check companion relationship between two plant names. Returns 'companion', 'antagonist', or 'neutral'."""
    row = db.execute("""
        SELECT c.relationship FROM companions c
        JOIN plants p ON c.plant_id = p.id
        WHERE p.name = ? COLLATE NOCASE AND c.companion_name = ? COLLATE NOCASE
    """, (plant_name, other_name)).fetchone()
    if row:
        return row["relationship"]
    row = db.execute("""
        SELECT c.relationship FROM companions c
        JOIN plants p ON c.plant_id = p.id
        WHERE p.name = ? COLLATE NOCASE AND c.companion_name = ? COLLATE NOCASE
    """, (other_name, plant_name)).fetchone()
    if row:
        return row["relationship"]
    return "neutral"


def _water_compat(w1: str | None, w2: str | None) -> bool:
    """Check if two water requirements are compatible."""
    if not w1 or not w2:
        return True
    order = {"low": 0, "moderate": 1, "regular": 1, "high": 2}
    v1 = order.get(w1.lower(), 1)
    v2 = order.get(w2.lower(), 1)
    return abs(v1 - v2) <= 1


def _sun_compat(s1: str | None, s2: str | None) -> bool:
    """Check if two sun requirements are compatible."""
    if not s1 or not s2:
        return True
    order = {"shade": 0, "partial shade": 1, "partial sun": 2, "partial": 2, "full sun": 3, "full": 3}
    v1 = order.get(s1.lower(), 2)
    v2 = order.get(s2.lower(), 2)
    return abs(v1 - v2) <= 1


@router.get("/api/suggestions/bed/{bed_id}")
def suggest_for_bed(bed_id: int):
    """Analyze a bed's empty cells and suggest best plants for each."""
    with get_db() as db:
        bed = db.execute("SELECT * FROM garden_beds WHERE id = ?", (bed_id,)).fetchone()
        if not bed:
            raise HTTPException(404, "Bed not found")
        bed = dict(bed)
        width = bed["width_cells"]
        height = bed["height_cells"]
        cell_size = bed.get("cell_size_inches", 12)

        # Determine bed soil type for scoring
        bed_soil_type = bed.get("soil_type")
        if not bed_soil_type:
            prop = db.execute("SELECT default_soil_type FROM property WHERE id = 1").fetchone()
            bed_soil_type = dict(prop).get("default_soil_type", "native-clay") if prop else "native-clay"
        bed_soil_info = SOIL_TYPES.get(bed_soil_type, SOIL_TYPES["native-clay"])
        bed_soil_ph_mid = (bed_soil_info["default_ph_min"] + bed_soil_info["default_ph_max"]) / 2

        # Pre-load plant details for pH checking
        all_plant_details = {}
        for pd_row in db.execute("SELECT plant_id, ph_min, ph_max, soil_type FROM plant_details").fetchall():
            all_plant_details[pd_row["plant_id"]] = dict(pd_row)

        # Build grid
        plantings = db.execute("""
            SELECT p.*, pl.name as plant_name, pl.category as plant_category,
                   pl.spacing_inches, pl.sun, pl.water
            FROM plantings p
            JOIN plants pl ON p.plant_id = pl.id
            WHERE p.bed_id = ? AND p.status NOT IN ('removed', 'failed')
        """, (bed_id,)).fetchall()

        grid = [[None for _ in range(width)] for _ in range(height)]
        for p in plantings:
            p = dict(p)
            x, y = p.get("cell_x"), p.get("cell_y")
            if x is not None and y is not None and 0 <= y < height and 0 <= x < width:
                grid[y][x] = p

        # Get all plants
        all_plants = db.execute("SELECT * FROM plants ORDER BY name").fetchall()
        all_plants = [row_to_dict(r) for r in all_plants]

        # Get rotation history families for this bed (last 2 years)
        current_year = date.today().year
        cutoff_year = current_year - 2
        recent_plantings = db.execute("""
            SELECT pl.name as plant_name
            FROM plantings p
            JOIN plants pl ON p.plant_id = pl.id
            WHERE p.bed_id = ? AND (p.year >= ? OR p.year IS NULL)
        """, (bed_id, cutoff_year)).fetchall()
        recent_families = set()
        for rp in recent_plantings:
            fam = get_plant_family(rp["plant_name"])
            if fam:
                recent_families.add(fam[0])

        # Sun/water of existing plants in bed
        neighbor_sun = set()
        neighbor_water = set()
        for row in grid:
            for cell in row:
                if cell:
                    if cell.get("sun"):
                        neighbor_sun.add(cell["sun"])
                    if cell.get("water"):
                        neighbor_water.add(cell["water"])

        # Find empty cells
        empty_cells = []
        for y in range(height):
            for x in range(width):
                if grid[y][x] is None:
                    empty_cells.append((x, y))

        # For each empty cell, score candidate plants
        cell_suggestions = []
        for (cx, cy) in empty_cells:
            neighbors = _get_neighbors(grid, cx, cy, width, height)
            scored = []

            for plant in all_plants:
                score = 0
                reasons = []

                # 1. Plantable now
                actions = _is_plantable_now(plant)
                if not actions:
                    continue
                reasons.append(f"good timing ({', '.join(a.replace('_', ' ') for a in actions)})")
                score += 20

                # 2. Companion compatibility with neighbors
                companion_count = 0
                antagonist_count = 0
                companion_names = []
                for nb in neighbors:
                    rel = _check_companion_db(db, plant["name"], nb["plant_name"])
                    if rel == "companion":
                        companion_count += 1
                        companion_names.append(nb["plant_name"])
                    elif rel == "antagonist":
                        antagonist_count += 1

                if antagonist_count > 0:
                    score -= 30 * antagonist_count
                    reasons.append(f"antagonist with {antagonist_count} neighbor(s)")
                if companion_count > 0:
                    score += 15 * companion_count
                    reasons.append(f"companion with adjacent {', '.join(companion_names[:2])}")

                # 3. Crop rotation
                plant_family = get_plant_family(plant["name"])
                if plant_family and plant_family[0] in recent_families:
                    score -= 20
                    reasons.append(f"same family ({plant_family[1]}) as recent season")
                elif plant_family:
                    score += 10
                    reasons.append("different family from last season")

                # 4. Sun/water compatibility
                plant_sun = plant.get("sun")
                plant_water = plant.get("water")
                sun_ok = all(_sun_compat(plant_sun, s) for s in neighbor_sun) if neighbor_sun else True
                water_ok = all(_water_compat(plant_water, w) for w in neighbor_water) if neighbor_water else True
                if sun_ok and water_ok:
                    score += 5
                    if neighbor_sun or neighbor_water:
                        reasons.append("compatible sun/water needs")
                elif not sun_ok:
                    score -= 10
                    reasons.append("incompatible sun needs")
                elif not water_ok:
                    score -= 10
                    reasons.append("incompatible water needs")

                # 5. Spacing check
                spacing = plant.get("spacing_inches", 12)
                if spacing > cell_size:
                    continue

                # 6. Soil/pH compatibility
                pd = all_plant_details.get(plant["id"])
                if pd and pd.get("ph_min") and pd.get("ph_max"):
                    plant_ph_mid = (pd["ph_min"] + pd["ph_max"]) / 2
                    ph_diff = abs(bed_soil_ph_mid - plant_ph_mid)
                    if bed_soil_ph_mid > pd["ph_max"]:
                        score -= 15
                        reasons.append(f"soil pH too alkaline for this plant (needs pH {pd['ph_min']}-{pd['ph_max']})")
                    elif bed_soil_ph_mid < pd["ph_min"]:
                        score -= 15
                        reasons.append(f"soil pH too acidic for this plant (needs pH {pd['ph_min']}-{pd['ph_max']})")
                    elif ph_diff <= 0.5:
                        score += 5
                        reasons.append("good soil pH match")

                scored.append({
                    "plant_id": plant["id"],
                    "plant_name": plant["name"],
                    "category": plant["category"],
                    "score": score,
                    "reasons": reasons,
                })

            scored.sort(key=lambda s: s["score"], reverse=True)
            top3 = scored[:3]
            if top3:
                cell_suggestions.append({
                    "cell": {"x": cx, "y": cy},
                    "suggestions": top3,
                })

    return {"bed_id": bed_id, "suggestions": cell_suggestions}


@router.get("/api/suggestions/quick")
def quick_suggestions():
    """Smart 'what should I plant today?' suggestions scored by usefulness."""
    today = date.today()

    def _window_days_remaining(window_list) -> int | None:
        """Return days until window end, or None if not currently in window."""
        if not window_list or len(window_list) < 2:
            return None
        try:
            start = parse_md(window_list[0])
            end = parse_md(window_list[1])
            in_window = False
            if start <= end:
                in_window = start <= today <= end
            else:
                in_window = today >= start or today <= end
            if not in_window:
                return None
            # Calculate days to end (handle wrap-around)
            if today <= end:
                return (end - today).days
            else:
                # Window wraps into next year
                end_next = end.replace(year=end.year + 1)
                return (end_next - today).days
        except Exception:
            return None

    def _indoor_start_window(plant):
        """Return (in_window: bool, days_remaining: int|None) for indoor seed start."""
        weeks_before = plant.get("sow_indoor_weeks_before_transplant")
        trans_raw = plant.get("desert_transplant")
        if not weeks_before or not trans_raw:
            return False, None
        try:
            t_start = parse_md(trans_raw[0])
            indoor_start = t_start - timedelta(weeks=weeks_before)
            indoor_end = t_start - timedelta(weeks=max(1, weeks_before - 2))
            if indoor_start <= today <= indoor_end:
                return True, (indoor_end - today).days
        except Exception:
            pass
        return False, None

    with get_db() as db:
        all_plants = db.execute("SELECT * FROM plants ORDER BY name").fetchall()
        all_plants = [row_to_dict(r) for r in all_plants]

        # Currently growing: check plantings, ground_plants, AND seed_tray_cells
        active_planting_ids = {r["plant_id"] for r in db.execute(
            "SELECT DISTINCT plant_id FROM plantings WHERE status NOT IN ('removed', 'failed')"
        ).fetchall()}

        active_ground_ids = {r["plant_id"] for r in db.execute(
            "SELECT DISTINCT plant_id FROM ground_plants WHERE status NOT IN ('removed')"
        ).fetchall()}

        active_tray_ids = {r["plant_id"] for r in db.execute(
            "SELECT DISTINCT plant_id FROM seed_tray_cells WHERE plant_id IS NOT NULL AND status NOT IN ('empty', 'failed')"
        ).fetchall()}

        currently_growing_ids = active_planting_ids | active_ground_ids | active_tray_ids

        # History: all plant_ids ever grown (for novelty scoring)
        ever_planted_ids = {r["plant_id"] for r in db.execute(
            "SELECT DISTINCT plant_id FROM plantings"
        ).fetchall()}
        ever_ground_ids = {r["plant_id"] for r in db.execute(
            "SELECT DISTINCT plant_id FROM ground_plants"
        ).fetchall()}
        ever_grown_ids = ever_planted_ids | ever_ground_ids

        # This year's plantings
        this_year_ids = {r["plant_id"] for r in db.execute(
            "SELECT DISTINCT plant_id FROM plantings WHERE year = ?", (today.year,)
        ).fetchall()}
        this_year_ground_ids = {r["plant_id"] for r in db.execute(
            "SELECT DISTINCT plant_id FROM ground_plants WHERE planted_date LIKE ?", (f"{today.year}%",)
        ).fetchall()}
        grown_this_year_ids = this_year_ids | this_year_ground_ids

        # Seed inventory: plant_id -> total seeds
        seed_rows = db.execute(
            "SELECT plant_id, COALESCE(SUM(quantity_seeds), 0) as total FROM seed_inventory WHERE quantity_seeds > 0 GROUP BY plant_id"
        ).fetchall()
        seed_inventory = {r["plant_id"]: r["total"] for r in seed_rows}

        # Desert ratings: plant_id -> max desert_rating among varieties
        variety_rows = db.execute(
            "SELECT plant_id, MAX(desert_rating) as max_rating FROM varieties GROUP BY plant_id"
        ).fetchall()
        desert_ratings = {r["plant_id"]: r["max_rating"] for r in variety_rows}

        # Best variety name per plant (for display)
        best_variety_rows = db.execute(
            "SELECT plant_id, name, desert_rating FROM varieties WHERE desert_rating >= 4 ORDER BY desert_rating DESC"
        ).fetchall()
        best_variety_name = {}
        for r in best_variety_rows:
            if r["plant_id"] not in best_variety_name:
                best_variety_name[r["plant_id"]] = (r["name"], r["desert_rating"])

        # Harvestable info from plant_details
        harvestable_rows = db.execute(
            "SELECT plant_id, is_harvestable FROM plant_details"
        ).fetchall()
        harvestable_map = {r["plant_id"]: r["is_harvestable"] for r in harvestable_rows}

        results = []
        for plant in all_plants:
            pid = plant["id"]
            score = 0
            reasons = []

            # --- 1. Timeliness (0-40 points with urgency bonus) ---
            sow_window = plant.get("desert_sow_outdoor")
            trans_window = plant.get("desert_transplant")

            sow_remaining = _window_days_remaining(sow_window)
            trans_remaining = _window_days_remaining(trans_window)
            indoor_active, indoor_remaining = _indoor_start_window(plant)

            best_window_days = None  # closest deadline for urgency

            if sow_remaining is not None:
                score += 30
                weeks_left = sow_remaining // 7
                if weeks_left <= 0:
                    reasons.append(f"Direct sow window closes THIS WEEK")
                elif weeks_left <= 2:
                    reasons.append(f"Direct sow window closes in {sow_remaining} days")
                else:
                    reasons.append(f"Direct sow window is open now (closes in {weeks_left} weeks)")
                best_window_days = sow_remaining

            if indoor_active:
                score += 25
                if indoor_remaining is not None:
                    if indoor_remaining <= 14:
                        reasons.append(f"Indoor seed start window closes in {indoor_remaining} days")
                    else:
                        reasons.append(f"Indoor seed start window is open now")
                    if best_window_days is None or indoor_remaining < best_window_days:
                        best_window_days = indoor_remaining

            if trans_remaining is not None:
                score += 20
                weeks_left = trans_remaining // 7
                if weeks_left <= 2:
                    reasons.append(f"Transplant window closes in {trans_remaining} days")
                else:
                    reasons.append(f"Transplant window is open now (closes in {weeks_left} weeks)")
                if best_window_days is None or trans_remaining < best_window_days:
                    best_window_days = trans_remaining

            # Urgency bonus: window closes within 2 weeks
            if best_window_days is not None and best_window_days <= 14:
                score += 10

            # Skip plants with no active window at all
            if sow_remaining is None and trans_remaining is None and not indoor_active:
                continue

            # --- 2. Not already growing (0-20 points) ---
            currently_growing = pid in currently_growing_ids
            if not currently_growing:
                score += 20
                reasons.append("Not currently in any planter, bed, or tray")

            # --- 3. Freshness / novelty (0-15 points) ---
            if pid not in ever_grown_ids:
                score += 15
                reasons.append("Never grown before — try something new!")
            elif pid not in grown_this_year_ids:
                score += 10
                reasons.append("Haven't grown this year")

            # --- 4. Desert rating (0-10 points) ---
            max_rating = desert_ratings.get(pid)
            if max_rating and max_rating >= 4:
                score += 10
                vname, vrating = best_variety_name.get(pid, (None, None))
                if vname:
                    reasons.append(f"Desert hardy ({vname} variety rated {vrating}/5)")
                else:
                    reasons.append(f"Desert hardy (rated {max_rating}/5)")
            elif max_rating and max_rating >= 3:
                score += 5

            # --- 5. Harvestable bonus (0-10 points) ---
            is_harvestable = harvestable_map.get(pid, 1)  # default to harvestable
            if is_harvestable:
                score += 10
            else:
                score += 5

            # --- 6. Seed availability (0-15 points) ---
            seed_count = seed_inventory.get(pid, 0)
            has_seeds = seed_count > 0
            if has_seeds:
                score += 15
                reasons.append(f"You have {seed_count} seeds in inventory")

            # --- Determine recommended method ---
            if has_seeds and indoor_active:
                recommended_method = "seed"
            elif has_seeds and sow_remaining is not None:
                recommended_method = "direct_sow"
            elif trans_remaining is not None:
                recommended_method = "transplant"
            elif has_seeds and sow_remaining is not None:
                recommended_method = "direct_sow"
            elif sow_remaining is not None:
                recommended_method = "direct_sow"
            else:
                recommended_method = "seed" if indoor_active else "transplant"

            # --- Determine urgency ---
            if best_window_days is not None and best_window_days <= 14:
                urgency = "high"
            elif best_window_days is not None and best_window_days <= 30:
                urgency = "medium"
            else:
                urgency = "low"

            results.append({
                "plant_id": pid,
                "plant_name": plant["name"],
                "category": plant["category"],
                "score": score,
                "recommended_method": recommended_method,
                "reasons": reasons,
                "urgency": urgency,
                "has_seeds": has_seeds,
                "currently_growing": currently_growing,
                "spacing_inches": plant.get("spacing_inches"),
                "days_to_maturity": f"{plant.get('days_to_maturity_min', '?')}-{plant.get('days_to_maturity_max', '?')}",
                "sun": plant.get("sun"),
                "water": plant.get("water"),
            })

        results.sort(key=lambda r: r["score"], reverse=True)
        return {"date": today.isoformat(), "suggestions": results[:10]}



# ──────────────── VARIETIES ────────────────

@router.get("/api/plants/{plant_id}/varieties")
def list_plant_varieties(plant_id: int):
    """List all varieties for a specific plant."""
    with get_db() as db:
        plant = db.execute("SELECT id, name FROM plants WHERE id = ?", (plant_id,)).fetchone()
        if not plant:
            raise HTTPException(404, "Plant not found")
        rows = db.execute(
            "SELECT * FROM varieties WHERE plant_id = ? ORDER BY desert_rating DESC, name",
            (plant_id,),
        ).fetchall()
        return {"plant_id": plant_id, "plant_name": plant["name"], "varieties": [dict(r) for r in rows]}


@router.get("/api/varieties")
def list_varieties(plant_id: Optional[int] = None, desert_rating_min: Optional[int] = None):
    """List all varieties with optional filters."""
    with get_db() as db:
        query = """
            SELECT v.*, p.name as plant_name, p.category as plant_category
            FROM varieties v
            JOIN plants p ON v.plant_id = p.id
        """
        conditions = []
        params = []
        if plant_id is not None:
            conditions.append("v.plant_id = ?")
            params.append(plant_id)
        if desert_rating_min is not None:
            conditions.append("v.desert_rating >= ?")
            params.append(desert_rating_min)
        if conditions:
            query += " WHERE " + " AND ".join(conditions)
        query += " ORDER BY v.desert_rating DESC, p.name, v.name"
        rows = db.execute(query, params).fetchall()
        return [dict(r) for r in rows]


@router.get("/api/varieties/recommended")
def recommended_varieties():
    """Top desert-rated varieties (desert_rating >= 4) that are plantable now."""
    today = date.today()
    with get_db() as db:
        # Get all high-rated varieties with their plant data
        rows = db.execute("""
            SELECT v.*, p.name as plant_name, p.category as plant_category,
                   p.desert_sow_outdoor, p.desert_transplant, p.desert_seasons
            FROM varieties v
            JOIN plants p ON v.plant_id = p.id
            WHERE v.desert_rating >= 4
            ORDER BY v.desert_rating DESC, p.name, v.name
        """).fetchall()

        results = []
        for row in rows:
            r = dict(row)
            # Check if parent plant is plantable now
            actions = []
            sow = r.get("desert_sow_outdoor")
            if sow:
                sow = json.loads(sow)
                start = parse_md(sow[0])
                end = parse_md(sow[1])
                if start <= end:
                    if start <= today <= end:
                        actions.append("direct_sow")
                else:
                    if today >= start or today <= end:
                        actions.append("direct_sow")

            trans = r.get("desert_transplant")
            if trans:
                trans = json.loads(trans)
                start = parse_md(trans[0])
                end = parse_md(trans[1])
                if start <= end:
                    if start <= today <= end:
                        actions.append("transplant")
                else:
                    if today >= start or today <= end:
                        actions.append("transplant")

            if actions:
                # Remove raw plant fields, keep variety data
                for key in ("desert_sow_outdoor", "desert_transplant", "desert_seasons"):
                    r.pop(key, None)
                r["plantable_actions"] = actions
                results.append(r)

        return {"date": today.isoformat(), "varieties": results}


@router.get("/api/varieties/{variety_id}")
def get_variety(variety_id: int):
    """Get a single variety detail."""
    with get_db() as db:
        row = db.execute("""
            SELECT v.*, p.name as plant_name, p.category as plant_category
            FROM varieties v
            JOIN plants p ON v.plant_id = p.id
            WHERE v.id = ?
        """, (variety_id,)).fetchone()
        if not row:
            raise HTTPException(404, "Variety not found")
        return dict(row)



# ──────────────── OPENPLANTBOOK ────────────────

# OpenPlantbook API integration
# Configure via Settings > Integrations or OPENPLANTBOOK_API_KEY env var
# Free tier available — register at open.plantbook.io
OPENPLANTBOOK_BASE = "https://open.plantbook.io/api/v1"
_plantbook_cache: dict[str, tuple[float, dict]] = {}
PLANTBOOK_CACHE_TTL = 86400  # 24 hours


@router.get("/api/openplantbook/search")
async def openplantbook_search(q: str = Query(..., min_length=2)):
    """Proxy search to OpenPlantbook API."""
    plantbook_key = _plantbook_token()
    if not plantbook_key:
        raise HTTPException(
            503,
            "OpenPlantbook API key not configured. Add token in Settings > Integrations. "
            "Register at https://open.plantbook.io for a free API key.",
        )

    cache_key = f"plantbook:search:{q.lower()}"
    now = time.time()
    if cache_key in _plantbook_cache:
        ts, data = _plantbook_cache[cache_key]
        if now - ts < PLANTBOOK_CACHE_TTL:
            return data

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            r = await client.get(
                f"{OPENPLANTBOOK_BASE}/plant/search",
                params={"alias": q},
                headers={"Authorization": f"Token {plantbook_key}"},
            )
            if r.status_code == 200:
                data = r.json()
                _plantbook_cache[cache_key] = (now, data)
                return data
            elif r.status_code == 401:
                raise HTTPException(401, "Invalid OpenPlantbook API key")
            elif r.status_code == 429:
                raise HTTPException(429, "OpenPlantbook rate limit exceeded")
            else:
                raise HTTPException(r.status_code, f"OpenPlantbook API error: {r.status_code}")
    except httpx.RequestError as exc:
        raise HTTPException(503, f"OpenPlantbook API unreachable: {exc}")



# ──────────────── PLANTING NOTES ────────────────



@router.post("/api/plantings/{planting_id}/notes")
def create_planting_note(planting_id: int, note: PlantingNoteCreate):
    """Add an observation, problem, success, or lesson to a planting."""
    valid_types = ('observation', 'problem', 'success', 'lesson', 'weather_impact', 'pest_issue', 'harvest_note')
    if note.note_type not in valid_types:
        raise HTTPException(400, f"Invalid note_type. Must be one of: {', '.join(valid_types)}")
    valid_severity = ('info', 'warning', 'critical')
    if note.severity and note.severity not in valid_severity:
        raise HTTPException(400, f"Invalid severity. Must be one of: {', '.join(valid_severity)}")

    with get_db() as db:
        existing = db.execute("SELECT id FROM plantings WHERE id = ?", (planting_id,)).fetchone()
        if not existing:
            raise HTTPException(404, "Planting not found")
        cursor = db.execute(
            "INSERT INTO planting_notes (planting_id, note_type, content, severity) VALUES (?, ?, ?, ?)",
            (planting_id, note.note_type, note.content, note.severity or "info"),
        )
        db.commit()
        return {"id": cursor.lastrowid, "planting_id": planting_id, "note_type": note.note_type, "content": note.content, "severity": note.severity}


@router.get("/api/plantings/{planting_id}/notes")
def list_planting_notes(planting_id: int):
    """Get all notes for a planting."""
    with get_db() as db:
        existing = db.execute("SELECT id FROM plantings WHERE id = ?", (planting_id,)).fetchone()
        if not existing:
            raise HTTPException(404, "Planting not found")
        rows = db.execute(
            "SELECT * FROM planting_notes WHERE planting_id = ? ORDER BY recorded_at DESC",
            (planting_id,),
        ).fetchall()
        return [dict(r) for r in rows]


@router.get("/api/notes/recent")
def list_recent_notes(limit: int = Query(50, ge=1, le=200)):
    """Recent notes across all plantings."""
    with get_db() as db:
        rows = db.execute("""
            SELECT pn.*, p.plant_id, pl.name as plant_name, pl.category as plant_category,
                   p.bed_id, gb.name as bed_name
            FROM planting_notes pn
            JOIN plantings p ON pn.planting_id = p.id
            JOIN plants pl ON p.plant_id = pl.id
            LEFT JOIN garden_beds gb ON p.bed_id = gb.id
            ORDER BY pn.recorded_at DESC
            LIMIT ?
        """, (limit,)).fetchall()
        return [dict(r) for r in rows]


@router.delete("/api/notes/{note_id}")
def delete_note(note_id: int):
    with get_db() as db:
        existing = db.execute("SELECT * FROM planting_notes WHERE id = ?", (note_id,)).fetchone()
        if not existing:
            raise HTTPException(404, "Note not found")
        db.execute("DELETE FROM planting_notes WHERE id = ?", (note_id,))
        db.commit()
        return {"ok": True}


# ──────────────── HISTORY / KNOWLEDGE BASE ────────────────

@router.get("/api/history/plant/{plant_id}")
def get_plant_history(plant_id: int):
    """Complete history of a specific plant across ALL seasons."""
    with get_db() as db:
        plant = db.execute("SELECT * FROM plants WHERE id = ?", (plant_id,)).fetchone()
        if not plant:
            raise HTTPException(404, "Plant not found")
        plant = row_to_dict(plant)

        # Every planting of this plant
        plantings = db.execute("""
            SELECT p.*, gb.name as bed_name
            FROM plantings p
            LEFT JOIN garden_beds gb ON p.bed_id = gb.id
            WHERE p.plant_id = ?
            ORDER BY p.planted_date DESC
        """, (plant_id,)).fetchall()
        plantings_list = [dict(r) for r in plantings]

        # Harvest data per planting
        for pl in plantings_list:
            harvests = db.execute(
                "SELECT * FROM harvests WHERE planting_id = ? ORDER BY harvest_date",
                (pl["id"],),
            ).fetchall()
            pl["harvests"] = [dict(h) for h in harvests]
            pl["total_harvest_oz"] = sum(h["weight_oz"] or 0 for h in harvests)

            # Photos
            photos = db.execute(
                "SELECT id, caption, taken_at, created_at FROM planting_photos WHERE planting_id = ? ORDER BY created_at DESC",
                (pl["id"],),
            ).fetchall()
            pl["photos"] = [dict(p) for p in photos]

            # Notes
            notes = db.execute(
                "SELECT * FROM planting_notes WHERE planting_id = ? ORDER BY recorded_at DESC",
                (pl["id"],),
            ).fetchall()
            pl["notes"] = [dict(n) for n in notes]

        # Ground plants (in-ground plantings of this plant)
        ground = db.execute("""
            SELECT gp.*, a.name as area_name
            FROM ground_plants gp
            LEFT JOIN areas a ON gp.area_id = a.id
            WHERE gp.plant_id = ?
            ORDER BY gp.planted_date DESC
        """, (plant_id,)).fetchall()
        ground_list = [dict(g) for g in ground]

        # Aggregate stats
        total_plantings = len(plantings_list) + len(ground_list)
        harvested = sum(1 for p in plantings_list if p["status"] == "harvested")
        failed = sum(1 for p in plantings_list if p["status"] == "failed")
        active_ground = sum(1 for g in ground_list if g["status"] in ("planted", "growing", "established"))
        success_rate = round(harvested / total_plantings * 100, 1) if total_plantings > 0 else 0
        total_yield_oz = sum(p["total_harvest_oz"] for p in plantings_list)

        # Average days to harvest (actual)
        actual_days = []
        for p in plantings_list:
            if p["status"] == "harvested" and p["planted_date"] and p["actual_harvest_date"]:
                try:
                    planted = date.fromisoformat(p["planted_date"])
                    harvested_d = date.fromisoformat(p["actual_harvest_date"])
                    actual_days.append((harvested_d - planted).days)
                except (ValueError, TypeError):
                    pass
            elif p["harvests"]:
                try:
                    planted = date.fromisoformat(p["planted_date"])
                    first_harvest = date.fromisoformat(p["harvests"][0]["harvest_date"])
                    actual_days.append((first_harvest - planted).days)
                except (ValueError, TypeError):
                    pass
        avg_days_to_harvest = round(sum(actual_days) / len(actual_days), 1) if actual_days else None

        # Best performing bed
        bed_yields: dict[str, float] = {}
        for p in plantings_list:
            bed_name = p.get("bed_name") or "Unknown"
            bed_yields[bed_name] = bed_yields.get(bed_name, 0) + p["total_harvest_oz"]
        best_bed = max(bed_yields, key=bed_yields.get) if bed_yields else None

        return {
            "plant": plant,
            "plantings": plantings_list,
            "ground_plants": ground_list,
            "stats": {
                "total_plantings": total_plantings,
                "harvested": harvested,
                "failed": failed,
                "active_ground": active_ground,
                "success_rate": success_rate,
                "total_yield_oz": round(total_yield_oz, 1),
                "avg_days_to_harvest": avg_days_to_harvest,
                "best_bed": best_bed,
            },
        }


@router.get("/api/history/bed/{bed_id}")
def get_bed_history(bed_id: int):
    """Complete history of a specific bed."""
    with get_db() as db:
        bed = db.execute("SELECT * FROM garden_beds WHERE id = ?", (bed_id,)).fetchone()
        if not bed:
            raise HTTPException(404, "Bed not found")
        bed = dict(bed)

        # Every planting ever in this bed
        plantings = db.execute("""
            SELECT p.*, pl.name as plant_name, pl.category as plant_category, pl.subcategory
            FROM plantings p
            JOIN plants pl ON p.plant_id = pl.id
            WHERE p.bed_id = ?
            ORDER BY p.planted_date DESC
        """, (bed_id,)).fetchall()
        plantings_list = [dict(r) for r in plantings]

        # Harvest totals per planting
        for pl in plantings_list:
            harvests = db.execute(
                "SELECT SUM(weight_oz) as total_oz, COUNT(*) as cnt FROM harvests WHERE planting_id = ?",
                (pl["id"],),
            ).fetchone()
            pl["total_harvest_oz"] = harvests["total_oz"] or 0
            pl["harvest_count"] = harvests["cnt"] or 0

        # Total yield from this bed
        total_yield = sum(p["total_harvest_oz"] for p in plantings_list)

        # Plantings by season
        by_season: dict[str, list] = {}
        for p in plantings_list:
            key = f"{p.get('year', '?')} {p.get('season', '?')}"
            by_season.setdefault(key, []).append(p)

        # Crop rotation timeline
        rotation_timeline = []
        for season_key, season_plantings in by_season.items():
            families = set()
            for sp in season_plantings:
                families.add(sp.get("plant_category", "unknown"))
            rotation_timeline.append({
                "season": season_key,
                "families": list(families),
                "plants": [sp["plant_name"] for sp in season_plantings],
            })

        # Best performing plants in this bed
        plant_yields: dict[str, float] = {}
        for p in plantings_list:
            plant_yields[p["plant_name"]] = plant_yields.get(p["plant_name"], 0) + p["total_harvest_oz"]
        best_plants = sorted(plant_yields.items(), key=lambda x: x[1], reverse=True)[:5]

        return {
            "bed": bed,
            "plantings": plantings_list,
            "by_season": by_season,
            "rotation_timeline": rotation_timeline,
            "total_yield_oz": round(total_yield, 1),
            "best_plants": [{"plant_name": name, "total_oz": round(oz, 1)} for name, oz in best_plants],
        }


@router.get("/api/history/season/{year}/{season}")
def get_season_history(year: int, season: str):
    """Season report: all plantings, yields, failures, lessons."""
    season = season.lower()
    if season not in ("cool", "warm", "monsoon"):
        raise HTTPException(400, "Invalid season. Must be cool, warm, or monsoon.")

    with get_db() as db:
        plantings = db.execute("""
            SELECT p.*, pl.name as plant_name, pl.category as plant_category,
                   gb.name as bed_name
            FROM plantings p
            JOIN plants pl ON p.plant_id = pl.id
            LEFT JOIN garden_beds gb ON p.bed_id = gb.id
            WHERE p.year = ? AND p.season = ?
            ORDER BY pl.name
        """, (year, season)).fetchall()
        plantings_list = [dict(r) for r in plantings]

        total_yield = 0
        for pl in plantings_list:
            harvests = db.execute(
                "SELECT SUM(weight_oz) as total_oz FROM harvests WHERE planting_id = ?",
                (pl["id"],),
            ).fetchone()
            pl["total_harvest_oz"] = harvests["total_oz"] or 0
            total_yield += pl["total_harvest_oz"]

            notes = db.execute(
                "SELECT * FROM planting_notes WHERE planting_id = ? ORDER BY recorded_at DESC",
                (pl["id"],),
            ).fetchall()
            pl["notes"] = [dict(n) for n in notes]

        total_plantings = len(plantings_list)
        total_harvested = sum(1 for p in plantings_list if p["status"] == "harvested")
        total_failed = sum(1 for p in plantings_list if p["status"] == "failed")

        # Top performers by yield
        plant_yields: dict[str, float] = {}
        for p in plantings_list:
            plant_yields[p["plant_name"]] = plant_yields.get(p["plant_name"], 0) + p["total_harvest_oz"]
        top_performers = sorted(plant_yields.items(), key=lambda x: x[1], reverse=True)[:5]

        failures = [p for p in plantings_list if p["status"] == "failed"]

        summary = db.execute(
            "SELECT * FROM season_summaries WHERE year = ? AND season = ?",
            (year, season),
        ).fetchone()
        summary_dict = dict(summary) if summary else None

        return {
            "year": year,
            "season": season,
            "plantings": plantings_list,
            "stats": {
                "total_plantings": total_plantings,
                "total_harvested": total_harvested,
                "total_failed": total_failed,
                "total_yield_oz": round(total_yield, 1),
            },
            "top_performers": [{"plant_name": name, "total_oz": round(oz, 1)} for name, oz in top_performers],
            "failures": failures,
            "summary": summary_dict,
        }


@router.get("/api/history/summary")
def get_history_summary():
    """Overall garden knowledge: all-time stats, best performers, plants to avoid."""
    with get_db() as db:
        seasons = db.execute("""
            SELECT DISTINCT year, season FROM plantings WHERE year IS NOT NULL AND season IS NOT NULL
        """).fetchall()
        total_seasons = len(seasons)

        total_grown_planters = db.execute("SELECT COUNT(DISTINCT plant_id) FROM plantings").fetchone()[0]
        total_grown_ground = db.execute("SELECT COUNT(DISTINCT plant_id) FROM ground_plants").fetchone()[0]
        # Union of distinct plant_ids from both tables
        total_grown = db.execute("""
            SELECT COUNT(*) FROM (
                SELECT DISTINCT plant_id FROM plantings
                UNION
                SELECT DISTINCT plant_id FROM ground_plants
            )
        """).fetchone()[0]

        status_counts = db.execute("""
            SELECT status, COUNT(*) as cnt FROM plantings GROUP BY status
        """).fetchall()
        status_map = {r["status"]: r["cnt"] for r in status_counts}

        # Merge ground_plants status counts
        ground_status_counts = db.execute("""
            SELECT status, COUNT(*) as cnt FROM ground_plants GROUP BY status
        """).fetchall()
        for r in ground_status_counts:
            key = r["status"]
            status_map[key] = status_map.get(key, 0) + r["cnt"]

        total_weight = db.execute("SELECT SUM(weight_oz) FROM harvests").fetchone()[0] or 0

        yield_by_plant = db.execute("""
            SELECT pl.id, pl.name, pl.category, SUM(h.weight_oz) as total_oz, COUNT(DISTINCT p.id) as plantings
            FROM harvests h
            JOIN plantings p ON h.planting_id = p.id
            JOIN plants pl ON p.plant_id = pl.id
            GROUP BY pl.id
            ORDER BY total_oz DESC
            LIMIT 10
        """).fetchall()
        best_by_yield = [dict(r) for r in yield_by_plant]

        reliability = db.execute("""
            SELECT pl.id, pl.name, pl.category,
                   COUNT(*) as total,
                   SUM(CASE WHEN p.status = 'harvested' THEN 1 ELSE 0 END) as harvested,
                   ROUND(SUM(CASE WHEN p.status = 'harvested' THEN 1.0 ELSE 0.0 END) / COUNT(*) * 100, 1) as success_rate
            FROM plantings p
            JOIN plants pl ON p.plant_id = pl.id
            GROUP BY pl.id
            HAVING total >= 2
            ORDER BY success_rate DESC
            LIMIT 10
        """).fetchall()
        most_reliable = [dict(r) for r in reliability]

        avoid = db.execute("""
            SELECT pl.id, pl.name, pl.category,
                   COUNT(*) as total,
                   SUM(CASE WHEN p.status = 'failed' THEN 1 ELSE 0 END) as failed,
                   ROUND(SUM(CASE WHEN p.status = 'failed' THEN 1.0 ELSE 0.0 END) / COUNT(*) * 100, 1) as failure_rate
            FROM plantings p
            JOIN plants pl ON p.plant_id = pl.id
            GROUP BY pl.id
            HAVING total >= 2 AND failure_rate > 30
            ORDER BY failure_rate DESC
        """).fetchall()
        plants_to_avoid = [dict(r) for r in avoid]

        busiest = db.execute("""
            SELECT strftime('%m', planted_date) as month, COUNT(*) as cnt
            FROM plantings WHERE planted_date IS NOT NULL
            GROUP BY month
            ORDER BY cnt DESC
            LIMIT 1
        """).fetchone()
        busiest_month = int(busiest["month"]) if busiest else None

        summaries = db.execute(
            "SELECT * FROM season_summaries ORDER BY year DESC, CASE season WHEN 'cool' THEN 1 WHEN 'warm' THEN 2 WHEN 'monsoon' THEN 3 END"
        ).fetchall()
        season_summaries = [dict(r) for r in summaries]

        return {
            "total_seasons_tracked": total_seasons,
            "seasons": [{"year": s["year"], "season": s["season"]} for s in seasons],
            "total_plants_grown": total_grown,
            "status_counts": status_map,
            "total_harvest_weight_oz": round(total_weight, 1),
            "best_by_yield": best_by_yield,
            "most_reliable": most_reliable,
            "plants_to_avoid": plants_to_avoid,
            "busiest_month": busiest_month,
            "season_summaries": season_summaries,
        }




@router.post("/api/history/season-summary")
def create_or_update_season_summary(data: SeasonSummaryCreate):
    """Generate/update a season summary. Auto-calculates from planting data if fields are omitted."""
    if data.season not in ("cool", "warm", "monsoon"):
        raise HTTPException(400, "Invalid season. Must be cool, warm, or monsoon.")

    with get_db() as db:
        plantings = db.execute(
            "SELECT * FROM plantings WHERE year = ? AND season = ?",
            (data.year, data.season),
        ).fetchall()

        total_plantings = data.total_plantings if data.total_plantings is not None else len(plantings)
        total_harvested = data.total_harvested if data.total_harvested is not None else sum(1 for p in plantings if p["status"] == "harvested")
        total_failed = data.total_failed if data.total_failed is not None else sum(1 for p in plantings if p["status"] == "failed")

        harvest_weight = data.total_harvest_weight_oz
        if harvest_weight is None:
            planting_ids = [p["id"] for p in plantings]
            if planting_ids:
                placeholders = ",".join("?" * len(planting_ids))
                w = db.execute(f"SELECT SUM(weight_oz) FROM harvests WHERE planting_id IN ({placeholders})", planting_ids).fetchone()[0]
                harvest_weight = w or 0

        db.execute("""
            INSERT INTO season_summaries (year, season, total_plantings, total_harvested, total_failed,
                total_harvest_weight_oz, top_performers, worst_performers, lessons_learned, weather_summary, notes)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(year, season) DO UPDATE SET
                total_plantings = excluded.total_plantings,
                total_harvested = excluded.total_harvested,
                total_failed = excluded.total_failed,
                total_harvest_weight_oz = excluded.total_harvest_weight_oz,
                top_performers = COALESCE(excluded.top_performers, season_summaries.top_performers),
                worst_performers = COALESCE(excluded.worst_performers, season_summaries.worst_performers),
                lessons_learned = COALESCE(excluded.lessons_learned, season_summaries.lessons_learned),
                weather_summary = COALESCE(excluded.weather_summary, season_summaries.weather_summary),
                notes = COALESCE(excluded.notes, season_summaries.notes)
        """, (
            data.year, data.season, total_plantings, total_harvested, total_failed,
            harvest_weight, data.top_performers, data.worst_performers,
            data.lessons_learned, data.weather_summary, data.notes,
        ))
        db.commit()

        row = db.execute("SELECT * FROM season_summaries WHERE year = ? AND season = ?", (data.year, data.season)).fetchone()
        return dict(row)


@router.get("/api/history/lessons")
def get_all_lessons():
    """Aggregated lessons learned from all season summaries and planting notes."""
    with get_db() as db:
        summaries = db.execute("""
            SELECT year, season, lessons_learned FROM season_summaries
            WHERE lessons_learned IS NOT NULL AND lessons_learned != ''
            ORDER BY year DESC
        """).fetchall()
        season_lessons = [{"year": r["year"], "season": r["season"], "lessons": r["lessons_learned"]} for r in summaries]

        note_lessons = db.execute("""
            SELECT pn.*, pl.name as plant_name, pl.category as plant_category,
                   gb.name as bed_name
            FROM planting_notes pn
            JOIN plantings p ON pn.planting_id = p.id
            JOIN plants pl ON p.plant_id = pl.id
            LEFT JOIN garden_beds gb ON p.bed_id = gb.id
            WHERE pn.note_type IN ('lesson', 'success', 'problem')
            ORDER BY pn.recorded_at DESC
            LIMIT 100
        """).fetchall()

        return {
            "season_lessons": season_lessons,
            "planting_lessons": [dict(r) for r in note_lessons],
        }


@router.get("/api/history/plant/{plant_id}/tips")
def get_plant_tips(plant_id: int):
    """Tips specific to this plant based on past experience."""
    with get_db() as db:
        plant = db.execute("SELECT * FROM plants WHERE id = ?", (plant_id,)).fetchone()
        if not plant:
            raise HTTPException(404, "Plant not found")
        plant = row_to_dict(plant)

        plantings = db.execute("""
            SELECT p.*, gb.name as bed_name
            FROM plantings p
            LEFT JOIN garden_beds gb ON p.bed_id = gb.id
            WHERE p.plant_id = ?
        """, (plant_id,)).fetchall()
        plantings_list = [dict(r) for r in plantings]

        # Also check ground_plants
        ground = db.execute("""
            SELECT gp.*, a.name as area_name
            FROM ground_plants gp
            LEFT JOIN areas a ON gp.area_id = a.id
            WHERE gp.plant_id = ?
        """, (plant_id,)).fetchall()
        ground_list = [dict(g) for g in ground]

        if not plantings_list and not ground_list:
            return {
                "plant": plant["name"],
                "tips": [],
                "message": f"No planting history for {plant['name']} yet. Plant it to start learning!",
            }

        tips = []

        # Ground plant summary tips
        if ground_list:
            active_ground = [g for g in ground_list if g["status"] in ("planted", "growing", "established")]
            if active_ground:
                # Group by area
                area_counts: dict[str, int] = {}
                for g in active_ground:
                    area = g.get("area_name") or "Unassigned area"
                    area_counts[area] = area_counts.get(area, 0) + 1
                parts = [f"{count} in {area}" for area, count in area_counts.items()]
                tips.append(f"Growing in ground: {', '.join(parts)}.")
            removed = [g for g in ground_list if g["status"] == "removed"]
            if removed:
                tips.append(f"{len(removed)} ground plant(s) previously removed.")

        total = len(plantings_list) + len(ground_list)
        harvested = sum(1 for p in plantings_list if p["status"] == "harvested")
        failed = sum(1 for p in plantings_list if p["status"] == "failed")

        if total >= 2:
            rate = round(harvested / total * 100)
            if rate >= 80:
                tips.append(f"Great track record! {harvested}/{total} plantings harvested successfully ({rate}% success rate).")
            elif rate >= 50:
                tips.append(f"Moderate success: {harvested}/{total} plantings harvested ({rate}%). Check notes for patterns.")
            else:
                tips.append(f"Struggles in your garden: only {harvested}/{total} harvested ({rate}%). Consider different timing or bed placement.")

        bed_success: dict[str, dict] = {}
        for p in plantings_list:
            bed = p.get("bed_name") or "Unknown"
            if bed not in bed_success:
                bed_success[bed] = {"total": 0, "harvested": 0, "yield": 0}
            bed_success[bed]["total"] += 1
            if p["status"] == "harvested":
                bed_success[bed]["harvested"] += 1
            h = db.execute("SELECT SUM(weight_oz) FROM harvests WHERE planting_id = ?", (p["id"],)).fetchone()[0]
            bed_success[bed]["yield"] += h or 0

        if len(bed_success) > 1:
            best = max(bed_success.items(), key=lambda x: x[1]["yield"])
            if best[1]["yield"] > 0:
                tips.append(f"Best results in {best[0]} ({round(best[1]['yield'], 1)} oz total yield).")

        actual_days = []
        for p in plantings_list:
            if p["planted_date"]:
                try:
                    planted = date.fromisoformat(p["planted_date"])
                    h_rows = db.execute("SELECT MIN(harvest_date) as first FROM harvests WHERE planting_id = ?", (p["id"],)).fetchone()
                    if h_rows and h_rows["first"]:
                        first_h = date.fromisoformat(h_rows["first"])
                        actual_days.append((first_h - planted).days)
                except (ValueError, TypeError):
                    pass
        if actual_days:
            avg = round(sum(actual_days) / len(actual_days))
            tips.append(f"Average {avg} days from planting to first harvest in your garden.")

        total_oz = 0
        harvest_count = 0
        for p in plantings_list:
            h = db.execute("SELECT SUM(weight_oz) FROM harvests WHERE planting_id = ?", (p["id"],)).fetchone()[0]
            if h:
                total_oz += h
                harvest_count += 1
        if harvest_count > 0:
            avg_yield = round(total_oz / harvest_count, 1)
            tips.append(f"Expect about {avg_yield} oz per plant on average.")

        lessons = db.execute("""
            SELECT pn.content, pn.note_type FROM planting_notes pn
            JOIN plantings p ON pn.planting_id = p.id
            WHERE p.plant_id = ? AND pn.note_type IN ('lesson', 'success', 'problem')
            ORDER BY pn.recorded_at DESC LIMIT 5
        """, (plant_id,)).fetchall()
        for l in lessons:
            prefix = {"lesson": "Lesson", "success": "Success", "problem": "Watch out"}.get(l["note_type"], "Note")
            tips.append(f"{prefix}: {l['content']}")

        return {
            "plant": plant["name"],
            "total_plantings": total,
            "tips": tips,
        }



# ──────────────── HEALTH ────────────────

@router.get("/api/health")
def health():
    with get_db() as db:
        count = db.execute("SELECT COUNT(*) as c FROM plants").fetchone()["c"]
        varieties_count = db.execute("SELECT COUNT(*) as c FROM varieties").fetchone()["c"]
        try:
            details_count = db.execute("SELECT COUNT(*) as c FROM plant_details").fetchone()["c"]
        except Exception:
            details_count = 0
        return {"status": "ok", "plants": count, "varieties": varieties_count, "enriched_plants": details_count, "zone": _get_configured_zone()}



# ──────────────── PLANTER TYPES ────────────────

@router.get("/api/planter-types")
def list_planter_types(form_factor: Optional[str] = None):
    """List all planter types, optional form_factor filter."""
    with get_db() as db:
        if form_factor:
            rows = db.execute("SELECT * FROM planter_types WHERE form_factor = ? ORDER BY brand, name", (form_factor,)).fetchall()
        else:
            rows = db.execute("SELECT * FROM planter_types ORDER BY brand, name").fetchall()
        results = []
        for r in rows:
            d = dict(r)
            for key in ("recommended_plants", "unsuitable_plants"):
                if d.get(key):
                    try:
                        d[key] = json.loads(d[key])
                    except (json.JSONDecodeError, TypeError):
                        pass
            results.append(d)
        return results


@router.get("/api/planter-types/{planter_type_id}")
def get_planter_type(planter_type_id: int):
    """Get a single planter type with details."""
    with get_db() as db:
        row = db.execute("SELECT * FROM planter_types WHERE id = ?", (planter_type_id,)).fetchone()
        if not row:
            raise HTTPException(404, "Planter type not found")
        d = dict(row)
        for key in ("recommended_plants", "unsuitable_plants"):
            if d.get(key):
                try:
                    d[key] = json.loads(d[key])
                except (json.JSONDecodeError, TypeError):
                    pass
        # Include compatibility data
        compat_rows = db.execute("""
            SELECT ppc.*, p.name as plant_name, p.category as plant_category
            FROM plant_planter_compatibility ppc
            JOIN plants p ON ppc.plant_id = p.id
            WHERE ppc.form_factor = ?
            ORDER BY
                CASE ppc.compatibility
                    WHEN 'excellent' THEN 1
                    WHEN 'good' THEN 2
                    WHEN 'possible' THEN 3
                    WHEN 'poor' THEN 4
                    WHEN 'unsuitable' THEN 5
                END,
                p.name
        """, (d["form_factor"],)).fetchall()
        d["compatibilities"] = [dict(c) for c in compat_rows]
        return d


@router.get("/api/planter-types/{planter_type_id}/compatible-plants")
def get_planter_compatible_plants(planter_type_id: int, min_compat: Optional[str] = None):
    """Get plants compatible with this planter type."""
    with get_db() as db:
        pt = db.execute("SELECT * FROM planter_types WHERE id = ?", (planter_type_id,)).fetchone()
        if not pt:
            raise HTTPException(404, "Planter type not found")
        form_factor = pt["form_factor"]

        query = """
            SELECT ppc.*, p.name as plant_name, p.category as plant_category,
                   p.sun, p.water, p.heat_tolerance, p.spacing_inches
            FROM plant_planter_compatibility ppc
            JOIN plants p ON ppc.plant_id = p.id
            WHERE ppc.form_factor = ?
        """
        params: list = [form_factor]

        # Filter by minimum compatibility
        compat_order = {"excellent": 1, "good": 2, "possible": 3, "poor": 4, "unsuitable": 5}
        if min_compat and min_compat in compat_order:
            allowed = [k for k, v in compat_order.items() if v <= compat_order[min_compat]]
            placeholders = ",".join("?" * len(allowed))
            query += f" AND ppc.compatibility IN ({placeholders})"
            params.extend(allowed)

        query += """
            ORDER BY
                CASE ppc.compatibility
                    WHEN 'excellent' THEN 1
                    WHEN 'good' THEN 2
                    WHEN 'possible' THEN 3
                    WHEN 'poor' THEN 4
                    WHEN 'unsuitable' THEN 5
                END,
                p.name
        """
        rows = db.execute(query, params).fetchall()
        return [dict(r) for r in rows]


@router.get("/api/plants/{plant_id}/compatible-planters")
def get_plant_compatible_planters(plant_id: int):
    """Get planter types compatible with this plant."""
    with get_db() as db:
        plant = db.execute("SELECT * FROM plants WHERE id = ?", (plant_id,)).fetchone()
        if not plant:
            raise HTTPException(404, "Plant not found")
        rows = db.execute("""
            SELECT ppc.*, pt.name as planter_name, pt.brand, pt.form_factor as planter_form_factor,
                   pt.tiers, pt.pockets_per_tier, pt.total_pockets, pt.pocket_depth_inches
            FROM plant_planter_compatibility ppc
            LEFT JOIN planter_types pt ON ppc.planter_type_id = pt.id
            WHERE ppc.plant_id = ?
            ORDER BY
                CASE ppc.compatibility
                    WHEN 'excellent' THEN 1
                    WHEN 'good' THEN 2
                    WHEN 'possible' THEN 3
                    WHEN 'poor' THEN 4
                    WHEN 'unsuitable' THEN 5
                END
        """, (plant_id,)).fetchall()
        return {"plant": dict(plant), "compatibilities": [dict(r) for r in rows]}


@router.get("/api/planter-types/recommend")
def recommend_planter_type(plant_id: int = Query(...)):
    """Given a plant, recommend the best planter type."""
    with get_db() as db:
        plant = db.execute("SELECT * FROM plants WHERE id = ?", (plant_id,)).fetchone()
        if not plant:
            raise HTTPException(404, "Plant not found")

        # Get compatibility data for this plant
        compat_rows = db.execute("""
            SELECT ppc.form_factor, ppc.compatibility, ppc.notes
            FROM plant_planter_compatibility ppc
            WHERE ppc.plant_id = ?
            ORDER BY
                CASE ppc.compatibility
                    WHEN 'excellent' THEN 1
                    WHEN 'good' THEN 2
                    WHEN 'possible' THEN 3
                    WHEN 'poor' THEN 4
                    WHEN 'unsuitable' THEN 5
                END
        """, (plant_id,)).fetchall()

        # Get the best form factors
        best_form_factors = [dict(r)["form_factor"] for r in compat_rows if dict(r)["compatibility"] in ("excellent", "good")]

        # Find matching planter types
        recommended = []
        if best_form_factors:
            placeholders = ",".join("?" * len(best_form_factors))
            pt_rows = db.execute(f"""
                SELECT * FROM planter_types WHERE form_factor IN ({placeholders})
                ORDER BY brand, name
            """, best_form_factors).fetchall()
            for r in pt_rows:
                d = dict(r)
                for key in ("recommended_plants", "unsuitable_plants"):
                    if d.get(key):
                        try:
                            d[key] = json.loads(d[key])
                        except (json.JSONDecodeError, TypeError):
                            pass
                recommended.append(d)

        return {
            "plant": row_to_dict(plant),
            "compatibilities": [dict(r) for r in compat_rows],
            "recommended_planter_types": recommended,
        }



# ──────────────── SOIL INTELLIGENCE ────────────────


@router.get("/api/soil/types")
def list_soil_types():
    """List all soil type categories with metadata."""
    # Return only the primary (non-legacy) types
    PRIMARY_TYPES = ["native_ground", "amended_native", "raised_bed_mix", "potting_mix", "cactus_succulent_mix", "custom_blend"]
    result = []
    for key in PRIMARY_TYPES:
        info = SOIL_TYPES[key]
        result.append({
            "value": key,
            "label": info["label"],
            "description": info["description"],
            "default_ph_min": info["default_ph_min"],
            "default_ph_max": info["default_ph_max"],
            "has_products": info.get("has_products", False),
        })
    return result


@router.get("/api/soil/products")
def list_soil_products(soil_type: Optional[str] = None):
    """List soil products, optionally filtered by soil type."""
    with get_db() as db:
        if soil_type:
            rows = db.execute(
                "SELECT * FROM soil_products WHERE soil_type = ? ORDER BY brand, product_name",
                (soil_type,)
            ).fetchall()
        else:
            rows = db.execute("SELECT * FROM soil_products ORDER BY soil_type, brand, product_name").fetchall()
        products = []
        for r in rows:
            d = dict(r)
            if d.get("composition"):
                try:
                    d["composition"] = json.loads(d["composition"])
                except (json.JSONDecodeError, TypeError):
                    pass
            if d.get("best_for"):
                try:
                    d["best_for"] = json.loads(d["best_for"])
                except (json.JSONDecodeError, TypeError):
                    pass
            products.append(d)
        return products


@router.get("/api/soil/products/{product_id}")
def get_soil_product(product_id: int):
    """Get a single soil product by ID."""
    with get_db() as db:
        row = db.execute("SELECT * FROM soil_products WHERE id = ?", (product_id,)).fetchone()
        if not row:
            raise HTTPException(404, "Soil product not found")
        d = dict(row)
        if d.get("composition"):
            try:
                d["composition"] = json.loads(d["composition"])
            except (json.JSONDecodeError, TypeError):
                pass
        if d.get("best_for"):
            try:
                d["best_for"] = json.loads(d["best_for"])
            except (json.JSONDecodeError, TypeError):
                pass
        return d


@router.get("/api/soil/profile")
def get_soil_profile():
    """Returns the default soil profile for the property."""
    with get_db() as db:
        prop = db.execute("SELECT default_soil_type, default_soil_ph, default_soil_notes FROM property WHERE id = 1").fetchone()
    profile = dict(DEFAULT_SOIL_PROFILE)
    if prop:
        p = dict(prop)
        if p.get("default_soil_type"):
            profile["default_soil"] = p["default_soil_type"]
        if p.get("default_soil_ph"):
            profile["default_ph"] = p["default_soil_ph"]
        if p.get("default_soil_notes"):
            profile["notes"] = p["default_soil_notes"]
    profile["soil_types"] = SOIL_TYPES
    return profile


@router.get("/api/soil/for-plant/{gp_id}")
def get_soil_for_ground_plant(gp_id: int):
    """Determine what soil a ground plant is in and return soil info + plant-specific recommendations."""
    with get_db() as db:
        gp = db.execute("""
            SELECT gp.*, p.name as plant_name, p.category as plant_category,
                   z.name as zone_name, z.soil_type as zone_soil_type, z.soil_ph_min as zone_ph_min,
                   z.soil_ph_max as zone_ph_max, z.soil_amendments as zone_amendments, z.soil_notes as zone_notes
            FROM ground_plants gp
            JOIN plants p ON gp.plant_id = p.id
            LEFT JOIN zones z ON gp.zone_id = z.id
            WHERE gp.id = ?
        """, (gp_id,)).fetchone()
        if not gp:
            raise HTTPException(404, "Ground plant not found")
        gp = dict(gp)

        # Determine soil source: zone > property default
        soil_source = "property_default"
        soil_type = None
        soil_ph_min = None
        soil_ph_max = None
        soil_amendments = None
        soil_notes = None

        if gp.get("zone_soil_type"):
            soil_source = "zone"
            soil_type = gp["zone_soil_type"]
            soil_ph_min = gp.get("zone_ph_min")
            soil_ph_max = gp.get("zone_ph_max")
            soil_amendments = gp.get("zone_amendments")
            soil_notes = gp.get("zone_notes")

        if not soil_type:
            prop = db.execute("SELECT default_soil_type, default_soil_ph FROM property WHERE id = 1").fetchone()
            if prop:
                prop = dict(prop)
                soil_type = prop.get("default_soil_type", "native-clay")
                soil_ph_min = (prop.get("default_soil_ph") or 8.0) - 0.5
                soil_ph_max = (prop.get("default_soil_ph") or 8.0) + 0.5
            else:
                soil_type = "native-clay"
                soil_ph_min = 7.5
                soil_ph_max = 8.5

        soil_info = SOIL_TYPES.get(soil_type, SOIL_TYPES["native-clay"])

        # Get plant details for pH preference
        plant_details = db.execute("SELECT ph_min, ph_max, soil_type as preferred_soil, preferred_amendments FROM plant_details WHERE plant_id = ?",
                                   (gp["plant_id"],)).fetchone()

        recommendations = _generate_soil_recommendations(
            soil_type, soil_ph_min, soil_ph_max,
            dict(plant_details) if plant_details else None,
            gp["plant_name"]
        )

        result = {
            "ground_plant_id": gp_id,
            "plant_name": gp["plant_name"],
            "soil_source": soil_source,
            "soil_type": soil_type,
            "soil_label": soil_info["label"],
            "soil_ph_min": soil_ph_min,
            "soil_ph_max": soil_ph_max,
            "soil_amendments": json.loads(soil_amendments) if soil_amendments else None,
            "soil_notes": soil_notes,
            "recommendations": recommendations,
        }
        return result


@router.get("/api/soil/recommendations")
def get_soil_recommendations(plant_id: int = Query(...), soil_type: str = Query("native-clay")):
    """Given a plant and soil type, return compatibility info and amendment recommendations."""
    with get_db() as db:
        plant = db.execute("SELECT * FROM plants WHERE id = ?", (plant_id,)).fetchone()
        if not plant:
            raise HTTPException(404, "Plant not found")
        plant = dict(plant)

        soil_info = SOIL_TYPES.get(soil_type, SOIL_TYPES.get("native-clay"))
        if not soil_info:
            raise HTTPException(400, f"Unknown soil type: {soil_type}")

        ph_min = soil_info["default_ph_min"]
        ph_max = soil_info["default_ph_max"]

        plant_details = db.execute("SELECT * FROM plant_details WHERE plant_id = ?", (plant_id,)).fetchone()

        recommendations = _generate_soil_recommendations(
            soil_type, ph_min, ph_max,
            dict(plant_details) if plant_details else None,
            plant["name"]
        )

        return {
            "plant_id": plant_id,
            "plant_name": plant["name"],
            "soil_type": soil_type,
            "soil_label": soil_info["label"],
            "soil_ph_range": f"{ph_min}-{ph_max}",
            **recommendations,
        }


def _generate_soil_recommendations(soil_type: str, soil_ph_min: float, soil_ph_max: float,
                                    plant_details: dict | None, plant_name: str) -> dict:
    """Generate soil recommendations for a plant given soil conditions."""
    is_compatible = True
    compatibility_notes = []
    amendments_needed = []
    watering_adjustments = []
    growth_challenges = []

    plant_ph_min = plant_details.get("ph_min") if plant_details else None
    plant_ph_max = plant_details.get("ph_max") if plant_details else None
    preferred_soil = plant_details.get("soil_type") if plant_details else None
    preferred_amendments = None
    if plant_details and plant_details.get("preferred_amendments"):
        try:
            preferred_amendments = json.loads(plant_details["preferred_amendments"]) if isinstance(plant_details["preferred_amendments"], str) else plant_details["preferred_amendments"]
        except (json.JSONDecodeError, TypeError):
            pass

    # pH compatibility check
    if plant_ph_min and plant_ph_max and soil_ph_min and soil_ph_max:
        soil_mid = (soil_ph_min + soil_ph_max) / 2
        plant_mid = (plant_ph_min + plant_ph_max) / 2
        ph_diff = abs(soil_mid - plant_mid)

        if soil_ph_min > plant_ph_max:
            # Soil too alkaline for plant
            is_compatible = False
            compatibility_notes.append(
                f"{plant_name} prefers pH {plant_ph_min}-{plant_ph_max} but soil is pH {soil_ph_min}-{soil_ph_max} (too alkaline)"
            )
            amendments_needed.append("Add elemental sulfur to lower pH (takes 3-6 months)")
            amendments_needed.append("Use chelated iron (EDDHA form) to prevent chlorosis")
            if ph_diff > 1.5:
                growth_challenges.append("Severe pH mismatch — consider raised bed with custom mix instead")
            else:
                growth_challenges.append("Iron chlorosis likely — watch for yellowing leaves with green veins")
        elif soil_ph_max < plant_ph_min:
            # Soil too acidic for plant
            is_compatible = False
            compatibility_notes.append(
                f"{plant_name} prefers pH {plant_ph_min}-{plant_ph_max} but soil is pH {soil_ph_min}-{soil_ph_max} (too acidic)"
            )
            amendments_needed.append("Add garden lime to raise pH")
        elif ph_diff > 0.5:
            compatibility_notes.append(
                f"{plant_name} prefers pH {plant_ph_min}-{plant_ph_max}, soil is pH {soil_ph_min}-{soil_ph_max} — marginal match"
            )
        else:
            compatibility_notes.append(f"pH range is compatible with {plant_name}")

    # Soil type specific issues (handle both legacy and new key formats)
    if soil_type in ("native-clay", "native_ground"):
        watering_adjustments.append("Water deeply but less frequently — clay retains moisture")
        watering_adjustments.append("Avoid overhead watering to prevent compaction")
        growth_challenges.append("Root growth restricted by heavy clay and possible caliche layer")
        growth_challenges.append("Drainage is poor — root rot risk in monsoon season")
        amendments_needed.append("Mix 4-6 inches of compost into planting area")
        amendments_needed.append("Add gypsum to improve clay structure")
    elif soil_type in ("native-amended", "amended_native"):
        watering_adjustments.append("Water moderately — amended clay holds moisture well")
        growth_challenges.append("Clay base still limits deep root penetration")
    elif soil_type == "sandy":
        watering_adjustments.append("Water more frequently — sandy soil drains fast")
        watering_adjustments.append("Fertilize more often (nutrients leach quickly)")
        growth_challenges.append("Low nutrient retention")
        amendments_needed.append("Add compost to improve water and nutrient retention")
    elif soil_type in ("raised-bed-mix", "raised_bed_mix"):
        watering_adjustments.append("Raised beds dry faster in desert heat — check moisture daily in summer")
        compatibility_notes.append("Raised bed mix provides good drainage and neutral pH — suitable for most plants")
    elif soil_type in ("potting-soil", "potting_mix"):
        watering_adjustments.append("Containers dry out quickly in desert heat — may need twice-daily watering in summer")
        watering_adjustments.append("Use self-watering containers or drip irrigation")
        compatibility_notes.append("Potting mix pH is easily adjustable")
    elif soil_type == "cactus_succulent_mix":
        watering_adjustments.append("Water sparingly — cactus mix drains very fast by design")
        watering_adjustments.append("Allow soil to fully dry between waterings")
        compatibility_notes.append("Cactus/succulent mix is ideal for desert-adapted plants")

    # Add preferred amendments if the plant has them
    if preferred_amendments:
        for amendment in preferred_amendments:
            if amendment not in amendments_needed:
                amendments_needed.append(amendment)

    return {
        "is_compatible": is_compatible,
        "compatibility_notes": compatibility_notes,
        "amendments_needed": amendments_needed,
        "watering_adjustments": watering_adjustments,
        "growth_challenges": growth_challenges,
    }


@router.get("/api/dashboard/stats")
def dashboard_stats():
    """Aggregated dashboard statistics in one call."""
    today_str = date.today().isoformat()
    with get_db() as db:
        # Active plantings count (planters + ground plants)
        active_planter_plants = db.execute(
            "SELECT COUNT(*) as c FROM plantings WHERE status IN ('seeded','sprouted','growing','flowering','fruiting','established')"
        ).fetchone()["c"]
        active_ground_plants = db.execute(
            "SELECT COUNT(*) as c FROM ground_plants WHERE status IN ('planted','growing','established')"
        ).fetchone()["c"]
        active_plants = active_planter_plants + active_ground_plants

        # Vacant planter cells: total cells minus active plantings per bed
        beds = db.execute("SELECT id, width_cells, height_cells FROM garden_beds").fetchall()
        total_bed_cells = 0
        occupied_bed_cells = 0
        for bed in beds:
            total_bed_cells += bed["width_cells"] * bed["height_cells"]
            occ = db.execute(
                "SELECT COUNT(*) as c FROM plantings WHERE bed_id = ? AND status IN ('seeded','sprouted','growing','flowering','fruiting','established')",
                (bed["id"],)
            ).fetchone()["c"]
            occupied_bed_cells += occ
        vacant_planter_cells = total_bed_cells - occupied_bed_cells

        # Vacant tray cells: cells with status='empty'
        vacant_tray_cells = db.execute(
            "SELECT COUNT(*) as c FROM seed_tray_cells WHERE status = 'empty'"
        ).fetchone()["c"]

        total_vacant = vacant_planter_cells + vacant_tray_cells

        # Next harvest: earliest expected_harvest_date >= today among active HARVESTABLE plantings
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

        # Tasks due today and overdue
        tasks_due_today = db.execute(
            "SELECT COUNT(*) as c FROM garden_tasks WHERE due_date = ? AND status NOT IN ('completed','skipped')",
            (today_str,)
        ).fetchone()["c"]
        tasks_overdue = db.execute(
            "SELECT COUNT(*) as c FROM garden_tasks WHERE (status = 'overdue' OR (due_date < ? AND status = 'pending'))",
            (today_str,)
        ).fetchone()["c"]

        return {
            "active_plants": active_plants,
            "vacant_planter_cells": vacant_planter_cells,
            "vacant_tray_cells": vacant_tray_cells,
            "total_vacant": total_vacant,
            "next_harvest": next_harvest,
            "tasks_due_today": tasks_due_today,
            "tasks_overdue": tasks_overdue,
        }


@router.get("/api/search")
def global_search(q: str = Query(..., min_length=1)):
    """Search across all entities: plants, planters, ground_plants, trays, areas, journal, varieties."""
    term = f"%{q}%"
    results = {
        "plants": [],
        "planters": [],
        "ground_plants": [],
        "trays": [],
        "areas": [],
        "journal": [],
        "varieties": [],
    }
    total = 0
    with get_db() as db:
        # Plants (name, category) + scientific_name from plant_details
        rows = db.execute(
            """SELECT p.id, p.name, p.category, pd.scientific_name
               FROM plants p
               LEFT JOIN plant_details pd ON pd.plant_id = p.id
               WHERE p.name LIKE ? COLLATE NOCASE
                  OR pd.scientific_name LIKE ? COLLATE NOCASE""",
            (term, term),
        ).fetchall()
        for r in rows:
            match_field = "scientific_name" if r["scientific_name"] and q.lower() in (r["scientific_name"] or "").lower() else "name"
            results["plants"].append({"id": r["id"], "name": r["name"], "category": r["category"], "scientific_name": r["scientific_name"], "match": match_field})
        total += len(results["plants"])

        # Planters/beds (name, notes, location)
        rows = db.execute(
            "SELECT id, name, location, notes FROM garden_beds WHERE name LIKE ? COLLATE NOCASE OR notes LIKE ? COLLATE NOCASE",
            (term, term),
        ).fetchall()
        for r in rows:
            match_field = "notes" if r["notes"] and q.lower() in (r["notes"] or "").lower() and q.lower() not in (r["name"] or "").lower() else "name"
            results["planters"].append({"id": r["id"], "name": r["name"], "location": r["location"], "match": match_field})
        total += len(results["planters"])

        # Ground plants (name)
        rows = db.execute(
            """SELECT gp.id, gp.name, p.name as plant_name, gp.status
               FROM ground_plants gp
               LEFT JOIN plants p ON p.id = gp.plant_id
               WHERE gp.name LIKE ? COLLATE NOCASE
                  OR p.name LIKE ? COLLATE NOCASE""",
            (term, term),
        ).fetchall()
        for r in rows:
            results["ground_plants"].append({"id": r["id"], "name": r["name"] or r["plant_name"], "plant_name": r["plant_name"], "status": r["status"], "match": "name"})
        total += len(results["ground_plants"])

        # Trays (name)
        rows = db.execute(
            "SELECT id, name, location FROM seed_trays WHERE name LIKE ? COLLATE NOCASE",
            (term,),
        ).fetchall()
        for r in rows:
            results["trays"].append({"id": r["id"], "name": r["name"], "location": r["location"], "match": "name"})
        total += len(results["trays"])

        # Areas (name)
        rows = db.execute(
            "SELECT id, name, area_type, color FROM areas WHERE name LIKE ? COLLATE NOCASE",
            (term,),
        ).fetchall()
        for r in rows:
            results["areas"].append({"id": r["id"], "name": r["name"], "area_type": r["area_type"], "color": r["color"], "match": "name"})
        total += len(results["areas"])

        # Journal entries (title, content)
        rows = db.execute(
            """SELECT id, title, content, entry_type, created_at
               FROM journal_entries
               WHERE title LIKE ? COLLATE NOCASE
                  OR content LIKE ? COLLATE NOCASE
               ORDER BY created_at DESC LIMIT 50""",
            (term, term),
        ).fetchall()
        for r in rows:
            match_field = "title" if r["title"] and q.lower() in (r["title"] or "").lower() else "content"
            snippet = ""
            if match_field == "content" and r["content"]:
                content = r["content"]
                idx = content.lower().find(q.lower())
                start = max(0, idx - 40)
                end = min(len(content), idx + len(q) + 40)
                snippet = ("..." if start > 0 else "") + content[start:end] + ("..." if end < len(content) else "")
            results["journal"].append({
                "id": r["id"],
                "title": r["title"],
                "entry_type": r["entry_type"],
                "snippet": snippet,
                "created_at": r["created_at"],
                "match": match_field,
            })
        total += len(results["journal"])

        # Varieties (name)
        rows = db.execute(
            """SELECT v.id, v.name, p.name as plant_name
               FROM varieties v
               LEFT JOIN plants p ON p.id = v.plant_id
               WHERE v.name LIKE ? COLLATE NOCASE""",
            (term,),
        ).fetchall()
        for r in rows:
            results["varieties"].append({"id": r["id"], "name": r["name"], "plant_name": r["plant_name"], "match": "name"})
        total += len(results["varieties"])

    return {"query": q, "results": results, "total": total}



# ──────────────── DATA EXPORT ────────────────

def _csv_response(rows: list[dict], filename: str) -> Response:
    """Build a CSV download Response from a list of dicts."""
    if not rows:
        return Response(
            content="",
            media_type="text/csv",
            headers={"Content-Disposition": f'attachment; filename="{filename}"'},
        )
    buf = StringIO()
    writer = csv.DictWriter(buf, fieldnames=rows[0].keys())
    writer.writeheader()
    writer.writerows(rows)
    return Response(
        content=buf.getvalue(),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/api/export/harvests")
def export_harvests(format: str = "csv"):
    with get_db() as db:
        rows = db.execute("""
            SELECT h.id, h.planting_id, pl.name as plant_name, h.harvest_date,
                   h.weight_oz, h.quantity, h.quality, h.notes, h.created_at
            FROM harvests h
            JOIN plantings p ON h.planting_id = p.id
            JOIN plants pl ON p.plant_id = pl.id
            ORDER BY h.harvest_date DESC, h.created_at DESC
        """).fetchall()
        return _csv_response([dict(r) for r in rows], "harvests.csv")


@router.get("/api/export/expenses")
def export_expenses(format: str = "csv"):
    with get_db() as db:
        rows = db.execute("""
            SELECT id, category, description, amount_cents, purchase_date, notes, created_at
            FROM expenses ORDER BY purchase_date DESC, created_at DESC
        """).fetchall()
        return _csv_response([dict(r) for r in rows], "expenses.csv")


@router.get("/api/export/journal")
def export_journal(format: str = "csv"):
    with get_db() as db:
        rows = db.execute("""
            SELECT j.id, j.entry_type, j.title, j.content, j.mood, j.tags,
                   pl.name as plant_name, j.created_at
            FROM journal_entries j
            LEFT JOIN plants pl ON j.plant_id = pl.id
            ORDER BY j.created_at DESC
        """).fetchall()
        return _csv_response([dict(r) for r in rows], "journal.csv")


@router.get("/api/export/plantings")
def export_plantings(format: str = "csv"):
    with get_db() as db:
        rows = db.execute("""
            SELECT p.id, pl.name as plant_name, pl.category as plant_category,
                   p.bed_id, p.planted_date, p.expected_harvest_date,
                   p.actual_harvest_date, p.status, p.season, p.year, p.notes, p.created_at
            FROM plantings p
            JOIN plants pl ON p.plant_id = pl.id
            ORDER BY p.planted_date DESC
        """).fetchall()
        return _csv_response([dict(r) for r in rows], "plantings.csv")


@router.get("/api/export/plants")
def export_plants(format: str = "json"):
    with get_db() as db:
        rows = db.execute("""
            SELECT id, name, category, subcategory, days_to_maturity_min,
                   days_to_maturity_max, spacing_inches, sun, water,
                   heat_tolerance, cold_tolerance, desert_seasons,
                   sow_indoor_weeks_before_transplant, desert_sow_outdoor,
                   desert_transplant, notes
            FROM plants ORDER BY name
        """).fetchall()
        data = []
        for r in rows:
            d = dict(r)
            for key in ("desert_seasons", "desert_sow_outdoor", "desert_transplant"):
                if d.get(key) and isinstance(d[key], str):
                    try:
                        d[key] = json.loads(d[key])
                    except (json.JSONDecodeError, TypeError):
                        pass
            data.append(d)
        content = json.dumps(data, indent=2)
        return Response(
            content=content,
            media_type="application/json",
            headers={"Content-Disposition": 'attachment; filename="plants.json"'},
        )



# ──────────────── SOIL AMENDMENTS ────────────────

AMENDMENT_TYPES = ("compost", "fertilizer", "sulfur", "gypsum", "mulch", "worm_castings", "bone_meal", "fish_emulsion", "other")




@router.get("/api/amendments")
def list_amendments(bed_id: int = Query(None), ground_plant_id: int = Query(None), tray_id: int = Query(None)):
    """List soil amendments, optionally filtered by bed, ground plant, or tray."""
    with get_db() as db:
        sql = """
            SELECT sa.*,
                   gb.name as bed_name,
                   gp_alias.name as ground_plant_label,
                   p.name as ground_plant_species,
                   st.name as tray_name
            FROM soil_amendments sa
            LEFT JOIN garden_beds gb ON sa.bed_id = gb.id
            LEFT JOIN ground_plants gp_alias ON sa.ground_plant_id = gp_alias.id
            LEFT JOIN plants p ON gp_alias.plant_id = p.id
            LEFT JOIN seed_trays st ON sa.tray_id = st.id
            WHERE 1=1
        """
        params: list = []
        if bed_id is not None:
            sql += " AND sa.bed_id = ?"
            params.append(bed_id)
        if ground_plant_id is not None:
            sql += " AND sa.ground_plant_id = ?"
            params.append(ground_plant_id)
        if tray_id is not None:
            sql += " AND sa.tray_id = ?"
            params.append(tray_id)
        sql += " ORDER BY sa.applied_date DESC, sa.created_at DESC"
        rows = db.execute(sql, params).fetchall()
        return [dict(r) for r in rows]


@router.post("/api/amendments")
def create_amendment(data: AmendmentCreate):
    """Log a new soil amendment."""
    if data.amendment_type not in AMENDMENT_TYPES:
        raise HTTPException(400, f"Invalid amendment_type. Must be one of: {', '.join(AMENDMENT_TYPES)}")
    if not data.bed_id and not data.ground_plant_id and not data.tray_id:
        raise HTTPException(400, "Must specify bed_id, ground_plant_id, or tray_id")
    with get_db() as db:
        cursor = db.execute(
            """INSERT INTO soil_amendments (bed_id, ground_plant_id, tray_id, amendment_type, product_name, amount, applied_date, next_due_date, notes)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (data.bed_id, data.ground_plant_id, data.tray_id, data.amendment_type, data.product_name,
             data.amount, data.applied_date, data.next_due_date, data.notes),
        )
        db.commit()
        amendment_id = cursor.lastrowid
        row = db.execute("SELECT * FROM soil_amendments WHERE id = ?", (amendment_id,)).fetchone()
        return dict(row)


@router.delete("/api/amendments/{amendment_id}")
def delete_amendment(amendment_id: int):
    """Delete a soil amendment record."""
    with get_db() as db:
        row = db.execute("SELECT id FROM soil_amendments WHERE id = ?", (amendment_id,)).fetchone()
        if not row:
            raise HTTPException(404, "Amendment not found")
        db.execute("DELETE FROM soil_amendments WHERE id = ?", (amendment_id,))
        db.commit()
        return {"deleted": amendment_id}


@router.get("/api/amendments/schedule")
def get_amendment_schedule():
    """Get amendments due within the next 2 weeks."""
    cutoff = (date.today() + timedelta(days=14)).isoformat()
    today_str = date.today().isoformat()
    with get_db() as db:
        rows = db.execute("""
            SELECT sa.*,
                   gb.name as bed_name,
                   gp_alias.name as ground_plant_label,
                   p.name as ground_plant_species
            FROM soil_amendments sa
            LEFT JOIN garden_beds gb ON sa.bed_id = gb.id
            LEFT JOIN ground_plants gp_alias ON sa.ground_plant_id = gp_alias.id
            LEFT JOIN plants p ON gp_alias.plant_id = p.id
            WHERE sa.next_due_date IS NOT NULL
              AND sa.next_due_date <= ?
              AND sa.next_due_date >= ?
            ORDER BY sa.next_due_date ASC
        """, (cutoff, today_str)).fetchall()
        return [dict(r) for r in rows]


# ──────────────── WATER USAGE ANALYTICS ────────────────

# ──────────────── WATER USAGE ANALYTICS ────────────────

_DEFAULT_GPM = {
    "rachio_controller": 1.5,
    "rachio_hose_timer": 2.0,
}
DEFAULT_WATER_RATE_PER_GALLON = 0.004  # Configurable via Settings > water_rate_per_gallon


def _get_water_rate() -> float:
    """Get the configured water rate per gallon, or the default."""
    try:
        with get_db() as db:
            row = db.execute("SELECT value FROM app_config WHERE key = 'water_rate_per_gallon'").fetchone()
            if row and row["value"]:
                return float(row["value"])
    except Exception:
        pass
    return DEFAULT_WATER_RATE_PER_GALLON


@router.get("/api/analytics/water-usage")
async def get_water_usage_analytics(days: int = Query(30, ge=1, le=365)):
    """Water usage analytics: per-zone gallons, daily totals, cost estimates."""
    cutoff_date = (date.today() - timedelta(days=days)).isoformat()
    prev_cutoff_start = (date.today() - timedelta(days=days * 2)).isoformat()
    prev_cutoff_end = cutoff_date

    with get_db() as db:
        events = db.execute("""
            SELECT zone_name, duration_minutes, source, DATE(recorded_at) as event_date
            FROM irrigation_events
            WHERE recorded_at >= ? AND event_type IN ('run_start', 'run_end')
            ORDER BY recorded_at
        """, (cutoff_date,)).fetchall()

        prev_events = db.execute("""
            SELECT zone_name, duration_minutes, source
            FROM irrigation_events
            WHERE recorded_at >= ? AND recorded_at < ? AND event_type IN ('run_start', 'run_end')
        """, (prev_cutoff_start, prev_cutoff_end)).fetchall()

        beds = db.execute("""
            SELECT id, name, irrigation_type, irrigation_zone_name
            FROM garden_beds
            WHERE irrigation_type IN ('rachio_controller', 'rachio_hose_timer') AND irrigation_zone_name IS NOT NULL
        """).fetchall()

        gp_rows = db.execute("""
            SELECT gp.id, COALESCE(gp.name, p.name) as name, gp.irrigation_type, gp.irrigation_zone_name
            FROM ground_plants gp
            JOIN plants p ON gp.plant_id = p.id
            WHERE gp.irrigation_type IN ('rachio_controller', 'rachio_hose_timer') AND gp.irrigation_zone_name IS NOT NULL
        """).fetchall()

    zone_beds_map: dict = {}
    for b in beds:
        bd = dict(b)
        zn = bd["irrigation_zone_name"]
        if zn not in zone_beds_map:
            zone_beds_map[zn] = {"planters": [], "ground_plants": []}
        zone_beds_map[zn]["planters"].append(bd["name"])
    for gp in gp_rows:
        gpd = dict(gp)
        zn = gpd["irrigation_zone_name"]
        if zn not in zone_beds_map:
            zone_beds_map[zn] = {"planters": [], "ground_plants": []}
        zone_beds_map[zn]["ground_plants"].append(gpd["name"])

    valve_views = await _fetch_valve_day_views(min(days, 90))

    zone_totals: dict = {}
    daily_totals: dict = {}

    for ev in events:
        evd = dict(ev)
        zone = evd["zone_name"] or "Unknown"
        dur = evd["duration_minutes"] or 0
        source = evd["source"] or "controller"
        gpm = _DEFAULT_GPM.get("rachio_hose_timer" if "hose" in source.lower() else "rachio_controller", 1.5)
        gallons = dur * gpm
        zone_totals[zone] = zone_totals.get(zone, 0.0) + gallons
        event_date = evd["event_date"]
        if event_date:
            daily_totals[event_date] = daily_totals.get(event_date, 0.0) + gallons

    for view in valve_views:
        day_ts = view.get("dayTimestamp")
        if not day_ts:
            continue
        day_str = datetime.utcfromtimestamp(day_ts / 1000).strftime("%Y-%m-%d")
        total_secs = view.get("totalDuration", 0)
        gallons = (total_secs / 60) * _DEFAULT_GPM["rachio_hose_timer"]
        zone_totals["Hose Timer"] = zone_totals.get("Hose Timer", 0.0) + gallons
        daily_totals[day_str] = daily_totals.get(day_str, 0.0) + gallons

    total_gallons = sum(zone_totals.values())
    total_cost = total_gallons * _get_water_rate()

    prev_total_gallons = 0.0
    for ev in prev_events:
        evd = dict(ev)
        dur = evd["duration_minutes"] or 0
        source = evd["source"] or "controller"
        gpm = _DEFAULT_GPM.get("rachio_hose_timer" if "hose" in source.lower() else "rachio_controller", 1.5)
        prev_total_gallons += dur * gpm

    by_zone = []
    for zone_name, gallons in sorted(zone_totals.items(), key=lambda x: -x[1]):
        zone_info = zone_beds_map.get(zone_name, {"planters": [], "ground_plants": []})
        by_zone.append({
            "zone_name": zone_name,
            "gallons": round(gallons, 1),
            "cost": round(gallons * _get_water_rate(), 2),
            "planters": zone_info["planters"],
            "ground_plants": zone_info["ground_plants"],
        })

    daily = [{"date": d, "gallons": round(g, 1)} for d, g in sorted(daily_totals.items())]

    weekly: dict = {}
    for d, g in daily_totals.items():
        try:
            dt = date.fromisoformat(d)
            week_start = (dt - timedelta(days=dt.weekday())).isoformat()
            weekly[week_start] = weekly.get(week_start, 0.0) + g
        except (ValueError, TypeError):
            pass
    weekly_list = [{"week_start": w, "gallons": round(g, 1)} for w, g in sorted(weekly.items())]

    return {
        "days": days,
        "total_gallons": round(total_gallons, 1),
        "total_cost_estimate": round(total_cost, 2),
        "previous_period_gallons": round(prev_total_gallons, 1),
        "previous_period_cost_estimate": round(prev_total_gallons * _get_water_rate(), 2),
        "by_zone": by_zone,
        "daily": daily,
        "weekly": weekly_list,
    }


# ──────────────── YIELD COMPARISON ANALYTICS ────────────────

# ──────────────── YIELD COMPARISON ANALYTICS ────────────────


@router.get("/api/analytics/yield-comparison")
def yield_comparison():
    """Compare plant performance by plant, bed, variety, and method."""
    with get_db() as db:
        # By plant: total yield, planting count, avg per plant
        by_plant_rows = db.execute("""
            SELECT pl.id as plant_id, pl.name as plant_name, pl.category,
                   COALESCE(SUM(h.weight_oz), 0) as total_weight_oz,
                   COUNT(DISTINCT p.id) as planting_count
            FROM plantings p
            JOIN plants pl ON p.plant_id = pl.id
            LEFT JOIN harvests h ON h.planting_id = p.id
            WHERE p.status IN ('harvested', 'growing', 'flowering', 'fruiting', 'established')
            GROUP BY pl.id
            ORDER BY total_weight_oz DESC
        """).fetchall()
        by_plant = []
        for r in by_plant_rows:
            d = dict(r)
            d["avg_per_plant_oz"] = round(d["total_weight_oz"] / d["planting_count"], 1) if d["planting_count"] > 0 else 0
            by_plant.append(d)

        # By bed: total yield, compute sq_ft from bed dimensions
        by_bed_rows = db.execute("""
            SELECT gb.id as bed_id, gb.name as bed_name,
                   gb.width_cells, gb.height_cells, gb.cell_size_inches,
                   gb.physical_width_inches, gb.physical_length_inches,
                   COALESCE(SUM(h.weight_oz), 0) as total_weight_oz,
                   COUNT(DISTINCT p.id) as planting_count
            FROM garden_beds gb
            JOIN plantings p ON p.bed_id = gb.id
            LEFT JOIN harvests h ON h.planting_id = p.id
            GROUP BY gb.id
            ORDER BY total_weight_oz DESC
        """).fetchall()
        by_bed = []
        for r in by_bed_rows:
            d = dict(r)
            if d.get("physical_width_inches") and d.get("physical_length_inches"):
                sq_ft = round((d["physical_width_inches"] * d["physical_length_inches"]) / 144, 1)
            else:
                cell_in = d.get("cell_size_inches") or 12
                sq_ft = round((d["width_cells"] * cell_in * d["height_cells"] * cell_in) / 144, 1)
            d["sq_ft"] = sq_ft
            d["oz_per_sqft"] = round(d["total_weight_oz"] / sq_ft, 1) if sq_ft > 0 else 0
            for k in ("width_cells", "height_cells", "cell_size_inches", "physical_width_inches", "physical_length_inches"):
                d.pop(k, None)
            by_bed.append(d)

        # By variety (ground_plants has variety_id; plantings does not)
        by_variety_rows = db.execute("""
            SELECT v.id as variety_id, v.name as variety_name, pl.name as plant_name,
                   0 as total_weight_oz,
                   COUNT(DISTINCT gp.id) as planting_count
            FROM ground_plants gp
            JOIN plants pl ON gp.plant_id = pl.id
            JOIN varieties v ON gp.variety_id = v.id
            WHERE gp.variety_id IS NOT NULL
            GROUP BY v.id
            ORDER BY total_weight_oz DESC
        """).fetchall()
        by_variety = []
        for r in by_variety_rows:
            d = dict(r)
            d["avg_per_plant_oz"] = round(d["total_weight_oz"] / d["planting_count"], 1) if d["planting_count"] > 0 else 0
            by_variety.append(d)

        # By method: derive from lifecycle tasks
        by_method_rows = db.execute("""
            SELECT
                CASE
                    WHEN EXISTS (
                        SELECT 1 FROM garden_tasks gt
                        WHERE gt.lifecycle_group_id IS NOT NULL
                        AND gt.task_type = 'direct_sow'
                        AND gt.plant_id = p.plant_id
                        AND gt.status = 'completed'
                    ) THEN 'direct_sow'
                    WHEN EXISTS (
                        SELECT 1 FROM garden_tasks gt
                        WHERE gt.lifecycle_group_id IS NOT NULL
                        AND gt.task_type = 'start_seeds'
                        AND gt.plant_id = p.plant_id
                        AND gt.status = 'completed'
                    ) THEN 'seed_start_transplant'
                    ELSE 'unknown'
                END as method,
                COUNT(DISTINCT p.id) as planting_count,
                SUM(CASE WHEN p.status = 'harvested' THEN 1 ELSE 0 END) as harvested_count,
                SUM(CASE WHEN p.status = 'failed' THEN 1 ELSE 0 END) as failed_count,
                COALESCE(SUM(h.weight_oz), 0) as total_weight_oz
            FROM plantings p
            LEFT JOIN harvests h ON h.planting_id = p.id
            GROUP BY method
            ORDER BY total_weight_oz DESC
        """).fetchall()
        by_method = []
        for r in by_method_rows:
            d = dict(r)
            d["success_rate"] = round(d["harvested_count"] / d["planting_count"] * 100, 1) if d["planting_count"] > 0 else 0
            by_method.append(d)

        # By season
        by_season_rows = db.execute("""
            SELECT p.year, p.season,
                   COUNT(DISTINCT p.id) as planting_count,
                   COALESCE(SUM(h.weight_oz), 0) as total_weight_oz,
                   SUM(CASE WHEN p.status = 'harvested' THEN 1 ELSE 0 END) as harvested_count,
                   SUM(CASE WHEN p.status = 'failed' THEN 1 ELSE 0 END) as failed_count
            FROM plantings p
            LEFT JOIN harvests h ON h.planting_id = p.id
            WHERE p.year IS NOT NULL AND p.season IS NOT NULL
            GROUP BY p.year, p.season
            ORDER BY p.year DESC, CASE p.season WHEN 'cool' THEN 1 WHEN 'warm' THEN 2 WHEN 'monsoon' THEN 3 END
        """).fetchall()
        by_season = []
        for r in by_season_rows:
            d = dict(r)
            d["success_rate"] = round(d["harvested_count"] / d["planting_count"] * 100, 1) if d["planting_count"] > 0 else 0
            by_season.append(d)

        top_performers = sorted(
            [p for p in by_plant if p["total_weight_oz"] > 0],
            key=lambda x: x["avg_per_plant_oz"],
            reverse=True,
        )[:10]
        worst_performers = sorted(
            [p for p in by_plant if p["planting_count"] >= 2],
            key=lambda x: x["avg_per_plant_oz"],
        )[:5]

        return {
            "by_plant": by_plant,
            "by_bed": by_bed,
            "by_variety": by_variety,
            "by_method": by_method,
            "by_season": by_season,
            "top_performers": top_performers,
            "worst_performers": worst_performers,
        }


@router.get("/api/analytics/season-review")
def season_review(year: int = Query(...), season: str = Query(...)):
    """Generate a season review with grades, what worked, what didn't, recommendations."""
    season = season.lower()
    if season not in ("cool", "warm", "monsoon"):
        raise HTTPException(400, "Invalid season. Must be cool, warm, or monsoon.")

    with get_db() as db:
        plantings = db.execute("""
            SELECT p.*, pl.name as plant_name, pl.category as plant_category,
                   gb.name as bed_name, gb.id as bed_id
            FROM plantings p
            JOIN plants pl ON p.plant_id = pl.id
            LEFT JOIN garden_beds gb ON p.bed_id = gb.id
            WHERE p.year = ? AND p.season = ?
            ORDER BY pl.name
        """, (year, season)).fetchall()
        plantings_list = [dict(r) for r in plantings]

        if not plantings_list:
            return {
                "year": year,
                "season": season,
                "overall_grade": "N/A",
                "overall_summary": "No plantings recorded for this season.",
                "metrics": {},
                "stats": {"total_plantings": 0, "harvested": 0, "failed": 0, "active": 0, "total_yield_oz": 0, "success_rate": 0, "unique_plants": 0},
                "what_worked": [],
                "what_to_improve": [],
                "recommendations": [],
                "top_performers": [],
                "saved_summary": None,
            }

        total_yield = 0.0
        for pl in plantings_list:
            harvests = db.execute(
                "SELECT SUM(weight_oz) as total_oz FROM harvests WHERE planting_id = ?",
                (pl["id"],),
            ).fetchone()
            pl["total_harvest_oz"] = harvests["total_oz"] or 0
            total_yield += pl["total_harvest_oz"]

        total = len(plantings_list)
        harvested = sum(1 for p in plantings_list if p["status"] == "harvested")
        failed = sum(1 for p in plantings_list if p["status"] == "failed")
        active = sum(1 for p in plantings_list if p["status"] in ("growing", "flowering", "fruiting", "sprouted", "seeded"))
        success_rate = round(harvested / total * 100, 1) if total > 0 else 0
        failure_rate = round(failed / total * 100, 1) if total > 0 else 0

        if success_rate >= 80:
            overall_grade = "A"
            overall_summary = "Great season! Most plantings succeeded and produced well."
        elif success_rate >= 65:
            overall_grade = "B"
            overall_summary = "Good season with solid results. A few things to tweak for next time."
        elif success_rate >= 50:
            overall_grade = "C"
            overall_summary = "Decent season with room for improvement. Review the failures for lessons."
        elif success_rate >= 30:
            overall_grade = "D"
            overall_summary = "Tough season. Several things didn't work out. Time to adjust strategy."
        else:
            overall_grade = "F"
            overall_summary = "Challenging season. Major adjustments needed. Check variety choices and timing."

        metrics = {}

        lbs = total_yield / 16
        if lbs > 20:
            metrics["yield"] = {"value": f"{lbs:.1f} lbs", "grade": "A", "label": "Total Yield"}
        elif lbs > 10:
            metrics["yield"] = {"value": f"{lbs:.1f} lbs", "grade": "B", "label": "Total Yield"}
        elif lbs > 3:
            metrics["yield"] = {"value": f"{lbs:.1f} lbs", "grade": "C", "label": "Total Yield"}
        elif lbs > 0:
            metrics["yield"] = {"value": f"{lbs:.1f} lbs", "grade": "D", "label": "Total Yield"}
        else:
            metrics["yield"] = {"value": "0 lbs", "grade": "F", "label": "Total Yield"}

        if success_rate >= 80:
            sr_grade = "A"
        elif success_rate >= 65:
            sr_grade = "B"
        elif success_rate >= 50:
            sr_grade = "C"
        elif success_rate >= 30:
            sr_grade = "D"
        else:
            sr_grade = "F"
        metrics["success_rate"] = {"value": f"{success_rate}%", "grade": sr_grade, "label": "Success Rate"}

        unique_plants = len(set(p["plant_name"] for p in plantings_list))
        if unique_plants >= 10:
            div_grade = "A"
        elif unique_plants >= 6:
            div_grade = "B"
        elif unique_plants >= 3:
            div_grade = "C"
        else:
            div_grade = "D"
        metrics["diversity"] = {"value": str(unique_plants), "grade": div_grade, "label": "Plant Variety"}

        if failure_rate <= 10:
            fr_grade = "A"
        elif failure_rate <= 25:
            fr_grade = "B"
        elif failure_rate <= 40:
            fr_grade = "C"
        elif failure_rate <= 60:
            fr_grade = "D"
        else:
            fr_grade = "F"
        metrics["failure_rate"] = {"value": f"{failure_rate}%", "grade": fr_grade, "label": "Failure Rate"}

        what_worked = []
        plant_yields: dict[str, float] = {}
        for p in plantings_list:
            if p["total_harvest_oz"] > 0:
                plant_yields[p["plant_name"]] = plant_yields.get(p["plant_name"], 0) + p["total_harvest_oz"]
        top_plants = sorted(plant_yields.items(), key=lambda x: x[1], reverse=True)[:5]
        for name, oz in top_plants:
            what_worked.append(f"{name} produced {oz / 16:.1f} lbs")

        bed_yields: dict[str, float] = {}
        for p in plantings_list:
            bname = p.get("bed_name") or "Unknown"
            if p["total_harvest_oz"] > 0:
                bed_yields[bname] = bed_yields.get(bname, 0) + p["total_harvest_oz"]
        if bed_yields:
            best_bed = max(bed_yields, key=bed_yields.get)
            what_worked.append(f"{best_bed} was the most productive planter ({bed_yields[best_bed] / 16:.1f} lbs)")

        what_to_improve = []
        failed_plants = [p for p in plantings_list if p["status"] == "failed"]
        if failed_plants:
            failed_names = list(set(p["plant_name"] for p in failed_plants))
            what_to_improve.append(f"Failed plants: {', '.join(failed_names[:5])}")
        if failure_rate > 30:
            what_to_improve.append(f"High failure rate ({failure_rate}%) -- consider switching varieties or adjusting timing")
        if total_yield == 0 and harvested == 0:
            what_to_improve.append("No harvest recorded -- start logging harvests to track progress")

        recommendations = []
        if top_plants:
            recommendations.append(f"Plant more {top_plants[0][0]} -- your best producer this season")
        if failed_plants:
            fail_names = list(set(p["plant_name"] for p in failed_plants))
            recommendations.append(f"Try heat-tolerant varieties of {fail_names[0]} or skip it next time")
        if unique_plants < 5:
            recommendations.append("Diversify your plantings -- try at least 5-6 different plants per season")
        if success_rate < 60:
            recommendations.append("Focus on proven performers from past seasons to rebuild confidence")
        if not recommendations:
            recommendations.append("Keep doing what you are doing! Maybe try 1-2 new varieties next season.")

        summary = db.execute(
            "SELECT * FROM season_summaries WHERE year = ? AND season = ?",
            (year, season),
        ).fetchone()
        saved_summary = dict(summary) if summary else None

        return {
            "year": year,
            "season": season,
            "overall_grade": overall_grade,
            "overall_summary": overall_summary,
            "metrics": metrics,
            "stats": {
                "total_plantings": total,
                "harvested": harvested,
                "failed": failed,
                "active": active,
                "total_yield_oz": round(total_yield, 1),
                "success_rate": success_rate,
                "unique_plants": unique_plants,
            },
            "what_worked": what_worked,
            "what_to_improve": what_to_improve,
            "recommendations": recommendations,
            "top_performers": [{"plant_name": name, "total_oz": round(oz, 1)} for name, oz in top_plants],
            "saved_summary": saved_summary,
        }



# ──────────────── PLANT DETAILS / ENRICHMENT ────────────────

# OpenPlantBook base URL (token resolved dynamically via _plantbook_token())


def _detail_row_to_dict(row) -> dict:
    """Convert a plant_details row to a dict with JSON fields parsed."""
    if not row:
        return {}
    d = dict(row)
    json_fields = [
        "common_names", "usda_zones", "preferred_amendments", "edible_parts",
        "culinary_uses", "common_pests", "common_diseases", "organic_pest_solutions",
        "plant_before", "plant_after", "seed_sources",
    ]
    for f in json_fields:
        if f in d and d[f] and isinstance(d[f], str):
            try:
                d[f] = json.loads(d[f])
            except (json.JSONDecodeError, TypeError):
                pass
    return d


async def _fetch_openplantbook(plant_name: str) -> Optional[dict]:
    """Search OpenPlantBook and return detail data if found."""
    try:
        headers = {"Authorization": f"Token {_plantbook_token()}"}
        async with httpx.AsyncClient(timeout=15) as client:
            search_resp = await client.get(
                f"{OPENPLANTBOOK_BASE}/plant/search",
                params={"alias": plant_name},
                headers=headers,
            )
            if search_resp.status_code != 200:
                return None
            results = search_resp.json().get("results", [])
            if not results:
                return None

            pid = results[0].get("pid", "")
            if not pid:
                return None

            detail_resp = await client.get(
                f"{OPENPLANTBOOK_BASE}/plant/detail/{pid}/",
                headers=headers,
            )
            if detail_resp.status_code != 200:
                return {"pid": pid}

            data = detail_resp.json()
            return {
                "pid": pid,
                "scientific_name": data.get("display_pid", "").replace("-", " ").title(),
                "min_soil_temp_f": None,
                "max_soil_temp_f": None,
                "min_temp_c": data.get("min_temp"),
                "max_temp_c": data.get("max_temp"),
                "min_light_lux": data.get("min_light_lux"),
                "max_light_lux": data.get("max_light_lux"),
                "min_env_humid": data.get("min_env_humid"),
                "max_env_humid": data.get("max_env_humid"),
                "min_soil_moist": data.get("min_soil_moist"),
                "max_soil_moist": data.get("max_soil_moist"),
            }
    except Exception as e:
        logger.warning(f"OpenPlantBook fetch failed for '{plant_name}': {e}")
        return None


def _enrich_plant_sync(db, plant_id: int, plant_name: str, opb_data: Optional[dict] = None) -> dict:
    """Enrich a single plant using knowledge base, OpenPlantBook data, and seed sources."""
    knowledge = get_knowledge(plant_name)
    seed_sources = generate_seed_sources(plant_name)

    # Build the details dict, merging knowledge base + OpenPlantBook
    details: dict = {}

    if knowledge:
        json_fields = [
            "common_names", "usda_zones", "preferred_amendments", "edible_parts",
            "culinary_uses", "common_pests", "common_diseases", "organic_pest_solutions",
            "plant_before", "plant_after",
        ]
        for key, val in knowledge.items():
            if key in json_fields and isinstance(val, list):
                details[key] = json.dumps(val)
            elif isinstance(val, bool):
                details[key] = 1 if val else 0
            else:
                details[key] = val

    # Add seed sources
    details["seed_sources"] = json.dumps(seed_sources)

    # Add OpenPlantBook data
    if opb_data:
        details["openplantbook_pid"] = opb_data.get("pid")
        if opb_data.get("scientific_name") and not details.get("scientific_name"):
            details["scientific_name"] = opb_data["scientific_name"]

    # Calculate quality score
    score_input = {}
    for k, v in details.items():
        if isinstance(v, str):
            try:
                score_input[k] = json.loads(v)
            except (json.JSONDecodeError, TypeError):
                score_input[k] = v
        else:
            score_input[k] = v
    details["data_quality_score"] = calculate_data_quality(score_input)
    details["last_enriched_at"] = datetime.utcnow().isoformat()
    details["plant_id"] = plant_id

    # Upsert into plant_details
    columns = list(details.keys())
    placeholders = ", ".join(["?"] * len(columns))
    col_names = ", ".join(columns)
    update_parts = ", ".join([f"{c} = excluded.{c}" for c in columns if c != "plant_id"])

    db.execute(
        f"""INSERT INTO plant_details ({col_names}) VALUES ({placeholders})
            ON CONFLICT(plant_id) DO UPDATE SET {update_parts}""",
        [details[c] for c in columns],
    )
    db.commit()

    return details


@router.get("/api/plants/{plant_id}/details")
def get_plant_details(plant_id: int):
    """Get enriched details for a plant."""
    with get_db() as db:
        plant = db.execute("SELECT * FROM plants WHERE id = ?", (plant_id,)).fetchone()
        if not plant:
            raise HTTPException(404, "Plant not found")

        row = db.execute("SELECT * FROM plant_details WHERE plant_id = ?", (plant_id,)).fetchone()
        if not row:
            # Still return harvest flags even when not enriched
            is_h, ss, sd = _get_harvest_flags(plant["name"], plant["category"], plant.get("subcategory", ""))
            return {
                "plant_id": plant_id, "enriched": False, "data_quality_score": 0,
                "is_harvestable": is_h, "success_state": ss, "success_description": sd,
            }

        details = _detail_row_to_dict(row)
        details["enriched"] = True
        # Ensure harvest flags are present (may not be set in DB yet)
        if details.get("is_harvestable") is None:
            is_h, ss, sd = _get_harvest_flags(plant["name"], plant["category"], plant.get("subcategory", ""))
            details["is_harvestable"] = is_h
            details["success_state"] = ss
            details["success_description"] = sd
        return details


@router.post("/api/plants/update-harvest-flags")
def update_harvest_flags():
    """Scan all plants and set is_harvestable/success_state/success_description based on classification."""
    with get_db() as db:
        plants = db.execute("SELECT id, name, category, subcategory FROM plants").fetchall()
        updated = 0
        for p in plants:
            is_h, ss, sd = _get_harvest_flags(p["name"], p["category"], p["subcategory"] or "")
            db.execute("""
                INSERT INTO plant_details (plant_id, is_harvestable, success_state, success_description)
                VALUES (?, ?, ?, ?)
                ON CONFLICT(plant_id) DO UPDATE SET
                    is_harvestable = excluded.is_harvestable,
                    success_state = excluded.success_state,
                    success_description = excluded.success_description
            """, (p["id"], is_h, ss, sd))
            updated += 1
        db.commit()
        return {"updated": updated}


@router.get("/api/plants/{plant_id}/harvest-info")
def get_plant_harvest_info(plant_id: int):
    """Get just the harvest classification for a plant."""
    with get_db() as db:
        plant = db.execute("SELECT * FROM plants WHERE id = ?", (plant_id,)).fetchone()
        if not plant:
            raise HTTPException(404, "Plant not found")
        row = db.execute(
            "SELECT is_harvestable, success_state, success_description FROM plant_details WHERE plant_id = ?",
            (plant_id,)
        ).fetchone()
        if row and row["is_harvestable"] is not None:
            return {"plant_id": plant_id, "is_harvestable": row["is_harvestable"],
                    "success_state": row["success_state"], "success_description": row["success_description"]}
        is_h, ss, sd = _get_harvest_flags(plant["name"], plant["category"], plant.get("subcategory", ""))
        return {"plant_id": plant_id, "is_harvestable": is_h, "success_state": ss, "success_description": sd}


@router.post("/api/plants/enrich/{plant_id}")
async def enrich_plant(plant_id: int):
    """Enrich a single plant with knowledge base + OpenPlantBook data."""
    with get_db() as db:
        plant = db.execute("SELECT * FROM plants WHERE id = ?", (plant_id,)).fetchone()
        if not plant:
            raise HTTPException(404, "Plant not found")

        plant_name = plant["name"]

        # Fetch OpenPlantBook data async
        opb_data = await _fetch_openplantbook(plant_name)

        details = _enrich_plant_sync(db, plant_id, plant_name, opb_data)

        return {
            "plant_id": plant_id,
            "plant_name": plant_name,
            "data_quality_score": details.get("data_quality_score", 0),
            "openplantbook_found": opb_data is not None,
            "knowledge_base_found": get_knowledge(plant_name) is not None,
            "seed_sources_count": len(generate_seed_sources(plant_name)),
        }


@router.post("/api/plants/enrich-all")
async def enrich_all_plants():
    """Enrich all plants in the database. Returns summary."""
    results = []
    with get_db() as db:
        plants = db.execute("SELECT id, name FROM plants ORDER BY name").fetchall()
        total = len(plants)

        for i, plant in enumerate(plants):
            plant_id = plant["id"]
            plant_name = plant["name"]

            opb_data = await _fetch_openplantbook(plant_name)
            details = _enrich_plant_sync(db, plant_id, plant_name, opb_data)

            results.append({
                "plant_id": plant_id,
                "plant_name": plant_name,
                "data_quality_score": details.get("data_quality_score", 0),
                "openplantbook_found": opb_data is not None,
                "knowledge_base_found": get_knowledge(plant_name) is not None,
            })

    avg_quality = sum(r["data_quality_score"] for r in results) / total if total else 0
    return {
        "total_plants": total,
        "enriched_count": len(results),
        "average_quality_score": round(avg_quality, 1),
        "plants": results,
    }


@router.get("/api/enrichment/summary")
def enrichment_summary():
    """Get a summary of data quality across all plants."""
    with get_db() as db:
        total_plants = db.execute("SELECT COUNT(*) as c FROM plants").fetchone()["c"]
        enriched = db.execute("SELECT COUNT(*) as c FROM plant_details").fetchone()["c"]

        quality_rows = db.execute(
            "SELECT data_quality_score FROM plant_details"
        ).fetchall()
        scores = [r["data_quality_score"] for r in quality_rows]

        avg_score = sum(scores) / len(scores) if scores else 0
        high_quality = sum(1 for s in scores if s >= 70)
        medium_quality = sum(1 for s in scores if 40 <= s < 70)
        low_quality = sum(1 for s in scores if s < 40)

        return {
            "total_plants": total_plants,
            "enriched_count": enriched,
            "not_enriched_count": total_plants - enriched,
            "average_quality_score": round(avg_score, 1),
            "high_quality_count": high_quality,
            "medium_quality_count": medium_quality,
            "low_quality_count": low_quality,
            "score_distribution": {
                "90-100": sum(1 for s in scores if s >= 90),
                "70-89": sum(1 for s in scores if 70 <= s < 90),
                "50-69": sum(1 for s in scores if 50 <= s < 70),
                "30-49": sum(1 for s in scores if 30 <= s < 50),
                "0-29": sum(1 for s in scores if s < 30),
            },
        }


@router.post("/api/plants/deduplicate")
def deduplicate_plants():
    """Scan for potential duplicate plants based on similar names or same scientific name."""
    with get_db() as db:
        plants = db.execute("SELECT id, name FROM plants ORDER BY name").fetchall()
        details = db.execute("SELECT plant_id, scientific_name FROM plant_details WHERE scientific_name IS NOT NULL").fetchall()

        # Build scientific name -> plant_ids map
        sci_map: dict[str, list] = {}
        for d in details:
            sn = d["scientific_name"].lower().strip()
            if sn:
                sci_map.setdefault(sn, []).append(d["plant_id"])

        candidates = []

        # Check for same scientific name
        for sn, ids in sci_map.items():
            if len(ids) > 1:
                names = []
                for pid in ids:
                    p = db.execute("SELECT name FROM plants WHERE id = ?", (pid,)).fetchone()
                    if p:
                        names.append({"id": pid, "name": p["name"]})
                candidates.append({
                    "reason": "same_scientific_name",
                    "scientific_name": sn,
                    "plants": names,
                })

        # Check for similar names (simple Levenshtein-like check)
        plant_list = [{"id": p["id"], "name": p["name"]} for p in plants]
        for i, p1 in enumerate(plant_list):
            for p2 in plant_list[i + 1:]:
                n1 = p1["name"].lower().strip()
                n2 = p2["name"].lower().strip()
                # Check if one name contains the other
                if n1 in n2 or n2 in n1:
                    candidates.append({
                        "reason": "similar_name",
                        "plants": [p1, p2],
                    })

        return {"duplicate_candidates": candidates, "count": len(candidates)}


