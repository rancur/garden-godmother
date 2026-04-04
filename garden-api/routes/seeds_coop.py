"""Co-op extensions for seeds: wishlist and swap availability."""
from __future__ import annotations

from fastapi import APIRouter, Request, HTTPException
from pydantic import BaseModel
from db import get_db
from auth import require_user

router = APIRouter()


class WishlistItem(BaseModel):
    plant_name: str
    variety: str | None = None
    notes: str | None = None


@router.get("/api/seeds/wishlist")
def get_wishlist(request: Request):
    user = require_user(request)
    with get_db() as db:
        rows = db.execute(
            "SELECT * FROM seed_wishlist WHERE user_id=? ORDER BY created_at DESC",
            (user["id"],)
        ).fetchall()
        return [dict(r) for r in rows]


@router.post("/api/seeds/wishlist")
def add_to_wishlist(item: WishlistItem, request: Request):
    user = require_user(request)
    with get_db() as db:
        cursor = db.execute(
            "INSERT INTO seed_wishlist (user_id, plant_name, variety, notes) VALUES (?,?,?,?)",
            (user["id"], item.plant_name, item.variety, item.notes)
        )
        db.commit()
        return {"id": cursor.lastrowid, **item.model_dump(), "user_id": user["id"]}


@router.delete("/api/seeds/wishlist/{item_id}")
def remove_from_wishlist(item_id: int, request: Request):
    user = require_user(request)
    with get_db() as db:
        row = db.execute("SELECT id FROM seed_wishlist WHERE id=? AND user_id=?", (item_id, user["id"])).fetchone()
        if not row:
            raise HTTPException(404, "Not found")
        db.execute("DELETE FROM seed_wishlist WHERE id=?", (item_id,))
        db.commit()
        return {"deleted": True}


@router.patch("/api/seeds/{seed_id}/swap")
def toggle_swap_availability(seed_id: int, request: Request):
    """Toggle coop_swap_available on a seed record."""
    user = require_user(request)
    with get_db() as db:
        row = db.execute("SELECT id, coop_swap_available FROM seeds WHERE id=?", (seed_id,)).fetchone()
        if not row:
            raise HTTPException(404, "Seed not found")
        new_val = 0 if row["coop_swap_available"] else 1
        db.execute("UPDATE seeds SET coop_swap_available=? WHERE id=?", (new_val, seed_id))
        db.commit()
        return {"id": seed_id, "coop_swap_available": bool(new_val)}
