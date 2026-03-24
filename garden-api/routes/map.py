"""Property, zones, bed positions, sun tracking endpoints."""
from __future__ import annotations

import json
import math
from datetime import date, datetime, timedelta
from typing import Optional

import httpx
from fastapi import APIRouter, HTTPException, Query, Request
from fastapi.responses import Response

from db import get_db, row_to_dict
from auth import require_user, require_admin
from models import PropertyUpdate, ZoneCreate, ZoneUpdate
from constants import VALID_ZONE_TYPES, AREA_ZONE_TYPES

router = APIRouter()

@router.get("/api/property")
def get_property():
    with get_db() as db:
        row = db.execute("SELECT * FROM property WHERE id = 1").fetchone()
        if not row:
            db.execute("INSERT INTO property (id, name, latitude, longitude, address) VALUES (1, 'My Property', 0.0, 0.0, '')")
            db.commit()
            row = db.execute("SELECT * FROM property WHERE id = 1").fetchone()
        return dict(row)


@router.patch("/api/property")
def update_property(data: PropertyUpdate):
    with get_db() as db:
        fields = []
        values = []
        for field_name, value in data.model_dump(exclude_none=True).items():
            fields.append(f"{field_name} = ?")
            values.append(value)
        if not fields:
            raise HTTPException(400, "No fields to update")
        values.append(1)
        db.execute(f"UPDATE property SET {', '.join(fields)} WHERE id = ?", values)
        db.commit()
        row = db.execute("SELECT * FROM property WHERE id = 1").fetchone()
        return dict(row)


@router.get("/api/zones")
def list_zones():
    with get_db() as db:
        rows = db.execute("SELECT * FROM zones ORDER BY id").fetchall()
        return [dict(r) for r in rows]


@router.post("/api/zones")
def create_zone(data: ZoneCreate):
    if data.zone_type not in VALID_ZONE_TYPES:
        raise HTTPException(400, f"Invalid zone_type '{data.zone_type}'. Must be one of: {', '.join(sorted(VALID_ZONE_TYPES))}")
    with get_db() as db:
        cur = db.execute(
            "INSERT INTO zones (property_id, name, zone_type, x_feet, y_feet, width_feet, height_feet, color, notes, rotation_degrees, polygon_points, is_cutout, parent_zone_id, soil_type, soil_ph_min, soil_ph_max, soil_amendments, soil_notes, height_ft) VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (data.name, data.zone_type, data.x_feet, data.y_feet, data.width_feet, data.height_feet, data.color, data.notes, data.rotation_degrees, data.polygon_points, data.is_cutout, data.parent_zone_id, data.soil_type, data.soil_ph_min, data.soil_ph_max, data.soil_amendments, data.soil_notes, data.height_ft),
        )
        # Auto-create a linked area for plantable zone types if no area with same name exists
        zone_id_new = cur.lastrowid
        if data.zone_type in AREA_ZONE_TYPES and not data.is_cutout:
            existing_area = db.execute(
                "SELECT id FROM areas WHERE name = ? COLLATE NOCASE", (data.name,)
            ).fetchone()
            if existing_area:
                # Link the existing area to this zone if not already linked
                if not db.execute("SELECT zone_id FROM areas WHERE id = ?", (existing_area["id"],)).fetchone()["zone_id"]:
                    db.execute("UPDATE areas SET zone_id = ? WHERE id = ?", (zone_id_new, existing_area["id"]))
            else:
                max_order = db.execute("SELECT COALESCE(MAX(sort_order), -1) FROM areas").fetchone()[0]
                db.execute(
                    "INSERT INTO areas (name, area_type, sort_order, color, zone_id) VALUES (?, 'all', ?, ?, ?)",
                    (data.name, max_order + 1, data.color, zone_id_new),
                )
        db.commit()
        row = db.execute("SELECT * FROM zones WHERE id = ?", (zone_id_new,)).fetchone()
        return dict(row)


@router.patch("/api/zones/{zone_id}")
def update_zone(zone_id: int, data: ZoneUpdate):
    if data.zone_type is not None and data.zone_type not in VALID_ZONE_TYPES:
        raise HTTPException(400, f"Invalid zone_type '{data.zone_type}'. Must be one of: {', '.join(sorted(VALID_ZONE_TYPES))}")
    with get_db() as db:
        existing = db.execute("SELECT id FROM zones WHERE id = ?", (zone_id,)).fetchone()
        if not existing:
            raise HTTPException(404, "Zone not found")
        fields = []
        values = []
        for field_name, value in data.model_dump(exclude_none=True).items():
            fields.append(f"{field_name} = ?")
            values.append(value)
        if not fields:
            raise HTTPException(400, "No fields to update")
        values.append(zone_id)
        db.execute(f"UPDATE zones SET {', '.join(fields)} WHERE id = ?", values)
        db.commit()
        row = db.execute("SELECT * FROM zones WHERE id = ?", (zone_id,)).fetchone()
        return dict(row)


