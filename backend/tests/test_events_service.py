"""Tests for services.events.log_event — the Event ring-buffer writer."""

from __future__ import annotations

from sqlmodel import Session, select

from backend.database import engine
from backend.models import Event, EventType
from backend.services.events import _MAX_ROWS, log_event


def test_log_event_persists_a_row(db_session):
    event = log_event(db_session, EventType.stream_connected, stream_path="cam1", message="hello")

    assert event.id is not None
    stored = db_session.get(Event, event.id)
    assert stored.type == EventType.stream_connected
    assert stored.stream_path == "cam1"
    assert stored.message == "hello"


def test_log_event_defaults_are_optional(db_session):
    event = log_event(db_session, EventType.alert_fired)

    assert event.stream_path is None
    assert event.message is None


def test_log_event_trims_to_max_rows():
    with Session(engine) as session:
        for i in range(_MAX_ROWS + 10):
            log_event(session, EventType.stream_connected, stream_path=f"cam{i}")

        remaining = session.exec(select(Event)).all()
        assert len(remaining) == _MAX_ROWS

        # The newest rows survive; the oldest are the ones trimmed.
        newest = session.exec(select(Event).order_by(Event.id.desc())).first()
        assert newest.stream_path == f"cam{_MAX_ROWS + 9}"
