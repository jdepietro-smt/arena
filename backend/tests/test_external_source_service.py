"""
Tests for services.external_source.ExternalSourceManager — SRT sources
(mediamtx pulls them directly, nothing of ours to supervise) and YouTube
sources (a supervised yt-dlp-resolve + ffmpeg-relay loop with backoff on
failure). No real mediamtx, yt-dlp, or ffmpeg: get_client() is faked and
asyncio.create_subprocess_exec is faked to distinguish the two commands by
argv[0], same monkeypatch-the-shared-asyncio-module pattern test_recorder.py
already uses for its backoff/sleep patch.
"""

from __future__ import annotations

import asyncio

import pytest

from backend.services import external_source
from backend.services.external_source import ExternalSourceManager


class FakeMediaMTXClient:
    def __init__(self):
        self.added_paths: list[tuple[str, dict]] = []
        self.removed_paths: list[str] = []

    async def add_path(self, name, config):
        self.added_paths.append((name, config))

    async def remove_path(self, name):
        self.removed_paths.append(name)


class FakeProc:
    """Mimics asyncio.subprocess.Process: communicate() blocks on an Event
    until terminate()/kill() fires it, same shape as test_recorder.py's
    FakeProc for the same reason (real ffmpeg processes never exit on
    their own until stopped)."""

    def __init__(self, stdout=b"", stderr=b"", returncode=0, exits_immediately=True):
        self.pid = 4242
        self.returncode: int | None = returncode if exits_immediately else None
        self._stdout = stdout
        self._stderr = stderr
        self._exited = asyncio.Event()
        if exits_immediately:
            self._exited.set()

    def terminate(self):
        self.returncode = self.returncode if self.returncode is not None else 0
        self._exited.set()

    def kill(self):
        self.returncode = -9
        self._exited.set()

    async def wait(self):
        await self._exited.wait()
        return self.returncode

    async def communicate(self):
        await self._exited.wait()
        return self._stdout, self._stderr


@pytest.fixture
def fake_client(monkeypatch):
    client = FakeMediaMTXClient()
    monkeypatch.setattr(external_source, "get_client", lambda: client)
    return client


@pytest.fixture
def no_real_backoff_sleep(monkeypatch):
    real_sleep = asyncio.sleep
    monkeypatch.setattr(external_source.asyncio, "sleep", lambda *_a, **_kw: real_sleep(0))


@pytest.fixture
async def manager(fake_client):
    mgr = ExternalSourceManager()
    yield mgr
    await mgr.stop_all()  # always cancel any supervise task, even on test failure


async def test_add_srt_source_calls_add_path_with_source_url(manager, fake_client):
    await manager.add("cam1", "srt://example.com:9000")

    assert fake_client.added_paths == [("cam1", {"source": "srt://example.com:9000"})]
    assert manager.list() == [{
        "name": "cam1", "url": "srt://example.com:9000", "status": "srt",
        "last_error": None, "age_seconds": pytest.approx(0.0, abs=1.0),
    }]


async def test_add_duplicate_name_raises(manager, fake_client):
    await manager.add("cam1", "srt://example.com:9000")

    with pytest.raises(ValueError):
        await manager.add("cam1", "srt://other.example.com:9000")


async def test_remove_srt_source(manager, fake_client):
    await manager.add("cam1", "srt://example.com:9000")

    removed = await manager.remove("cam1")

    assert removed is True
    assert manager.list() == []
    assert "cam1" in fake_client.removed_paths


async def test_remove_nonexistent_source_returns_false(manager, fake_client):
    removed = await manager.remove("nope")
    assert removed is False


async def test_add_youtube_source_starts_supervised_ffmpeg_relay(manager, fake_client, monkeypatch):
    resolved_url = "https://manifest.example.com/stream.m3u8"

    async def fake_exec(*cmd, **_kwargs):
        if cmd[0] == "yt-dlp":
            return FakeProc(stdout=f"{resolved_url}\n".encode(), returncode=0)
        assert cmd[0] == "ffmpeg"
        return FakeProc(exits_immediately=False)  # simulates a running relay

    monkeypatch.setattr(external_source.asyncio, "create_subprocess_exec", fake_exec)

    await manager.add("yt1", "https://youtube.com/watch?v=abc123")
    await asyncio.sleep(0)  # let the supervise task run its first iteration

    sources = manager.list()
    assert len(sources) == 1
    assert sources[0]["name"] == "yt1"
    assert sources[0]["status"] == "live"
    assert ("yt1", {"source": "publisher"}) in fake_client.added_paths


async def test_youtube_resolve_failure_sets_error_status_and_retries(
    manager, fake_client, monkeypatch, no_real_backoff_sleep,
):
    async def always_fails(*cmd, **_kwargs):
        assert cmd[0] == "yt-dlp"
        return FakeProc(stderr=b"ERROR: Sign in to confirm you're not a bot", returncode=1)

    monkeypatch.setattr(external_source.asyncio, "create_subprocess_exec", always_fails)

    await manager.add("yt1", "https://youtube.com/watch?v=abc123")
    await asyncio.sleep(0)
    await asyncio.sleep(0)  # let at least one retry cycle happen with the sleep patched to instant

    sources = manager.list()
    assert sources[0]["status"] == "error"
    assert "bot" in sources[0]["last_error"]


async def test_remove_youtube_source_stops_ffmpeg_and_removes_path(manager, fake_client, monkeypatch):
    ffmpeg_proc = FakeProc(exits_immediately=False)

    async def fake_exec(*cmd, **_kwargs):
        if cmd[0] == "yt-dlp":
            return FakeProc(stdout=b"https://manifest.example.com/x.m3u8\n", returncode=0)
        return ffmpeg_proc

    monkeypatch.setattr(external_source.asyncio, "create_subprocess_exec", fake_exec)

    await manager.add("yt1", "https://youtube.com/watch?v=abc123")
    await asyncio.sleep(0)

    removed = await manager.remove("yt1")

    assert removed is True
    assert manager.list() == []
    assert ffmpeg_proc.returncode is not None  # terminated
    assert "yt1" in fake_client.removed_paths


def test_get_external_sources_returns_singleton():
    external_source._manager = None
    first = external_source.get_external_sources()
    second = external_source.get_external_sources()
    assert first is second
    external_source._manager = None
