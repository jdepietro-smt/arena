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
