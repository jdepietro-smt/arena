"""
Router tests for /api/routes — CRUD + activation lifecycle for stream
routes. Pure DB + RouteManager (no MediaMTX HTTP client involved), so this
needs no external-service mocking: RouteManager's activate/deactivate call
into ffmpeg subprocess management that fails gracefully in a test
environment (routes stay inactive; the endpoints report the failure via
503/500 rather than crashing), which is exactly the behavior asserted
below.
"""

from __future__ import annotations

from backend.models import UserRole


def _route_payload(name="test-route", is_active=False):
    return {
        "name": name,
        "source_path": "cam1",
        "destinations": [{"type": "srt", "url": "srt://example.com:9000"}],
        "is_active": is_active,
    }


def test_list_routes_requires_auth(client):
    resp = client.get("/api/routes")
    assert resp.status_code == 401


def test_create_and_list_route(client, auth_headers):
    headers, _ = auth_headers(UserRole.viewer, username="viewer1")

    create_resp = client.post("/api/routes", headers=headers, json=_route_payload())
    assert create_resp.status_code == 201
    body = create_resp.json()
    assert body["name"] == "test-route"
    assert body["source_path"] == "cam1"
    # Route is created inactive regardless of the requested is_active flag,
    # since there's no live RouteManager relay in the test environment.
    assert body["is_active"] is False

    list_resp = client.get("/api/routes", headers=headers)
    assert list_resp.status_code == 200
    names = {r["name"] for r in list_resp.json()}
    assert "test-route" in names


def test_create_duplicate_route_name_is_409(client, auth_headers):
    headers, _ = auth_headers(UserRole.viewer, username="viewer1")
    client.post("/api/routes", headers=headers, json=_route_payload())

    resp = client.post("/api/routes", headers=headers, json=_route_payload())

    assert resp.status_code == 409


def test_get_single_route(client, auth_headers):
    headers, _ = auth_headers(UserRole.viewer, username="viewer1")
    created = client.post("/api/routes", headers=headers, json=_route_payload()).json()

    resp = client.get(f"/api/routes/{created['id']}", headers=headers)

    assert resp.status_code == 200
    assert resp.json()["name"] == "test-route"


def test_get_nonexistent_route_is_404(client, auth_headers):
    headers, _ = auth_headers(UserRole.viewer, username="viewer1")

    resp = client.get("/api/routes/999999", headers=headers)

    assert resp.status_code == 404


def test_deactivate_already_inactive_route_is_409(client, auth_headers):
    headers, _ = auth_headers(UserRole.viewer, username="viewer1")
    created = client.post("/api/routes", headers=headers, json=_route_payload()).json()

    resp = client.put(f"/api/routes/{created['id']}/deactivate", headers=headers)

    assert resp.status_code == 409


def test_delete_route_requires_admin(client, auth_headers):
    headers, _ = auth_headers(UserRole.viewer, username="viewer1")
    created = client.post("/api/routes", headers=headers, json=_route_payload()).json()

    resp = client.delete(f"/api/routes/{created['id']}", headers=headers)

    assert resp.status_code == 403


def test_admin_can_delete_route(client, auth_headers):
    headers, _ = auth_headers(UserRole.admin, username="admin1")
    created = client.post("/api/routes", headers=headers, json=_route_payload()).json()

    resp = client.delete(f"/api/routes/{created['id']}", headers=headers)
    assert resp.status_code == 200

    follow_up = client.get(f"/api/routes/{created['id']}", headers=headers)
    assert follow_up.status_code == 404


# ---------------------------------------------------------------------------
# Automatic failover — backup_source_path, fail-back
# ---------------------------------------------------------------------------
#
# Unlike the CRUD tests above (which accept a real, quickly-failing ffmpeg
# spawn attempt as the cost of not mocking RouteManager), the fail-back
# tests below DO fake it — they're specifically about the router's own
# state transitions (409 when not failed-over, admin gating, the DB flag
# flipping back), not about ffmpeg, and a real spawn would make them
# flaky/slow for no benefit. See test_route_failover.py for the actual
# automatic-failover trigger logic, which fakes RouteManager the same way.