@router.delete("/api/zones/{zone_id}")
def delete_zone(zone_id: int):
    with get_db() as db:
        existing = db.execute("SELECT id FROM zones WHERE id = ?", (zone_id,)).fetchone()
        if not existing:
            raise HTTPException(404, "Zone not found")
        # Unlink any areas that reference this zone (don't delete the area)
        db.execute("UPDATE areas SET zone_id = NULL WHERE zone_id = ?", (zone_id,))
        db.execute("DELETE FROM zones WHERE id = ?", (zone_id,))
        db.commit()
        return {"deleted": zone_id}


@router.post("/api/property/seed-from-plans")
def seed_property_from_plans():
    """Re-seed property and zones from the actual plot plan / floor plan measurements.
    Deletes all existing zones and recreates them from plan data."""
    with get_db() as db:
        # Update property dimensions
        db.execute("""UPDATE property SET name='My Property', width_feet=45, height_feet=108,
                      orientation_degrees=180, latitude=0.0, longitude=0.0,
                      address='' WHERE id=1""")

        # Delete existing zones
        db.execute("DELETE FROM zones WHERE property_id = 1")

        # Seed zones from plot plan
        ZONES = [
            ("House", "house", 5, 15, 35, 63, "#8B7355", "Single story, ~15ft to roof peak"),
            ("Covered Patio", "patio", 5, 4, 11, 12, "#A0A0A0", "Rear covered patio, ~10'10\" x 12'3\""),
            ("Driveway", "driveway", 22, 78, 18, 12, "#C0C0C0", "Front driveway from garage to street"),
            ("Front Porch", "patio", 5, 78, 10, 8, "#B0A090", "Small covered porch at front door"),
            ("West Side Yard (Rear)", "garden", 0, 0, 5, 15, "#7CB342", "West side of rear yard, between fence and patio"),
            ("East Side Yard (Rear)", "garden", 40, 0, 5, 15, "#7CB342", "East side of rear yard"),
            ("West Side Yard", "garden", 0, 15, 5, 63, "#8BC34A", "Between west fence and house"),
            ("East Side Yard", "garden", 40, 15, 5, 63, "#8BC34A", "Between east fence and house"),
            ("Rear Yard (North)", "garden", 5, 0, 35, 4, "#66BB6A", "Open area behind the patio, between side yards"),
            ("Front Yard", "lawn", 0, 78, 22, 18, "#AED581", "Between house front and street, west of driveway"),
            ("North Fence (CMU Block)", "fence", 0, 0, 45, 1, "#9E9E9E", "CMU block wall — north/rear property line"),
            ("West Fence (CMU Block)", "fence", 0, 0, 1, 108, "#9E9E9E", "CMU block wall — west property line"),
            ("East Fence (CMU Block)", "fence", 44, 0, 1, 108, "#9E9E9E", "CMU block wall — east property line"),
        ]
        for z in ZONES:
            db.execute(
                "INSERT INTO zones (property_id, name, zone_type, x_feet, y_feet, width_feet, height_feet, color, notes) VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?)",
                z,
            )
        db.commit()

        zones = db.execute("SELECT * FROM zones WHERE property_id = 1 ORDER BY id").fetchall()
        return {"message": f"Property seeded with {len(zones)} zones from plan data", "zones": [dict(r) for r in zones]}



# ──────────────── SUN TRACKING ────────────────

def solar_position(lat: float, lon: float, dt: datetime) -> dict:
    """Calculate sun azimuth and altitude for a given location and time."""
    n = dt.timetuple().tm_yday
    # Solar declination
    declination = 23.45 * math.sin(math.radians(360 / 365 * (284 + n)))
    # Equation of time (minutes) for more accurate solar noon
    b = math.radians(360 / 365 * (n - 81))
    eot = 9.87 * math.sin(2 * b) - 7.53 * math.cos(b) - 1.5 * math.sin(b)
    # Solar noon adjusted for longitude (standard meridian for MST = -105, but AZ doesn't do DST so use -105 for MST)
    # More generic: use actual longitude offset from UTC
    # Assume UTC offset based on longitude roughly: lon / 15
    # For AZ (MST = UTC-7), standard meridian = -105
    std_meridian = round(lon / 15) * 15
    solar_noon_offset = (std_meridian - lon) * 4 / 60  # hours
    solar_noon = 12.0 - eot / 60 + solar_noon_offset

    hour = dt.hour + dt.minute / 60
    hour_angle = 15 * (hour - solar_noon)

    lat_r = math.radians(lat)
    dec_r = math.radians(declination)
    ha_r = math.radians(hour_angle)

    # Altitude
    sin_alt = (math.sin(lat_r) * math.sin(dec_r) +
               math.cos(lat_r) * math.cos(dec_r) * math.cos(ha_r))
    sin_alt = max(-1.0, min(1.0, sin_alt))
    altitude = math.degrees(math.asin(sin_alt))

    # Azimuth
    cos_alt = math.cos(math.radians(altitude))
    if cos_alt < 1e-10:
        azimuth = 180.0
    else:
        cos_az = (math.sin(dec_r) - math.sin(lat_r) * sin_alt) / (math.cos(lat_r) * cos_alt)
        cos_az = max(-1.0, min(1.0, cos_az))
        azimuth = math.degrees(math.acos(cos_az))
        if hour_angle > 0:
            azimuth = 360 - azimuth

    return {"altitude": round(altitude, 1), "azimuth": round(azimuth, 1)}


