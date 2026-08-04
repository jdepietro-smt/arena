"""
Router tests for /api/audit — read-only, admin-only. The interesting
behavior is that create/delete on users, routes, and alert rules actually
write an audit entry, not just that the listing endpoint works.
"""

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


def _route_payload(name="Studio A -> CDN"):
    return {
        "name": name,
        "source_path": "cam1",
        "destinations": [{"type": "srt", "url": "srt://dest.example.com:9000"}],
        "is_active": False,
    }


def test_list_audit_log_requires_auth(client):
    resp = client.get("/api/audit")
    assert resp.status_code == 401


def test_list_audit_log_requires_admin(client, auth_headers):
    auth, _ = auth_headers(UserRole.viewer, username="viewer1")

    resp = client.get("/api/audit", headers=auth)

    assert resp.status_code == 403


def test_creating_a_user_writes_an_audit_entry(client, auth_headers):
    auth, _ = auth_headers(UserRole.admin, username="admin1")

    create_resp = client.post(
        "/api/users", headers=auth,
        json={"username": "newop", "email": "newop@example.com", "password": "Password123!", "role": "operator"},
    )
    assert create_resp.status_code == 201

    log_resp = client.get("/api/audit", headers=auth)
    assert log_resp.status_code == 200
    entries = log_resp.json()
    entry = next(e for e in entries if e["action"] == "user.create")
    assert entry["username"] == "admin1"
    assert entry["target"] == "newop"
    assert "operator" in entry["detail"]


def test_deleting_a_route_writes_an_audit_entry(client, auth_headers):
    auth, _ = auth_headers(UserRole.admin, username="admin1")

    created = client.post("/api/routes", headers=auth, json=_route_payload()).json()
    client.delete(f"/api/routes/{created['id']}", headers=auth)

    entries = client.get("/api/audit", headers=auth).json()
    create_entry = next(e for e in entries if e["action"] == "route.create")
    delete_entry = next(e for e in entries if e["action"] == "route.delete")
    assert create_entry["target"] == "Studio A -> CDN"
    assert delete_entry["target"] == "Studio A -> CDN"
    assert create_entry["username"] == "admin1"


def test_creating_and_deleting_an_alert_rule_writes_audit_entries(client, auth_headers):
    auth, _ = auth_headers(UserRole.admin, username="admin1")

    created = client.post("/api/alerts", headers=auth, json=_rule_payload()).json()
    client.delete(f"/api/alerts/{created['id']}", headers=auth)

    entries = client.get("/api/audit", headers=auth).json()
    assert any(e["action"] == "alert_rule.create" and e["target"] == "cam1" for e in entries)
    assert any(e["action"] == "alert_rule.delete" and e["target"] == "cam1" for e in entries)


def test_audit_log_lists_newest_first(client, auth_headers):
    auth, _ = auth_headers(UserRole.admin, username="admin1")

    client.post("/api/alerts", headers=auth, json=_rule_payload("first"))
    client.post("/api/alerts", headers=auth, json=_rule_payload("second"))

    entries = client.get("/api/audit", headers=auth).json()
    create_entries = [e for e in entries if e["action"] == "alert_rule.create"]
    assert create_entries[0]["target"] == "second"
    assert create_entries[1]["target"] == "first"
