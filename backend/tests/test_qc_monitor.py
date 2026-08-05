"""
Tests for backend.services.qc_monitor.QCMonitor.

Two things are tested separately, deliberately:

1. want()/unwant()/reconcile bookkeeping — mirrors test_hls_generator.py's
   approach exactly (_Job replaced with a fake; this is about the
   manager's job lifecycle, not about spawning real ffmpeg).
2. _handle_event()'s open/close state machine — freeze/silence must open
   on start and close on end (and never double-open/close), while black
   is always a one-shot retrospective event. This is the actual business
   logic worth getting right; test_qc_parser.py already covers turning
   real ffmpeg output into these events in the first place.
"""

from __future__ import annotations

import pytest

from backend.services import qc_monitor as qc_module
from backend.services.qc_monitor import QCMonitor


class FakeJob:
    """Mirrors the parts of _Job that QCMonitor touches — see
    test_hls_generator.py's FakeJob for the identical rationale."""

    instances: list["FakeJob"] = []

    def __init__(self, path: str, on_event) -> None:
        self.path = path
        self.on_event = on_event
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
    monkeypatch.setattr(qc_module, "_Job", FakeJob)
    yield


@pytest.fixture
def manager() -> QCMonitor:
    m = QCMonitor()
    return m


@pytest.fixture(autouse=True)
def _no_op_side_effects(monkeypatch):
    """_handle_event logs to the DB and posts a webhook — neither is what
    these tests are about, so replace both with no-ops and let individual
    tests assert on call counts where that IS what they're testing."""
    monkeypatch.setattr(QCMonitor, "_log_event", lambda self, *a, **kw: None)

    async def fake_notify(self, text):
        return None

    monkeypatch.setattr(QCMonitor, "_notify", fake_notify)


class TestWantUnwant:
    async def test_want_starts_a_job(self, manager: QCMonitor):
        await manager.want("Golf_Channel")
        assert "Golf_Channel" in manager._wanted
        assert len(FakeJob.instances) == 1
        assert FakeJob.instances[0].started

    async def test_want_twice_does_not_spawn_a_second_job(self, manager: QCMonitor):
        await manager.want("Golf_Channel")
        await manager.want("Golf_Channel")
        assert len(FakeJob.instances) == 1

    async def test_unwant_stops_the_job_and_forgets_it(self, manager: QCMonitor):
        await manager.want("Golf_Channel")
        await manager.unwant("Golf_Channel")
        assert "Golf_Channel" not in manager._wanted
        assert "Golf_Channel" not in manager._jobs
        assert FakeJob.instances[0].stopped

    async def test_unwant_unknown_path_is_a_harmless_noop(self, manager: QCMonitor):
        assert await manager.unwant("never-started") is None

    async def test_unwant_clears_any_open_issue_for_that_path_silently(self, manager: QCMonitor, monkeypatch):
        logged = []
        monkeypatch.setattr(QCMonitor, "_log_event", lambda self, et, p, msg: logged.append((et, p, msg)))
        await manager.want("Golf_Channel")
        await manager._handle_event("Golf_Channel", {"kind": "freeze", "action": "start"})
        assert ("Golf_Channel", "freeze") in manager._active_issues
        logged_before_unwant = len(logged)  # the start itself legitimately logs a detection

        await manager.unwant("Golf_Channel")

        assert ("Golf_Channel", "freeze") not in manager._active_issues
        assert len(logged) == logged_before_unwant  # silent cleanup — stopping monitoring isn't a real recovery


class TestReconcileOnlyTouchesWantedPaths:
    async def test_reconcile_does_not_start_unwanted_paths(self, manager: QCMonitor):
        await manager._reconcile_once()
        assert FakeJob.instances == []
        assert manager._jobs == {}

    async def test_reconcile_restarts_a_wanted_job_that_died(self, manager: QCMonitor):
        await manager.want("Golf_Channel")
        FakeJob.instances[0].stopped = True

        await manager._reconcile_once()

        assert len(FakeJob.instances) == 2
        assert manager._jobs["Golf_Channel"] is FakeJob.instances[1]

    async def test_reconcile_leaves_a_healthy_wanted_job_alone(self, manager: QCMonitor):
        await manager.want("Golf_Channel")
        await manager._reconcile_once()
        assert len(FakeJob.instances) == 1


