"""
Router tests for /api/hls — serves ffmpeg-generated HLS files from disk.
No auth (watching a live stream isn't privileged here), so the
path-traversal guard is the only thing protecting this endpoint; that's
the primary thing under test.
"""

from __future__ import annotations

import pytest


@pytest.fixture
def hls_dir(monkeypatch, tmp_path):
    monkeypatch.setattr("backend.routers.hls_proxy.HLS_DIR", str(tmp_path))
    return tmp_path


def test_missing_file_is_404(client, hls_dir):
    resp = client.get("/api/hls/cam1/index.m3u8")
    assert resp.status_code == 404


def test_serves_manifest_with_correct_headers(client, hls_dir):
    stream_dir = hls_dir / "cam1"
    stream_dir.mkdir()
    (stream_dir / "index.m3u8").write_text("#EXTM3U\n#EXT-X-VERSION:3\n")

    resp = client.get("/api/hls/cam1/index.m3u8")

    assert resp.status_code == 200
    assert resp.headers["content-type"] == "application/vnd.apple.mpegurl"
    assert resp.headers["cache-control"] == "no-cache"
    assert resp.headers["access-control-allow-origin"] == "*"
    assert "#EXTM3U" in resp.text


def test_serves_segment_file(client, hls_dir):
    stream_dir = hls_dir / "cam1"
    stream_dir.mkdir()
    (stream_dir / "seg0.ts").write_bytes(b"\x47fake-ts-data")

    resp = client.get("/api/hls/cam1/seg0.ts")

    assert resp.status_code == 200
    assert resp.headers["content-type"] == "video/mp2t"
    assert resp.content == b"\x47fake-ts-data"


def test_path_traversal_via_filename_is_rejected(client, hls_dir, tmp_path):
    # A file genuinely outside HLS_DIR that a traversal attempt would try
    # to reach, so a bug here shows up as a 200 with real file content
    # rather than an ambiguous 404.
    secret = tmp_path.parent / "secret.txt"
    secret.write_text("should never be served")

    resp = client.get("/api/hls/cam1/../../secret.txt")

    assert resp.status_code in (400, 404)
    assert b"should never be served" not in resp.content

    secret.unlink()


def test_path_traversal_via_path_name_is_rejected(client, hls_dir, tmp_path):
    secret = tmp_path.parent / "secret2.txt"
    secret.write_text("also never served")

    resp = client.get("/api/hls/../secret2.txt/x")

    assert resp.status_code in (400, 404)
    assert b"also never served" not in resp.content

    secret.unlink()
