"""
Regression tests for backend.services.hls_generator.HlsGeneratorManager.

The real incident: this manager used to reconcile against every live
mediamtx path, keeping one real-time ffmpeg transcode running per stream at
ALL times whether or not anyone was recording it — confirmed live via
/api/recordings/debug/hls-generators showing jobs "running":true with zero
active recordings, which was silently eating CPU the multiviewer compositor
needed (frame-rate slowdown, audio desync). The fix scopes everything to an
explicit want()/unwant() set instead of discovering work from mediamtx.

_Job is replaced with a fake here — these tests are about the manager's
want/unwant/reconcile bookkeeping, not about actually spawning ffmpeg.
"""

from __future__ import annotations

import pytest

from backend.services import hls_generator as hls_gen_module
from backend.services.hls_generator import HlsGeneratorManager


class FakeJob:
    """Mirrors the parts of _Job that HlsGeneratorManager touches, without
    spawning a real subprocess or asyncio task."""

    instances: list["FakeJob"] = []

    def __init__(self, path: str) -> None:
        self.path = path
        self.started = False
        self.stopped = False
        FakeJob.instances.append(self)

    def start(self) -> None:
        self.started = True

    @property
    def alive(self) -> bool:
        return self.started and not self.stopped

    @property
    def running(self) -> bool:
        return self.alive

    async def stop(self) -> None:
        self.stopped = True


@pytest.fixture(autouse=True)
def _fake_job(monkeypatch):
    FakeJob.instances = []
    monkeypatch.setattr(hls_gen_module, "_Job", FakeJob)
    yield


@pytest.fixture
def manager() -> HlsGeneratorManager:
    return HlsGeneratorManager()


class TestWantUnwant:
    async def test_want_starts_a_job(self, manager: HlsGeneratorManager):
        await manager.want("Golf_Channel")
        assert "Golf_Channel" in manager._wanted
        assert len(FakeJob.instances) == 1
        assert FakeJob.instances[0].started

    async def test_want_twice_does_not_spawn_a_second_job(self, manager: HlsGeneratorManager):
        await manager.want("Golf_Channel")
        await manager.want("Golf_Channel")
        assert len(FakeJob.instances) == 1

    async def test_unwant_stops_the_job_and_forgets_it(self, manager: HlsGeneratorManager):
        await manager.want("Golf_Channel")
        await manager.unwant("Golf_Channel")
        assert "Golf_Channel" not in manager._wanted
        assert "Golf_Channel" not in manager._jobs
        assert FakeJob.instances[0].stopped

    async def test_unwant_unknown_path_is_a_harmless_noop(self, manager: HlsGeneratorManager):
        result = await manager.unwant("never-started")
        assert result is None


class TestReconcileOnlyTouchesWantedPaths:
    """The actual regression: reconcile used to ask mediamtx for every live
    path and start a generator for each. It must never do that again — only
    paths explicitly want()ed should ever get a job, and reconcile should
    never invent new work on its own."""

    async def test_reconcile_does_not_start_unwanted_paths(self, manager: HlsGeneratorManager):
        # Nothing wanted at all — a live stream existing elsewhere in the
        # system must not cause a job to appear here.
        await manager._reconcile_once()
        assert len(FakeJob.instances) == 0
        assert manager._jobs == {}

    async def test_reconcile_restarts_a_wanted_job_that_died(self, manager: HlsGeneratorManager):
        await manager.want("Golf_Channel")
        FakeJob.instances[0].stopped = True  # simulate the ffmpeg process dying

        await manager._reconcile_once()

        # ensure_job() sees the tracked job is no longer alive and replaces it
        assert len(FakeJob.instances) == 2
        assert FakeJob.instances[1].started
        assert manager._jobs["Golf_Channel"] is FakeJob.instances[1]

    async def test_reconcile_leaves_a_healthy_wanted_job_alone(self, manager: HlsGeneratorManager):
        await manager.want("Golf_Channel")
        await manager._reconcile_once()
        # still alive — must not be replaced
        assert len(FakeJob.instances) == 1

    async def test_unwanted_job_is_not_recreated_by_reconcile(self, manager: HlsGeneratorManager):
        await manager.want("Golf_Channel")
        await manager.unwant("Golf_Channel")
        await manager._reconcile_once()
        assert manager._jobs == {}
        assert len(FakeJob.instances) == 1  # only the original — reconcile made nothing new
