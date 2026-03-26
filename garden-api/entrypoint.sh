#!/bin/sh
# Garden God Mother entrypoint
#
# Two-database architecture:
#   plants_reference.db — built into the Docker image (read-only reference data)
#   garden.db           — user data on the persistent volume (backed up)

# ── User database (garden.db) ──
DB_PATH="/app/data/garden.db"

# Migration: rename legacy plants.db to garden.db if it exists
LEGACY_DB="/app/data/plants.db"
if [ -f "$LEGACY_DB" ] && [ ! -f "$DB_PATH" ]; then
    echo "Migrating legacy plants.db → garden.db..."
    cp "$LEGACY_DB" "$DB_PATH"
    echo "Legacy database migrated. Original preserved at $LEGACY_DB"
fi

if [ ! -f "$DB_PATH" ]; then
    echo "No user database found — initializing..."
    # Run init_db to create all tables (user + reference stubs).
    # At runtime, reference table stubs are shadowed by temp views from
    # the attached plants_reference.db.
    GG_DB_PATH="$DB_PATH" python3 -c "
import os, sys
os.environ['GG_DB_PATH'] = '$DB_PATH'
# Patch init_db to write to the volume path
from pathlib import Path
import init_db
init_db.DB_PATH = Path('$DB_PATH')
init_db.init_db()
"
fi

# Pre-deploy backup
if [ -f "$DB_PATH" ]; then
    TIMESTAMP=$(date +%Y%m%d_%H%M%S)
    mkdir -p /app/data/backups
    cp "$DB_PATH" "/app/data/backups/garden_predeploy_${TIMESTAMP}.db"
    echo "Pre-deploy backup created: garden_predeploy_${TIMESTAMP}.db"
fi

# Tell the app where the user database lives
export GG_DB_PATH="$DB_PATH"

# Reference database is baked into the image at /app/plants_reference.db
# (built by create_reference_db.py during Docker build)

# Create photos dir on volume
mkdir -p /app/data/photos

exec uvicorn main:app --host 0.0.0.0 --port 3402
