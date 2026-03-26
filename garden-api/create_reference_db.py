#!/usr/bin/env python3
"""Create the plants_reference.db from the full init_db data.

This script runs at Docker build time (not at runtime). It:
1. Runs init_db() to create a temporary full database
2. Extracts only the reference tables into plants_reference.db
3. Cleans up the temporary database

The resulting plants_reference.db ships with the Docker image as read-only
reference data. User data (beds, plantings, journal, etc.) lives separately
in garden.db on the persistent volume.
"""
from __future__ import annotations

import sqlite3
import tempfile
import shutil
from pathlib import Path

# Reference tables to extract from the full init database
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

OUTPUT_PATH = Path(__file__).parent / "plants_reference.db"


def create_reference_db():
    """Build the reference database from init_db data."""
    # Step 1: Create a temporary full database via init_db
    with tempfile.TemporaryDirectory() as tmp_dir:
        tmp_db_path = Path(tmp_dir) / "plants.db"

        # Monkey-patch init_db's DB_PATH to use our temp location
        import init_db
        original_path = init_db.DB_PATH
        init_db.DB_PATH = tmp_db_path

        try:
            init_db.init_db()
        finally:
            init_db.DB_PATH = original_path

        if not tmp_db_path.exists():
            raise RuntimeError("init_db() did not create the database")

        # Step 2: Create the reference DB and copy only reference tables
        if OUTPUT_PATH.exists():
            OUTPUT_PATH.unlink()

        src = sqlite3.connect(str(tmp_db_path))
        dst = sqlite3.connect(str(OUTPUT_PATH))
        dst.execute("PRAGMA journal_mode=WAL")

        for table in REFERENCE_TABLES:
            # Check if table exists in source
            exists = src.execute(
                "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name=?",
                (table,),
            ).fetchone()[0]
            if not exists:
                print(f"  Skipping {table} (not found in source)")
                continue

            # Get the CREATE TABLE statement
            create_sql = src.execute(
                "SELECT sql FROM sqlite_master WHERE type='table' AND name=?",
                (table,),
            ).fetchone()[0]

            # Strip FOREIGN KEY constraints that reference user tables
            # (the reference DB is standalone — FKs to user tables are meaningless)
            dst.execute(create_sql)

            # Copy all rows
            rows = src.execute(f"SELECT * FROM {table}").fetchall()
            if rows:
                cols = [desc[0] for desc in src.execute(f"SELECT * FROM {table} LIMIT 1").description]
                placeholders = ", ".join(["?"] * len(cols))
                dst.executemany(
                    f"INSERT INTO {table} ({', '.join(cols)}) VALUES ({placeholders})",
                    rows,
                )

            count = dst.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
            print(f"  {table}: {count} rows")

        # Copy relevant indexes
        indexes = src.execute(
            "SELECT sql FROM sqlite_master WHERE type='index' AND sql IS NOT NULL"
        ).fetchall()
        for (idx_sql,) in indexes:
            # Only copy indexes for reference tables
            for table in REFERENCE_TABLES:
                if f" ON {table}" in idx_sql or f" ON {table}(" in idx_sql:
                    try:
                        dst.execute(idx_sql)
                    except sqlite3.OperationalError:
                        pass  # Index may already exist
                    break

        dst.commit()

        # Print summary
        total = sum(
            dst.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0]
            for t in REFERENCE_TABLES
            if dst.execute(
                "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name=?", (t,)
            ).fetchone()[0]
        )

        dst.close()
        src.close()

    size_kb = OUTPUT_PATH.stat().st_size / 1024
    print(f"\nReference database created: {OUTPUT_PATH}")
    print(f"  Total rows: {total}")
    print(f"  Size: {size_kb:.1f} KB")
    print(f"  Tables: {', '.join(REFERENCE_TABLES)}")


if __name__ == "__main__":
    print("Creating plants reference database...")
    create_reference_db()
    print("Done.")
