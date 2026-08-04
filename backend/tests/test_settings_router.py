"""
Router tests for /api/settings — recording storage/retention config and
the on-demand DB backup trigger.
"""

from __future__ import annotations

import sqlite3

import httpx
import pytest

from backend.models import UserRole
from backend.routers import settings as settings_router
from backend.services import db_backup


def test_get_recording_settings_requires_auth(client):
    resp = client.get("/api/settings/recording")
    assert resp.status_code == 401


def test_get_recording_settings_returns_defaults(client, auth_headers):
    auth, _ = auth_headers(UserRole.viewer, username="viewer1")

    resp = client.get("/api/settings/recording", headers=auth)

    assert resp.status_code == 200
    body = resp.json()
    assert "output_dir" in body
    assert "max_storage_gb" in body
    assert "auto_delete" in body


def test_get_server_settings_requires_auth(client):
    resp = client.get("/api/settings/server")
    assert resp.status_code == 401


def test_get_server_settings_reflects_config(client, auth_headers):
    auth, _ = auth_headers(UserRole.viewer, username="viewer1")

    resp = client.get("/api/settings/server", headers=auth)

    assert resp.status_code == 200
    body = resp.json()
    assert body["mediamtx_api_url"]
    assert body["srt_port"]
    assert body["hls_base_url"]
    # No TURN server is configured for this deployment — these should
    # read as absent, not fabricated.
    assert body["turn_enabled"] is False
    assert body["turn_host"] is None


def test_get_about_info_requires_auth(client):
    resp = client.get("/api/settings/about")
    assert resp.status_code == 401


def test_get_about_info_returns_version(client, auth_headers):
    auth, _ = auth_headers(UserRole.viewer, username="viewer1")

    resp = client.get("/api/settings/about", headers=auth)

    assert resp.status_code == 200
    body = resp.json()
    assert body["version"] == "1.0.0"
    # mediamtx/GStreamer/FFmpeg versions are deliberately not probed —
    # this service has no runtime dependency on any of them.
    assert body["mediamtx_version"] is None
    assert body["gstreamer_version"] is None
    assert body["ffmpeg_version"] is None


def test_update_recording_settings_requires_admin(client, auth_headers):
    auth, _ = auth_headers(UserRole.viewer, username="viewer1")

    resp = client.put(
        "/api/settings/recording",
        headers=auth,
        json={"output_dir": "/mnt/rec", "max_storage_gb": 100.0, "auto_delete": True},
    )

    assert resp.status_code == 403


def test_admin_update_recording_settings_persists(client, auth_headers):
    auth, _ = auth_headers(UserRole.admin, username="admin1")

    put_resp = client.put(
        "/api/settings/recording",
        headers=auth,
        json={"output_dir": "/mnt/rec", "max_storage_gb": 250.5, "auto_delete": True},
    )
    assert put_resp.status_code == 200
    assert put_resp.json() == {
        "output_dir": "/mnt/rec",
        "max_storage_gb": 250.5,
        "auto_delete": True,
    }

    get_resp = client.get("/api/settings/recording", headers=auth)
    assert get_resp.json() == {
        "output_dir": "/mnt/rec",
        "max_storage_gb": 250.5,
        "auto_delete": True,
    }


def test_backup_status_requires_auth(client):
    resp = client.get("/api/settings/backup/status")
    assert resp.status_code == 401


def test_backup_status_shape(client, auth_headers):
    auth, _ = auth_headers(UserRole.viewer, username="viewer1")

    resp = client.get("/api/settings/backup/status", headers=auth)

    assert resp.status_code == 200
    assert "last_backup" in resp.json()


def test_trigger_backup_requires_admin(client, auth_headers):
    auth, _ = auth_headers(UserRole.viewer, username="viewer1")

    resp = client.post("/api/settings/backup", headers=auth)

    assert resp.status_code == 403


def test_admin_trigger_backup_creates_real_file(client, auth_headers, monkeypatch, tmp_path):
    auth, _ = auth_headers(UserRole.admin, username="admin1")

    # run_backup_once derives its source DB path from settings.DATABASE_URL
    # independently of the app's actual test-session DB — point it at an
    # isolated tmp sqlite file so this test cleans up after itself.
    db_path = tmp_path / "arena.db"
    sqlite3.connect(str(db_path)).close()
    monkeypatch.setattr(db_backup.settings, "DATABASE_URL", f"sqlite:///{db_path}")

    resp = client.post("/api/settings/backup", headers=auth)

    assert resp.status_code == 200
    body = resp.json()
    assert body["ok"] is True
    assert (tmp_path / "backups").exists()


def test_server_settings_reports_whether_a_webhook_is_configured(client, auth_headers, monkeypatch):
    auth, _ = auth_headers(UserRole.viewer, username="viewer1")

    monkeypatch.setattr(settings_router.settings, "ALERT_WEBHOOK_URL", "")
    assert client.get("/api/settings/server", headers=auth).json()["webhook_configured"] is False

    monkeypatch.setattr(settings_router.settings, "ALERT_WEBHOOK_URL", "https://hooks.example.com/x")
    assert client.get("/api/settings/server", headers=auth).json()["webhook_configured"] is True


