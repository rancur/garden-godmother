"""Seed inventory endpoints."""
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, HTTPException, Query, Request
from fastapi.responses import Response

from db import get_db
from auth import require_user
from models import SeedCreate, SeedUpdate

router = APIRouter()

@router.get("/api/seeds")
def list_seeds():
    with get_db() as db:
        rows = db.execute("""
            SELECT s.*, p.name as plant_name, p.category as plant_category
            FROM seed_inventory s
            JOIN plants p ON s.plant_id = p.id
            ORDER BY p.name, s.variety
        """).fetchall()
        return [dict(r) for r in rows]


@router.post("/api/seeds")
def create_seed(seed: SeedCreate):
    with get_db() as db:
        plant = db.execute("SELECT * FROM plants WHERE id = ?", (seed.plant_id,)).fetchone()
        if not plant:
            raise HTTPException(404, "Plant not found")
        cursor = db.execute(
            "INSERT INTO seed_inventory (plant_id, variety, brand, quantity_seeds, purchase_date, expiration_date, notes) VALUES (?, ?, ?, ?, ?, ?, ?)",
            (seed.plant_id, seed.variety, seed.brand, seed.quantity_seeds, seed.purchase_date, seed.expiration_date, seed.notes),
        )
        db.commit()
        return {"id": cursor.lastrowid, **seed.dict()}


@router.patch("/api/seeds/{seed_id}")
def update_seed(seed_id: int, data: SeedUpdate):
    with get_db() as db:
        existing = db.execute("SELECT * FROM seed_inventory WHERE id = ?", (seed_id,)).fetchone()
        if not existing:
            raise HTTPException(404, "Seed not found")

        updates = []
        params = []
        for field in ("variety", "brand", "quantity_seeds", "purchase_date", "expiration_date", "notes"):
            val = getattr(data, field)
            if val is not None:
                updates.append(f"{field} = ?")
                params.append(val)

        if updates:
            params.append(seed_id)
            db.execute(f"UPDATE seed_inventory SET {', '.join(updates)} WHERE id = ?", params)
            db.commit()

        return {"ok": True}


@router.delete("/api/seeds/{seed_id}")
def delete_seed(seed_id: int):
    with get_db() as db:
        existing = db.execute("SELECT * FROM seed_inventory WHERE id = ?", (seed_id,)).fetchone()
        if not existing:
            raise HTTPException(404, "Seed not found")
        db.execute("DELETE FROM seed_inventory WHERE id = ?", (seed_id,))
        db.commit()
        return {"ok": True}

