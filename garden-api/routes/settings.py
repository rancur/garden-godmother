"""Settings + integrations endpoints."""
from __future__ import annotations

import json
from datetime import date, datetime, timedelta
from typing import Optional

import httpx
from fastapi import APIRouter, HTTPException, Query, Request
from fastapi.responses import Response

from db import get_db
from auth import require_user, require_admin, audit_log, get_current_user
from models import IntegrationUpdate, FrostDateUpdate, UsdaZoneUpdate
from constants import get_frost_dates_from_property, DEFAULT_SOIL_PROFILE
from services.integrations import INTEGRATION_TYPES, get_integration_config, get_ha_config

def _ha_is_configured() -> bool:
    config = get_ha_config()
    return bool(config.get("token"))

router = APIRouter()

# ──────────────── INTEGRATION SETTINGS ENDPOINTS ────────────────



@router.get("/api/integrations")
def list_integrations(request: Request):
    require_admin(request)
    with get_db() as db:
        rows = db.execute("SELECT * FROM integration_settings").fetchall()
        saved = {r["integration"]: dict(r) for r in rows}
    result = []
    for key, info in INTEGRATION_TYPES.items():
        entry = {"integration": key, **info, "enabled": False, "configured": False}
        if key in saved:
            entry["enabled"] = bool(saved[key]["enabled"])
            entry["configured"] = True
            try:
                config = json.loads(saved[key]["config"])
                masked = {}
                for field in info["fields"]:
                    val = config.get(field, "")
                    if val and field in ('api_key', 'token', 'client_secret', 'password'):
                        masked[field] = val[:4] + "..." + val[-4:] if len(val) > 8 else "***"
                    else:
                        masked[field] = val
                entry["config"] = masked
            except Exception:
                entry["config"] = {}
        else:
            entry["config"] = {}
        result.append(entry)
    return result


@router.put("/api/integrations/{integration}")
def update_integration(integration: str, body: IntegrationUpdate, request: Request):
    require_admin(request)
    if integration not in INTEGRATION_TYPES:
        raise HTTPException(400, f"Unknown integration: {integration}")
    with get_db() as db:
        db.execute("""
            INSERT INTO integration_settings (integration, config, enabled, updated_at)
            VALUES (?, ?, ?, datetime('now'))
            ON CONFLICT(integration) DO UPDATE SET config = ?, enabled = ?, updated_at = datetime('now')
        """, (integration, json.dumps(body.config), 1 if body.enabled else 0,
              json.dumps(body.config), 1 if body.enabled else 0))
        db.commit()
    return {"ok": True}


@router.delete("/api/integrations/{integration}")
def delete_integration(integration: str, request: Request):
    require_admin(request)
    with get_db() as db:
        db.execute("DELETE FROM integration_settings WHERE integration = ?", (integration,))
        db.commit()
    return {"ok": True}