def calc_sunrise_sunset(lat: float, lon: float, d: date) -> dict:
    """Calculate approximate sunrise and sunset times."""
    n = d.timetuple().tm_yday
    declination = 23.45 * math.sin(math.radians(360 / 365 * (284 + n)))
    lat_r = math.radians(lat)
    dec_r = math.radians(declination)

    cos_ha = -math.tan(lat_r) * math.tan(dec_r)
    cos_ha = max(-1.0, min(1.0, cos_ha))
    ha_sunrise = math.degrees(math.acos(cos_ha))

    b = math.radians(360 / 365 * (n - 81))
    eot = 9.87 * math.sin(2 * b) - 7.53 * math.cos(b) - 1.5 * math.sin(b)
    std_meridian = round(lon / 15) * 15
    solar_noon_offset = (std_meridian - lon) * 4 / 60
    solar_noon = 12.0 - eot / 60 + solar_noon_offset

    sunrise_hour = solar_noon - ha_sunrise / 15
    sunset_hour = solar_noon + ha_sunrise / 15

    def hour_to_str(h):
        h = max(0, min(23.99, h))
        return f"{int(h):02d}:{int((h % 1) * 60):02d}"

    return {
        "sunrise": hour_to_str(sunrise_hour),
        "sunset": hour_to_str(sunset_hour),
        "daylight_hours": round(2 * ha_sunrise / 15, 1),
    }


@router.get("/api/sun/position")
def get_sun_position(
    date_str: str = Query(alias="date", default=None),
    time_str: str = Query(alias="time", default=None),
):
    with get_db() as db:
        prop = db.execute("SELECT latitude, longitude FROM property WHERE id = 1").fetchone()
        if not prop:
            raise HTTPException(404, "Property not configured")
        lat, lon = prop["latitude"], prop["longitude"]

    d = date.today() if not date_str else date.fromisoformat(date_str)
    if time_str:
        hour, minute = map(int, time_str.split(":"))
    else:
        now = datetime.now()
        hour, minute = now.hour, now.minute

    dt = datetime(d.year, d.month, d.day, hour, minute)
    pos = solar_position(lat, lon, dt)
    sun_times = calc_sunrise_sunset(lat, lon, d)

    return {
        **pos,
        **sun_times,
        "date": d.isoformat(),
        "time": f"{hour:02d}:{minute:02d}",
        "latitude": lat,
        "longitude": lon,
    }


def estimate_shadow_length(structure_height_ft: float, sun_altitude: float) -> float:
    """Estimate shadow length in feet from a structure given sun altitude."""
    if sun_altitude <= 0:
        return 999  # sun below horizon, everything in shadow
    return structure_height_ft / math.tan(math.radians(sun_altitude))


def _get_zone_height(zone: dict) -> float:
    """Get the effective height for a zone (from DB column or defaults)."""
    if zone.get("height_ft") is not None and zone["height_ft"] > 0:
        return float(zone["height_ft"])
    # Fallback defaults if height_ft not set
    height_map = {"house": 15, "fence": 6, "patio": 10, "other": 8}
    return height_map.get(zone["zone_type"], 0)


def _shadow_casts_on(zone: dict) -> bool:
    """Check if a zone type casts meaningful shadows."""
    return zone["zone_type"] in ("house", "fence", "patio", "other") or _get_zone_height(zone) > 0


def compute_shadow_polygon(zone: dict, sun_azimuth: float, sun_altitude: float) -> list:
    """Compute shadow polygon points (in feet) for a structure zone.
    Returns list of {x, y} points forming the shadow polygon, or empty list."""
    structure_h = _get_zone_height(zone)
    if structure_h <= 0 or sun_altitude <= 0:
        return []

    shadow_len = estimate_shadow_length(structure_h, sun_altitude)
    # Cap shadow at reasonable length (200ft) to avoid absurd low-angle shadows
    shadow_len = min(shadow_len, 200)

    shadow_dir = math.radians((sun_azimuth + 180) % 360)
    dx = shadow_len * math.sin(shadow_dir)
    dy = -shadow_len * math.cos(shadow_dir)  # y-axis: top = north

    poly_pts = zone.get("polygon_points")
    if poly_pts:
        try:
            pts = json.loads(poly_pts) if isinstance(poly_pts, str) else poly_pts
        except (json.JSONDecodeError, TypeError):
            pts = None
        if pts and len(pts) >= 3:
            # Shadow polygon: original polygon + each point shifted by shadow vector
            # Then take the convex hull-ish shape: far-side points + shifted far-side points
            shadow_poly = []
            for p in pts:
                shadow_poly.append({"x": p["x"], "y": p["y"]})
            for p in pts:
                shadow_poly.append({"x": p["x"] + dx, "y": p["y"] + dy})
            return _convex_hull(shadow_poly)
    else:
        # Rectangle zone
        zx, zy = zone["x_feet"], zone["y_feet"]
        zw, zh = zone["width_feet"], zone["height_feet"]
        corners = [
            {"x": zx, "y": zy},
            {"x": zx + zw, "y": zy},
            {"x": zx + zw, "y": zy + zh},
            {"x": zx, "y": zy + zh},
        ]
        shadow_poly = list(corners)
        for c in corners:
            shadow_poly.append({"x": c["x"] + dx, "y": c["y"] + dy})
        return _convex_hull(shadow_poly)

    return []


