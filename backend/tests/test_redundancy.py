"""
Tests for backend.services.redundancy.RedundancyMonitor.

Same state-transition contract as AlertManager: notify once when a gateway
becomes degraded, once on recovery, never on every poll while it persists.
"degraded" covers three distinct conditions a real sdi_receive can report:
an unreachable stats endpoint, a dual-path gateway with only one leg up, and
a gateway (single- or dual-path) whose merged output never connected.
"""

from __future__ import annotations

from backend.models import RedundancyGateway
from backend.services.redundancy import RedundancyMonitor


class FakeResponse:
    def __init__(self, payload: dict) -> None:
        self._payload = payload

    def raise_for_status(self) -> None:
        pass

    def json(self) -> dict:
        return self._payload


class FakeHttpxClient:
    def __init__(self, payload: dict | None = None, raises: bool = False) -> None:
        self._payload = payload
        self._raises = raises

    async def get(self, url: str):
        if self._raises:
            raise ConnectionError("connection refused")
        return FakeResponse(self._payload)


def _gateway(**overrides) -> RedundancyGateway:
    defaults = dict(id=1, name="Truck 1", stats_url="http://10.0.1.5:6400/", stream_path=None, is_active=True)
    defaults.update(overrides)
    return RedundancyGateway(**defaults)


class TestPollOne:
    async def test_healthy_single_path_does_not_notify(self, monkeypatch):
        monitor = RedundancyMonitor()
        notified: list[str] = []
        monkeypatch.setattr(monitor, "_notify", _record(notified))
        gw = _gateway()
        client = FakeHttpxClient({"dual_path": False, "path1_up": True, "path2_up": False, "output_connected": True})

        await monitor._poll_one(client, gw)

        assert notified == []
        assert monitor._last[gw.id]["output_connected"] is True

    async def test_dual_path_one_leg_down_notifies_once(self, monkeypatch):
        monitor = RedundancyMonitor()
        notified: list[str] = []
        monkeypatch.setattr(monitor, "_notify", _record(notified))
        gw = _gateway()

        client = FakeHttpxClient({"dual_path": True, "path1_up": True, "path2_up": False, "output_connected": True})
        await monitor._poll_one(client, gw)
        assert len(notified) == 1
        assert "degraded" in notified[0]

        # Still degraded — must not notify again.
        await monitor._poll_one(client, gw)
        assert len(notified) == 1

    async def test_recovery_notifies_once(self, monkeypatch):
        monitor = RedundancyMonitor()
        notified: list[str] = []
        monkeypatch.setattr(monitor, "_notify", _record(notified))
        gw = _gateway()

        down = FakeHttpxClient({"dual_path": True, "path1_up": True, "path2_up": False, "output_connected": True})
        await monitor._poll_one(down, gw)
        assert len(notified) == 1

        up = FakeHttpxClient({"dual_path": True, "path1_up": True, "path2_up": True, "output_connected": True})
        await monitor._poll_one(up, gw)
        assert len(notified) == 2
        assert "recovered" in notified[1]

    async def test_output_never_connected_is_degraded_even_single_path(self, monkeypatch):
        """A single-path gateway that's up but whose downstream SRT output
        never connected is still fully failed — no output means no protected
        stream, dual-path or not."""
        monitor = RedundancyMonitor()
        notified: list[str] = []
        monkeypatch.setattr(monitor, "_notify", _record(notified))
        gw = _gateway()
        client = FakeHttpxClient({"dual_path": False, "path1_up": True, "path2_up": False, "output_connected": False})

        await monitor._poll_one(client, gw)

        assert len(notified) == 1
        assert "degraded" in notified[0]

    async def test_unreachable_endpoint_is_degraded_and_recovers(self, monkeypatch):
        monitor = RedundancyMonitor()
        notified: list[str] = []
        monkeypatch.setattr(monitor, "_notify", _record(notified))
        gw = _gateway()

        broken = FakeHttpxClient(raises=True)
        await monitor._poll_one(broken, gw)
        assert len(notified) == 1
        assert "unreachable" in notified[0]
        assert monitor._last[gw.id] is None

        healthy = FakeHttpxClient({"dual_path": False, "path1_up": True, "path2_up": False, "output_connected": True})
        await monitor._poll_one(healthy, gw)
        assert len(notified) == 2
        assert "recovered" in notified[1]


def _record(sink: list[str]):
    async def _fake_notify(text: str) -> None:
        sink.append(text)

    return _fake_notify
