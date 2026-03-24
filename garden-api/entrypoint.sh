#!/bin/sh
# Initialize DB only if it doesn't exist on the persistent volume
DB_PATH="/app/data/plants.db"
if [ ! -f "$DB_PATH" ]; then
    echo "No database found — initializing..."
    python init_db.py
    mv /app/plants.db "$DB_PATH" 2>/dev/null || true
else
    echo "Database exists at $DB_PATH — skipping init"
fi

# Pre-deploy backup
if [ -f "$DB_PATH" ]; then
    TIMESTAMP=$(date +%Y%m%d_%H%M%S)
    mkdir -p /app/data/backups
    cp "$DB_PATH" "/app/data/backups/plants_predeploy_${TIMESTAMP}.db"
    echo "Pre-deploy backup created: plants_predeploy_${TIMESTAMP}.db"
fi

# Symlink so the app finds it at the expected path
ln -sf "$DB_PATH" /app/plants.db

# Create photos dir on volume
mkdir -p /app/data/photos

exec uvicorn main:app --host 0.0.0.0 --port 3402
