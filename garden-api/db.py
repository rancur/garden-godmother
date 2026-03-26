"""Database connection, helpers, and migration utilities.

Two-database architecture:
- garden.db (DB_PATH)           — User/instance data (beds, plantings, journal, etc.)
- plants_reference.db (PLANTS_DB_PATH) — Read-only reference data (plants, varieties, companions, etc.)

The reference DB is ATTACHed as 'ref' and temp VIEWs are created so that existing
queries (SELECT * FROM plants, JOIN varieties, etc.) work unchanged — they
transparently read from the reference DB.
"""
from __future__ import annotations

import json
import os
import sqlite3
import logging
from pathlib import Path
from contextlib import contextmanager

logger = logging.getLogger(__name__)

# User / garden data — persisted on a Docker volume, backed up
DB_PATH = Path(os.environ.get("GG_DB_PATH", str(Path(__file__).parent / "garden.db")))

# Plant reference data — ships with the Docker image, read-only at runtime
PLANTS_DB_PATH = Path(os.environ.get(
    "GG_PLANTS_DB_PATH",
    str(Path(__file__).parent / "plants_reference.db"),
))

# Tables that live in the reference database
REFERENCE_TABLES = [
    "plants",
    "varieties",
    "companions",
    "plant_families",
    "soil_products",
    "planter_types",
    "plant_planter_compatibility",
    "zone_info",
]


def _attach_reference_db(db: sqlite3.Connection) -> None:
    """Attach the plants reference DB and create temp views for transparent access."""
    if not PLANTS_DB_PATH.exists():
        logger.debug("Reference DB not found at %s — skipping ATTACH", PLANTS_DB_PATH)
        return

    db.execute(f"ATTACH DATABASE '{PLANTS_DB_PATH}' AS ref")

    for table in REFERENCE_TABLES:
        try:
            # Check if the table exists in the reference DB
            exists = db.execute(
                "SELECT COUNT(*) FROM ref.sqlite_master WHERE type='table' AND name=?",
                (table,),
            ).fetchone()[0]
            if exists:
                # Temp views take priority over permanent tables in SQLite, so
                # even if the main DB has a legacy copy of this table (from
                # before the split), the view transparently redirects reads to
                # the reference DB.
                db.execute(f"CREATE TEMP VIEW IF NOT EXISTS {table} AS SELECT * FROM ref.{table}")
        except Exception as exc:
            logger.debug("Could not create view for %s: %s", table, exc)


@contextmanager
def get_db(*, attach_ref: bool = True):
    """Get a database connection, optionally with the reference DB attached.

    Args:
        attach_ref: When True (default), attaches the reference DB and creates
            temp views so that unqualified queries against reference tables
            (plants, varieties, etc.) transparently read from the reference DB.
            Set to False for migrations that need to ALTER reference-table schemas
            in the main DB.

    Yields a sqlite3.Connection.
    """
    db = sqlite3.connect(str(DB_PATH))
    db.row_factory = sqlite3.Row
    if attach_ref:
        _attach_reference_db(db)
    try:
        yield db
    finally:
        db.close()


def row_to_dict(row):
    d = dict(row)
    for key in ("desert_seasons", "desert_sow_outdoor", "desert_transplant", "desert_harvest"):
        if key in d and d[key]:
            d[key] = json.loads(d[key])
    return d


def _table_exists(db, table_name: str) -> bool:
    """Check if a table exists in the database."""
    return db.execute(
        "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name=?", (table_name,)
    ).fetchone()[0] > 0


def run_migration(db, migration_id: int, name: str, sql_statements: list, callback=None):
    """Run a migration if it hasn't been applied yet.

    sql_statements: list of SQL strings to execute.
    callback: optional callable(db) for migrations that need Python logic beyond raw SQL.
    Returns True if migration was applied, False if already applied.
    """
    existing = db.execute("SELECT id FROM schema_migrations WHERE id = ?", (migration_id,)).fetchone()
    if existing:
        return False  # Already applied
    logger.info(f"Running migration {migration_id:03d}: {name}")
    for sql in sql_statements:
        db.execute(sql)
    if callback:
        callback(db)
    db.execute("INSERT INTO schema_migrations (id, name) VALUES (?, ?)", (migration_id, name))
    db.commit()
    return True


def _migration_add_columns_if_missing(db, table: str, columns: dict):
    """Helper: add columns to a table if they don't exist. columns = {name: definition}."""
    if not _table_exists(db, table):
        return
    existing = {row[1] for row in db.execute(f"PRAGMA table_info({table})").fetchall()}
    for col_name, col_def in columns.items():
        if col_name not in existing:
            db.execute(f"ALTER TABLE {table} ADD COLUMN {col_name} {col_def}")
