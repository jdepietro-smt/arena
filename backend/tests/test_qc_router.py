"""
Router tests for /api/qc — enable/disable monitoring (admin-only, since
it spawns a real extra ffmpeg decode per stream) and the status endpoint.

_Job is faked (never spawns ffmpeg) the same way test_qc_monitor.py does,
and the module-level singleton is reset between tests so one test's
want()ed path doesn't leak into the next.
"""

from __future__ import annotations

import pytest

from backend.models import UserRole
from backend.services import qc_monitor as qc_module


class FakeJob:
    def __init__(self, path: str, on_event) -> None:
        self.path = path
        self.started = False
        self.stopped = False

    def start(self) -> None:
        self.started = True

    @property
    def alive(self) -> bool:
        return self.started and not self.stopped

    @property
    def running(self) -> bool:
        return self.alive

    async def stop(self) -> None:
        self.stopped = True


@pytest.fixture(autouse=True)
def _fake_job_and_fresh_monitor(monkeypatch):
    monkeypatch.setattr(qc_module, "_Job", FakeJob)
    qc_module._monitor = None
    yield
    qc_module._monitor = None


def test_status_requires_auth(client):
    resp = client.get("/api/qc/status")
    assert resp.status_code == 401


def test_status_empty_by_default(client, auth_headers):
    auth, _ = auth_headers(UserRole.viewer, username="viewer1")

    resp = client.get("/api/qc/status", headers=auth)

    assert resp.status_code == 200
    assert resp.json() == {"monitored_paths": [], "active_issues": []}


def test_enable_requires_admin(client, auth_headers):
    auth, _ = auth_headers(UserRole.viewer, username="viewer1")

    resp = client.post("/api/qc/cam1/enable", headers=auth)

    assert resp.status_code == 403


def test_disable_requires_admin(client, auth_headers):
    auth, _ = auth_headers(UserRole.viewer, username="viewer1")

    resp = client.post("/api/qc/cam1/disable", headers=auth)

    assert resp.status_code == 403


def test_admin_enable_then_see_it_in_status(client, auth_headers):
    auth, _ = auth_headers(UserRole.admin, username="admin1")

    resp = client.post("/api/qc/cam1/enable", headers=auth)
    assert resp.status_code == 200
    assert resp.json() == {"path": "cam1", "monitoring": True}

    status = client.get("/api/qc/status", headers=auth).json()
    assert status["monitored_paths"] == ["cam1"]


def test_admin_disable_removes_it_from_status(client, auth_headers):
    auth, _ = auth_headers(UserRole.admin, username="admin1")
    client.post("/api/qc/cam1/enable", headers=auth)

    resp = client.post("/api/qc/cam1/disable", headers=auth)
    assert resp.status_code == 200
    assert resp.json() == {"path": "cam1", "monitoring": False}

    status = client.get("/api/qc/status", headers=auth).json()
    assert status["monitored_paths"] == []
