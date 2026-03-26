"""Seasonal pattern recognition endpoints."""
from __future__ import annotations

from collections import defaultdict

import httpx
from fastapi import APIRouter, HTTPException, Request

from db import get_db
from auth import require_user
from services.integrations import get_openai_key

router = APIRouter()


# ──────────────── PATTERN ANALYSIS ────────────────


def _analyze_patterns(plantings: list[dict], harvests: list[dict], tasks: list[dict]) -> dict:
    """Analyze garden data for seasonal patterns."""
    monthly_plantings: dict[str, int] = defaultdict(int)
    plant_success: dict[str, dict] = defaultdict(lambda: {"planted": 0, "harvested": 0, "failed": 0})

    for p in plantings:
        if p.get("planted_date"):
            month = p["planted_date"][5:7]  # MM
            monthly_plantings[month] += 1
            name = p.get("plant_name", "Unknown")
            plant_success[name]["planted"] += 1
            if p.get("status") in ("harvested", "fruiting", "flowering", "established"):
                plant_success[name]["harvested"] += 1
            elif p.get("status") in ("failed", "removed"):
                plant_success[name]["failed"] += 1

    # Best performing plants by harvest weight
    plant_harvests: dict[str, float] = defaultdict(float)
    for h in harvests:
        plant_harvests[h.get("plant_name", "Unknown")] += float(h.get("weight_oz") or 0)

    # Task frequency by month
    monthly_tasks: dict[str, dict[str, int]] = defaultdict(lambda: defaultdict(int))
    for t in tasks:
        if t.get("completed_date"):
            month = t["completed_date"][5:7]
            monthly_tasks[month][t.get("task_type", "other")] += 1

    # Compute success rates
    success_rates = {}
    for name, data in sorted(plant_success.items(), key=lambda x: x[1]["planted"], reverse=True)[:20]:
        rate = round(data["harvested"] / max(data["planted"], 1) * 100)
        success_rates[name] = {**data, "success_rate": rate}

    # Overall success rate
    total_planted = sum(d["planted"] for d in plant_success.values())
    total_succeeded = sum(d["harvested"] for d in plant_success.values())
    overall_success_rate = round(total_succeeded / max(total_planted, 1) * 100)

    return {
        "monthly_planting_activity": dict(sorted(monthly_plantings.items())),
        "plant_success_rates": success_rates,
        "top_harvests": dict(sorted(plant_harvests.items(), key=lambda x: x[1], reverse=True)[:10]),
        "monthly_task_breakdown": {m: dict(tasks_dict) for m, tasks_dict in sorted(monthly_tasks.items())},
        "total_plantings": len(plantings),
        "total_harvests": len(harvests),
        "total_tasks": len(tasks),
        "overall_success_rate": overall_success_rate,
    }


def _build_pattern_context(plantings: list[dict], harvests: list[dict], tasks: list[dict]) -> str:
    """Build a text summary of garden data for AI analysis."""
    lines = []
    lines.append(f"Garden History Summary:")
    lines.append(f"- Total plantings: {len(plantings)}")
    lines.append(f"- Total harvests: {len(harvests)}")
    lines.append(f"- Total completed tasks: {len(tasks)}")
    lines.append("")

    # Planting timeline
    if plantings:
        lines.append("Plantings by month:")
        monthly: dict[str, list[str]] = defaultdict(list)
        for p in plantings:
            if p.get("planted_date"):
                month_key = p["planted_date"][:7]  # YYYY-MM
                status = p.get("status", "unknown")
                name = p.get("plant_name", "Unknown")
                bed = p.get("bed_name", "unknown bed")
                monthly[month_key].append(f"{name} ({status}) in {bed}")
        for month_key in sorted(monthly.keys()):
            lines.append(f"  {month_key}: {', '.join(monthly[month_key])}")
        lines.append("")

    # Harvest data
    if harvests:
        lines.append("Harvests:")
        for h in harvests:
            weight = h.get("weight_oz") or 0
            quality = h.get("quality") or "unrated"
            name = h.get("plant_name", "Unknown")
            date_str = h.get("harvest_date", "unknown date")
            lines.append(f"  {date_str}: {name} - {weight} oz, quality: {quality}")
        lines.append("")

    # Task patterns
    if tasks:
        task_counts: dict[str, int] = defaultdict(int)
        for t in tasks:
            task_counts[t.get("task_type", "other")] += 1
        lines.append("Completed task types:")
        for tt, count in sorted(task_counts.items(), key=lambda x: x[1], reverse=True):
            lines.append(f"  {tt}: {count}")
        lines.append("")

    # Plant outcomes
    outcomes: dict[str, dict[str, int]] = defaultdict(lambda: defaultdict(int))
    for p in plantings:
        name = p.get("plant_name", "Unknown")
        status = p.get("status", "unknown")
        outcomes[name][status] += 1
    if outcomes:
        lines.append("Plant outcomes (name: status counts):")
        for name, statuses in sorted(outcomes.items()):
            parts = [f"{s}={c}" for s, c in sorted(statuses.items())]
            lines.append(f"  {name}: {', '.join(parts)}")

    return "\n".join(lines)


