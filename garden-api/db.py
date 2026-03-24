"""Database connection, helpers, and migration utilities."""
from __future__ import annotations

import json
import sqlite3
import logging
from pathlib import Path
from contextlib import contextmanager

logger = logging.getLogger(__name__)

DB_PATH = Path(__file__).parent / "plants.db"


@contextmanager
def get_db():
    db = sqlite3.connect(str(DB_PATH))
    db.row_factory = sqlite3.Row
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
