"""Tests for the plant library endpoints.

The plant data lives in the read-only reference database, so these tests
use the pre-seeded data (124 plants) rather than inserting test rows.
"""
from __future__ import annotations


# ── List / Search ──────────────────────────────────────────────────────────

def test_list_plants(auth_client):
    """GET /api/plants should return a list of plants from the reference DB."""
    resp = auth_client.get("/api/plants")
    assert resp.status_code == 200
    data = resp.json()
    assert isinstance(data, list)
    assert len(data) > 50  # Reference DB has 124 plants


def test_search_plants(auth_client):
    """Searching for 'tomato' should return matching results."""
    resp = auth_client.get("/api/plants?search=tomato")
    assert resp.status_code == 200
    data = resp.json()
    assert len(data) >= 1
    assert any("tomato" in p["name"].lower() for p in data)


def test_filter_by_category(auth_client):
    """Filtering by category=herb should return only herbs."""
    resp = auth_client.get("/api/plants?category=herb")
    assert resp.status_code == 200
    data = resp.json()
    assert len(data) > 0
    assert all(p["category"] == "herb" for p in data)


def test_filter_by_sun(auth_client):
    """Filtering by sun requirement should work."""
    resp = auth_client.get("/api/plants?sun=partial")
    assert resp.status_code == 200
    data = resp.json()
    assert all(p["sun"] == "partial" for p in data)


def test_sort_by_name(auth_client):
    """Default sort should be alphabetical by name."""
    resp = auth_client.get("/api/plants")
    assert resp.status_code == 200
    data = resp.json()
    names = [p["name"] for p in data]
    assert names == sorted(names)


# ── Get single plant ──────────────────────────────────────────────────────

def test_get_plant_by_id(auth_client, sample_plant_id):
    """GET /api/plants/{id} should return plant details."""
    resp = auth_client.get(f"/api/plants/{sample_plant_id}")
    assert resp.status_code == 200
    data = resp.json()
    assert "name" in data
    assert "id" in data
    assert "companions" in data
    assert "antagonists" in data


def test_get_plant_not_found(auth_client):
    """Requesting a non-existent plant should return 404."""
    resp = auth_client.get("/api/plants/99999")
    assert resp.status_code == 404


def test_get_plant_by_name(auth_client):
    """GET /api/plants/name/{name} should return the plant."""
    resp = auth_client.get("/api/plants/name/Tomato")
    assert resp.status_code == 200
    data = resp.json()
    assert data["name"] == "Tomato"
    assert data["category"] == "vegetable"


def test_get_plant_by_name_not_found(auth_client):
    """Looking up a non-existent plant name should return 404."""
    resp = auth_client.get("/api/plants/name/NonexistentPlant")
    assert resp.status_code == 404


# ── Companions ─────────────────────────────────────────────────────────────

def test_get_companions(auth_client):
    """GET /api/companions/{id} should return companions and antagonists."""
    # Get the Tomato plant ID
    resp = auth_client.get("/api/plants/name/Tomato")
    assert resp.status_code == 200
    tomato_id = resp.json()["id"]

    resp = auth_client.get(f"/api/companions/{tomato_id}")
    assert resp.status_code == 200
    data = resp.json()
    assert "companions" in data
    assert "antagonists" in data
    assert len(data["companions"]) > 0


def test_check_companion_pair(auth_client):
    """GET /api/companions/check should report the relationship between two plants."""
    resp = auth_client.get("/api/companions/check?plant1=Tomato&plant2=Basil")
    assert resp.status_code == 200
    data = resp.json()
    assert data["relationship"] == "companion"


def test_check_neutral_pair(auth_client):
    """Two unrelated plants should be reported as neutral."""
    resp = auth_client.get("/api/companions/check?plant1=Corn&plant2=Lavender")
    assert resp.status_code == 200
    assert resp.json()["relationship"] == "neutral"


# ── Plant stats ────────────────────────────────────────────────────────────

def test_plant_stats(auth_client):
    """GET /api/plants/stats should return aggregate counts."""
    resp = auth_client.get("/api/plants/stats")
    assert resp.status_code == 200
    data = resp.json()
    assert "total" in data
    assert data["total"] > 50
    assert "by_category" in data
    assert "vegetable" in data["by_category"]


# ── Unauthenticated access ────────────────────────────────────────────────

def test_plants_unauthenticated(client):
    """Plant endpoints should require authentication."""
    resp = client.get("/api/plants")
    assert resp.status_code == 401