def _convex_hull(points: list) -> list:
    """Compute convex hull of 2D points using Andrew's monotone chain algorithm."""
    pts = sorted(points, key=lambda p: (p["x"], p["y"]))
    if len(pts) <= 2:
        return pts

    def cross(o, a, b):
        return (a["x"] - o["x"]) * (b["y"] - o["y"]) - (a["y"] - o["y"]) * (b["x"] - o["x"])

    lower = []
    for p in pts:
        while len(lower) >= 2 and cross(lower[-2], lower[-1], p) <= 0:
            lower.pop()
        lower.append(p)

    upper = []
    for p in reversed(pts):
        while len(upper) >= 2 and cross(upper[-2], upper[-1], p) <= 0:
            upper.pop()
        upper.append(p)

    return lower[:-1] + upper[:-1]


def compute_tree_shadow(gp: dict, mature_height_inches: int, sun_azimuth: float, sun_altitude: float) -> list:
    """Compute circular-ish shadow polygon for a tree/ground plant.
    Returns list of {x, y} points, or empty list."""
    if sun_altitude <= 0 or not mature_height_inches:
        return []
    tree_height_ft = mature_height_inches / 12.0
    shadow_len = estimate_shadow_length(tree_height_ft, sun_altitude)
    shadow_len = min(shadow_len, 200)

    shadow_dir = math.radians((sun_azimuth + 180) % 360)
    tx, ty = gp["x_feet"], gp["y_feet"]
    # Shadow center is offset from tree by half the shadow length
    center_x = tx + shadow_len * 0.5 * math.sin(shadow_dir)
    center_y = ty - shadow_len * 0.5 * math.cos(shadow_dir)

    # Approximate canopy width: assume canopy spread ~ 1/3 of height, min 3ft
    canopy_radius = max(3, tree_height_ft / 6)
    # Shadow is an ellipse: width = canopy_radius, length = shadow_len * canopy_factor
    shadow_half_len = shadow_len * 0.4
    shadow_half_width = canopy_radius

    pts = []
    for i in range(16):
        angle = 2 * math.pi * i / 16
        # Ellipse aligned to shadow direction
        local_x = shadow_half_width * math.cos(angle)
        local_y = shadow_half_len * math.sin(angle)
        # Rotate to shadow direction
        rot_x = local_x * math.cos(shadow_dir) - local_y * math.sin(shadow_dir)
        rot_y = local_x * math.sin(shadow_dir) + local_y * math.cos(shadow_dir)
        pts.append({"x": round(center_x + rot_x, 1), "y": round(center_y + rot_y, 1)})
    return pts


def check_bed_shading(bed_x: float, bed_y: float, bed_w: float, bed_h: float,
                      zones: list, sun_azimuth: float, sun_altitude: float,
                      ground_plants_with_heights: list | None = None) -> list:
    """Check if any structure zones or trees cast shadow on a bed at given sun position.
    Returns list of dicts with shade source info: [{"name": ..., "type": ...}]."""
    if sun_altitude <= 0:
        return [{"name": "sun below horizon", "type": "horizon"}]

    shade_sources = []

    for zone in zones:
        structure_h = _get_zone_height(zone)
        if structure_h <= 0:
            continue

        shadow_len = estimate_shadow_length(structure_h, sun_altitude)
        shadow_len = min(shadow_len, 200)

        shadow_dir = math.radians((sun_azimuth + 180) % 360)
        zx, zy = zone["x_feet"], zone["y_feet"]
        zw, zh = zone["width_feet"], zone["height_feet"]

        zcx = zx + zw / 2
        zcy = zy + zh / 2

        bed_cx = bed_x + bed_w / 2
        bed_cy = bed_y + bed_h / 2

        dx = bed_cx - zcx
        dy = bed_cy - zcy
        dist = math.sqrt(dx * dx + dy * dy)
        if dist < 0.1:
            continue

        angle_to_bed = math.atan2(dx, -dy)
        angle_to_bed_deg = math.degrees(angle_to_bed) % 360
        shadow_dir_deg = (sun_azimuth + 180) % 360

        angle_diff = abs(((angle_to_bed_deg - shadow_dir_deg + 180) % 360) - 180)
        if angle_diff < 45 and dist < shadow_len + max(zw, zh):
            shade_sources.append({"name": zone["name"], "type": zone["zone_type"]})

    # Check tree shadows
    if ground_plants_with_heights:
        for gp in ground_plants_with_heights:
            tree_h_in = gp.get("mature_height_inches")
            if not tree_h_in or tree_h_in <= 0:
                continue
            tree_h_ft = tree_h_in / 12.0
            if tree_h_ft < 3:
                continue  # too short to cast meaningful shadow
            gx, gy = gp.get("x_feet"), gp.get("y_feet")
            if gx is None or gy is None:
                continue
            shadow_len = min(estimate_shadow_length(tree_h_ft, sun_altitude), 200)
            shadow_dir = math.radians((sun_azimuth + 180) % 360)

            bed_cx = bed_x + bed_w / 2
            bed_cy = bed_y + bed_h / 2
            dx = bed_cx - gx
            dy = bed_cy - gy
            dist = math.sqrt(dx * dx + dy * dy)
            if dist < 0.1:
                continue
            angle_to_bed = math.atan2(dx, -dy)
            angle_to_bed_deg = math.degrees(angle_to_bed) % 360
            shadow_dir_deg = (sun_azimuth + 180) % 360
            angle_diff = abs(((angle_to_bed_deg - shadow_dir_deg + 180) % 360) - 180)
            canopy_radius = max(3, tree_h_ft / 6)
            if angle_diff < 30 and dist < shadow_len + canopy_radius:
                shade_sources.append({"name": gp.get("name") or gp.get("plant_name", "Tree"), "type": "tree"})

    return shade_sources


