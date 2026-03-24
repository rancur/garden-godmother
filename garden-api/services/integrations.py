"""Integration configuration helpers."""
from __future__ import annotations

import json
import os

from db import get_db


INTEGRATION_TYPES = {
    'openai': {'name': 'OpenAI', 'description': 'AI photo analysis', 'fields': ['api_key']},
    'home_assistant': {'name': 'Home Assistant', 'description': 'Sensor data & weather', 'fields': ['url', 'token']},
    'rachio': {'name': 'Rachio Controller', 'description': 'Smart irrigation controller', 'fields': ['api_key', 'person_id']},
    'rachio_hose_timer': {'name': 'Rachio Hose Timer', 'description': 'Smart hose timer', 'fields': ['base_station_id', 'valve_id']},
    'openplantbook': {'name': 'OpenPlantBook', 'description': 'Plant species data', 'fields': ['token', 'client_id', 'client_secret']},
    'weather_tempest': {'name': 'Tempest WeatherFlow', 'description': 'Personal weather station data', 'fields': ['api_token', 'station_id']},
    'weather_openmeteo': {'name': 'Open-Meteo', 'description': 'Free weather data (no API key needed)', 'fields': []},
    'weather_openweathermap': {'name': 'OpenWeatherMap', 'description': 'Weather data with API key', 'fields': ['api_key']},
    'weather_nws': {'name': 'National Weather Service', 'description': 'Free US weather data', 'fields': []},
}


def get_integration_config(integration: str) -> dict:
    """Get config for an integration, falling back to env vars."""
    with get_db() as db:
        row = db.execute("SELECT config, enabled FROM integration_settings WHERE integration = ?", (integration,)).fetchone()
        if row and row["enabled"]:
            try:
                return json.loads(row["config"])
            except Exception:
                pass
    return {}


def get_openai_key() -> str | None:
    """Get OpenAI API key from integration settings or env var."""
    config = get_integration_config("openai")
    return config.get("api_key") or os.environ.get("OPENAI_API_KEY")


def get_ha_config() -> dict:
    """Get Home Assistant config."""
    config = get_integration_config("home_assistant")
    return {
        "url": config.get("url") or os.environ.get("HA_URL", "http://homeassistant.local:8123"),
        "token": config.get("token") or os.environ.get("HA_TOKEN", ""),
    }


def get_rachio_config() -> dict:
    """Get Rachio config."""
    config = get_integration_config("rachio")
    return {
        "api_key": config.get("api_key", ""),
        "person_id": config.get("person_id", ""),
    }


def get_hose_timer_config() -> dict:
    """Get Rachio Hose Timer config."""
    config = get_integration_config("rachio_hose_timer")
    return {
        "base_station_id": config.get("base_station_id", ""),
        "valve_id": config.get("valve_id", ""),
    }


def get_plantbook_config() -> dict:
    """Get OpenPlantBook config."""
    config = get_integration_config("openplantbook")
    return {
        "token": config.get("token") or os.environ.get("OPENPLANTBOOK_API_KEY", ""),
        "client_id": config.get("client_id", ""),
        "client_secret": config.get("client_secret", ""),
    }


def _plantbook_token() -> str:
    """Get the OpenPlantBook API token."""
    return get_plantbook_config()["token"]