class TestFreezeAndSilenceStateMachine:
    async def test_start_then_end_opens_then_closes_the_issue(self, manager: QCMonitor):
        await manager._handle_event("cam1", {"kind": "freeze", "action": "start"})
        assert ("cam1", "freeze") in manager._active_issues

        await manager._handle_event("cam1", {"kind": "freeze", "action": "end"})
        assert ("cam1", "freeze") not in manager._active_issues

    async def test_duplicate_start_does_not_reopen_or_double_notify(self, manager: QCMonitor, monkeypatch):
        notified = []
        async def record_notify(self, text):
            notified.append(text)
        monkeypatch.setattr(QCMonitor, "_notify", record_notify)

        await manager._handle_event("cam1", {"kind": "silence", "action": "start"})
        first_started_at = manager._active_issues[("cam1", "silence")]
        await manager._handle_event("cam1", {"kind": "silence", "action": "start"})

        assert manager._active_issues[("cam1", "silence")] == first_started_at
        assert len(notified) == 1  # only the first start notifies

    async def test_end_without_a_matching_start_is_ignored(self, manager: QCMonitor, monkeypatch):
        notified = []
        async def record_notify(self, text):
            notified.append(text)
        monkeypatch.setattr(QCMonitor, "_notify", record_notify)

        # e.g. monitoring started mid-freeze — we only ever saw the recovery.
        await manager._handle_event("cam1", {"kind": "freeze", "action": "end"})

        assert manager._active_issues == {}
        assert notified == []

    async def test_freeze_and_silence_on_the_same_path_are_independent(self, manager: QCMonitor):
        await manager._handle_event("cam1", {"kind": "freeze", "action": "start"})
        await manager._handle_event("cam1", {"kind": "silence", "action": "start"})

        assert ("cam1", "freeze") in manager._active_issues
        assert ("cam1", "silence") in manager._active_issues

        await manager._handle_event("cam1", {"kind": "freeze", "action": "end"})

        assert ("cam1", "freeze") not in manager._active_issues
        assert ("cam1", "silence") in manager._active_issues  # unaffected

    async def test_status_reports_open_issues_sorted(self, manager: QCMonitor):
        await manager._handle_event("cam2", {"kind": "freeze", "action": "start"})
        await manager._handle_event("cam1", {"kind": "silence", "action": "start"})
        await manager.want("cam1")
        await manager.want("cam2")

        status = manager.status()

        assert status["monitored_paths"] == ["cam1", "cam2"]
        assert [i["path"] for i in status["active_issues"]] == ["cam1", "cam2"]
        assert {i["kind"] for i in status["active_issues"]} == {"freeze", "silence"}


class TestBlackIsAlwaysRetrospective:
    async def test_black_event_never_opens_an_active_issue(self, manager: QCMonitor):
        await manager._handle_event("cam1", {"kind": "black", "action": "detected", "duration": 4.96})

        assert manager._active_issues == {}  # nothing to close later — see module docstring

    async def test_black_event_still_logs_and_notifies(self, manager: QCMonitor, monkeypatch):
        logged = []
        notified = []
        monkeypatch.setattr(QCMonitor, "_log_event", lambda self, et, p, msg: logged.append((et, p, msg)))
        async def record_notify(self, text):
            notified.append(text)
        monkeypatch.setattr(QCMonitor, "_notify", record_notify)

        await manager._handle_event("cam1", {"kind": "black", "action": "detected", "duration": 4.96})

        assert len(logged) == 1
        assert "black" in logged[0][2]
        assert len(notified) == 1
        assert "cam1" in notified[0]
