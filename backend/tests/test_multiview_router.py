"""
Router tests for /api/multiview — composite-job lifecycle. The real
CompositorManager spawns an ffmpeg process per job, so it's replaced with
a fake here. routers/multiview.py imports get_compositor/get_job_log by
name at module load time (`from ..services.compositor import
get_compositor, get_job_log`), so patching those names on the router
module itself is what's needed — patching the service module's exports
wouldn't affect the reference the router already holds.
"""

from __future__ import annotations

import pytest

from backend.models import UserRole


class FakeCompositor:
    def __init__(self):
        self.jobs: dict[str, dict] = {}
        self._next_id = 1

    async def ensure_job(self, paths, audio_path, blank_slots):
        job_id = f"job{self._next_id}"
        self._next_id += 1
        self.jobs[job_id] = {
            "job_id": job_id, "paths": paths, "audio_path": audio_path,
            "running": True, "age_seconds": 0.0,
        }
        return job_id

    def list_jobs(self):
        return list(self.jobs.values())

    async def stop_job(self, job_id):
        return self.jobs.pop(job_id, None) is not None


@pytest.fixture
def fake_compositor(monkeypatch):
    fake = FakeCompositor()
    monkeypatch.setattr("backend.routers.multiview.get_compositor", lambda: fake)
    monkeypatch.setattr("backend.routers.multiview.get_job_log", lambda job_id: f"log for {job_id}")
    return fake


def test_create_job_needs_no_auth(client, fake_compositor):
    resp = client.post("/api/multiview/jobs", json={"paths": ["cam1", "cam2"]})

    assert resp.status_code == 200
    job_id = resp.json()["job_id"]
    assert job_id in fake_compositor.jobs


def test_create_job_rejects_empty_paths(client, fake_compositor):
    resp = client.post("/api/multiview/jobs", json={"paths": [" ", ""]})
    assert resp.status_code == 400


def test_create_job_rejects_audio_path_not_in_paths(client, fake_compositor):
    resp = client.post(
        "/api/multiview/jobs",
        json={"paths": ["cam1", "cam2"], "audio_path": "cam3"},
    )
    assert resp.status_code == 400


def test_list_jobs_requires_auth(client, fake_compositor):
    resp = client.get("/api/multiview/jobs")
    assert resp.status_code == 401


def test_list_jobs_after_create(client, auth_headers, fake_compositor):
    auth, _ = auth_headers(UserRole.viewer, username="viewer1")
    job_id = client.post("/api/multiview/jobs", json={"paths": ["cam1"]}).json()["job_id"]

    resp = client.get("/api/multiview/jobs", headers=auth)

    assert resp.status_code == 200
    assert any(j["job_id"] == job_id for j in resp.json())


def test_stop_job(client, auth_headers, fake_compositor):
    auth, _ = auth_headers(UserRole.viewer, username="viewer1")
    job_id = client.post("/api/multiview/jobs", json={"paths": ["cam1"]}).json()["job_id"]

    resp = client.delete(f"/api/multiview/jobs/{job_id}", headers=auth)

    assert resp.status_code == 200
    assert resp.json() == {"stopped": job_id}


def test_stop_nonexistent_job_is_404(client, auth_headers, fake_compositor):
    auth, _ = auth_headers(UserRole.viewer, username="viewer1")

    resp = client.delete("/api/multiview/jobs/nope", headers=auth)

    assert resp.status_code == 404


def test_job_log_requires_admin(client, auth_headers, fake_compositor):
    auth, _ = auth_headers(UserRole.viewer, username="viewer1")
    job_id = client.post("/api/multiview/jobs", json={"paths": ["cam1"]}).json()["job_id"]

    resp = client.get(f"/api/multiview/jobs/{job_id}/log", headers=auth)

    assert resp.status_code == 403


def test_job_log_as_admin(client, auth_headers, fake_compositor):
    auth, _ = auth_headers(UserRole.admin, username="admin1")
    job_id = client.post("/api/multiview/jobs", json={"paths": ["cam1"]}).json()["job_id"]

    resp = client.get(f"/api/multiview/jobs/{job_id}/log", headers=auth)

    assert resp.status_code == 200
    assert resp.json() == {"job_id": job_id, "log": f"log for {job_id}"}
