#!/usr/bin/env python3
"""Garden God Mother API — Plant database, companion planting, calendar engine, bed management, seed tray tracking."""
from __future__ import annotations

import asyncio
import logging
import os
from datetime import datetime
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from db import get_db
from auth import AuthMiddleware, router as auth_router
from migrations import startup_run_migrations
from constants import PHOTOS_DIR

from routes import (
    plants, beds, plantings, trays, seeds, tasks,
    calendar, sensors, journal, harvest, expenses, photos,
    map as map_routes, admin, notifications, settings,
    ground_plants, misc, my_plantings, patterns, pests, instances,
    dashboard,
)

logger = logging.getLogger(__name__)

app = FastAPI(title="Garden God Mother API", version="1.3.0")


# ──── Startup events ────

@app.on_event("startup")
def startup_create_photos_dir():
    PHOTOS_DIR.mkdir(parents=True, exist_ok=True)


@app.on_event("startup")
def startup_migrations():
    startup_run_migrations()


@app.on_event("startup")
def startup_weather_entities():
    """Load weather entity IDs from HA entity mappings."""
    from routes.sensors import init_weather_entities
    init_weather_entities()


@app.on_event("startup")
async def startup_session_cleanup():
    """Background task to clean up expired sessions hourly."""
    async def cleanup_loop():
        while True:
            await asyncio.sleep(3600)
            try:
                with get_db() as db:
                    db.execute("DELETE FROM sessions WHERE expires_at < ?", (datetime.utcnow().isoformat(),))
                    db.commit()
            except Exception:
                pass
    asyncio.create_task(cleanup_loop())


@app.on_event("startup")
def startup_audit_cleanup():
    """Clean up audit log entries older than 90 days."""
    with get_db() as db:
        try:
            db.execute("DELETE FROM audit_log WHERE created_at < datetime('now', '-90 days')")
            db.commit()
        except Exception:
            pass


# ──── Middleware ────

app.add_middleware(AuthMiddleware)

app.add_middleware(
    CORSMiddleware,
    # Configure for your domain — set CORS_ORIGINS env var (comma-separated) for production
    allow_origins=os.environ.get("CORS_ORIGINS", "http://localhost:3000,http://localhost:3400").split(","),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
async def startup_backup_loop():
    await admin.startup_backup_loop()


@app.on_event("startup")
async def startup_sensor_recording():
    await sensors.startup_sensor_recording()


@app.on_event("startup")
async def startup_tempest_udp():
    """Start Tempest UDP listener if local_udp is enabled."""
    from services.integrations import get_integration_config
    from services.tempest_udp import start_udp_listener
    config = get_integration_config("weather_tempest")
    if config and config.get("local_udp"):
        await start_udp_listener()


# ──── Register routers ────

app.include_router(auth_router)
app.include_router(plants.router)
app.include_router(beds.router)
app.include_router(plantings.router)
app.include_router(ground_plants.router)
app.include_router(trays.router)
app.include_router(seeds.router)
app.include_router(tasks.router)
app.include_router(calendar.router)
app.include_router(sensors.router)
app.include_router(journal.router)
app.include_router(harvest.router)
app.include_router(expenses.router)
app.include_router(photos.router)
app.include_router(map_routes.router)
app.include_router(admin.router)
app.include_router(notifications.router)
app.include_router(settings.router)
app.include_router(misc.router)
app.include_router(my_plantings.router)
app.include_router(patterns.router)
app.include_router(pests.router)
app.include_router(instances.router)
app.include_router(dashboard.router)


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=3402)
