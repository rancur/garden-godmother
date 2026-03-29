"""Expense tracking endpoints."""
from __future__ import annotations

import json
from datetime import date, datetime, timedelta
from typing import Optional

from fastapi import APIRouter, HTTPException, Query, Request
from fastapi.responses import Response

from db import get_db
from auth import require_user
from models import ExpenseCreate, ExpenseUpdate
from constants import create_undo_action
from routes.harvest import _estimate_price_per_oz

router = APIRouter()

# ──────────────── EXPENSES ────────────────



@router.post("/api/expenses")
def create_expense(expense: ExpenseCreate):
    with get_db() as db:
        cur = db.execute("""
            INSERT INTO expenses (category, description, amount_cents, purchase_date, notes)
            VALUES (?, ?, ?, ?, ?)
        """, (expense.category, expense.description, expense.amount_cents, expense.purchase_date, expense.notes))
        db.commit()
        row = db.execute("SELECT * FROM expenses WHERE id = ?", (cur.lastrowid,)).fetchone()
        return dict(row)


@router.get("/api/expenses")
def list_expenses(category: Optional[str] = None):
    with get_db() as db:
        query = "SELECT * FROM expenses"
        params = []
        if category:
            query += " WHERE category = ?"
            params.append(category)
        query += " ORDER BY purchase_date DESC, created_at DESC"
        rows = db.execute(query, params).fetchall()
        return [dict(r) for r in rows]


@router.delete("/api/expenses/{expense_id}")
def delete_expense(expense_id: int):
    with get_db() as db:
        existing = db.execute("SELECT * FROM expenses WHERE id = ?", (expense_id,)).fetchone()
        if not existing:
            raise HTTPException(404, "Expense not found")
        undo_id = create_undo_action(db, "delete_expense", {"expense": dict(existing)})
        db.execute("DELETE FROM expenses WHERE id = ?", (expense_id,))
        db.commit()
        return {"ok": True, "undo_id": undo_id}


@router.patch("/api/expenses/{expense_id}")
def update_expense(expense_id: int, update: ExpenseUpdate):
    with get_db() as db:
        existing = db.execute("SELECT * FROM expenses WHERE id = ?", (expense_id,)).fetchone()
        if not existing:
            raise HTTPException(404, "Expense not found")
        data = update.model_dump(exclude_none=True)
        if not data:
            raise HTTPException(400, "No fields to update")
        set_clause = ", ".join(f"{k} = ?" for k in data.keys())
        values = list(data.values()) + [expense_id]
        db.execute(f"UPDATE expenses SET {set_clause} WHERE id = ?", values)
        db.commit()
        row = db.execute("SELECT * FROM expenses WHERE id = ?", (expense_id,)).fetchone()
        return dict(row)


@router.get("/api/expenses/summary")
def expenses_summary():
    with get_db() as db:
        # Total
        total = db.execute("SELECT COALESCE(SUM(amount_cents), 0) as total_cents FROM expenses").fetchone()

        # By category
        by_category = db.execute("""
            SELECT category, COUNT(*) as count, SUM(amount_cents) as total_cents
            FROM expenses GROUP BY category ORDER BY total_cents DESC
        """).fetchall()

        # By month
        by_month = db.execute("""
            SELECT strftime('%Y-%m', COALESCE(purchase_date, created_at)) as month,
                   SUM(amount_cents) as total_cents
            FROM expenses GROUP BY month ORDER BY month
        """).fetchall()

        return {
            "total_cents": total["total_cents"],
            "by_category": [dict(r) for r in by_category],
            "by_month": [dict(r) for r in by_month],
        }



# ──────────────── ECONOMICS ────────────────

@router.get("/api/economics")
def economics():
    with get_db() as db:
        # Get all harvests with plant names
        harvests = db.execute("""
            SELECT h.weight_oz, pl.name as plant_name
            FROM harvests h
            JOIN plantings p ON h.planting_id = p.id
            JOIN plants pl ON p.plant_id = pl.id
            WHERE h.weight_oz IS NOT NULL
        """).fetchall()

        total_value_cents = 0
        for h in harvests:
            price_per_oz = _estimate_price_per_oz(h["plant_name"])
            total_value_cents += int(h["weight_oz"] * price_per_oz * 100)

        total_expenses = db.execute(
            "SELECT COALESCE(SUM(amount_cents), 0) as total FROM expenses"
        ).fetchone()["total"]

        total_weight = db.execute(
            "SELECT COALESCE(SUM(weight_oz), 0) as total FROM harvests"
        ).fetchone()["total"]

        total_harvests = db.execute(
            "SELECT COUNT(*) as total FROM harvests"
        ).fetchone()["total"]

        roi = ((total_value_cents - total_expenses) / total_expenses * 100) if total_expenses > 0 else 0

        return {
            "total_harvest_value_cents": total_value_cents,
            "total_expenses_cents": total_expenses,
            "net_cents": total_value_cents - total_expenses,
            "roi_percent": round(roi, 1),
            "total_weight_oz": total_weight,
            "total_harvests": total_harvests,
        }