@router.get("/api/sun/exposure")
def get_bed_sun_exposure(
    bed_id: int = Query(),
    date_str: str = Query(alias="date", default=None),
):
    with get_db() as db:
        prop = db.execute("SELECT latitude, longitude FROM property WHERE id = 1").fetchone()
        if not prop:
            raise HTTPException(404, "Property not configured")
        lat, lon = prop["latitude"], prop["longitude"]

        bed_pos = db.execute("""
            SELECT bp.x_feet, bp.y_feet, gb.width_cells, gb.height_cells, gb.cell_size_inches, gb.name
            FROM bed_positions bp
            JOIN garden_beds gb ON bp.bed_id = gb.id
            WHERE bp.bed_id = ?
        """, (bed_id,)).fetchone()
        if not bed_pos:
            raise HTTPException(404, "Bed position not found. Place the bed on the property map first.")

        zones = [dict(r) for r in db.execute("SELECT * FROM zones").fetchall()]

        # Get ground plants with mature heights for tree shadow calculation
        gp_rows = db.execute("""
            SELECT gp.id, gp.name, gp.x_feet, gp.y_feet, p.name as plant_name, p.category as plant_category,
                   pd.mature_height_inches
            FROM ground_plants gp
            JOIN plants p ON gp.plant_id = p.id
            LEFT JOIN plant_details pd ON gp.plant_id = pd.plant_id
            WHERE gp.status != 'removed' AND gp.x_feet IS NOT NULL AND gp.y_feet IS NOT NULL
              AND pd.mature_height_inches IS NOT NULL AND pd.mature_height_inches > 36
        """).fetchall()
        gp_with_heights = [dict(r) for r in gp_rows]

    d = date.today() if not date_str else date.fromisoformat(date_str)
    sun_times = calc_sunrise_sunset(lat, lon, d)

    bed_x = bed_pos["x_feet"]
    bed_y = bed_pos["y_feet"]
    bed_w = bed_pos["width_cells"] * bed_pos["cell_size_inches"] / 12
    bed_h = bed_pos["height_cells"] * bed_pos["cell_size_inches"] / 12

    sunrise_parts = sun_times["sunrise"].split(":")
    sunset_parts = sun_times["sunset"].split(":")
    sunrise_h = int(sunrise_parts[0]) + int(sunrise_parts[1]) / 60
    sunset_h = int(sunset_parts[0]) + int(sunset_parts[1]) / 60

    sun_hours = 0
    morning_hours = 0
    afternoon_hours = 0
    shade_source_hours: dict[str, list[float]] = {}  # name -> list of hours shaded
    hourly = []

    h = sunrise_h
    while h <= sunset_h:
        dt_obj = datetime(d.year, d.month, d.day, int(h), int((h % 1) * 60))
        pos = solar_position(lat, lon, dt_obj)
        hour_int = int(h)
        if pos["altitude"] > 0:
            sources = check_bed_shading(bed_x, bed_y, bed_w, bed_h, zones, pos["azimuth"], pos["altitude"], gp_with_heights)
            if not sources:
                sun_hours += 0.5
                if h < 12:
                    morning_hours += 0.5
                else:
                    afternoon_hours += 0.5
                hourly.append({"hour": hour_int, "sun": True, "shading_by": None})
            else:
                primary_source = sources[0]["name"]
                hourly.append({"hour": hour_int, "sun": False, "shading_by": primary_source})
                for src in sources:
                    shade_source_hours.setdefault(src["name"] + "|" + src["type"], []).append(h)
        else:
            hourly.append({"hour": hour_int, "sun": False, "shading_by": "below horizon"})
        h += 0.5

    # Build shade_sources summary with time ranges
    shade_sources_summary = []
    for key, hours in shade_source_hours.items():
        name, stype = key.split("|", 1)
        hours_sorted = sorted(hours)
        start_h = hours_sorted[0]
        end_h = hours_sorted[-1] + 0.5
        start_str = f"{int(start_h)}{'am' if start_h < 12 else 'pm'}"
        end_str = f"{int(end_h) if end_h <= 12 else int(end_h - 12) if end_h > 12 else 12}{'am' if end_h < 12 else 'pm'}"
        shade_sources_summary.append({
            "type": stype,
            "name": name,
            "shaded_hours": round(len(hours) * 0.5, 1),
            "time_range": f"{start_str}-{end_str}",
        })

    total_daylight = sunset_h - sunrise_h
    total_shade_hours = round(total_daylight - sun_hours, 1)
    quality = sun_quality_label(sun_hours)

    return {
        "bed_id": bed_id,
        "bed_name": bed_pos["name"],
        "date": d.isoformat(),
        "total_sun_hours": round(sun_hours, 1),
        "total_shade_hours": total_shade_hours,
        "sun_hours": round(sun_hours, 1),
        "morning_sun_hours": round(morning_hours, 1),
        "afternoon_sun_hours": round(afternoon_hours, 1),
        "sun_quality": quality,
        "shade_sources": shade_sources_summary,
        "hourly": hourly,
        "sunrise": sun_times["sunrise"],
        "sunset": sun_times["sunset"],
        "daylight_hours": sun_times["daylight_hours"],
    }