import pytest

from backend.routers import routes as routes_router


class FakeRouteManager:
    def __init__(self):
        self.activate_calls = []
        self.deactivate_calls = []

    async def activate(self, route, source_override=None):
        self.activate_calls.append((route.id, source_override))

    async def deactivate(self, route):
        self.deactivate_calls.append(route.id)

    async def is_running(self, route):
        return False


@pytest.fixture
def fake_route_manager(monkeypatch):
    fake = FakeRouteManager()

    async def _get_fake_manager():
        return fake

    monkeypatch.setattr(routes_router, "_get_route_manager", _get_fake_manager)
    return fake


def _route_payload_with_backup(name="test-route", backup="cam1-backup"):
    payload = _route_payload(name=name)
    payload["backup_source_path"] = backup
    return payload


def test_create_route_persists_backup_source_path(client, auth_headers):
    headers, _ = auth_headers(UserRole.viewer, username="viewer1")

    resp = client.post("/api/routes", headers=headers, json=_route_payload_with_backup())

    assert resp.status_code == 201
    body = resp.json()
    assert body["backup_source_path"] == "cam1-backup"
    assert body["failed_over"] is False


def test_fail_back_requires_admin(client, auth_headers):
    headers, _ = auth_headers(UserRole.viewer, username="viewer1")
    created = client.post("/api/routes", headers=headers, json=_route_payload()).json()

    resp = client.put(f"/api/routes/{created['id']}/fail-back", headers=headers)

    assert resp.status_code == 403


def test_fail_back_on_a_route_that_never_failed_over_is_409(client, auth_headers):
    headers, _ = auth_headers(UserRole.admin, username="admin1")
    created = client.post("/api/routes", headers=headers, json=_route_payload()).json()

    resp = client.put(f"/api/routes/{created['id']}/fail-back", headers=headers)

    assert resp.status_code == 409


def test_fail_back_switches_back_to_primary_and_logs_audit(client, auth_headers, fake_route_manager, db_session):
    from backend.models import StreamRoute

    headers, _ = auth_headers(UserRole.admin, username="admin1")
    created = client.post("/api/routes", headers=headers, json=_route_payload_with_backup()).json()
    # Simulate an automatic failover having already happened.
    route = db_session.get(StreamRoute, created["id"])
    route.is_active = True
    route.failed_over = True
    db_session.add(route)
    db_session.commit()

    resp = client.put(f"/api/routes/{created['id']}/fail-back", headers=headers)

    assert resp.status_code == 200
    body = resp.json()
    assert body["failed_over"] is False
    assert fake_route_manager.deactivate_calls == [created["id"]]
    assert fake_route_manager.activate_calls == [(created["id"], None)]  # back to source_path, no override

    audit = client.get("/api/audit", headers=headers).json()
    entry = next(e for e in audit if e["action"] == "route.failback")
    assert entry["username"] == "admin1"
    assert entry["target"] == "test-route"


def test_fail_back_on_an_inactive_failed_over_route_skips_the_relay_call(client, auth_headers, fake_route_manager, db_session):
    """A route can be failed_over=True but not currently is_active (e.g. an
    admin deactivated it after the automatic failover) — fail-back should
    just flip the flag back, not try to start a relay that isn't running."""
    from backend.models import StreamRoute

    headers, _ = auth_headers(UserRole.admin, username="admin1")
    created = client.post("/api/routes", headers=headers, json=_route_payload_with_backup()).json()
    route = db_session.get(StreamRoute, created["id"])
    route.failed_over = True
    db_session.add(route)
    db_session.commit()

    resp = client.put(f"/api/routes/{created['id']}/fail-back", headers=headers)

    assert resp.status_code == 200
    assert resp.json()["failed_over"] is False
    assert fake_route_manager.activate_calls == []
    assert fake_route_manager.deactivate_calls == []
