"""
Recording storage growth forecast — "at this rate, storage fills up in
~N days." Reuses the same least-squares trend fit alerting.py's predictive
alerts use, but over daily cumulative recording size instead of a live
metric stream.

Only meaningful when auto_delete is off: with auto_delete on, retention.py
deletes the oldest recordings before the limit is ever reached, so the
library size oscillates rather than growing — a forecast there would be
noise, not a warning. Callers should gate display on that same flag,
same as RecordingsPage's existing StorageUsageBar messaging.
"""

from __future__ import annotations

from datetime import datetime

from ..models import Recording

_MIN_DAYS_OF_DATA = 3  # fewer than this and a slope estimate is just noise


def _daily_totals(recordings: list[Recording]) -> dict[str, int]:
    totals: dict[str, int] = {}
    for r in recordings:
        day = r.started_at.date().isoformat()
        totals[day] = totals.get(day, 0) + r.size_bytes
    return totals


def compute_storage_forecast(recordings: list[Recording], max_storage_gb: float) -> dict:
    """Returns {available, trend_gb_per_day, days_until_full, current_gb}.

    `available` is False when there isn't enough historical spread yet to
    fit a trend — the frontend should render nothing rather than a
    misleading "day 1" projection.
    """
    daily = _daily_totals(recordings)
    if len(daily) < _MIN_DAYS_OF_DATA:
        return {"available": False}

    days_sorted = sorted(daily)
    day0 = datetime.fromisoformat(days_sorted[0]).date()
    cumulative = 0
    points: list[tuple[float, float]] = []
    for day in days_sorted:
        cumulative += daily[day]
        x = (datetime.fromisoformat(day).date() - day0).days
        points.append((float(x), cumulative / (1024**3)))

    n = len(points)
    mean_x = sum(p[0] for p in points) / n
    mean_y = sum(p[1] for p in points) / n
    denom = sum((p[0] - mean_x) ** 2 for p in points)
    if denom == 0:
        return {"available": False}

    slope = sum((p[0] - mean_x) * (p[1] - mean_y) for p in points) / denom
    current_gb = points[-1][1]

    if slope <= 0:
        return {"available": True, "trend_gb_per_day": round(slope, 3), "days_until_full": None, "current_gb": round(current_gb, 2)}

    days_until_full = max(0.0, (max_storage_gb - current_gb) / slope)
    return {
        "available": True,
        "trend_gb_per_day": round(slope, 3),
        "days_until_full": round(days_until_full, 1),
        "current_gb": round(current_gb, 2),
    }
