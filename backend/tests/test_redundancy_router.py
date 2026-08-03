"""Router tests for /api/redundancy — RedundancyGateway CRUD + status."""

from __future__ import annotations

from backend.models import UserRole


def _gateway_payload(name="gw1"):
    return {"name": name, "stats_url": "http://10.0.1.5:6400/", "stream_path": "cam1"}


def test_list_gateways_requires_auth(client):
    resp = client.get("/api/redundancy")
    assert resp.status_code == 401


def test_create_gateway_requires_admin(client, auth_headers):
    auth, _ = auth_headers(UserRole.viewer, username="viewer1")

    resp = client.post("/api/redundancy", headers=auth, json=_gateway_payload())

    assert resp.status_code == 403


def test_admin_create_and_list_gateway(client, auth_headers):
    auth, _ = auth_headers(UserRole.admin, username="admin1")

    create_resp = client.post("/api/redundancy", headers=auth, json=_gateway_payload())
    assert create_resp.status_code == 200
    body = create_resp.json()
    assert body["name"] == "gw1"
    assert body["is_active"] is True

    list_resp = client.get("/api/redundancy", headers=auth)
    assert list_resp.status_code == 200
    assert any(g["id"] == body["id"] for g in list_resp.json())


def test_toggle_gateway(client, auth_headers):
    auth, _ = auth_headers(UserRole.admin, username="admin1")
    gw = client.post("/api/redundancy", headers=auth, json=_gateway_payload()).json()

    resp = client.patch(f"/api/redundancy/{gw['id']}/toggle", headers=auth)

    assert resp.status_code == 200
    assert resp.json()["is_active"] is False


def test_toggle_nonexistent_gateway_is_404(client, auth_headers):
    auth, _ = auth_headers(UserRole.admin, username="admin1")

    resp = client.patch("/api/redundancy/999999/toggle", headers=auth)

    assert resp.status_code == 404


def test_delete_gateway(client, auth_headers):
    auth, _ = auth_headers(UserRole.admin, username="admin1")
    gw = client.post("/api/redundancy", headers=auth, json=_gateway_payload()).json()

    resp = client.delete(f"/api/redundancy/{gw['id']}", headers=auth)

    assert resp.status_code == 200
    assert resp.json() == {"deleted": gw["id"]}


def test_redundancy_status_shape(client, auth_headers):
    auth, _ = auth_headers(UserRole.admin, username="admin1")
    client.post("/api/redundancy", headers=auth, json=_gateway_payload())

    resp = client.get("/api/redundancy/status", headers=auth)

    assert resp.status_code == 200
    body = resp.json()
    assert "gateways" in body
    assert any(g["name"] == "gw1" for g in body["gateways"])
