"""Shared constants, helper functions, and data maps."""
from __future__ import annotations

import json
import math
import uuid
from datetime import date, datetime, timedelta
from pathlib import Path

from db import get_db


PHOTOS_DIR = Path(__file__).parent / "data" / "photos"
ALLOWED_PHOTO_TYPES = {"image/jpeg", "image/png", "image/webp"}
MAX_PHOTO_SIZE = 10 * 1024 * 1024  # 10MB
PHOTO_EXTENSIONS = {"image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp"}

CURRENT_YEAR = date.today().year

UNDO_EXPIRY_SECONDS = 30

# Amendment types
AMENDMENT_TYPES = ("compost", "fertilizer", "sulfur", "gypsum", "mulch", "worm_castings", "bone_meal", "fish_emulsion", "other")

# Notification event types
NOTIFICATION_EVENT_TYPES = [
    "task_due", "task_overdue", "harvest_ready", "planting_window",
    "frost_warning", "watering_reminder", "lifecycle_milestone",
]

# ── Harvest flag classification for all plants ──
# Maps plant name -> (is_harvestable, success_state, success_description)
HARVEST_FLAG_MAP: dict[str, tuple[int, str, str]] = {
    # Vegetables — all harvestable
    "Tomato": (1, "harvested", "Fruit/produce ready to pick"),
    "Pepper": (1, "harvested", "Fruit/produce ready to pick"),
    "Cucumber": (1, "harvested", "Fruit/produce ready to pick"),
    "Squash (Summer)": (1, "harvested", "Fruit/produce ready to pick"),
    "Lettuce": (1, "harvested", "Leaves ready to harvest"),
    "Spinach": (1, "harvested", "Leaves ready to harvest"),
    "Kale": (1, "harvested", "Leaves ready to harvest"),
    "Carrot": (1, "harvested", "Fruit/produce ready to pick"),
    "Radish": (1, "harvested", "Fruit/produce ready to pick"),
    "Beet": (1, "harvested", "Fruit/produce ready to pick"),
    "Onion": (1, "harvested", "Fruit/produce ready to pick"),
    "Garlic": (1, "harvested", "Fruit/produce ready to pick"),
    "Pea": (1, "harvested", "Fruit/produce ready to pick"),
    "Bean (Bush)": (1, "harvested", "Fruit/produce ready to pick"),
    "Corn": (1, "harvested", "Fruit/produce ready to pick"),
    "Eggplant": (1, "harvested", "Fruit/produce ready to pick"),
    "Melon": (1, "harvested", "Fruit/produce ready to pick"),
    "Broccoli": (1, "harvested", "Fruit/produce ready to pick"),
    "Cauliflower": (1, "harvested", "Fruit/produce ready to pick"),
    "Brussels Sprouts": (1, "harvested", "Fruit/produce ready to pick"),
    "Cabbage": (1, "harvested", "Fruit/produce ready to pick"),
    "Swiss Chard": (1, "harvested", "Leaves ready to harvest"),
    "Collard Greens": (1, "harvested", "Leaves ready to harvest"),
    "Arugula": (1, "harvested", "Leaves ready to harvest"),
    "Bok Choy": (1, "harvested", "Leaves ready to harvest"),
    "Sweet Potato": (1, "harvested", "Fruit/produce ready to pick"),
    "Potato": (1, "harvested", "Fruit/produce ready to pick"),
    "Turnip": (1, "harvested", "Fruit/produce ready to pick"),
    "Parsnip": (1, "harvested", "Fruit/produce ready to pick"),
    "Okra": (1, "harvested", "Fruit/produce ready to pick"),
    "Artichoke": (1, "harvested", "Fruit/produce ready to pick"),
    "Asparagus": (1, "harvested", "Spears ready to harvest"),
    "Celery": (1, "harvested", "Stalks ready to harvest"),
    "Leek": (1, "harvested", "Fruit/produce ready to pick"),
    "Green Onion": (1, "harvested", "Fruit/produce ready to pick"),
    "Watermelon": (1, "harvested", "Fruit/produce ready to pick"),
    "Cantaloupe": (1, "harvested", "Fruit/produce ready to pick"),
    "Pumpkin": (1, "harvested", "Fruit/produce ready to pick"),
    "Winter Squash": (1, "harvested", "Fruit/produce ready to pick"),
    "Butternut Squash": (1, "harvested", "Fruit/produce ready to pick"),
    "Zucchini": (1, "harvested", "Fruit/produce ready to pick"),
    "Tomatillo": (1, "harvested", "Fruit/produce ready to pick"),
    "Ground Cherry": (1, "harvested", "Fruit/produce ready to pick"),
    "Jalapeno": (1, "harvested", "Fruit/produce ready to pick"),
    "Habanero": (1, "harvested", "Fruit/produce ready to pick"),
    "Serrano": (1, "harvested", "Fruit/produce ready to pick"),
    "Prickly Pear": (1, "harvested", "Pads/fruit ready to harvest"),
    "Moringa": (1, "harvested", "Leaves/pods ready to harvest"),
    "Armenian Cucumber": (1, "harvested", "Fruit/produce ready to pick"),
    "Tepary Bean": (1, "harvested", "Fruit/produce ready to pick"),
    "Malabar Spinach": (1, "harvested", "Leaves ready to harvest"),
    "Roselle": (1, "harvested", "Calyces ready to harvest"),
    # Herbs — harvestable
    "Basil": (1, "harvested", "Leaves ready to harvest"),
    "Cilantro": (1, "harvested", "Leaves ready to harvest"),
    "Rosemary": (1, "harvested", "Leaves ready to harvest"),
    "Mint": (1, "harvested", "Leaves ready to harvest"),
    "Oregano": (1, "harvested", "Leaves ready to harvest"),
    "Thyme": (1, "harvested", "Leaves ready to harvest"),
    "Sage": (1, "harvested", "Leaves ready to harvest"),
    "Dill": (1, "harvested", "Leaves ready to harvest"),
    "Chive": (1, "harvested", "Leaves ready to harvest"),
    "Parsley": (1, "harvested", "Leaves ready to harvest"),
    "Lavender": (1, "harvested", "Flowers/stems ready to harvest"),
    "Lemongrass": (1, "harvested", "Stalks ready to harvest"),
    "Mexican Tarragon": (1, "harvested", "Leaves ready to harvest"),
    # Fruit trees — harvestable
    "Fig": (1, "fruiting", "Fruit ripening on tree"),
    "Pomegranate": (1, "fruiting", "Fruit ripening on tree"),
    "Lemon": (1, "fruiting", "Fruit ripening on tree"),
    "Orange": (1, "fruiting", "Fruit ripening on tree"),
    "Grapefruit": (1, "fruiting", "Fruit ripening on tree"),
    "Jujube": (1, "fruiting", "Fruit ripening on tree"),
    "Date Palm": (1, "fruiting", "Fruit ripening on tree"),
    "Desert Gold Peach": (1, "fruiting", "Fruit ripening on tree"),
    "Barbados Cherry": (1, "fruiting", "Fruit ripening on tree"),
    # Fruit vines/berries — harvestable
    "Strawberry": (1, "harvested", "Fruit ready to pick"),
    "Grape": (1, "fruiting", "Fruit ripening on vine"),
    "Blackberry": (1, "harvested", "Berries ready to pick"),
    "Raspberry": (1, "harvested", "Berries ready to pick"),
    # Ornamental flowers — NOT harvestable
    "Marigold": (0, "flowering", "Blooming successfully"),
    "Nasturtium": (0, "flowering", "Blooming successfully"),
    "Sunflower": (0, "flowering", "Blooming successfully"),
    "Zinnia": (0, "flowering", "Blooming successfully"),
    "Cosmos": (0, "flowering", "Blooming successfully"),
    "Borage": (0, "flowering", "Blooming successfully"),
    "Calendula": (0, "flowering", "Blooming successfully"),
    "Sweet Alyssum": (0, "flowering", "Blooming successfully"),
    # Ornamental/landscape tree
    "Indian Laurel": (0, "established", "Healthy and established"),
    # Vines — NOT harvestable
    "Tangerine Crossvine": (0, "flowering", "Growing and blooming on trellis"),
    # Desert natives / landscape — NOT harvestable
    "Baja Fairy Duster": (0, "flowering", "Blooming and attracting pollinators"),
    "Parry's Penstemon": (0, "flowering", "Blooming and attracting pollinators"),
    "Sparky Tecoma": (0, "flowering", "Blooming successfully"),
    "Blackfoot Daisy": (0, "flowering", "Blooming successfully"),
    "Moss Verbena": (0, "flowering", "Blooming successfully"),
    "Purple Trailing Lantana": (0, "flowering", "Blooming successfully"),
    # Yucca — NOT harvestable
    "Soaptree Yucca": (0, "established", "Healthy and established"),
    "Banana Yucca": (0, "established", "Healthy and established"),
    "Mojave Yucca": (0, "established", "Healthy and established"),
    "Red Yucca": (0, "established", "Healthy and established"),
    # Milkweed / pollinator plants — NOT harvestable
    "Desert Milkweed": (0, "flowering", "Blooming and attracting pollinators"),
    "Pine-leaf Milkweed": (0, "flowering", "Blooming and attracting pollinators"),
    "Butterfly Weed": (0, "flowering", "Blooming and attracting pollinators"),
    "Showy Milkweed": (0, "flowering", "Blooming and attracting pollinators"),
    "Arizona Milkweed": (0, "flowering", "Blooming and attracting pollinators"),
}

