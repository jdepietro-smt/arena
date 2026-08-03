"""Router tests for /api/alerts — AlertRule CRUD + current status."""

from __future__ import annotations

from backend.models import UserRole


def _rule_payload(stream_path="cam1"):
    return {
        "stream_path": stream_path,
        "metric": "bitrate",
        "operator": "lt",
        "threshold": 500.0,
        "action": "webhook",
    }


def test_list_rules_requires_auth(client):
    resp = client.get("/api/alerts")
    assert resp.status_code == 401


def test_create_rule_requires_admin(client, auth_headers):
    auth, _ = auth_headers(UserRole.viewer, username="viewer1")

    resp = client.post("/api/alerts", headers=auth, json=_rule_payload())

    assert resp.status_code == 403


def test_admin_create_and_list_rule(client, auth_headers):
    auth, _ = auth_headers(UserRole.admin, username="admin1")

    create_resp = client.post("/api/alerts", headers=auth, json=_rule_payload())
    assert create_resp.status_code == 200
    body = create_resp.json()
    assert body["stream_path"] == "cam1"
    assert body["metric"] == "bitrate"

    list_resp = client.get("/api/alerts", headers=auth)
    assert list_resp.status_code == 200
    assert any(r["id"] == body["id"] for r in list_resp.json())


def test_toggle_rule(client, auth_headers):
    auth, _ = auth_headers(UserRole.admin, username="admin1")
    rule = client.post("/api/alerts", headers=auth, json=_rule_payload()).json()
    assert rule["is_active"] is True

    resp = client.patch(f"/api/alerts/{rule['id']}/toggle", headers=auth)

    assert resp.status_code == 200
    assert resp.json()["is_active"] is False


def test_toggle_nonexistent_rule_is_404(client, auth_headers):
    auth, _ = auth_headers(UserRole.admin, username="admin1")

    resp = client.patch("/api/alerts/999999/toggle", headers=auth)

    assert resp.status_code == 404


def test_delete_rule(client, auth_headers):
    auth, _ = auth_headers(UserRole.admin, username="admin1")
    rule = client.post("/api/alerts", headers=auth, json=_rule_payload()).json()

    resp = client.delete(f"/api/alerts/{rule['id']}", headers=auth)

    assert resp.status_code == 200
    assert resp.json() == {"deleted": rule["id"]}

    list_resp = client.get("/api/alerts", headers=auth)
    assert not any(r["id"] == rule["id"] for r in list_resp.json())


def test_alert_status_shape(client, auth_headers):
    auth, _ = auth_headers(UserRole.viewer, username="viewer1")

    resp = client.get("/api/alerts/status", headers=auth)

    assert resp.status_code == 200
    body = resp.json()
    assert "down_streams" in body
    assert "firing_rule_ids" in body
