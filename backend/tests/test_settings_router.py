"""
Router tests for /api/settings — recording storage/retention config and
the on-demand DB backup trigger.
"""

from __future__ import annotations

import sqlite3

from backend.models import UserRole
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