# Fallback classification by category/subcategory
HARVEST_FLAG_DEFAULTS: dict[str, tuple[int, str, str]] = {
    "vegetable": (1, "harvested", "Fruit/produce ready to pick"),
    "herb": (1, "harvested", "Leaves ready to harvest"),
    "fruit": (1, "fruiting", "Fruit ripening"),
    "flower:companion": (0, "flowering", "Blooming successfully"),
    "flower:desert native": (0, "flowering", "Blooming and attracting pollinators"),
    "flower:desert adapted": (0, "flowering", "Blooming successfully"),
    "flower:vine": (0, "flowering", "Growing and blooming on trellis"),
    "flower": (0, "flowering", "Blooming successfully"),
}


def _get_harvest_flags(plant_name: str, category: str, subcategory: str = "") -> tuple[int, str, str]:
    """Return (is_harvestable, success_state, success_description) for a plant."""
    if plant_name in HARVEST_FLAG_MAP:
        return HARVEST_FLAG_MAP[plant_name]
    # Fallback by category:subcategory, then category
    key = f"{category}:{subcategory}" if subcategory else category
    if key in HARVEST_FLAG_DEFAULTS:
        return HARVEST_FLAG_DEFAULTS[key]
    if category in HARVEST_FLAG_DEFAULTS:
        return HARVEST_FLAG_DEFAULTS[category]
    return (1, "harvested", "Ready to harvest")



