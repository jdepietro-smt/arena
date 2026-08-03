"""
Router tests for /api/recordings — list/get/delete/download/stream/
thumbnail. The debug/* endpoints (ffprobe, mediamtx path-config, HLS
generator status) shell out to external tools or a live mediamtx instance
and aren't covered here; the file-serving and DB-CRUD surface is.
"""

from __future__ import annotations

from datetime import datetime, timedelta

import pytest
from sqlmodel import Session

from backend.database import engine
from backend.models import Recording, RecordingConfig, RecordingStatus, UserRole


@pytest.fixture
def recordings_dir(tmp_path):
    """Point RecordingConfig.output_dir at a fresh tmp directory for the
    duration of one test, and reset the singleton row afterward."""
    with Session(engine) as session:
        config = session.get(RecordingConfig, 1)
        if config is None:
            config = RecordingConfig(id=1)
        config.output_dir = str(tmp_path)
        session.add(config)
        session.commit()

    yield tmp_path

    with Session(engine) as session:
        config = session.get(RecordingConfig, 1)
        if config is not None:
            session.delete(config)
            session.commit()


def _make_recording(stream_path="cam1", filename="cam1_20260101_120000.mp4", **kwargs):
    with Session(engine) as session:
        rec = Recording(
            stream_path=stream_path,
            filename=filename,
            size_bytes=kwargs.get("size_bytes", 1024),
            duration_seconds=kwargs.get("duration_seconds", 12.5),
            started_at=kwargs.get("started_at", datetime.utcnow() - timedelta(minutes=5)),
            ended_at=kwargs.get("ended_at", datetime.utcnow()),
            status=kwargs.get("status", RecordingStatus.complete),
        )
        session.add(rec)
        session.commit()
        session.refresh(rec)
        return rec


def test_list_recordings_requires_auth(client):
    resp = client.get("/api/recordings")
    assert resp.status_code == 401


def test_list_recordings(client, auth_headers, recordings_dir):
    auth, _ = auth_headers(UserRole.viewer, username="viewer1")
    _make_recording(stream_path="cam1")
    _make_recording(stream_path="cam2")

    resp = client.get("/api/recordings", headers=auth)

    assert resp.status_code == 200
    paths = {r["stream_path"] for r in resp.json()}
    assert paths == {"cam1", "cam2"}


def test_list_recordings_filters_by_stream_path(client, auth_headers, recordings_dir):
    auth, _ = auth_headers(UserRole.viewer, username="viewer1")
    _make_recording(stream_path="cam1", filename="a.mp4")
    _make_recording(stream_path="cam2", filename="b.mp4")

    resp = client.get("/api/recordings", params={"stream_path": "cam1"}, headers=auth)

    assert resp.status_code == 200
    body = resp.json()
    assert len(body) == 1
    assert body[0]["stream_path"] == "cam1"


def test_get_recording_metadata(client, auth_headers, recordings_dir):
    auth, _ = auth_headers(UserRole.viewer, username="viewer1")
    rec = _make_recording()

    resp = client.get(f"/api/recordings/{rec.id}", headers=auth)

    assert resp.status_code == 200
    assert resp.json()["filename"] == rec.filename


def test_get_nonexistent_recording_is_404(client, auth_headers, recordings_dir):
    auth, _ = auth_headers(UserRole.viewer, username="viewer1")

    resp = client.get("/api/recordings/999999", headers=auth)

    assert resp.status_code == 404


def test_delete_requires_admin(client, auth_headers, recordings_dir):
    auth, _ = auth_headers(UserRole.viewer, username="viewer1")
    rec = _make_recording()

    resp = client.delete(f"/api/recordings/{rec.id}", headers=auth)

    assert resp.status_code == 403


def test_admin_delete_removes_file_and_db_row(client, auth_headers, recordings_dir):
    auth, _ = auth_headers(UserRole.admin, username="admin1")
    rec = _make_recording(filename="to-delete.mp4")
    file_path = recordings_dir / "to-delete.mp4"
    file_path.write_bytes(b"fake video data")

    resp = client.delete(f"/api/recordings/{rec.id}", headers=auth)

    assert resp.status_code == 200
    assert not file_path.exists()
    follow_up = client.get(f"/api/recordings/{rec.id}", headers=auth)
    assert follow_up.status_code == 404


def test_admin_delete_succeeds_even_if_file_already_missing(client, auth_headers, recordings_dir):
    auth, _ = auth_headers(UserRole.admin, username="admin1")
    rec = _make_recording(filename="already-gone.mp4")

    resp = client.delete(f"/api/recordings/{rec.id}", headers=auth)

    assert resp.status_code == 200


def test_download_missing_file_is_404(client, auth_headers, recordings_dir):
    auth, _ = auth_headers(UserRole.viewer, username="viewer1")
    rec = _make_recording(filename="never-written.mp4")

    resp = client.get(f"/api/recordings/{rec.id}/download", headers=auth)

    assert resp.status_code == 404


def test_download_existing_file(client, auth_headers, recordings_dir):
    auth, _ = auth_headers(UserRole.viewer, username="viewer1")
    rec = _make_recording(filename="real.mp4")
    (recordings_dir / "real.mp4").write_bytes(b"0123456789")

    resp = client.get(f"/api/recordings/{rec.id}/download", headers=auth)

    assert resp.status_code == 200
    assert resp.content == b"0123456789"
    assert "attachment" in resp.headers["content-disposition"]


def test_stream_recording_supports_range_requests(client, auth_headers, recordings_dir):
    auth, _ = auth_headers(UserRole.viewer, username="viewer1")
    rec = _make_recording(filename="seekable.mp4")
    (recordings_dir / "seekable.mp4").write_bytes(b"0123456789")

    resp = client.get(
        f"/api/recordings/{rec.id}/stream",
        headers={**auth, "Range": "bytes=2-5"},
    )

    assert resp.status_code == 206
    assert resp.content == b"2345"
    assert resp.headers["content-range"] == "bytes 2-5/10"


def test_stream_recording_via_token_query_param(client, auth_headers, recordings_dir):
    """<video> elements can't send an Authorization header — auth accepts
    a `token` query param instead (get_current_user_flexible)."""
    auth, _ = auth_headers(UserRole.viewer, username="viewer1")
    token = auth["Authorization"].split(" ", 1)[1]
    rec = _make_recording(filename="via-token.mp4")
    (recordings_dir / "via-token.mp4").write_bytes(b"hello world")

    resp = client.get(f"/api/recordings/{rec.id}/stream", params={"token": token})

    assert resp.status_code == 200
    assert resp.content == b"hello world"


def test_thumbnail_missing_is_404(client, auth_headers, recordings_dir):
    auth, _ = auth_headers(UserRole.viewer, username="viewer1")
    rec = _make_recording(filename="no-thumb.mp4")

    resp = client.get(f"/api/recordings/{rec.id}/thumbnail", headers=auth)

    assert resp.status_code == 404


def test_thumbnail_present(client, auth_headers, recordings_dir):
    auth, _ = auth_headers(UserRole.viewer, username="viewer1")
    rec = _make_recording(filename="has-thumb.mp4")
    (recordings_dir / "has-thumb.jpg").write_bytes(b"\xff\xd8\xff\xd9")  # minimal JPEG-ish bytes

    resp = client.get(f"/api/recordings/{rec.id}/thumbnail", headers=auth)

    assert resp.status_code == 200
    assert resp.headers["content-type"] == "image/jpeg"
