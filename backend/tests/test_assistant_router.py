"""
Router tests for /api/assistant. The Anthropic call itself is monkeypatched
(services.assistant.ask) so these never make a real network request; the
MediaMTX client is faked the same way test_streams_router.py does it, since
the assistant route builds its context by calling list_streams() directly.
"""

from __future__ import annotations

import pytest

from backend.main import app
from backend.models import UserRole
from backend.services import assistant as assistant_service
from backend.services.mediamtx import get_client


class FakeMediaMTXClient:
    def __init__(self, paths=None):
        self._paths = paths if paths is not None else []

    async def get_paths(self):
        return self._paths


@pytest.fixture
def fake_client():
    stub = FakeMediaMTXClient()
    app.dependency_overrides[get_client] = lambda: stub
    yield stub
    app.dependency_overrides.pop(get_client, None)


def _path(name, ready=True):
    return {
        "name": name,
        "ready": ready,
        "readyTime": "2026-01-01T00:00:00Z" if ready else None,
        "readers": [],
        "bytesReceived": 0,
        "bytesSent": 0,
        "source": {"type": "srtConn", "remoteAddr": "10.0.0.5:1234"},
    }


def test_query_requires_auth(client, fake_client):
    resp = client.post("/api/assistant/query", json={"question": "why is cam1 down?"})
    assert resp.status_code == 401


def test_query_rejects_empty_question(client, auth_headers, fake_client):
    auth, _ = auth_headers(UserRole.viewer, username="viewer1")

    resp = client.post("/api/assistant/query", headers=auth, json={"question": "   "})

    assert resp.status_code == 400


def test_query_returns_503_when_assistant_unconfigured(client, auth_headers, fake_client, monkeypatch):
    auth, _ = auth_headers(UserRole.viewer, username="viewer1")

    async def _boom(question, context):
        raise RuntimeError("The ops assistant isn't configured — set ANTHROPIC_API_KEY.")
    monkeypatch.setattr(assistant_service, "ask", _boom)

    resp = client.post("/api/assistant/query", headers=auth, json={"question": "any streams down?"})

    assert resp.status_code == 503
    assert "ANTHROPIC_API_KEY" in resp.json()["detail"]


def test_query_passes_live_stream_context_to_the_assistant(client, auth_headers, fake_client, monkeypatch):
    auth, _ = auth_headers(UserRole.viewer, username="viewer1")
    fake_client._paths = [_path("cam1", ready=True), _path("cam2", ready=False)]

    captured = {}

    async def _fake_ask(question, context):
        captured["question"] = question
        captured["context"] = context
        return "cam2 is offline; cam1 is live."
    monkeypatch.setattr(assistant_service, "ask", _fake_ask)

    resp = client.post("/api/assistant/query", headers=auth, json={"question": "what's the status?"})

    assert resp.status_code == 200
    assert resp.json() == {"answer": "cam2 is offline; cam1 is live."}
    assert captured["question"] == "what's the status?"
    stream_paths = {s["path"]: s["live"] for s in captured["context"]["streams"]}
    assert stream_paths == {"cam1": True, "cam2": False}
    assert "down_streams" in captured["context"]
    assert "recent_events" in captured["context"]
