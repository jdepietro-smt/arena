"""
Router tests for /api/streams — list/detail/preview-url/presets and
recording start/stop. This router talks to MediaMTX over HTTP (via
MediaMTXClient) and to the recorder service (which spawns real ffmpeg
processes), so both are faked out here rather than exercised for real:

- MediaMTXClient is swapped via FastAPI's dependency_overrides for a
  stub returning canned dicts shaped like the real v1 API responses.
- services.recorder.start_recording/stop_recording are monkeypatched at
  the module level — routers/streams.py imports them lazily
  (`from ..services.recorder import start_recording as _start`) inside
  the endpoint function, so patching the module attribute before the
  request is enough; no need to reach into the router module itself.
"""

from __future__ import annotations

from datetime import datetime

import pytest

from backend.main import app
from backend.models import Recording, RecordingStatus, UserRole
from backend.services.mediamtx import MediaMTXError, get_client


class FakeMediaMTXClient:
    def __init__(self, paths=None, connections=None, path_errors=None):
        self._paths = paths if paths is not None else []
        self._connections = connections if connections is not None else {}
        # Map of path_name -> MediaMTXError to raise from get_path().
        self._path_errors = path_errors or {}

    async def get_paths(self):
        return self._paths

    async def get_path(self, path_name):
        if path_name in self._path_errors:
            raise self._path_errors[path_name]
        for p in self._paths:
            if p.get("name") == path_name:
                return p
        raise MediaMTXError(404, f"path '{path_name}' not found")

    async def get_connections(self):
        return self._connections


@pytest.fixture
def fake_client():
    stub = FakeMediaMTXClient()
    app.dependency_overrides[get_client] = lambda: stub
    yield stub
    app.dependency_overrides.pop(get_client, None)


def _path(name, ready=True, readers=None, bytes_received=0, bytes_sent=0, source_type="srtConn"):
    return {
        "name": name,
        "ready": ready,
        "readyTime": "2026-01-01T00:00:00Z" if ready else None,
        "readers": readers or [],
        "bytesReceived": bytes_received,
        "bytesSent": bytes_sent,
        "source": {"type": source_type, "remoteAddr": "10.0.0.5:1234"},
    }


def test_list_streams_requires_auth(client, fake_client):
    resp = client.get("/api/streams")
    assert resp.status_code == 401


def test_list_streams_returns_enriched_paths(client, auth_headers, fake_client):
    auth, _ = auth_headers(UserRole.viewer, username="viewer1")
    fake_client._paths = [_path("cam1"), _path("cam2", ready=False)]

    resp = client.get("/api/streams", headers=auth)

    assert resp.status_code == 200
    body = resp.json()
    names = {s["path"] for s in body}
    assert names == {"cam1", "cam2"}
    cam1 = next(s for s in body if s["path"] == "cam1")
    assert cam1["ready"] is True
    assert cam1["recording"] is False
    assert cam1["preview_urls"]["hls_url"] == "/api/hls/cam1/index.m3u8"


def test_list_streams_excludes_multiview_composites(client, auth_headers, fake_client):
    auth, _ = auth_headers(UserRole.viewer, username="viewer1")
    fake_client._paths = [_path("cam1"), _path("mv_abc123")]

    resp = client.get("/api/streams", headers=auth)

    assert resp.status_code == 200
    names = {s["path"] for s in resp.json()}
    assert names == {"cam1"}


def test_list_streams_flags_active_recording(client, auth_headers, fake_client, db_session):
    auth, _ = auth_headers(UserRole.viewer, username="viewer1")
    fake_client._paths = [_path("cam1")]
    db_session.add(Recording(
        stream_path="cam1", filename="cam1_x.mp4",
        status=RecordingStatus.recording, started_at=datetime.utcnow(),
    ))
    db_session.commit()

    resp = client.get("/api/streams", headers=auth)

    assert resp.status_code == 200
    cam1 = next(s for s in resp.json() if s["path"] == "cam1")
    assert cam1["recording"] is True


def test_list_streams_502_when_mediamtx_down(client, auth_headers, fake_client, monkeypatch):
    auth, _ = auth_headers(UserRole.viewer, username="viewer1")

    async def _boom():
        raise MediaMTXError(0, "connection refused")

    monkeypatch.setattr(fake_client, "get_paths", _boom)

    resp = client.get("/api/streams", headers=auth)

    assert resp.status_code == 502


def test_get_stream_detail(client, auth_headers, fake_client):
    auth, _ = auth_headers(UserRole.viewer, username="viewer1")
    fake_client._paths = [_path("cam1")]
    fake_client._connections = {
        "srt": [{"path": "cam1", "id": "abc"}, {"path": "other", "id": "def"}],
    }

    resp = client.get("/api/streams/cam1", headers=auth)

    assert resp.status_code == 200
    body = resp.json()
    assert body["path"] == "cam1"
    assert body["connections"]["srt"] == [{"path": "cam1", "id": "abc"}]