# ─── Valid zone types (application-layer validation, replaces rigid CHECK constraint) ───
VALID_ZONE_TYPES = {'garden', 'house', 'patio', 'lawn', 'driveway', 'walkway', 'fence', 'mulch', 'turf', 'planter_area', 'other'}

# Zone types that represent plantable garden areas (auto-create linked area on zone creation)
AREA_ZONE_TYPES = {'garden', 'lawn', 'planter_area'}


def _point_in_polygon(x: float, y: float, polygon_json: str) -> bool:
    """Ray-casting point-in-polygon test. polygon_json is a JSON array of {x, y} objects."""
    try:
        pts = json.loads(polygon_json)
    except (json.JSONDecodeError, TypeError):
        return False
    n = len(pts)
    if n < 3:
        return False
    inside = False
    j = n - 1
    for i in range(n):
        xi, yi = float(pts[i].get("x", 0)), float(pts[i].get("y", 0))
        xj, yj = float(pts[j].get("x", 0)), float(pts[j].get("y", 0))
        if ((yi > y) != (yj > y)) and (x < (xj - xi) * (y - yi) / (yj - yi) + xi):
            inside = not inside
        j = i
    return inside


def _point_in_rect(x: float, y: float, rx: float, ry: float, rw: float, rh: float) -> bool:
    """Check if point (x, y) is inside axis-aligned rectangle."""
    return rx <= x <= rx + rw and ry <= y <= ry + rh


def find_zone_at_position(db, x_feet: float, y_feet: float):
    """Find the zone (linked to an area) containing the given position. Returns zone row or None."""
    zones = db.execute(
        "SELECT z.* FROM zones z INNER JOIN areas a ON a.zone_id = z.id ORDER BY z.id"
    ).fetchall()
    for z in zones:
        zd = dict(z)
        if zd.get("polygon_points"):
            if _point_in_polygon(x_feet, y_feet, zd["polygon_points"]):
                return zd
        else:
            if _point_in_rect(x_feet, y_feet, float(zd.get("x_feet", 0)), float(zd.get("y_feet", 0)),
                              float(zd.get("width_feet", 0)), float(zd.get("height_feet", 0))):
                return zd
    return None


def _auto_assign_area_from_position(db, x_feet, y_feet):
    """Given x,y coordinates, find a zone at that position and return the linked area_id, or None."""
    if x_feet is None or y_feet is None:
        return None
    zone = find_zone_at_position(db, float(x_feet), float(y_feet))
    if zone:
        area = db.execute("SELECT id FROM areas WHERE zone_id = ?", (zone["id"],)).fetchone()
        if area:
            return area["id"]
    return None


