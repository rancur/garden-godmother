"""Tests for task management endpoints."""
from __future__ import annotations


# ── Create ─────────────────────────────────────────────────────────────────

def test_create_task(auth_client):
    """POST /api/tasks should create a manual task."""
    resp = auth_client.post("/api/tasks", json={
        "task_type": "water",
        "title": "Water the tomatoes",
        "priority": "high",
        "due_date": "2026-04-01",
    })
    assert resp.status_code == 200
    data = resp.json()
    assert data["title"] == "Water the tomatoes"
    assert data["priority"] == "high"
    assert data["status"] == "pending"
    assert "id" in data


def test_create_task_missing_fields(auth_client):
    """Creating a task without required fields should fail."""
    resp = auth_client.post("/api/tasks", json={
        "priority": "low",
    })
    assert resp.status_code == 422


# ── List ───────────────────────────────────────────────────────────────────

def test_list_tasks(auth_client):
    """GET /api/tasks should return all tasks."""
    # Create a task first
    auth_client.post("/api/tasks", json={
        "task_type": "water",
        "title": "Test task",
        "priority": "medium",
    })
    resp = auth_client.get("/api/tasks")
    assert resp.status_code == 200
    data = resp.json()
    assert isinstance(data, list)
    assert len(data) >= 1


def test_filter_tasks_by_status(auth_client):
    """Filtering tasks by status should work."""
    auth_client.post("/api/tasks", json={
        "task_type": "water",
        "title": "Pending task",
        "priority": "medium",
    })
    resp = auth_client.get("/api/tasks?status=pending")
    assert resp.status_code == 200
    data = resp.json()
    assert all(t["status"] == "pending" for t in data)


def test_filter_tasks_by_priority(auth_client):
    """Filtering tasks by priority should work."""
    auth_client.post("/api/tasks", json={
        "task_type": "water",
        "title": "Urgent task",
        "priority": "urgent",
    })
    resp = auth_client.get("/api/tasks?priority=urgent")
    assert resp.status_code == 200
    data = resp.json()
    assert all(t["priority"] == "urgent" for t in data)


# ── Update ─────────────────────────────────────────────────────────────────

def test_update_task(auth_client):
    """PATCH /api/tasks/{id} should update task fields."""
    create_resp = auth_client.post("/api/tasks", json={
        "task_type": "water",
        "title": "Original title",
        "priority": "low",
    })
    task_id = create_resp.json()["id"]

    resp = auth_client.patch(f"/api/tasks/{task_id}", json={
        "title": "Updated title",
        "priority": "high",
    })
    assert resp.status_code == 200
    assert resp.json()["title"] == "Updated title"
    assert resp.json()["priority"] == "high"


def test_update_task_not_found(auth_client):
    """Updating a non-existent task should return 404."""
    resp = auth_client.patch("/api/tasks/99999", json={"title": "nope"})
    assert resp.status_code == 404


def test_update_task_no_fields(auth_client):
    """Updating with no fields should return 400."""
    create_resp = auth_client.post("/api/tasks", json={
        "task_type": "water",
        "title": "Test",
        "priority": "low",
    })
    task_id = create_resp.json()["id"]
    resp = auth_client.patch(f"/api/tasks/{task_id}", json={})
    assert resp.status_code == 400


# ── Complete ───────────────────────────────────────────────────────────────

def test_complete_task(auth_client):
    """POST /api/tasks/{id}/complete should mark task as completed."""
    create_resp = auth_client.post("/api/tasks", json={
        "task_type": "harvest",
        "title": "Harvest tomatoes",
        "priority": "medium",
    })
    task_id = create_resp.json()["id"]

    resp = auth_client.post(f"/api/tasks/{task_id}/complete")
    assert resp.status_code == 200

    # Verify the task is now completed
    task_resp = auth_client.get(f"/api/tasks?status=completed")
    completed = [t for t in task_resp.json() if t["id"] == task_id]
    assert len(completed) == 1
    assert completed[0]["status"] == "completed"


# ── Delete ─────────────────────────────────────────────────────────────────

def test_delete_task(auth_client):
    """DELETE /api/tasks/{id} should remove the task."""
    create_resp = auth_client.post("/api/tasks", json={
        "task_type": "weed",
        "title": "Weed the garden",
        "priority": "low",
    })
    task_id = create_resp.json()["id"]

    resp = auth_client.delete(f"/api/tasks/{task_id}")
    assert resp.status_code == 200
    assert resp.json()["deleted"] is True


def test_delete_task_not_found(auth_client):
    """Deleting a non-existent task should return 404."""
    resp = auth_client.delete("/api/tasks/99999")
    assert resp.status_code == 404