def sun_quality_label(sun_hours: float) -> str:
    if sun_hours >= 6:
        return "full sun"
    elif sun_hours >= 3:
        return "partial sun"
    else:
        return "shade"


def plants_for_exposure(quality: str) -> list:
    mapping = {
        "full sun": ["Tomato", "Pepper", "Squash", "Eggplant", "Okra", "Watermelon", "Corn", "Sunflower"],
        "partial sun": ["Lettuce", "Spinach", "Kale", "Swiss Chard", "Cilantro", "Parsley", "Pea", "Bean (Bush)"],
        "shade": ["Lettuce", "Spinach", "Mint", "Cilantro", "Green Onion"],
    }
    return mapping.get(quality, [])


@router.get("/api/sun/daily")
def get_daily_sun_all_beds(
    date_str: str = Query(alias="date", default=None),
):
    with get_db() as db:
        prop = db.execute("SELECT latitude, longitude FROM property WHERE id = 1").fetchone()
        if not prop:
            raise HTTPException(404, "Property not configured")
        lat, lon = prop["latitude"], prop["longitude"]

        beds = db.execute("""
            SELECT bp.bed_id, bp.x_feet, bp.y_feet, gb.width_cells, gb.height_cells, gb.cell_size_inches, gb.name
            FROM bed_positions bp
            JOIN garden_beds gb ON bp.bed_id = gb.id
        """).fetchall()

        zones = [dict(r) for r in db.execute("SELECT * FROM zones").fetchall()]

        # Get ground plants with mature heights for tree shadow calculation
        gp_rows = db.execute("""
            SELECT gp.id, gp.name, gp.x_feet, gp.y_feet, p.name as plant_name, p.category as plant_category,
                   pd.mature_height_inches
            FROM ground_plants gp
            JOIN plants p ON gp.plant_id = p.id
            LEFT JOIN plant_details pd ON gp.plant_id = pd.plant_id
            WHERE gp.status != 'removed' AND gp.x_feet IS NOT NULL AND gp.y_feet IS NOT NULL
              AND pd.mature_height_inches IS NOT NULL AND pd.mature_height_inches > 36
        """).fetchall()
        gp_with_heights = [dict(r) for r in gp_rows]

    d = date.today() if not date_str else date.fromisoformat(date_str)
    sun_times = calc_sunrise_sunset(lat, lon, d)

    sunrise_parts = sun_times["sunrise"].split(":")
    sunset_parts = sun_times["sunset"].split(":")
    sunrise_h = int(sunrise_parts[0]) + int(sunrise_parts[1]) / 60
    sunset_h = int(sunset_parts[0]) + int(sunset_parts[1]) / 60

    # Pre-compute sun positions for the day
    sun_positions = []
    h = sunrise_h
    while h <= sunset_h:
        dt_obj = datetime(d.year, d.month, d.day, int(h), int((h % 1) * 60))
        pos = solar_position(lat, lon, dt_obj)
        sun_positions.append((h, pos))
        h += 0.5

    results = []
    for bed in beds:
        bed_x = bed["x_feet"]
        bed_y = bed["y_feet"]
        bed_w = bed["width_cells"] * bed["cell_size_inches"] / 12
        bed_h = bed["height_cells"] * bed["cell_size_inches"] / 12

        sun_hours = 0
        morning_hours = 0
        afternoon_hours = 0
        shade_source_hours: dict[str, list[float]] = {}

        for hour_val, pos in sun_positions:
            if pos["altitude"] > 0:
                sources = check_bed_shading(bed_x, bed_y, bed_w, bed_h, zones, pos["azimuth"], pos["altitude"], gp_with_heights)
                if not sources:
                    sun_hours += 0.5
                    if hour_val < 12:
                        morning_hours += 0.5
                    else:
                        afternoon_hours += 0.5
                else:
                    for src in sources:
                        shade_source_hours.setdefault(src["name"] + "|" + src["type"], []).append(hour_val)

        # Build shade sources summary
        shade_sources_summary = []
        for key, hours in shade_source_hours.items():
            name, stype = key.split("|", 1)
            hours_sorted = sorted(hours)
            start_h = hours_sorted[0]
            end_h = hours_sorted[-1] + 0.5
            start_str = f"{int(start_h)}{'am' if start_h < 12 else 'pm'}"
            end_str = f"{int(end_h) if end_h <= 12 else int(end_h - 12) if end_h > 12 else 12}{'am' if end_h < 12 else 'pm'}"
            shade_sources_summary.append({
                "type": stype,
                "name": name,
                "shaded_hours": round(len(hours) * 0.5, 1),
                "time_range": f"{start_str}-{end_str}",
            })

        quality = sun_quality_label(sun_hours)
        results.append({
            "bed_id": bed["bed_id"],
            "bed_name": bed["name"],
            "sun_hours": round(sun_hours, 1),
            "morning_sun_hours": round(morning_hours, 1),
            "afternoon_sun_hours": round(afternoon_hours, 1),
            "sun_quality": quality,
            "best_plants": plants_for_exposure(quality),
            "shade_sources": shade_sources_summary,
        })

    return {
        "date": d.isoformat(),
        "sunrise": sun_times["sunrise"],
        "sunset": sun_times["sunset"],
        "daylight_hours": sun_times["daylight_hours"],
        "beds": results,
    }


