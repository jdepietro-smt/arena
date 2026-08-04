"""
Per-day, per-stream uptime rollup — backs a calendar-style uptime heatmap
and an eventual SLA report. See models.StreamUptimeDaily's docstring for
why this exists separately from the Event ring buffer.

record_sample() is called once per AlertManager connectivity tick
(alerting.py, every 10s) — cheap enough (one upsert) not to need its own
polling loop.
"""

from __future__ import annotations

from datetime import datetime

from sqlmodel import Session, select

from ..models import StreamUptimeDaily


def _today() -> str:
    return datetime.utcnow().date().isoformat()


def record_sample(session: Session, stream_path: str, is_up: bool) -> None:
    today = _today()
    row = session.exec(
        select(StreamUptimeDaily).where(
            StreamUptimeDaily.date == today, StreamUptimeDaily.stream_path == stream_path
        )
    ).first()
    if row is None:
        row = StreamUptimeDaily(date=today, stream_path=stream_path)
    row.total_samples += 1
    if is_up:
        row.up_samples += 1
    session.add(row)
    session.commit()


def get_uptime_history(session: Session, stream_path: str, days: int) -> list[dict]:
    rows = session.exec(
        select(StreamUptimeDaily)
        .where(StreamUptimeDaily.stream_path == stream_path)
        .order_by(StreamUptimeDaily.date.desc())  # type: ignore[attr-defined]
        .limit(days)
    ).all()
    return [
        {
            "date": r.date,
            "uptime_pct": round(100.0 * r.up_samples / r.total_samples, 1) if r.total_samples else None,
            "total_samples": r.total_samples,
        }
        for r in sorted(rows, key=lambda r: r.date)
    ]
