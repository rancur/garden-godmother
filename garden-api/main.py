#!/usr/bin/env python3
"""Garden God Mother API — Plant database, companion planting, calendar engine, bed management, seed tray tracking."""
from __future__ import annotations

import asyncio
import logging
import os
from contextlib import asynccontextmanager
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
    dashboard, suggestions,
)
from routes.federation import router as federation_router
from routes.federation_data import router as federation_data_router
from routes.meshtastic import router as meshtastic_router
from routes.seeds_coop import router as seeds_coop_router

from apscheduler.schedulers.background import BackgroundScheduler
from federation_sync import run_sync_cycle

logger = logging.getLogger(__name__)

@asynccontextmanager
async def lifespan(app: FastAPI):
    # ── startup ──
    PHOTOS_DIR.mkdir(parents=True, exist_ok=True)
    startup_run_migrations()

    from routes.sensors import init_weather_entities
    init_weather_entities()

    with get_db() as db:
        try:
            db.execute("DELETE FROM audit_log WHERE created_at < datetime('now', '-90 days')")
            db.commit()
        except Exception:
            pass

    scheduler = BackgroundScheduler()
    scheduler.add_job(run_sync_cycle, trigger='interval', minutes=30, id='federation_sync', replace_existing=True)
    scheduler.start()
    app.state.scheduler = scheduler

    try:
        from meshtastic_transport import init_transport
        with get_db() as _db:
            _cfg = _db.execute("SELECT * FROM meshtastic_config WHERE id=1").fetchone()
        if _cfg and _cfg["enabled"] and (_cfg["hostname"] or _cfg["serial_port"]):
            init_transport(
                hostname=_cfg["hostname"] if _cfg["connection_type"] == "tcp" else None,
                dev_path=_cfg["serial_port"] if _cfg["connection_type"] == "serial" else None,
                channel_index=_cfg["channel_index"] or 0,
            )
    except Exception as e:
        logger.warning(f"Failed to auto-init Meshtastic: {e}")

    asyncio.create_task(_session_cleanup_loop())
    await admin.startup_backup_loop()
    await sensors.startup_sensor_recording()

    from services.integrations import get_integration_config
    from services.tempest_udp import start_udp_listener
    config = get_integration_config("weather_tempest")
    if config and config.get("local_udp"):
        await start_udp_listener()

    yield

    # ── shutdown ──
    try:
        app.state.scheduler.shutdown()
    except Exception:
        pass
    try:
        from meshtastic_transport import get_transport
        transport = get_transport()
        if transport:
            transport.stop()
    except Exception:
        pass


async def _session_cleanup_loop():
    """Background task to clean up expired sessions hourly."""
    while True:
        await asyncio.sleep(3600)
        try:
            with get_db() as db:
                db.execute("DELETE FROM sessions WHERE expires_at < ?", (datetime.utcnow().isoformat(),))
                db.commit()
        except Exception:
            pass


app = FastAPI(title="Garden God Mother API", version="1.3.0", lifespan=lifespan)


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
app.include_router(suggestions.router)
app.include_router(federation_router)
app.include_router(federation_data_router)
app.include_router(meshtastic_router)
app.include_router(seeds_coop_router)


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=3402)
