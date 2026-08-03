"""
Tests for services.stream_router.RouteManager — the ffmpeg relay-process
manager backing /api/routes' activate/deactivate. No real ffmpeg or real
process spawning: asyncio.create_subprocess_exec is faked, same pattern
as test_recorder.py.
"""

from __future__ import annotations

import asyncio

import pytest

from backend.models import StreamRoute
from backend.services import stream_router


class FakeProc:
    def __init__(self) -> None:
        self.pid = 1234
        self.returncode: int | None = None
        self._exited = asyncio.Event()

    def terminate(self) -> None:
        self.returncode = 0
        self._exited.set()

    def kill(self) -> None:
        self.returncode = -9
        self._exited.set()

    async def wait(self) -> int:
        await self._exited.wait()
        return self.returncode


@pytest.fixture
def fake_subprocess(monkeypatch):
    procs: list[FakeProc] = []

    async def _fake_exec(*_args, **_kwargs):
        proc = FakeProc()
        procs.append(proc)
        return proc

    monkeypatch.setattr(stream_router.asyncio, "create_subprocess_exec", _fake_exec)
    return procs


def _route(route_id=1, source_path="cam1", destinations=None):
    return StreamRoute(
        id=route_id, name=f"route{route_id}", source_path=source_path,
        destinations=destinations if destinations is not None else [],
    )


class TestCmdBuilder:
    def test_srt_destination_builds_srt_input_and_mpegts_output(self):
        manager = stream_router.RouteManager()
        cmd = manager._cmd("cam1", "srt://dest.example.com:9000")

        assert cmd[0] == "ffmpeg"
        assert any("srt://localhost:" in arg and "streamid=" in arg for arg in cmd)
        assert "srt://dest.example.com:9000" in cmd
        assert "mpegts" in cmd

    def test_non_srt_destination_builds_rtsp_input_and_flv_output(self):
        manager = stream_router.RouteManager()
        cmd = manager._cmd("cam1", "rtmp://dest.example.com/live/key")

        assert any("rtsp://localhost:8554/cam1" in arg for arg in cmd)
        assert "rtmp://dest.example.com/live/key" in cmd
        assert "flv" in cmd


class TestActivateDeactivate:
    @pytest.mark.asyncio
    async def test_activate_starts_one_relay_per_destination(self, fake_subprocess):
        manager = stream_router.RouteManager()
        route = _route(destinations=[
            {"type": "srt", "url": "srt://a.example.com:9000"},
            {"type": "srt", "url": "srt://b.example.com:9000"},
        ])

        await manager.activate(route)

        assert len(fake_subprocess) == 2
        assert await manager.is_running(route) is True

    @pytest.mark.asyncio
    async def test_activate_skips_destinations_with_no_url(self, fake_subprocess):
        manager = stream_router.RouteManager()
        route = _route(destinations=[{"type": "srt", "url": ""}, {"type": "srt"}])

        await manager.activate(route)

        assert len(fake_subprocess) == 0
        assert await manager.is_running(route) is False

    @pytest.mark.asyncio
    async def test_activate_with_no_destinations_is_a_noop(self, fake_subprocess):
        manager = stream_router.RouteManager()
        route = _route(destinations=[])

        await manager.activate(route)

        assert await manager.is_running(route) is False

    @pytest.mark.asyncio
    async def test_deactivate_stops_all_relays(self, fake_subprocess):
        manager = stream_router.RouteManager()
        route = _route(destinations=[{"type": "srt", "url": "srt://a.example.com:9000"}])
        await manager.activate(route)
        assert await manager.is_running(route) is True

        await manager.deactivate(route)

        assert await manager.is_running(route) is False
        assert fake_subprocess[0].returncode == 0

    @pytest.mark.asyncio
    async def test_deactivate_on_unknown_route_is_a_noop(self, fake_subprocess):
        manager = stream_router.RouteManager()
        route = _route(route_id=999)

        await manager.deactivate(route)  # should not raise

        assert await manager.is_running(route) is False

    @pytest.mark.asyncio
    async def test_activate_when_ffmpeg_not_found_leaves_route_with_no_running_relays(self, monkeypatch):
        async def _raise_not_found(*_args, **_kwargs):
            raise FileNotFoundError("ffmpeg not found")

        monkeypatch.setattr(stream_router.asyncio, "create_subprocess_exec", _raise_not_found)
        manager = stream_router.RouteManager()
        route = _route(destinations=[{"type": "srt", "url": "srt://a.example.com:9000"}])

        await manager.activate(route)  # should not raise

        assert await manager.is_running(route) is False


def test_get_router_returns_a_singleton():
    stream_router._manager = None
    first = stream_router.get_router()
    second = stream_router.get_router()
    assert first is second
    stream_router._manager = None