def test_get_stream_detail_404_for_unknown_path(client, auth_headers, fake_client):
    auth, _ = auth_headers(UserRole.viewer, username="viewer1")

    resp = client.get("/api/streams/nope", headers=auth)

    assert resp.status_code == 404


def test_preview_url_shape(client, auth_headers, fake_client):
    auth, _ = auth_headers(UserRole.viewer, username="viewer1")

    resp = client.get("/api/streams/cam1/preview-url", headers=auth)

    assert resp.status_code == 200
    body = resp.json()
    assert body["hls_url"] == "/api/hls/cam1/index.m3u8"
    assert "srt://" in body["srt_url"]
    assert "streamid=read:cam1" in body["srt_url"]


def test_create_list_delete_preset(client, auth_headers, fake_client):
    auth, _ = auth_headers(UserRole.viewer, username="viewer1")

    create_resp = client.post(
        "/api/streams/preset",
        headers=auth,
        json={"name": "sports-preset", "srt_url": "srt://example.com:9000", "description": "d", "tags": ["sports"]},
    )
    assert create_resp.status_code == 201
    preset_id = create_resp.json()["id"]

    list_resp = client.get("/api/streams/presets", headers=auth)
    assert list_resp.status_code == 200
    assert any(p["name"] == "sports-preset" for p in list_resp.json())

    delete_resp = client.delete(f"/api/streams/presets/{preset_id}", headers=auth)
    assert delete_resp.status_code == 200

    list_resp2 = client.get("/api/streams/presets", headers=auth)
    assert not any(p["name"] == "sports-preset" for p in list_resp2.json())


def test_create_duplicate_preset_is_409(client, auth_headers, fake_client):
    auth, _ = auth_headers(UserRole.viewer, username="viewer1")
    payload = {"name": "dup-preset", "srt_url": "srt://example.com:9000", "description": None, "tags": []}

    client.post("/api/streams/preset", headers=auth, json=payload)
    resp = client.post("/api/streams/preset", headers=auth, json=payload)

    assert resp.status_code == 409


def test_delete_nonexistent_preset_is_404(client, auth_headers, fake_client):
    auth, _ = auth_headers(UserRole.viewer, username="viewer1")

    resp = client.delete("/api/streams/presets/999999", headers=auth)

    assert resp.status_code == 404


def test_start_recording_404_when_stream_missing(client, auth_headers, fake_client):
    auth, _ = auth_headers(UserRole.viewer, username="viewer1")

    resp = client.post("/api/streams/nope/start-recording", headers=auth)

    assert resp.status_code == 404


def test_start_recording_409_when_already_recording(client, auth_headers, fake_client, db_session):
    auth, _ = auth_headers(UserRole.viewer, username="viewer1")
    fake_client._paths = [_path("cam1")]
    db_session.add(Recording(
        stream_path="cam1", filename="cam1_x.mp4",
        status=RecordingStatus.recording, started_at=datetime.utcnow(),
    ))
    db_session.commit()

    resp = client.post("/api/streams/cam1/start-recording", headers=auth)

    assert resp.status_code == 409


def test_start_recording_success(client, auth_headers, fake_client, monkeypatch):
    auth, _ = auth_headers(UserRole.viewer, username="viewer1")
    fake_client._paths = [_path("cam1")]

    async def _fake_start(session, stream_path):
        rec = Recording(
            stream_path=stream_path, filename=f"{stream_path}_fake.mp4",
            status=RecordingStatus.recording, started_at=datetime.utcnow(),
        )
        session.add(rec)
        session.commit()
        session.refresh(rec)
        return rec

    monkeypatch.setattr("backend.services.recorder.start_recording", _fake_start)

    resp = client.post("/api/streams/cam1/start-recording", headers=auth)

    assert resp.status_code == 200
    body = resp.json()
    assert body["stream_path"] == "cam1"
    assert body["filename"] == "cam1_fake.mp4"


def test_stop_recording_404_when_none_active(client, auth_headers, fake_client):
    auth, _ = auth_headers(UserRole.viewer, username="viewer1")

    resp = client.post("/api/streams/cam1/stop-recording", headers=auth)

    assert resp.status_code == 404


def test_stop_recording_success(client, auth_headers, fake_client, monkeypatch, db_session):
    auth, _ = auth_headers(UserRole.viewer, username="viewer1")
    rec = Recording(
        stream_path="cam1", filename="cam1_x.mp4",
        status=RecordingStatus.recording, started_at=datetime.utcnow(),
    )
    db_session.add(rec)
    db_session.commit()
    db_session.refresh(rec)

    async def _fake_stop(session, recording_id):
        target = session.get(Recording, recording_id)
        target.status = RecordingStatus.complete
        target.ended_at = datetime.utcnow()
        session.add(target)
        session.commit()
        session.refresh(target)
        return target

    monkeypatch.setattr("backend.services.recorder.stop_recording", _fake_stop)

    resp = client.post("/api/streams/cam1/stop-recording", headers=auth)

    assert resp.status_code == 200
    assert resp.json()["status"] == "complete"