# ──────────────── SOIL INTELLIGENCE CONSTANTS ────────────────

SOIL_TYPES = {
    "native_ground": {
        "label": "Native Ground",
        "description": "Whatever the property's native soil is (e.g. clay/caliche in the desert Southwest)",
        "default_ph_min": 7.5,
        "default_ph_max": 8.5,
        "has_products": False,
    },
    "amended_native": {
        "label": "Amended Native",
        "description": "Native soil with amendments mixed in",
        "default_ph_min": 7.0,
        "default_ph_max": 8.0,
        "has_products": False,
    },
    "raised_bed_mix": {
        "label": "Raised Bed Mix",
        "description": "Pre-made raised bed soil blends for planters",
        "default_ph_min": 6.0,
        "default_ph_max": 7.0,
        "has_products": True,
    },
    "potting_mix": {
        "label": "Potting Mix",
        "description": "Lighter container mixes for pots and vertical planters",
        "default_ph_min": 5.5,
        "default_ph_max": 6.5,
        "has_products": True,
    },
    "cactus_succulent_mix": {
        "label": "Cactus/Succulent Mix",
        "description": "Specialized desert mix for cacti and succulents",
        "default_ph_min": 5.5,
        "default_ph_max": 6.5,
        "has_products": True,
    },
    "custom_blend": {
        "label": "Custom Blend",
        "description": "User-defined soil mix",
        "default_ph_min": 6.0,
        "default_ph_max": 7.5,
        "has_products": False,
    },
    # Legacy keys kept for backward compatibility
    "native-clay": {
        "label": "Native Clay/Caliche",
        "description": "Heavy alkaline clay with caliche subsoil, typical of the desert Southwest",
        "default_ph_min": 7.5,
        "default_ph_max": 8.5,
        "has_products": False,
    },
    "native-amended": {
        "label": "Native Soil (Amended)",
        "description": "Native clay soil with organic amendments mixed in",
        "default_ph_min": 7.0,
        "default_ph_max": 8.0,
        "has_products": False,
    },
    "raised-bed-mix": {
        "label": "Raised Bed Mix",
        "description": "Commercial raised bed soil mix (typically 1/3 compost, 1/3 topsoil, 1/3 drainage material)",
        "default_ph_min": 6.2,
        "default_ph_max": 7.0,
        "has_products": True,
    },
    "potting-soil": {
        "label": "Container Potting Mix",
        "description": "Lightweight potting mix for containers and vertical planters",
        "default_ph_min": 5.5,
        "default_ph_max": 7.0,
        "has_products": True,
    },
    "sandy": {
        "label": "Sandy Soil",
        "description": "Sandy, fast-draining soil",
        "default_ph_min": 6.0,
        "default_ph_max": 7.5,
        "has_products": False,
    },
    "loamy": {
        "label": "Loam",
        "description": "Balanced loam with good structure and drainage",
        "default_ph_min": 6.0,
        "default_ph_max": 7.0,
        "has_products": False,
    },
    "custom": {
        "label": "Custom Mix",
        "description": "User-defined soil mix",
        "default_ph_min": 6.0,
        "default_ph_max": 7.5,
        "has_products": False,
    },
}

DEFAULT_SOIL_PROFILE = {
    "default_soil": "loam",
    "default_ph": 6.5,
    "location": "Default",
    "characteristics": [
        "General-purpose garden soil profile",
        "Actual characteristics depend on your location",
        "Configure your address in Settings to get location-specific recommendations",
    ],
    "challenges": [
        "Set your garden location in Settings for tailored soil advice",
    ],
    "recommended_amendments": [
        {"name": "Compost (3-4 inches)", "purpose": "Adds organic matter, improves structure and water retention"},
        {"name": "Mulch (2-3 inches)", "purpose": "Retains moisture, suppresses weeds, moderates soil temperature"},
        {"name": "Mycorrhizal inoculant", "purpose": "Helps roots access nutrients in challenging soil"},
    ],
    "notes": "This is a generic soil profile. Configure your property address in Settings to get "
             "location-aware soil recommendations, frost dates, and USDA zone detection.",
}

# Legacy alias for backward compatibility (deprecated — use DEFAULT_SOIL_PROFILE)
GLENDALE_SOIL_PROFILE = DEFAULT_SOIL_PROFILE