@router.post("/api/integrations/{integration}/test")
async def test_integration(integration: str, request: Request):
    require_admin(request)
    with get_db() as db:
        row = db.execute("SELECT config FROM integration_settings WHERE integration = ?", (integration,)).fetchone()
        if not row:
            raise HTTPException(404, "Integration not configured")
        config = json.loads(row["config"])

    try:
        if integration == "openai":
            async with httpx.AsyncClient() as client:
                r = await client.get("https://api.openai.com/v1/models",
                                     headers={"Authorization": f"Bearer {config.get('api_key', '')}"},
                                     timeout=10)
                if r.status_code != 200:
                    raise Exception(f"OpenAI API returned {r.status_code}")
        elif integration == "home_assistant":
            async with httpx.AsyncClient() as client:
                r = await client.get(f"{config.get('url', '')}/api/",
                                     headers={"Authorization": f"Bearer {config.get('token', '')}"},
                                     timeout=10)
                if r.status_code != 200:
                    raise Exception(f"HA API returned {r.status_code}")
        elif integration == "rachio":
            async with httpx.AsyncClient() as client:
                r = await client.get("https://api.rach.io/1/public/person/info",
                                     headers={"Authorization": f"Bearer {config.get('api_key', '')}"},
                                     timeout=10)
                if r.status_code != 200:
                    raise Exception(f"Rachio API returned {r.status_code}")
        elif integration == "rachio_hose_timer":
            return {"ok": True, "message": "Hose timer config saved (no test endpoint available)"}
        elif integration == "openplantbook":
            async with httpx.AsyncClient() as client:
                token = config.get("token", "")
                if token:
                    # Test with existing API token
                    r = await client.get("https://open.plantbook.io/api/v1/plant/search",
                                         params={"alias": "tomato"},
                                         headers={"Authorization": f"Token {token}"},
                                         timeout=10)
                    if r.status_code != 200:
                        raise Exception(f"PlantBook API returned {r.status_code}")
                elif config.get("client_id") and config.get("client_secret"):
                    # Test with OAuth credentials
                    r = await client.post("https://open.plantbook.io/api/v1/token/",
                                          data={"grant_type": "client_credentials",
                                                "client_id": config.get("client_id", ""),
                                                "client_secret": config.get("client_secret", "")},
                                          timeout=10)
                    if r.status_code != 200:
                        raise Exception(f"PlantBook API returned {r.status_code}")
                else:
                    raise Exception("No token or client credentials configured")
        elif integration == "weather_tempest":
            async with httpx.AsyncClient() as client:
                r = await client.get(
                    f"https://swd.weatherflow.com/swd/rest/better_forecast?station_id={config.get('station_id', '')}&token={config.get('api_token', '')}&units_temp=f",
                    timeout=10)
                if r.status_code != 200:
                    raise Exception(f"Tempest API returned {r.status_code}")
        elif integration == "weather_openmeteo":
            return {"ok": True, "message": "Open-Meteo requires no API key — will use property coordinates"}
        elif integration == "weather_openweathermap":
            async with httpx.AsyncClient() as client:
                r = await client.get(
                    f"https://api.openweathermap.org/data/2.5/weather?q=Phoenix&appid={config.get('api_key', '')}",
                    timeout=10)
                if r.status_code != 200:
                    raise Exception(f"OpenWeatherMap API returned {r.status_code}")
        elif integration == "weather_nws":
            return {"ok": True, "message": "NWS requires no API key — will use property coordinates"}
        return {"ok": True, "message": "Connection successful"}
    except Exception as e:
        raise HTTPException(500, f"Test failed: {str(e)[:200]}")


# ──────────────── SETUP / ONBOARDING ────────────────


@router.get("/api/settings/setup-status")
def get_setup_status(request: Request):
    """Check if initial setup has been completed. Works for both authenticated and unauthenticated users."""
    user = get_current_user(request)
    if not user:
        return {"setup_complete": False, "step": "login"}
    with get_db() as db:
        row = db.execute("SELECT value FROM app_config WHERE key = 'setup_complete'").fetchone()
        if row and row["value"] == "1":
            return {"setup_complete": True}
        # Check what's been configured
        property_row = db.execute("SELECT * FROM property WHERE id = 1").fetchone()
        has_address = property_row and property_row["address"] and len(property_row["address"]) > 3
        has_integrations = db.execute("SELECT COUNT(*) FROM integration_settings WHERE enabled = 1").fetchone()[0] > 0
        return {
            "setup_complete": False,
            "step": "property" if not has_address else "integrations" if not has_integrations else "done",
        }


@router.post("/api/settings/setup-complete")
def mark_setup_complete(request: Request):
    """Mark initial setup as complete."""
    require_admin(request)
    with get_db() as db:
        db.execute("INSERT OR REPLACE INTO app_config (key, value) VALUES ('setup_complete', '1')")
        db.commit()
    return {"ok": True}




@router.get("/api/settings/frost-dates")
def get_frost_date_settings(request: Request):
    """Get the configured frost dates."""
    require_user(request)
    last_frost, first_frost = get_frost_dates_from_property()
    return {
        "last_frost": f"{last_frost[0]:02d}-{last_frost[1]:02d}",
        "first_frost": f"{first_frost[0]:02d}-{first_frost[1]:02d}",
    }


