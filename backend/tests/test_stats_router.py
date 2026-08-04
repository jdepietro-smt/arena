"""
Router tests for /api/stats — REST snapshot/history endpoints and the
stats WebSocket. MediaMTXClient is faked the same way test_streams_router
does (dependency_overrides on get_client); the WebSocket is exercised
with TestClient's real websocket_connect, since it's a full ASGI
connection rather than a mockable dependency chain.
"""

from __future__ import annotations

import pytest
from jose import jwt

from backend.config import settings
from backend.main import app
from backend.models import UserRole
from backend.services.mediamtx import MediaMTXError, get_client


class FakeMediaMTXClient:
    def __init__(self, paths=None, path_errors=None):
        self._paths = paths if paths is not None else []
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


@pytest.fixture
def fake_client():
    stub = FakeMediaMTXClient()
    app.dependency_overrides[get_client] = lambda: stub
    yield stub
    app.dependency_overrides.pop(get_client, None)


def _path(name, ready=True, bytes_received=1000, bytes_sent=2000, rtt=5.0, packet_loss=0.1, readers=None):
    return {
        "name": name,
        "ready": ready,
        "readers": readers or [],
        "bytesReceived": bytes_received,
        "bytesSent": bytes_sent,
        "source": {"rtt": rtt, "packetLoss": packet_loss},
    }


def test_stats_summary_requires_auth(client, fake_client):
    resp = client.get("/api/stats/summary")
    assert resp.status_code == 401


def test_stats_summary_only_includes_ready_paths(client, auth_headers, fake_client):
    auth, _ = auth_headers(UserRole.viewer, username="viewer1")
    fake_client._paths = [_path("cam1", ready=True), _path("cam2", ready=False)]

    resp = client.get("/api/stats/summary", headers=auth)

    assert resp.status_code == 200
    paths = {s["path"] for s in resp.json()}
    assert paths == {"cam1"}


def test_stats_summary_derives_rtt_and_loss_from_source(client, auth_headers, fake_client):
    auth, _ = auth_headers(UserRole.viewer, username="viewer1")
    fake_client._paths = [_path("cam1", rtt=12.5, packet_loss=1.2)]

    resp = client.get("/api/stats/summary", headers=auth)

    body = resp.json()[0]
    assert body["rtt_ms"] == 12.5
    assert body["packet_loss_pct"] == 1.2


def test_stats_summary_502_when_mediamtx_down(client, auth_headers, fake_client, monkeypatch):
    auth, _ = auth_headers(UserRole.viewer, username="viewer1")

    async def _boom():
        raise MediaMTXError(0, "connection refused")

    monkeypatch.setattr(fake_client, "get_paths", _boom)

    resp = client.get("/api/stats/summary", headers=auth)

    assert resp.status_code == 502


def test_single_stream_stats(client, auth_headers, fake_client):
    auth, _ = auth_headers(UserRole.viewer, username="viewer1")
    fake_client._paths = [_path("cam1")]

    resp = client.get("/api/stats/cam1", headers=auth)

    assert resp.status_code == 200
    assert resp.json()["path"] == "cam1"


def test_single_stream_stats_404_for_unknown_path(client, auth_headers, fake_client):
    auth, _ = auth_headers(UserRole.viewer, username="viewer1")

    resp = client.get("/api/stats/nope", headers=auth)

    assert resp.status_code == 404


def test_history_requires_auth(client):
    resp = client.get("/api/stats/cam1/history")
    assert resp.status_code == 401


def test_history_returns_list(client, auth_headers):
    auth, _ = auth_headers(UserRole.viewer, username="viewer1")

    resp = client.get("/api/stats/cam1/history", headers=auth)

    assert resp.status_code == 200
    assert resp.json() == []  # no live collector data recorded for this path in tests


def test_history_rejects_seconds_over_3600(client, auth_headers):
    auth, _ = auth_headers(UserRole.viewer, username="viewer1")

    resp = client.get("/api/stats/cam1/history", params={"seconds": 9999}, headers=auth)

    assert resp.status_code == 422


def test_uptime_requires_auth(client):
    resp = client.get("/api/stats/cam1/uptime")
    assert resp.status_code == 401


def test_uptime_returns_empty_list_with_no_recorded_samples(client, auth_headers):
    auth, _ = auth_headers(UserRole.viewer, username="viewer1")

    resp = client.get("/api/stats/cam1/uptime", headers=auth)

    assert resp.status_code == 200
    assert resp.json() == []


def test_uptime_returns_recorded_daily_percentages(client, auth_headers, db_session):
    from backend.models import StreamUptimeDaily

    db_session.add(StreamUptimeDaily(date="2026-01-01", stream_path="cam1", up_samples=9, total_samples=10))
    db_session.add(StreamUptimeDaily(date="2026-01-02", stream_path="cam1", up_samples=5, total_samples=10))
    db_session.add(StreamUptimeDaily(date="2026-01-01", stream_path="cam2", up_samples=1, total_samples=10))
    db_session.commit()
    auth, _ = auth_headers(UserRole.viewer, username="viewer1")

    resp = client.get("/api/stats/cam1/uptime", headers=auth)

    assert resp.status_code == 200
    body = resp.json()
    assert [d["date"] for d in body] == ["2026-01-01", "2026-01-02"]
    assert body[0]["uptime_pct"] == 90.0
    assert body[1]["uptime_pct"] == 50.0


def test_uptime_respects_days_param(client, auth_headers, db_session):
    from backend.models import StreamUptimeDaily

    for day in range(1, 6):
        db_session.add(StreamUptimeDaily(date=f"2026-01-{day:02d}", stream_path="cam1", up_samples=10, total_samples=10))
    db_session.commit()
    auth, _ = auth_headers(UserRole.viewer, username="viewer1")

    resp = client.get("/api/stats/cam1/uptime", params={"days": 2}, headers=auth)

    assert resp.status_code == 200
    assert [d["date"] for d in resp.json()] == ["2026-01-04", "2026-01-05"]


def test_websocket_rejects_missing_token(client, fake_client):
    from starlette.websockets import WebSocketDisconnect

    with pytest.raises(WebSocketDisconnect) as exc_info:
        with client.websocket_connect("/api/stats/ws"):
            pass
    assert exc_info.value.code == 4001


def test_websocket_rejects_invalid_token(client, fake_client):
    from starlette.websockets import WebSocketDisconnect

    with pytest.raises(WebSocketDisconnect) as exc_info:
        with client.websocket_connect("/api/stats/ws?token=not-a-real-token"):
            pass
    assert exc_info.value.code == 4001


def test_websocket_pushes_stats_for_valid_token(client, auth_headers, fake_client):
    auth, user = auth_headers(UserRole.viewer, username="viewer1")
    token = auth["Authorization"].split(" ", 1)[1]
    fake_client._paths = [_path("cam1")]

    with client.websocket_connect(f"/api/stats/ws?token={token}") as ws:
        payload = ws.receive_json()

    assert "ts" in payload
    assert any(s["path"] == "cam1" for s in payload["streams"])