def _estimate_frost_from_latitude(lat: float) -> dict:
    """Rough frost date estimation based on latitude for locations not in the lookup table."""
    abs_lat = abs(lat)
    if abs_lat < 25:
        return {"last_frost_spring": "01-01", "first_frost_fall": "12-31", "frost_free_days": 365,
                "source": f"Estimated from latitude {lat:.1f}", "confidence": "low"}
    if abs_lat > 55:
        return {"last_frost_spring": "06-15", "first_frost_fall": "08-15", "frost_free_days": 61,
                "source": f"Estimated from latitude {lat:.1f}", "confidence": "low"}
    last_frost_day = max(1, int((abs_lat - 25) * 5.96))
    first_frost_day = min(365, 365 - last_frost_day)
    frost_free = first_frost_day - last_frost_day
    base_year = 2024
    try:
        spring = date(base_year, 1, 1) + timedelta(days=last_frost_day - 1)
        fall = date(base_year, 1, 1) + timedelta(days=first_frost_day - 1)
    except (ValueError, OverflowError):
        spring = date(base_year, 4, 15)
        fall = date(base_year, 10, 15)
        frost_free = 183
    return {
        "last_frost_spring": spring.strftime("%m-%d"),
        "first_frost_fall": fall.strftime("%m-%d"),
        "frost_free_days": max(0, frost_free),
        "source": f"Estimated from latitude {lat:.1f}",
        "confidence": "low",
    }


def get_frost_dates_from_property():
    """Get frost dates from property settings, falling back to latitude-based estimation or generic defaults."""
    try:
        with get_db() as db:
            prop = db.execute("SELECT last_frost_spring, first_frost_fall, latitude FROM property WHERE id = 1").fetchone()
            if prop:
                last_frost = prop["last_frost_spring"]
                first_frost = prop["first_frost_fall"]
                if last_frost and first_frost:
                    try:
                        lm, ld = map(int, last_frost.split("-"))
                        fm, fd = map(int, first_frost.split("-"))
                        return (lm, ld), (fm, fd)
                    except (ValueError, AttributeError):
                        pass
                # If property has coordinates but no frost dates, estimate from latitude
                lat = prop["latitude"]
                if lat and lat != 0.0:
                    est = _estimate_frost_from_latitude(lat)
                    lm, ld = map(int, est["last_frost_spring"].split("-"))
                    fm, fd = map(int, est["first_frost_fall"].split("-"))
                    return (lm, ld), (fm, fd)
    except Exception:
        pass
    # Ultimate fallback: mid-range temperate defaults (Apr 15 / Oct 15)
    return (4, 15), (10, 15)


def _get_configured_timezone() -> str:
    """Return the configured timezone, or UTC as fallback."""
    try:
        with get_db() as db:
            row = db.execute("SELECT timezone FROM property WHERE id = 1").fetchone()
            if row and row["timezone"]:
                return row["timezone"]
    except Exception:
        pass
    return "UTC"


def _get_configured_zone() -> str:
    """Return the configured USDA zone string, or 'Not set' if unknown."""
    try:
        with get_db() as db:
            row = db.execute("SELECT value FROM app_config WHERE key = 'usda_zone'").fetchone()
            if row and row["value"]:
                return row["value"]
    except Exception:
        pass
    return "Not set"



# ──────────────── UNDO SYSTEM ────────────────

UNDO_EXPIRY_SECONDS = 30


def create_undo_action(db, action_type: str, entity_data: dict) -> str:
    """Snapshot an entity before deletion so it can be restored. Returns the undo action ID."""
    action_id = str(uuid.uuid4())
    now = datetime.utcnow()
    expires_at = now + timedelta(seconds=UNDO_EXPIRY_SECONDS)
    db.execute(
        "INSERT INTO undo_actions (id, action_type, entity_data, created_at, expires_at) VALUES (?, ?, ?, ?, ?)",
        (action_id, action_type, json.dumps(entity_data), now.isoformat(), expires_at.isoformat()),
    )
    return action_id


def cleanup_expired_undo_actions(db):
    """Remove expired undo actions."""
    db.execute("DELETE FROM undo_actions WHERE expires_at < ?", (datetime.utcnow().isoformat(),))


def _restore_rows(db, table: str, rows: list[dict]):
    """Re-insert rows from a snapshot into a table."""
    for row in rows:
        cols = list(row.keys())
        placeholders = ", ".join("?" for _ in cols)
        col_names = ", ".join(cols)
        db.execute(f"INSERT OR REPLACE INTO {table} ({col_names}) VALUES ({placeholders})", [row[c] for c in cols])



def parse_md(md_str: str, year: int = None) -> date:
    """Parse MM-DD string to date."""
    if year is None:
        year = CURRENT_YEAR
    m, d = md_str.split("-")
    return date(year, int(m), int(d))


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

