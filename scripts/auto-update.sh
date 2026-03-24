#!/bin/bash
# Garden Godmother Auto-Update Script
# Run via cron on the host:
#   */5 * * * * /path/to/garden-god-mother/scripts/auto-update.sh >> /path/to/garden-god-mother-update.log 2>&1
#
# Two modes:
#   1. Signal file — the web UI writes .update-requested to the data volume; we detect and rebuild immediately.
#   2. Auto-update — if enabled via the app_config table, check for new commits every run and rebuild if found.
set -euo pipefail

REPO_DIR="/home/pi/garden-god-mother"
DATA_DIR="/var/lib/docker/volumes/garden-god-mother_garden-data/_data"
SIGNAL_FILE="${DATA_DIR}/.update-requested"
LOCK_FILE="/tmp/garden-godmother-update.lock"

log() { echo "$(date '+%Y-%m-%d %H:%M:%S') - $*"; }

# Prevent concurrent runs
if [ -f "$LOCK_FILE" ]; then
    LOCK_PID=$(cat "$LOCK_FILE" 2>/dev/null || true)
    if [ -n "$LOCK_PID" ] && kill -0 "$LOCK_PID" 2>/dev/null; then
        log "Another update is running (PID $LOCK_PID), skipping."
        exit 0
    fi
    rm -f "$LOCK_FILE"
fi
echo $$ > "$LOCK_FILE"
trap 'rm -f "$LOCK_FILE"' EXIT

do_update() {
    log "Pulling latest from origin/main..."
    cd "$REPO_DIR"
    git pull origin main

    log "Rebuilding containers..."
    docker compose up -d --build

    log "Pruning old images..."
    docker image prune -f

    log "Update complete."
}

# ── Mode 1: Manual update request from the web UI ──
if [ -f "$SIGNAL_FILE" ]; then
    log "Update requested via web UI (signal: $(cat "$SIGNAL_FILE"))"
    rm -f "$SIGNAL_FILE"
    do_update
    exit 0
fi

# ── Mode 2: Auto-update check ──
# Read auto_update_enabled from the SQLite database in the Docker volume
AUTO_ENABLED=0
DB_FILE="${DATA_DIR}/plants.db"
if [ -f "$DB_FILE" ]; then
    AUTO_ENABLED=$(sqlite3 "$DB_FILE" "SELECT COALESCE((SELECT value FROM app_config WHERE key='auto_update_enabled'), '0');" 2>/dev/null || echo "0")
fi

if [ "$AUTO_ENABLED" != "1" ]; then
    exit 0
fi

cd "$REPO_DIR"
git fetch origin main 2>/dev/null

LOCAL=$(git rev-parse HEAD 2>/dev/null)
REMOTE=$(git rev-parse origin/main 2>/dev/null)

if [ "$LOCAL" = "$REMOTE" ]; then
    exit 0
fi

log "Auto-update: new commits detected (local=$LOCAL, remote=$REMOTE)"
do_update