@router.put("/api/settings/frost-dates")
def update_frost_date_settings(request: Request, data: FrostDateUpdate):
    """Update frost dates (stored on property record)."""
    require_admin(request)
    # Validate format
    try:
        lm, ld = map(int, data.last_frost.split("-"))
        fm, fd = map(int, data.first_frost.split("-"))
        date(2024, lm, ld)  # validate
        date(2024, fm, fd)
    except (ValueError, TypeError):
        raise HTTPException(400, "Invalid date format. Use MM-DD.")
    with get_db() as db:
        db.execute("UPDATE property SET last_frost_spring = ?, first_frost_fall = ? WHERE id = 1",
                   (data.last_frost, data.first_frost))
        db.commit()
    return {"last_frost": data.last_frost, "first_frost": data.first_frost}




@router.put("/api/settings/usda-zone")
def update_usda_zone(request: Request, data: UsdaZoneUpdate):
    """Save USDA zone to app_config."""
    require_admin(request)
    with get_db() as db:
        db.execute("INSERT OR REPLACE INTO app_config (key, value) VALUES ('usda_zone', ?)", (data.zone,))
        db.commit()
    return {"zone": data.zone}


# ──────────────── SETTINGS (aggregated) ────────────────

@router.get("/api/settings")
async def get_settings():
    """Aggregate all settings-relevant data into a single response."""
    with get_db() as db:
        # Property
        prop_row = db.execute("SELECT * FROM property WHERE id = 1").fetchone()
        if not prop_row:
            db.execute("INSERT INTO property (id, name, latitude, longitude, address) VALUES (1, 'My Property', 0.0, 0.0, '')")
            db.commit()
            prop_row = db.execute("SELECT * FROM property WHERE id = 1").fetchone()
        property_data = dict(prop_row)

        # Soil profile
        soil_profile = dict(DEFAULT_SOIL_PROFILE)
        if property_data.get("default_soil_type"):
            soil_profile["default_soil"] = property_data["default_soil_type"]
        if property_data.get("default_soil_ph"):
            soil_profile["default_ph"] = property_data["default_soil_ph"]
        if property_data.get("default_soil_notes"):
            soil_profile["notes"] = property_data["default_soil_notes"]

        # Database stats
        plants_count = db.execute("SELECT COUNT(*) as c FROM plants").fetchone()["c"]
        varieties_count = db.execute("SELECT COUNT(*) as c FROM varieties").fetchone()["c"]
        try:
            enriched_count = db.execute("SELECT COUNT(*) as c FROM plant_details").fetchone()["c"]
        except Exception:
            enriched_count = 0
        planters_count = db.execute("SELECT COUNT(*) as c FROM garden_beds").fetchone()["c"]
        ground_plants_count = db.execute("SELECT COUNT(*) as c FROM ground_plants").fetchone()["c"]
        try:
            journal_entries_count = db.execute("SELECT COUNT(*) as c FROM journal_entries").fetchone()["c"]
        except Exception:
            journal_entries_count = 0
        try:
            trays_count = db.execute("SELECT COUNT(*) as c FROM seed_trays").fetchone()["c"]
        except Exception:
            trays_count = 0
        try:
            harvests_count = db.execute("SELECT COUNT(*) as c FROM harvests").fetchone()["c"]
        except Exception:
            harvests_count = 0
        try:
            tasks_count = db.execute("SELECT COUNT(*) as c FROM garden_tasks").fetchone()["c"]
        except Exception:
            tasks_count = 0
        try:
            expenses_count = db.execute("SELECT COUNT(*) as c FROM expenses").fetchone()["c"]
        except Exception:
            expenses_count = 0
        try:
            photos_count = db.execute("SELECT COUNT(*) as c FROM planting_photos").fetchone()["c"]
        except Exception:
            photos_count = 0

    # Rachio status (from integration settings + API)
    rachio_status = {"connected": False, "controller": None, "zones": 0, "valves": 0}
    rachio_config = get_integration_config("rachio")
    if rachio_config.get("api_key"):
        try:
            rachio_key = rachio_config["api_key"]
            person_id = rachio_config.get("person_id", "")
            async with httpx.AsyncClient() as client:
                resp = await client.get(
                    f"https://api.rach.io/1/public/person/{person_id}",
                    headers={"Authorization": f"Bearer {rachio_key}"},
                    timeout=5,
                )
                if resp.status_code == 200:
                    data = resp.json()
                    rachio_status["connected"] = True
                    zone_count = 0
                    valve_count = 0
                    for device in data.get("devices", []):
                        zone_count += sum(1 for z in device.get("zones", []) if z.get("enabled"))
                        if not rachio_status["controller"]:
                            rachio_status["controller"] = device.get("name", "Rachio")
                    rachio_status["zones"] = zone_count
                    # Count hose timer valves
                    try:
                        bs_resp = await client.get(
                            f"https://cloud-rest.rach.io/valve/listBaseStations/{person_id}",
                            headers={"Authorization": f"Bearer {rachio_key}"},
                            timeout=5,
                        )
                        if bs_resp.status_code == 200:
                            for bs in bs_resp.json().get("baseStations", []):
                                v_resp = await client.get(
                                    f"https://cloud-rest.rach.io/valve/listValves/{bs['id']}",
                                    headers={"Authorization": f"Bearer {rachio_key}"},
                                    timeout=5,
                                )
                                if v_resp.status_code == 200:
                                    valve_count += len(v_resp.json().get("valves", []))
                    except Exception:
                        pass
                    rachio_status["valves"] = valve_count
        except Exception:
            pass

    # Weather status (from integration settings or HA entity mappings)
    weather_status = {"connected": False, "station": None, "condition": None, "temperature": None, "humidity": None}
    # Check configured weather providers
    for provider in ["weather_tempest", "weather_openmeteo", "weather_openweathermap", "weather_nws"]:
        config = get_integration_config(provider)
        if config is not None:
            with get_db() as wdb:
                enabled = wdb.execute("SELECT enabled FROM integration_settings WHERE integration = ?", (provider,)).fetchone()
                if enabled and enabled["enabled"]:
                    weather_status["connected"] = True
                    weather_status["station"] = provider.replace("weather_", "").replace("_", " ").title()
                    break
    # Also check HA entity mappings for temperature/humidity
    if not weather_status["connected"] and _ha_is_configured():
        weather_status["connected"] = True
        weather_status["station"] = "Home Assistant"
    # Try to get current conditions from HA entity mappings
    if _ha_is_configured():
        try:
            with get_db() as wdb:
                mappings_row = wdb.execute("SELECT value FROM app_config WHERE key = 'ha_entity_mappings'").fetchone()
                if mappings_row:
                    mappings = json.loads(mappings_row["value"])
                    temp_entity = mappings.get("outdoor_temperature")
                    humid_entity = mappings.get("outdoor_humidity")
                    ha_config = get_ha_config()
                    async with httpx.AsyncClient(timeout=5) as client:
                        if temp_entity:
                            r = await client.get(f"{ha_config['url']}/api/states/{temp_entity}", headers={"Authorization": f"Bearer {ha_config['token']}"})
                            if r.status_code == 200:
                                weather_status["temperature"] = _safe_float(r.json().get("state"))
                        if humid_entity:
                            r = await client.get(f"{ha_config['url']}/api/states/{humid_entity}", headers={"Authorization": f"Bearer {ha_config['token']}"})
                            if r.status_code == 200:
                                weather_status["humidity"] = _safe_float(r.json().get("state"))
        except Exception:
            pass

    return {
        "property": property_data,
        "soil_profile": soil_profile,
        "rachio_status": rachio_status,
        "weather_status": weather_status,
        "database_stats": {
            "plants": plants_count,
            "varieties": varieties_count,
            "enriched": enriched_count,
            "planters": planters_count,
            "ground_plants": ground_plants_count,
            "trays": trays_count,
            "journal_entries": journal_entries_count,
            "harvests": harvests_count,
            "tasks": tasks_count,
            "expenses": expenses_count,
            "photos": photos_count,
        },
        "version": "1.0.0",
    }


