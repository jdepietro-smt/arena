"""
Router tests for /api/whep — SDP signaling proxy to mediamtx's WHEP
endpoint. httpx.AsyncClient is constructed inline inside the handler
(not an injectable dependency), so it's replaced at the module's
`httpx.AsyncClient` attribute rather than via dependency_overrides.
"""

from __future__ import annotations

import httpx
import pytest


class _FakeResponse:
    def __init__(self, status_code=201, content=b"v=0\r\n...", headers=None):
        self.status_code = status_code
        self.content = content
        self.headers = headers or {"Content-Type": "application/sdp"}


class _FakeAsyncClient:
    def __init__(self, response=None, raise_error=None):
        self._response = response or _FakeResponse()
        self._raise_error = raise_error

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False

    async def post(self, url, content=None, headers=None, timeout=None):
        if self._raise_error:
            raise self._raise_error
        return self._response


def _patch_client(monkeypatch, response=None, raise_error=None):
    monkeypatch.setattr(
        "backend.routers.whep_proxy.httpx.AsyncClient",
        lambda *a, **k: _FakeAsyncClient(response=response, raise_error=raise_error),
    )


def test_get_whep_redirects_to_watch_page(client):
    resp = client.get("/api/whep/cam1/whep", follow_redirects=False)

    assert resp.status_code == 302
    assert resp.headers["location"] == "/watch/cam1"


def test_post_whep_proxies_sdp_answer(client, monkeypatch):
    _patch_client(monkeypatch, response=_FakeResponse(status_code=201, content=b"v=0\r\nanswer-sdp"))

    resp = client.post(
        "/api/whep/cam1/whep",
        content=b"v=0\r\noffer-sdp",
        headers={"Content-Type": "application/sdp"},
    )

    assert resp.status_code == 201
    assert resp.content == b"v=0\r\nanswer-sdp"
    assert resp.headers["content-type"] == "application/sdp"


def test_post_whep_forwards_location_header(client, monkeypatch):
    _patch_client(
        monkeypatch,
        response=_FakeResponse(
            status_code=201,
            headers={"Content-Type": "application/sdp", "Location": "/whep/cam1/session123"},
        ),
    )

    resp = client.post("/api/whep/cam1/whep", content=b"offer")

    assert resp.headers["location"] == "/whep/cam1/session123"


def test_post_whep_503_when_mediamtx_unreachable(client, monkeypatch):
    _patch_client(monkeypatch, raise_error=httpx.ConnectError("connection refused"))

    resp = client.post("/api/whep/cam1/whep", content=b"offer")

    assert resp.status_code == 503
    assert b"mediamtx unreachable" in resp.content
