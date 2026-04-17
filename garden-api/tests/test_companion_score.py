"""Tests for GET /api/beds/{bed_id}/companion-score."""
from __future__ import annotations

import pytest

from db import get_db


def _create_bed(client):
    resp = client.post("/api/beds", json={
        "name": "Score Test Bed",
        "width_cells": 4,
        "height_cells": 4,
        "cell_size_inches": 12,
        "bed_type": "grid",
    })
    assert resp.status_code == 200
    return resp.json()["id"]


def _plant(client, bed_id, plant_id, x, y):
    resp = client.post("/api/plantings", json={
        "plant_id": plant_id,
        "bed_id": bed_id,
        "cell_x": x,
        "cell_y": y,
        "planted_date": "2026-04-01",
    })
    assert resp.status_code == 200
    return resp.json()["id"]


@pytest.fixture()
def companion_pair_ids():
    """Return (companion_plant_id, companion_name_id) for a known companion pair."""
    with get_db() as db:
        row = db.execute(
            """
            SELECT p.id AS plant_id, p2.id AS other_id
            FROM companions c
            JOIN plants p ON c.plant_id = p.id
            JOIN plants p2 ON c.companion_name = p2.name COLLATE NOCASE
            WHERE c.relationship = 'companion'
            LIMIT 1
            """
        ).fetchone()
        if not row:
            pytest.skip("No companion pairs in reference DB")
        return row["plant_id"], row["other_id"]


@pytest.fixture()
def antagonist_pair_ids():
    """Return (plant_id, antagonist_id) for a known antagonist pair."""
    with get_db() as db:
        row = db.execute(
            """
            SELECT p.id AS plant_id, p2.id AS other_id
            FROM companions c
            JOIN plants p ON c.plant_id = p.id
            JOIN plants p2 ON c.companion_name = p2.name COLLATE NOCASE
            WHERE c.relationship = 'antagonist'
            LIMIT 1
            """
        ).fetchone()
        if not row:
            pytest.skip("No antagonist pairs in reference DB")
        return row["plant_id"], row["other_id"]


# ── Empty / single plant ───────────────────────────────────────────────────

def test_score_empty_bed(auth_client):
    """Empty bed should return score=100, grade='A'."""
    bed_id = _create_bed(auth_client)
    resp = auth_client.get(f"/api/beds/{bed_id}/companion-score")
    assert resp.status_code == 200
    data = resp.json()
    assert data["score"] == 100
    assert data["grade"] == "A"
    assert data["plant_count"] == 0
    assert data["companion_count"] == 0
    assert data["antagonist_count"] == 0


def test_score_single_plant(auth_client, sample_plant_id):
    """A bed with one plant has no pairs to score — should still be 100/A."""
    bed_id = _create_bed(auth_client)
    _plant(auth_client, bed_id, sample_plant_id, 0, 0)
    resp = auth_client.get(f"/api/beds/{bed_id}/companion-score")
    assert resp.status_code == 200
    data = resp.json()
    assert data["score"] == 100
    assert data["grade"] == "A"
    assert data["plant_count"] == 1


# ── Companion pair ─────────────────────────────────────────────────────────

def test_score_with_companion_pair(auth_client, companion_pair_ids):
    """A bed with a companion pair should score above 100 capped at 100 (≥ 100)."""
    p1, p2 = companion_pair_ids
    bed_id = _create_bed(auth_client)
    _plant(auth_client, bed_id, p1, 0, 0)
    _plant(auth_client, bed_id, p2, 1, 0)
    resp = auth_client.get(f"/api/beds/{bed_id}/companion-score")
    assert resp.status_code == 200
    data = resp.json()
    assert data["companion_count"] >= 1
    assert data["antagonist_count"] == 0
    assert data["score"] >= 100  # companion bonus caps at 100
    assert data["grade"] == "A"


# ── Antagonist pair ────────────────────────────────────────────────────────

def test_score_with_antagonist_pair(auth_client, antagonist_pair_ids):
    """A bed with an antagonist pair should score below 100 and flag the pair."""
    p1, p2 = antagonist_pair_ids
    bed_id = _create_bed(auth_client)
    _plant(auth_client, bed_id, p1, 0, 0)
    _plant(auth_client, bed_id, p2, 1, 0)
    resp = auth_client.get(f"/api/beds/{bed_id}/companion-score")
    assert resp.status_code == 200
    data = resp.json()
    assert data["antagonist_count"] >= 1
    assert data["score"] < 100
    assert data["grade"] in ("B", "C", "D", "F")
    assert len(data["antagonist_pairs"]) >= 1
    pair = data["antagonist_pairs"][0]
    assert "plant1" in pair and "plant2" in pair


# ── Score formula ──────────────────────────────────────────────────────────

def test_score_not_below_zero(auth_client, antagonist_pair_ids):
    """Score should never go below 0 regardless of how many antagonists exist."""
    p1, p2 = antagonist_pair_ids
    bed_id = _create_bed(auth_client)
    # Plant the same antagonist pair in multiple cells
    for x in range(4):
        _plant(auth_client, bed_id, p1, x, 0)
        _plant(auth_client, bed_id, p2, x, 1)
    resp = auth_client.get(f"/api/beds/{bed_id}/companion-score")
    assert resp.status_code == 200
    assert resp.json()["score"] >= 0


# ── Auth ───────────────────────────────────────────────────────────────────

def test_score_requires_auth(client):
    """Unauthenticated request should return 401."""
    resp = client.get("/api/beds/1/companion-score")
    assert resp.status_code == 401


# ── 404 ────────────────────────────────────────────────────────────────────

def test_score_bed_not_found(auth_client):
    """Non-existent bed should return 404."""
    resp = auth_client.get("/api/beds/99999/companion-score")
    assert resp.status_code == 404
