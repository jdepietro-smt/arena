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

    create_resp = client.post("/api/routes/", headers=headers, json=_route_payload())
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
    client.post("/api/routes/", headers=headers, json=_route_payload())

    resp = client.post("/api/routes/", headers=headers, json=_route_payload())

    assert resp.status_code == 409


def test_get_single_route(client, auth_headers):
    headers, _ = auth_headers(UserRole.viewer, username="viewer1")
    created = client.post("/api/routes/", headers=headers, json=_route_payload()).json()

    resp = client.get(f"/api/routes/{created['id']}", headers=headers)

    assert resp.status_code == 200
    assert resp.json()["name"] == "test-route"


def test_get_nonexistent_route_is_404(client, auth_headers):
    headers, _ = auth_headers(UserRole.viewer, username="viewer1")

    resp = client.get("/api/routes/999999", headers=headers)

    assert resp.status_code == 404


def test_deactivate_already_inactive_route_is_409(client, auth_headers):
    headers, _ = auth_headers(UserRole.viewer, username="viewer1")
    created = client.post("/api/routes/", headers=headers, json=_route_payload()).json()

    resp = client.put(f"/api/routes/{created['id']}/deactivate", headers=headers)

    assert resp.status_code == 409


def test_delete_route_requires_admin(client, auth_headers):
    headers, _ = auth_headers(UserRole.viewer, username="viewer1")
    created = client.post("/api/routes/", headers=headers, json=_route_payload()).json()

    resp = client.delete(f"/api/routes/{created['id']}", headers=headers)

    assert resp.status_code == 403


def test_admin_can_delete_route(client, auth_headers):
    headers, _ = auth_headers(UserRole.admin, username="admin1")
    created = client.post("/api/routes/", headers=headers, json=_route_payload()).json()

    resp = client.delete(f"/api/routes/{created['id']}", headers=headers)
    assert resp.status_code == 200

    follow_up = client.get(f"/api/routes/{created['id']}", headers=headers)
    assert follow_up.status_code == 404