def test_test_webhook_requires_admin(client, auth_headers):
    auth, _ = auth_headers(UserRole.viewer, username="viewer1")

    resp = client.post("/api/settings/test-webhook", headers=auth)

    assert resp.status_code == 403


def test_test_webhook_400s_when_unconfigured(client, auth_headers, monkeypatch):
    auth, _ = auth_headers(UserRole.admin, username="admin1")
    monkeypatch.setattr(settings_router.settings, "ALERT_WEBHOOK_URL", "")

    resp = client.post("/api/settings/test-webhook", headers=auth)

    assert resp.status_code == 400
    assert "not configured" in resp.json()["detail"]


def test_test_webhook_success_writes_an_audit_entry(client, auth_headers, monkeypatch):
    auth, _ = auth_headers(UserRole.admin, username="admin1")
    monkeypatch.setattr(settings_router.settings, "ALERT_WEBHOOK_URL", "https://hooks.example.com/x")

    async def _fake_post(self, url, json=None):
        assert url == "https://hooks.example.com/x"
        assert "Test alert" in json["text"]
        return httpx.Response(200, request=httpx.Request("POST", url))
    monkeypatch.setattr(httpx.AsyncClient, "post", _fake_post)

    resp = client.post("/api/settings/test-webhook", headers=auth)

    assert resp.status_code == 200
    assert resp.json() == {"ok": True, "status_code": 200}

    log = client.get("/api/audit", headers=auth).json()
    entry = next(e for e in log if e["action"] == "webhook.test")
    assert entry["username"] == "admin1"
    assert "200" in entry["detail"]


def test_test_webhook_surfaces_a_non_2xx_response_as_502(client, auth_headers, monkeypatch):
    auth, _ = auth_headers(UserRole.admin, username="admin1")
    monkeypatch.setattr(settings_router.settings, "ALERT_WEBHOOK_URL", "https://hooks.example.com/x")

    async def _fake_post(self, url, json=None):
        return httpx.Response(404, request=httpx.Request("POST", url))
    monkeypatch.setattr(httpx.AsyncClient, "post", _fake_post)

    resp = client.post("/api/settings/test-webhook", headers=auth)

    assert resp.status_code == 502
    assert "404" in resp.json()["detail"]


def test_test_webhook_surfaces_a_network_failure_as_502(client, auth_headers, monkeypatch):
    auth, _ = auth_headers(UserRole.admin, username="admin1")
    monkeypatch.setattr(settings_router.settings, "ALERT_WEBHOOK_URL", "https://hooks.example.com/x")

    async def _fake_post(self, url, json=None):
        raise httpx.ConnectError("connection refused")
    monkeypatch.setattr(httpx.AsyncClient, "post", _fake_post)

    resp = client.post("/api/settings/test-webhook", headers=auth)

    assert resp.status_code == 502
    assert "connection refused" in resp.json()["detail"]


class TestLoginAttempts:
    @pytest.fixture(autouse=True)
    def _reset_limiter(self):
        from backend.services import login_limiter
        login_limiter._failures.clear()
        login_limiter._locked_until.clear()
        yield
        login_limiter._failures.clear()
        login_limiter._locked_until.clear()

    def test_list_requires_admin(self, client, auth_headers):
        auth, _ = auth_headers(UserRole.viewer, username="viewer1")

        resp = client.get("/api/settings/login-attempts", headers=auth)

        assert resp.status_code == 403

    def test_list_reports_a_locked_ip(self, client, auth_headers):
        from backend.services import login_limiter
        for _ in range(5):
            login_limiter.record_failure("10.0.0.9")
        auth, _ = auth_headers(UserRole.admin, username="admin1")

        resp = client.get("/api/settings/login-attempts", headers=auth)

        assert resp.status_code == 200
        entries = resp.json()
        assert entries == [{"ip": "10.0.0.9", "attempt_count": 5, "locked": True, "seconds_remaining": entries[0]["seconds_remaining"]}]
        assert entries[0]["seconds_remaining"] > 0

    def test_clear_requires_admin(self, client, auth_headers):
        auth, _ = auth_headers(UserRole.viewer, username="viewer1")

        resp = client.post("/api/settings/login-attempts/10.0.0.9/clear", headers=auth)

        assert resp.status_code == 403

    def test_clear_404s_for_an_untracked_ip(self, client, auth_headers):
        auth, _ = auth_headers(UserRole.admin, username="admin1")

        resp = client.post("/api/settings/login-attempts/1.2.3.4/clear", headers=auth)

        assert resp.status_code == 404

    def test_clear_lifts_a_lockout_and_writes_an_audit_entry(self, client, auth_headers):
        from backend.services import login_limiter
        for _ in range(5):
            login_limiter.record_failure("10.0.0.9")
        auth, _ = auth_headers(UserRole.admin, username="admin1")

        resp = client.post("/api/settings/login-attempts/10.0.0.9/clear", headers=auth)

        assert resp.status_code == 200
        assert client.get("/api/settings/login-attempts", headers=auth).json() == []

        log = client.get("/api/audit", headers=auth).json()
        entry = next(e for e in log if e["action"] == "login_lockout.clear")
        assert entry["username"] == "admin1"
        assert entry["target"] == "10.0.0.9"
