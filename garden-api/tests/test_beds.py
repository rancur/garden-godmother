"""Tests for garden bed / planter CRUD endpoints."""
from __future__ import annotations


# ── Create ─────────────────────────────────────────────────────────────────

def test_create_bed(auth_client):
    """POST /api/beds should create a new garden bed."""
    resp = auth_client.post("/api/beds", json={
        "name": "Raised Bed 1",
        "width_cells": 4,
        "height_cells": 8,
        "cell_size_inches": 12,
        "bed_type": "grid",
    })
    assert resp.status_code == 200
    data = resp.json()
    assert data["name"] == "Raised Bed 1"
    assert data["width_cells"] == 4
    assert data["height_cells"] == 8
    assert "id" in data


def test_create_bed_missing_name(auth_client):
    """Creating a bed without a name should fail validation."""
    resp = auth_client.post("/api/beds", json={
        "width_cells": 4,
        "height_cells": 4,
    })
    assert resp.status_code == 422


# ── List ───────────────────────────────────────────────────────────────────

def test_list_beds(auth_client, sample_bed_id):
    """GET /api/beds should return all beds."""
    resp = auth_client.get("/api/beds")
    assert resp.status_code == 200
    data = resp.json()
    assert isinstance(data, list)
    assert any(b["id"] == sample_bed_id for b in data)


# ── Get single bed ─────────────────────────────────────────────────────────

def test_get_bed(auth_client, sample_bed_id):
    """GET /api/beds/{id} should return bed details."""
    resp = auth_client.get(f"/api/beds/{sample_bed_id}")
    assert resp.status_code == 200
    data = resp.json()
    assert data["id"] == sample_bed_id
    assert "name" in data


def test_get_bed_not_found(auth_client):
    """Requesting a non-existent bed should return 404."""
    resp = auth_client.get("/api/beds/99999")
    assert resp.status_code == 404


# ── Update ─────────────────────────────────────────────────────────────────

def test_update_bed(auth_client, sample_bed_id):
    """PATCH /api/beds/{id} should update bed fields."""
    resp = auth_client.patch(f"/api/beds/{sample_bed_id}", json={
        "name": "Updated Bed Name",
        "notes": "Test notes",
    })
    assert resp.status_code == 200
    data = resp.json()
    assert data["ok"] is True

    # Verify the update took effect
    get_resp = auth_client.get(f"/api/beds/{sample_bed_id}")
    assert get_resp.json()["name"] == "Updated Bed Name"


# ── Delete ─────────────────────────────────────────────────────────────────

def test_delete_bed(auth_client, sample_bed_id):
    """DELETE /api/beds/{id} should remove the bed."""
    resp = auth_client.delete(f"/api/beds/{sample_bed_id}")
    assert resp.status_code == 200

    # Confirm it is gone
    resp = auth_client.get(f"/api/beds/{sample_bed_id}")
    assert resp.status_code == 404


# ── Unauthenticated access ────────────────────────────────────────────────

def test_beds_unauthenticated(client):
    """Bed endpoints should require authentication."""
    resp = client.get("/api/beds")
    assert resp.status_code == 401

    resp = client.post("/api/beds", json={"name": "Test"})
    assert resp.status_code == 401


# ── Templates ──────────────────────────────────────────────────────────────

def test_list_templates(auth_client):
    """GET /api/beds/templates should return available garden templates."""
    resp = auth_client.get("/api/beds/templates")
    assert resp.status_code == 200
    data = resp.json()
    assert isinstance(data, list)
    assert len(data) > 0
    assert all("name" in t for t in data)