@router.get("/api/sun/shadows")
def get_sun_shadows(
    date_str: str = Query(alias="date", default=None),
    time_str: str = Query(alias="time", default=None),
):
    """Return shadow polygons for all structures and trees at a given date/time.
    Used by the frontend to render shadow overlays on the map."""
    with get_db() as db:
        prop = db.execute("SELECT latitude, longitude FROM property WHERE id = 1").fetchone()
        if not prop:
            raise HTTPException(404, "Property not configured")
        lat, lon = prop["latitude"], prop["longitude"]

        zones = [dict(r) for r in db.execute("SELECT * FROM zones").fetchall()]

        # Get trees / tall ground plants
        gp_rows = db.execute("""
            SELECT gp.id, gp.name, gp.x_feet, gp.y_feet, p.name as plant_name, p.category as plant_category,
                   pd.mature_height_inches
            FROM ground_plants gp
            JOIN plants p ON gp.plant_id = p.id
            LEFT JOIN plant_details pd ON gp.plant_id = pd.plant_id
            WHERE gp.status != 'removed' AND gp.x_feet IS NOT NULL AND gp.y_feet IS NOT NULL
              AND pd.mature_height_inches IS NOT NULL AND pd.mature_height_inches > 36
        """).fetchall()
        gp_with_heights = [dict(r) for r in gp_rows]

    d = date.today() if not date_str else date.fromisoformat(date_str)
    if time_str:
        hour, minute = map(int, time_str.split(":"))
    else:
        now = datetime.now()
        hour, minute = now.hour, now.minute

    dt_obj = datetime(d.year, d.month, d.day, hour, minute)
    pos = solar_position(lat, lon, dt_obj)

    if pos["altitude"] <= 0:
        return {"shadows": [], "sun_altitude": pos["altitude"], "sun_azimuth": pos["azimuth"]}

    shadows = []

    # Structure shadows
    for zone in zones:
        structure_h = _get_zone_height(zone)
        if structure_h <= 0:
            continue
        poly = compute_shadow_polygon(zone, pos["azimuth"], pos["altitude"])
        if poly:
            shadows.append({
                "source_type": zone["zone_type"],
                "source_name": zone["name"],
                "source_id": zone["id"],
                "height_ft": structure_h,
                "polygon": [{"x": round(p["x"], 1), "y": round(p["y"], 1)} for p in poly],
            })

    # Tree shadows
    for gp in gp_with_heights:
        poly = compute_tree_shadow(gp, gp["mature_height_inches"], pos["azimuth"], pos["altitude"])
        if poly:
            shadows.append({
                "source_type": "tree",
                "source_name": gp.get("name") or gp.get("plant_name", "Tree"),
                "source_id": gp["id"],
                "height_ft": round(gp["mature_height_inches"] / 12, 1),
                "polygon": poly,
            })

    return {
        "shadows": shadows,
        "sun_altitude": pos["altitude"],
        "sun_azimuth": pos["azimuth"],
    }


# ──────────────── GEOCODING & FROST DATES ────────────────

@router.get("/api/geocode")
async def geocode(q: str = Query(..., min_length=2)):
    """Proxy geocoding requests to Nominatim (OpenStreetMap)."""
    async with httpx.AsyncClient() as client:
        r = await client.get(
            "https://nominatim.openstreetmap.org/search",
            params={"q": q, "format": "json", "limit": 5, "addressdetails": 1},
            headers={"User-Agent": "GardenGodmother/1.0"},
            timeout=5,
        )
        return r.json()