@router.get("/api/patterns/seasonal")
def get_seasonal_patterns(request: Request):
    """Analyze garden history to find seasonal patterns."""
    require_user(request)
    with get_db() as db:
        plantings = db.execute("""
            SELECT p.planted_date, p.status, pl.name as plant_name, pl.category,
                   gb.name as bed_name
            FROM plantings p
            JOIN plants pl ON p.plant_id = pl.id
            LEFT JOIN garden_beds gb ON p.bed_id = gb.id
            WHERE p.planted_date IS NOT NULL
            ORDER BY p.planted_date
        """).fetchall()

        harvests = db.execute("""
            SELECT h.harvest_date, h.weight_oz, h.quantity, h.quality,
                   pl.name as plant_name
            FROM harvests h
            JOIN plantings p ON h.planting_id = p.id
            JOIN plants pl ON p.plant_id = pl.id
        """).fetchall()

        tasks = db.execute("""
            SELECT task_type, completed_date, title
            FROM garden_tasks
            WHERE status = 'completed' AND completed_date IS NOT NULL
        """).fetchall()

        return _analyze_patterns(
            [dict(r) for r in plantings],
            [dict(r) for r in harvests],
            [dict(r) for r in tasks],
        )


@router.post("/api/patterns/ai-insights")
async def get_ai_insights(request: Request):
    """Generate AI insights about garden patterns."""
    require_user(request)
    openai_key = get_openai_key()
    if not openai_key:
        raise HTTPException(400, "OpenAI not configured — add your API key in Settings > Integrations")

    with get_db() as db:
        plantings = db.execute("""
            SELECT p.planted_date, p.status, pl.name as plant_name, pl.category,
                   gb.name as bed_name
            FROM plantings p
            JOIN plants pl ON p.plant_id = pl.id
            LEFT JOIN garden_beds gb ON p.bed_id = gb.id
            WHERE p.planted_date IS NOT NULL
            ORDER BY p.planted_date
        """).fetchall()

        harvests = db.execute("""
            SELECT h.harvest_date, h.weight_oz, h.quantity, h.quality,
                   pl.name as plant_name
            FROM harvests h
            JOIN plantings p ON h.planting_id = p.id
            JOIN plants pl ON p.plant_id = pl.id
        """).fetchall()

        tasks = db.execute("""
            SELECT task_type, completed_date, title
            FROM garden_tasks
            WHERE status = 'completed' AND completed_date IS NOT NULL
        """).fetchall()

    context = _build_pattern_context(
        [dict(r) for r in plantings],
        [dict(r) for r in harvests],
        [dict(r) for r in tasks],
    )

    if not context.strip() or (len(plantings) == 0 and len(harvests) == 0):
        return {
            "insights": "Not enough garden data yet to generate meaningful insights. "
                        "Start logging plantings, harvests, and tasks to see AI-powered pattern analysis here!"
        }

    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.post(
            "https://api.openai.com/v1/chat/completions",
            headers={"Authorization": f"Bearer {openai_key}"},
            json={
                "model": "gpt-4o-mini",
                "messages": [
                    {
                        "role": "system",
                        "content": (
                            "You are a garden analytics expert. Analyze the garden data and provide "
                            "actionable insights about seasonal patterns, what's working well, what to "
                            "improve, and recommendations for next season. Be specific and reference "
                            "the actual data. Use a friendly, encouraging tone. Keep your response "
                            "under 500 words. Use markdown formatting with headers and bullet points."
                        ),
                    },
                    {"role": "user", "content": context},
                ],
                "max_tokens": 1000,
            },
        )
        if resp.status_code != 200:
            raise HTTPException(502, f"OpenAI API error: {resp.status_code}")
        data = resp.json()
        content = data.get("choices", [{}])[0].get("message", {}).get("content", "")
        return {"insights": content}
