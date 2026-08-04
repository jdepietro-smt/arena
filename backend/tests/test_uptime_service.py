"""Unit tests for services/uptime.py's record_sample/get_uptime_history —
see test_stats_router.py for the endpoint-level tests and test_alerting.py
for confirmation that AlertManager actually calls record_sample."""

from __future__ import annotations

from datetime import datetime

from sqlmodel import select

from backend.models import StreamUptimeDaily
from backend.services import uptime as uptime_module
from backend.services.uptime import get_uptime_history, record_sample


def test_record_sample_creates_a_row_on_first_call(db_session):
    record_sample(db_session, "cam1", is_up=True)

    row = db_session.exec(select(StreamUptimeDaily)).first()
    assert row.stream_path == "cam1"
    assert row.up_samples == 1
    assert row.total_samples == 1


def test_record_sample_accumulates_across_calls(db_session, monkeypatch):
    monkeypatch.setattr(uptime_module, "_today", lambda: "2026-03-01")

    record_sample(db_session, "cam1", is_up=True)
    record_sample(db_session, "cam1", is_up=True)
    record_sample(db_session, "cam1", is_up=False)

    history = get_uptime_history(db_session, "cam1", days=30)
    assert history == [{"date": "2026-03-01", "uptime_pct": 66.7, "total_samples": 3}]


def test_record_sample_keeps_streams_and_days_separate(db_session, monkeypatch):
    day = ["2026-03-01"]
    monkeypatch.setattr(uptime_module, "_today", lambda: day[0])

    record_sample(db_session, "cam1", is_up=True)
    record_sample(db_session, "cam2", is_up=False)
    day[0] = "2026-03-02"
    record_sample(db_session, "cam1", is_up=False)

    cam1_history = get_uptime_history(db_session, "cam1", days=30)
    assert [h["date"] for h in cam1_history] == ["2026-03-01", "2026-03-02"]
    assert cam1_history[0]["uptime_pct"] == 100.0
    assert cam1_history[1]["uptime_pct"] == 0.0

    cam2_history = get_uptime_history(db_session, "cam2", days=30)
    assert len(cam2_history) == 1
    assert cam2_history[0]["uptime_pct"] == 0.0


def test_get_uptime_history_empty_for_unknown_stream(db_session):
    assert get_uptime_history(db_session, "never-seen", days=30) == []
