"""Shared fixtures for Garden God Mother API tests."""
from __future__ import annotations

import os
import sys
import sqlite3
import tempfile
import shutil
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

# Add the garden-api directory to the Python path so we can import modules
API_DIR = Path(__file__).parent.parent
sys.path.insert(0, str(API_DIR))


def _create_reference_table_stubs(db_path: Path, ref_path: Path):
    """Create empty copies of reference tables in the main DB.

    Migrations expect certain tables (plants, soil_products, planter_types, etc.)
    to exist in the main DB because they were written for the old single-DB
    architecture. We create stub tables with the same schema so migrations
    can ALTER them without error. At runtime the temp views from the attached
    reference DB shadow these stubs.
    """
    if not ref_path.exists():
        return
    ref_conn = sqlite3.connect(str(ref_path))
    main_conn = sqlite3.connect(str(db_path))
    try:
        # Get CREATE TABLE statements from the reference DB
        tables = ref_conn.execute(
            "SELECT name, sql FROM sqlite_master WHERE type='table' AND sql IS NOT NULL"
        ).fetchall()
        for name, sql in tables:
            try:
                main_conn.execute(sql)
            except sqlite3.OperationalError:
                pass  # Table already exists
        main_conn.commit()
    finally:
        ref_conn.close()
        main_conn.close()


@pytest.fixture(autouse=True)
def _isolate_database(tmp_path, monkeypatch):
    """Point the app at fresh temporary databases for every test.

    We monkey-patch ``db.DB_PATH`` (user data) and ``db.PLANTS_DB_PATH``
    (reference data), build a reference DB, create table stubs in the main
    DB for migration compatibility, then run migrations.
    """
    db_file = tmp_path / "test_garden.db"
    ref_file = tmp_path / "test_plants_reference.db"
    monkeypatch.setattr("db.DB_PATH", db_file)
    monkeypatch.setattr("db.PLANTS_DB_PATH", ref_file)
    # Also ensure the photos directory exists inside tmp_path
    photos_dir = tmp_path / "photos"
    photos_dir.mkdir()
    monkeypatch.setattr("constants.PHOTOS_DIR", photos_dir)

    # Build a reference database for the test (same data as production)
    import create_reference_db
    original_output = create_reference_db.OUTPUT_PATH
    create_reference_db.OUTPUT_PATH = ref_file
    try:
        create_reference_db.create_reference_db()
    finally:
        create_reference_db.OUTPUT_PATH = original_output

    # Run init_db to create ALL tables (reference + user) in the main DB.
    # This mirrors what happens on a fresh deployment: init_db populates user
    # tables (garden_beds, plantings, etc.) that migrations later alter.
    # The temp views from the attached reference DB will shadow the reference
    # tables in the main DB at query time.
    import init_db as init_db_mod
    monkeypatch.setattr(init_db_mod, "DB_PATH", db_file)
    init_db_mod.init_db()

    # Now run migrations (these add auth tables, undo actions, etc.)
    from migrations import startup_run_migrations
    startup_run_migrations()

    yield db_file


@pytest.fixture()
def client(monkeypatch):
    """Return a ``TestClient`` wrapping the FastAPI app.

    The database has already been set up by ``_isolate_database``.
    We disable secure-cookie so the TestClient (which uses http://) keeps
    the session cookie across requests.
    """
    import auth as auth_mod
    monkeypatch.setattr(auth_mod, "COOKIE_DOMAIN", None)
    monkeypatch.setattr(auth_mod, "COOKIE_SECURE", False)

    from main import app

    return TestClient(app, raise_server_exceptions=False)


@pytest.fixture()
def _seed_admin(client):
    """Create a known admin user with predictable credentials.

    The default migration seeds random passwords, so we insert our own
    admin user for test login.
    """
    from db import get_db
    from argon2 import PasswordHasher

    ph = PasswordHasher()
    with get_db() as db:
        # Check if our test admin already exists
        existing = db.execute("SELECT id FROM users WHERE username = 'testadmin'").fetchone()
        if not existing:
            db.execute(
                "INSERT INTO users (username, display_name, email, password_hash, role) "
                "VALUES (?, ?, ?, ?, ?)",
                ("testadmin", "Test Admin", "testadmin@example.com",
                 ph.hash("testpassword123"), "admin"),
            )
            db.commit()


@pytest.fixture()
def auth_client(client, _seed_admin):
    """Return a ``TestClient`` that is already authenticated as an admin user."""
    resp = client.post("/api/auth/login", json={
        "username": "testadmin",
        "password": "testpassword123",
    })
    assert resp.status_code == 200, f"Login failed: {resp.text}"
    # The session cookie is now stored in the client's cookie jar
    return client


@pytest.fixture()
def _seed_viewer(client):
    """Create a viewer-role user for permission tests."""
    from db import get_db
    from argon2 import PasswordHasher

    ph = PasswordHasher()
    with get_db() as db:
        existing = db.execute("SELECT id FROM users WHERE username = 'testviewer'").fetchone()
        if not existing:
            db.execute(
                "INSERT INTO users (username, display_name, email, password_hash, role) "
                "VALUES (?, ?, ?, ?, ?)",
                ("testviewer", "Test Viewer", "viewer@example.com",
                 ph.hash("viewerpass123"), "viewer"),
            )
            db.commit()


@pytest.fixture()
def viewer_client(client, _seed_viewer):
    """Return a ``TestClient`` authenticated as a viewer (non-admin)."""
    resp = client.post("/api/auth/login", json={
        "username": "testviewer",
        "password": "viewerpass123",
    })
    assert resp.status_code == 200
    return client


@pytest.fixture()
def sample_plant_id(auth_client):
    """Return the ID of a plant from the reference database."""
    from db import get_db
    with get_db() as db:
        row = db.execute("SELECT id FROM plants LIMIT 1").fetchone()
        if row:
            return row["id"]
        # Should not happen — reference DB has 124 plants
        raise RuntimeError("No plants in reference database")


@pytest.fixture()
def sample_bed_id(auth_client):
    """Create a test garden bed and return its ID."""
    resp = auth_client.post("/api/beds", json={
        "name": "Test Bed",
        "width_cells": 4,
        "height_cells": 4,
        "cell_size_inches": 12,
        "bed_type": "grid",
    })
    assert resp.status_code == 200, f"Failed to create bed: {resp.text}"
    return resp.json()["id"]


@pytest.fixture()
def sample_planting_id(auth_client, sample_bed_id, sample_plant_id):
    """Create a test planting and return its ID."""
    resp = auth_client.post("/api/plantings", json={
        "plant_id": sample_plant_id,
        "bed_id": sample_bed_id,
        "cell_x": 0,
        "cell_y": 0,
        "planted_date": "2026-03-01",
    })
    assert resp.status_code == 200, f"Failed to create planting: {resp.text}"
    return resp.json()["id"]
