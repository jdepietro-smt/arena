"""
Tests for services.srt_stats.StatsCollector — the polling stats ring
buffer backing /api/stats and the dashboard's live bitrate/RTT numbers.
StatsCollector takes an injectable client, so _poll_once() is driven
directly against a fake rather than going through the real background
loop or a real mediamtx instance.
"""

from __future__ import annotations

import asyncio

import pytest

from backend.services.srt_stats import StatsCollector


class FakeMediaMTXClient:
    def __init__(self):
        self.paths: list[dict] = []
        self.srt_conns: list[dict] = []

    async def get_paths(self):
        return self.paths

    async def get_connections(self):
        return {"srt": self.srt_conns}


def _path(name, ready=True, bytes_received=0, readers=None, ready_time=None):
    return {
        "name": name, "ready": ready, "bytesReceived": bytes_received,
        "readers": readers or [], "readyTime": ready_time,
    }


async def test_no_data_before_first_poll():
    collector = StatsCollector(client=FakeMediaMTXClient())
    assert collector.get_stats("cam1") is None
    assert collector.get_history("cam1") == []
    assert collector.get_all_paths() == []


async def test_poll_once_populates_current_stats():
    fake = FakeMediaMTXClient()
    fake.paths = [_path("cam1", readers=[{"id": "r1"}])]
    collector = StatsCollector(client=fake)

    await collector._poll_once()

    stats = collector.get_stats("cam1")
    assert stats is not None
    assert stats["path_name"] == "cam1"
    assert stats["ready"] is True
    assert stats["reader_count"] == 1
    assert collector.get_all_paths() == ["cam1"]


async def test_bitrate_is_computed_from_bytes_delta_between_polls(monkeypatch):
    fake = FakeMediaMTXClient()
    fake.paths = [_path("cam1", bytes_received=0)]
    collector = StatsCollector(client=fake)

    mono_time = [1000.0]
    monkeypatch.setattr("backend.services.srt_stats.time.monotonic", lambda: mono_time[0])

    await collector._poll_once()
    assert collector.get_stats("cam1")["bitrate_kbps"] == 0.0

    # 125,000 bytes over 1 second = 1,000,000 bits/s = 1000 kbps.
    fake.paths = [_path("cam1", bytes_received=125_000)]
    mono_time[0] = 1001.0
    await collector._poll_once()

    assert collector.get_stats("cam1")["bitrate_kbps"] == pytest.approx(1000.0, rel=1e-3)


async def test_srt_connection_stats_merged_by_path():
    fake = FakeMediaMTXClient()
    fake.paths = [_path("cam1")]
    fake.srt_conns = [{
        "path": "cam1", "msRTT": 15.5,
        "pktSentTotal": 1000, "pktSndLossTotal": 10,
        "msRcvTsbPdDelay": 120.0,
    }]
    collector = StatsCollector(client=fake)

    await collector._poll_once()

    stats = collector.get_stats("cam1")
    assert stats["rtt_ms"] == 15.5
    assert stats["packet_loss_pct"] == pytest.approx(1.0)
    assert stats["jitter_ms"] == 120.0


async def test_path_with_no_srt_connection_has_zeroed_srt_fields():
    fake = FakeMediaMTXClient()
    fake.paths = [_path("cam1")]
    fake.srt_conns = []
    collector = StatsCollector(client=fake)

    await collector._poll_once()

    stats = collector.get_stats("cam1")
    assert stats["rtt_ms"] == 0.0
    assert stats["packet_loss_pct"] == 0.0


async def test_history_accumulates_across_polls():
    fake = FakeMediaMTXClient()
    fake.paths = [_path("cam1")]
    collector = StatsCollector(client=fake)

    await collector._poll_once()
    await collector._poll_once()
    await collector._poll_once()

    history = collector.get_history("cam1", seconds=3600)
    assert len(history) == 3


async def test_history_cutoff_excludes_old_points(monkeypatch):
    fake = FakeMediaMTXClient()
    fake.paths = [_path("cam1")]
    collector = StatsCollector(client=fake)

    wall_time = [1_000_000.0]
    monkeypatch.setattr("backend.services.srt_stats.time.time", lambda: wall_time[0])

    await collector._poll_once()  # old point, 100s ago
    wall_time[0] += 100
    await collector._poll_once()  # recent point

    recent_only = collector.get_history("cam1", seconds=10)
    assert len(recent_only) == 1


async def test_path_that_disappears_is_dropped_from_current_but_history_kept():
    fake = FakeMediaMTXClient()
    fake.paths = [_path("cam1")]
    collector = StatsCollector(client=fake)
    await collector._poll_once()
    assert collector.get_stats("cam1") is not None

    fake.paths = []  # cam1 no longer reported by mediamtx
    await collector._poll_once()

    assert collector.get_stats("cam1") is None
    assert len(collector.get_history("cam1", seconds=3600)) == 1


async def test_poll_once_swallows_mediamtx_error():
    from backend.services.mediamtx import MediaMTXError

    class ErroringClient(FakeMediaMTXClient):
        async def get_paths(self):
            raise MediaMTXError(0, "connection refused")

    collector = StatsCollector(client=ErroringClient())

    await collector._poll_once()  # should not raise

    assert collector.get_all_paths() == []


async def test_start_and_stop_lifecycle():
    collector = StatsCollector(client=FakeMediaMTXClient(), poll_interval=0.01)

    await collector.start()
    assert collector._task is not None
    await asyncio.sleep(0.03)  # let at least one poll cycle run

    await collector.stop()
    assert collector._task is None


def test_get_collector_returns_singleton():
    from backend.services import srt_stats

    srt_stats._collector = None
    first = srt_stats.get_collector()
    second = srt_stats.get_collector()
    assert first is second
    srt_stats._collector = None
