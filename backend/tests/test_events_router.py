"""Router tests for /api/events — read-only recent-events feed."""

from __future__ import annotations

from backend.models import Event, EventType, UserRole


def _add_event(db_session, event_type=EventType.stream_connected, stream_path="cam1", message=None):
    event = Event(type=event_type, stream_path=stream_path, message=message)
    db_session.add(event)
    db_session.commit()
    db_session.refresh(event)
    return event


def test_list_events_requires_auth(client):
    resp = client.get("/api/events")
    assert resp.status_code == 401


def test_list_events_newest_first(client, auth_headers, db_session):
    auth, _ = auth_headers(UserRole.viewer, username="viewer1")
    first = _add_event(db_session, EventType.stream_connected, "cam1")
    second = _add_event(db_session, EventType.stream_disconnected, "cam1")

    resp = client.get("/api/events", headers=auth)

    assert resp.status_code == 200
    body = resp.json()
    assert body[0]["id"] == second.id
    assert body[1]["id"] == first.id


def test_list_events_respects_limit(client, auth_headers, db_session):
    auth, _ = auth_headers(UserRole.viewer, username="viewer1")
    for _ in range(5):
        _add_event(db_session)

    resp = client.get("/api/events", params={"limit": 2}, headers=auth)

    assert resp.status_code == 200
    assert len(resp.json()) == 2


def test_list_events_rejects_limit_over_200(client, auth_headers):
    auth, _ = auth_headers(UserRole.viewer, username="viewer1")

    resp = client.get("/api/events", params={"limit": 500}, headers=auth)

    assert resp.status_code == 422
