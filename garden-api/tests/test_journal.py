"""Tests for journal entry endpoints."""
from __future__ import annotations


# ── Create ─────────────────────────────────────────────────────────────────

def test_create_journal_entry(auth_client):
    """POST /api/journal should create a new entry."""
    resp = auth_client.post("/api/journal", json={
        "entry_type": "note",
        "title": "First day in the garden",
        "content": "Everything looks great!",
        "mood": "great",
        "tags": ["spring", "planting"],
    })
    assert resp.status_code == 200
    data = resp.json()
    assert data["entry_type"] == "note"
    assert data["title"] == "First day in the garden"
    assert data["mood"] == "great"
    assert data["tags"] == ["spring", "planting"]
    assert "id" in data


def test_create_journal_entry_invalid_type(auth_client):
    """Creating an entry with an invalid type should fail."""
    resp = auth_client.post("/api/journal", json={
        "entry_type": "invalid_type",
        "content": "Test",
    })
    assert resp.status_code == 400


def test_create_journal_entry_invalid_mood(auth_client):
    """Creating an entry with an invalid mood should fail."""
    resp = auth_client.post("/api/journal", json={
        "entry_type": "note",
        "content": "Test",
        "mood": "ecstatic",
    })
    assert resp.status_code == 400


def test_create_journal_milestone(auth_client):
    """Creating a milestone entry with milestone_type should work."""
    resp = auth_client.post("/api/journal", json={
        "entry_type": "milestone",
        "title": "First sprout!",
        "content": "The tomato seeds sprouted today.",
        "milestone_type": "sprouted",
    })
    assert resp.status_code == 200
    assert resp.json()["milestone_type"] == "sprouted"


def test_create_journal_problem(auth_client):
    """Creating a problem entry with severity should work."""
    resp = auth_client.post("/api/journal", json={
        "entry_type": "problem",
        "title": "Aphid infestation",
        "content": "Found aphids on the tomatoes.",
        "severity": "high",
    })
    assert resp.status_code == 200
    assert resp.json()["severity"] == "high"


# ── List ───────────────────────────────────────────────────────────────────

def test_list_journal_entries(auth_client):
    """GET /api/journal should return entries."""
    auth_client.post("/api/journal", json={
        "entry_type": "note",
        "content": "Test entry",
    })
    resp = auth_client.get("/api/journal")
    assert resp.status_code == 200
    data = resp.json()
    assert isinstance(data, list)
    assert len(data) >= 1


def test_filter_journal_by_type(auth_client):
    """Filtering by entry_type should work."""
    auth_client.post("/api/journal", json={"entry_type": "observation", "content": "Obs"})
    auth_client.post("/api/journal", json={"entry_type": "note", "content": "Note"})

    resp = auth_client.get("/api/journal?entry_type=observation")
    assert resp.status_code == 200
    data = resp.json()
    assert all(e["entry_type"] == "observation" for e in data)


# ── Update ─────────────────────────────────────────────────────────────────

def test_update_journal_entry(auth_client):
    """PATCH /api/journal/{id} should update the entry."""
    create_resp = auth_client.post("/api/journal", json={
        "entry_type": "note",
        "title": "Original",
        "content": "Original content",
    })
    entry_id = create_resp.json()["id"]

    resp = auth_client.patch(f"/api/journal/{entry_id}", json={
        "title": "Updated Title",
        "content": "Updated content",
        "mood": "good",
    })
    assert resp.status_code == 200
    assert resp.json()["title"] == "Updated Title"
    assert resp.json()["mood"] == "good"


def test_update_journal_not_found(auth_client):
    """Updating a non-existent entry should return 404."""
    resp = auth_client.patch("/api/journal/99999", json={"title": "nope"})
    assert resp.status_code == 404


# ── Delete ─────────────────────────────────────────────────────────────────

def test_delete_journal_entry(auth_client):
    """DELETE /api/journal/{id} should remove the entry and return an undo_id."""
    create_resp = auth_client.post("/api/journal", json={
        "entry_type": "note",
        "content": "Ephemeral entry",
    })
    entry_id = create_resp.json()["id"]

    resp = auth_client.delete(f"/api/journal/{entry_id}")
    assert resp.status_code == 200
    assert resp.json()["ok"] is True
    assert "undo_id" in resp.json()


def test_delete_journal_not_found(auth_client):
    """Deleting a non-existent entry should return 404."""
    resp = auth_client.delete("/api/journal/99999")
    assert resp.status_code == 404


# ── Feed ───────────────────────────────────────────────────────────────────

def test_journal_feed(auth_client):
    """GET /api/journal/feed should return a combined feed."""
    auth_client.post("/api/journal", json={
        "entry_type": "note",
        "content": "Feed test entry",
    })
    resp = auth_client.get("/api/journal/feed")
    assert resp.status_code == 200
    data = resp.json()
    assert isinstance(data, list)
