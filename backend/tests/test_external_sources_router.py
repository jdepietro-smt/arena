"""
Router tests for /api/sources — external SRT/YouTube source CRUD and the
YouTube cookies file management endpoints. The debug/* endpoints (Docker
provider health check, GitHub plugin download, live mediamtx path
inspection) aren't covered — they hit real external services rather than
app logic.

ExternalSourceManager.add() would otherwise spawn a real yt-dlp/ffmpeg
process, so it's replaced with a fake — routers/external_sources.py
imports get_external_sources by name at module load time, so the patch
target is the router module's own reference to it.
"""

from __future__ import annotations

import pytest

from backend.models import UserRole


class FakeExternalSources:
    def __init__(self):
        self._sources: dict[str, dict] = {}

    async def add(self, name, url):
        if name in self._sources:
            raise ValueError(f"Source '{name}' already exists")
        self._sources[name] = {
            "name": name, "url": url, "status": "starting",
            "last_error": None, "age_seconds": 0.0,
        }

    def list(self):
        return list(self._sources.values())

    async def remove(self, name):
        return self._sources.pop(name, None) is not None


@pytest.fixture
def fake_sources(monkeypatch):
    fake = FakeExternalSources()
    monkeypatch.setattr("backend.routers.external_sources.get_external_sources", lambda: fake)
    return fake


@pytest.fixture
def cookies_path(monkeypatch, tmp_path):
    path = tmp_path / "youtube_cookies.txt"
    monkeypatch.setattr("backend.routers.external_sources.COOKIES_PATH", str(path))
    return path


def test_add_source_requires_auth(client, fake_sources):
    resp = client.post("/api/sources", json={"name": "cam1", "url": "srt://example.com:9000"})
    assert resp.status_code == 401


def test_add_and_list_source(client, auth_headers, fake_sources):
    auth, _ = auth_headers(UserRole.viewer, username="viewer1")

    create_resp = client.post(
        "/api/sources", headers=auth,
        json={"name": "cam1", "url": "srt://example.com:9000"},
    )
    assert create_resp.status_code == 201
    assert create_resp.json()["name"] == "cam1"

    list_resp = client.get("/api/sources", headers=auth)
    assert list_resp.status_code == 200
    assert any(s["name"] == "cam1" for s in list_resp.json())


def test_add_source_rejects_invalid_name(client, auth_headers, fake_sources):
    auth, _ = auth_headers(UserRole.viewer, username="viewer1")

    resp = client.post(
        "/api/sources", headers=auth,
        json={"name": "not a valid name!", "url": "srt://example.com:9000"},
    )

    assert resp.status_code == 400


def test_add_duplicate_source_is_409(client, auth_headers, fake_sources):
    auth, _ = auth_headers(UserRole.viewer, username="viewer1")
    payload = {"name": "cam1", "url": "srt://example.com:9000"}

    client.post("/api/sources", headers=auth, json=payload)
    resp = client.post("/api/sources", headers=auth, json=payload)

    assert resp.status_code == 409


def test_remove_source(client, auth_headers, fake_sources):
    auth, _ = auth_headers(UserRole.viewer, username="viewer1")
    client.post("/api/sources", headers=auth, json={"name": "cam1", "url": "srt://example.com:9000"})

    resp = client.delete("/api/sources/cam1", headers=auth)

    assert resp.status_code == 200
    assert resp.json() == {"removed": "cam1"}


def test_remove_nonexistent_source_is_404(client, auth_headers, fake_sources):
    auth, _ = auth_headers(UserRole.viewer, username="viewer1")

    resp = client.delete("/api/sources/nope", headers=auth)

    assert resp.status_code == 404


def test_cookies_status_when_absent(client, auth_headers, cookies_path):
    auth, _ = auth_headers(UserRole.viewer, username="viewer1")

    resp = client.get("/api/sources/youtube-cookies/status", headers=auth)

    assert resp.status_code == 200
    assert resp.json() == {"present": False}


def test_upload_cookies_requires_admin(client, auth_headers, cookies_path):
    auth, _ = auth_headers(UserRole.viewer, username="viewer1")

    resp = client.post(
        "/api/sources/youtube-cookies", headers=auth,
        files={"file": ("cookies.txt", b"# Netscape HTTP Cookie File\n", "text/plain")},
    )

    assert resp.status_code == 403


def test_upload_and_status_and_delete_cookies(client, auth_headers, cookies_path):
    auth, _ = auth_headers(UserRole.admin, username="admin1")
    netscape_cookie = (
        "# Netscape HTTP Cookie File\n"
        ".youtube.com\tTRUE\t/\tTRUE\t2147483647\tSID\tfake-session-value\n"
    )

    upload_resp = client.post(
        "/api/sources/youtube-cookies", headers=auth,
        files={"file": ("cookies.txt", netscape_cookie.encode(), "text/plain")},
    )
    assert upload_resp.status_code == 200
    assert upload_resp.json()["saved"] is True

    status_resp = client.get("/api/sources/youtube-cookies/status", headers=auth)
    body = status_resp.json()
    assert body["present"] is True
    assert body["looks_like_netscape_format"] is True
    assert body["youtube_cookie_lines"] == 1
    assert body["has_session_cookie"] is True

    delete_resp = client.delete("/api/sources/youtube-cookies", headers=auth)
    assert delete_resp.status_code == 200
    assert delete_resp.json() == {"removed": True}

    delete_again_resp = client.delete("/api/sources/youtube-cookies", headers=auth)
    assert delete_again_resp.json() == {"removed": False}


def test_upload_cookies_rejects_empty_file(client, auth_headers, cookies_path):
    auth, _ = auth_headers(UserRole.admin, username="admin1")

    resp = client.post(
        "/api/sources/youtube-cookies", headers=auth,
        files={"file": ("cookies.txt", b"", "text/plain")},
    )

    assert resp.status_code == 400


def test_upload_cookies_rejects_oversized_file(client, auth_headers, cookies_path):
    auth, _ = auth_headers(UserRole.admin, username="admin1")
    too_big = b"x" * (256 * 1024 + 1)

    resp = client.post(
        "/api/sources/youtube-cookies", headers=auth,
        files={"file": ("cookies.txt", too_big, "text/plain")},
    )

    assert resp.status_code == 400