# Frost date lookup data — historical averages for major cities
_FROST_ZONES = [
    # (lat_min, lat_max, lon_min, lon_max, city, last_frost_spring, first_frost_fall, frost_free_days, confidence)
    (33.2, 33.7, -112.5, -111.5, "Phoenix/Glendale, AZ", "01-26", "12-11", 320, "high"),
    (32.0, 32.5, -111.2, -110.7, "Tucson, AZ", "02-15", "11-29", 287, "high"),
    (34.9, 35.4, -111.9, -111.4, "Flagstaff, AZ", "06-01", "09-15", 106, "high"),
    (33.3, 33.6, -111.9, -111.6, "Tempe/Mesa, AZ", "01-31", "12-06", 310, "high"),
    (33.5, 33.8, -112.4, -112.0, "Peoria/Surprise, AZ", "02-01", "12-08", 311, "high"),
    (31.8, 32.1, -110.0, -109.5, "Sierra Vista, AZ", "03-25", "11-05", 225, "high"),
    (34.5, 34.7, -112.5, -112.3, "Prescott, AZ", "05-01", "10-15", 167, "high"),
    (32.6, 33.0, -114.8, -114.4, "Yuma, AZ", "01-15", "12-20", 340, "high"),
    # Major US cities
    (40.5, 40.9, -74.2, -73.7, "New York, NY", "04-01", "11-12", 225, "high"),
    (41.7, 42.0, -87.9, -87.5, "Chicago, IL", "04-20", "10-18", 181, "high"),
    (29.5, 30.0, -95.6, -95.1, "Houston, TX", "02-14", "12-01", 290, "high"),
    (33.6, 34.2, -118.5, -117.8, "Los Angeles, CA", "01-15", "12-31", 350, "high"),
    (25.6, 26.0, -80.4, -80.1, "Miami, FL", "01-01", "12-31", 365, "high"),
    (47.4, 47.8, -122.5, -122.1, "Seattle, WA", "03-15", "11-15", 245, "high"),
    (39.6, 40.0, -105.1, -104.7, "Denver, CO", "05-04", "10-06", 155, "high"),
    (35.0, 35.4, -106.8, -106.4, "Albuquerque, NM", "04-16", "10-22", 189, "high"),
    (36.0, 36.3, -115.4, -115.0, "Las Vegas, NV", "03-07", "11-12", 250, "high"),
    (32.6, 33.0, -97.0, -96.5, "Dallas, TX", "03-14", "11-17", 248, "high"),
    (33.6, 34.0, -84.6, -84.2, "Atlanta, GA", "03-20", "11-15", 240, "high"),
]


def _estimate_frost_from_latitude(lat: float) -> dict:
    """Rough frost date estimation based on latitude for locations not in the lookup table."""
    abs_lat = abs(lat)
    if abs_lat < 25:
        return {"last_frost_spring": "01-01", "first_frost_fall": "12-31", "frost_free_days": 365,
                "source": f"Estimated from latitude {lat:.1f}", "confidence": "low"}
    if abs_lat > 55:
        return {"last_frost_spring": "06-15", "first_frost_fall": "08-15", "frost_free_days": 61,
                "source": f"Estimated from latitude {lat:.1f}", "confidence": "low"}
    # Linear interpolation: lat 25 → day 1 (Jan 1), lat 50 → day 150 (May 30)
    last_frost_day = max(1, int((abs_lat - 25) * 5.96))  # ~6 days per degree
    first_frost_day = min(365, 365 - last_frost_day)
    frost_free = first_frost_day - last_frost_day
    # Convert day-of-year to MM-DD
    from datetime import date as _date
    base_year = 2024  # leap year for safety
    try:
        spring = _date(base_year, 1, 1) + timedelta(days=last_frost_day - 1)
        fall = _date(base_year, 1, 1) + timedelta(days=first_frost_day - 1)
    except (ValueError, OverflowError):
        spring = _date(base_year, 4, 15)
        fall = _date(base_year, 10, 15)
        frost_free = 183
    return {
        "last_frost_spring": spring.strftime("%m-%d"),
        "first_frost_fall": fall.strftime("%m-%d"),
        "frost_free_days": max(0, frost_free),
        "source": f"Estimated from latitude {lat:.1f}",
        "confidence": "low",
    }


@router.get("/api/frost-dates")
def get_frost_dates(lat: float = Query(...), lon: float = Query(...)):
    """Return estimated frost dates for the given lat/lon."""
    # Check known zones first
    for lat_min, lat_max, lon_min, lon_max, city, lf_spring, ff_fall, ff_days, conf in _FROST_ZONES:
        if lat_min <= lat <= lat_max and lon_min <= lon <= lon_max:
            return {
                "last_frost_spring": lf_spring,
                "first_frost_fall": ff_fall,
                "frost_free_days": ff_days,
                "source": f"{city} historical data",
                "confidence": conf,
            }
    # Fallback to latitude estimation
    return _estimate_frost_from_latitude(lat)


