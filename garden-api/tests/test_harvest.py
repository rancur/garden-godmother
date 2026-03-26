"""Tests for harvest tracking endpoints."""
from __future__ import annotations


def _create_planting(auth_client, bed_id, plant_id):
    """Helper: create a planting and return its ID."""
    resp = auth_client.post(f"/api/beds/{bed_id}/plantings", json={
        "plant_id": plant_id,
        "bed_id": bed_id,
        "cell_x": 0,
        "cell_y": 0,
        "planted_date": "2026-01-15",
    })
    assert resp.status_code == 200
    return resp.json()["id"]


# ── Create ─────────────────────────────────────────────────────────────────

def test_create_harvest(auth_client, sample_planting_id):
    """POST /api/harvests should record a harvest."""
    resp = auth_client.post("/api/harvests", json={
        "planting_id": sample_planting_id,
        "harvest_date": "2026-04-01",
        "weight_oz": 12.5,
        "quantity": 3,
        "quality": "good",
        "notes": "Nice big tomatoes",
    })
    assert resp.status_code == 200
    data = resp.json()
    assert data["weight_oz"] == 12.5
    assert data["quantity"] == 3
    assert "id" in data


def test_create_harvest_invalid_planting(auth_client):
    """Harvesting from a non-existent planting should return 404."""
    resp = auth_client.post("/api/harvests", json={
        "planting_id": 99999,
        "harvest_date": "2026-04-01",
    })
    assert resp.status_code == 404


def test_create_harvest_with_journal(auth_client, sample_planting_id):
    """Creating a harvest with create_journal_entry=true should also create a journal entry."""
    resp = auth_client.post("/api/harvests", json={
        "planting_id": sample_planting_id,
        "harvest_date": "2026-04-02",
        "weight_oz": 8.0,
        "create_journal_entry": True,
    })
    assert resp.status_code == 200
    data = resp.json()
    assert "journal_entry_id" in data
    assert data["journal_entry_id"] is not None


# ── List ───────────────────────────────────────────────────────────────────

def test_list_harvests(auth_client, sample_planting_id):
    """GET /api/harvests should return all harvests."""
    auth_client.post("/api/harvests", json={
        "planting_id": sample_planting_id,
        "harvest_date": "2026-04-01",
        "weight_oz": 5.0,
    })
    resp = auth_client.get("/api/harvests")
    assert resp.status_code == 200
    data = resp.json()
    assert isinstance(data, list)
    assert len(data) >= 1


def test_list_harvests_by_planting(auth_client, sample_planting_id):
    """Filtering harvests by planting_id should work."""
    auth_client.post("/api/harvests", json={
        "planting_id": sample_planting_id,
        "harvest_date": "2026-04-01",
    })
    resp = auth_client.get(f"/api/harvests?planting_id={sample_planting_id}")
    assert resp.status_code == 200
    data = resp.json()
    assert all(h["planting_id"] == sample_planting_id for h in data)


# ── Summary ────────────────────────────────────────────────────────────────

def test_harvest_summary(auth_client, sample_planting_id):
    """GET /api/harvests/summary should return aggregate stats."""
    auth_client.post("/api/harvests", json={
        "planting_id": sample_planting_id,
        "harvest_date": "2026-04-01",
        "weight_oz": 10.0,
    })
    resp = auth_client.get("/api/harvests/summary")
    assert resp.status_code == 200
    data = resp.json()
    assert "total_harvests" in data
    assert "total_weight_oz" in data
    assert "by_plant" in data
    assert "by_month" in data


# ── Delete ─────────────────────────────────────────────────────────────────

def test_delete_harvest(auth_client, sample_planting_id):
    """DELETE /api/harvests/{id} should remove the harvest."""
    create_resp = auth_client.post("/api/harvests", json={
        "planting_id": sample_planting_id,
        "harvest_date": "2026-04-01",
    })
    harvest_id = create_resp.json()["id"]

    resp = auth_client.delete(f"/api/harvests/{harvest_id}")
    assert resp.status_code == 200
    assert resp.json()["ok"] is True
    assert "undo_id" in resp.json()


def test_delete_harvest_not_found(auth_client):
    """Deleting a non-existent harvest should return 404."""
    resp = auth_client.delete("/api/harvests/99999")
    assert resp.status_code == 404
