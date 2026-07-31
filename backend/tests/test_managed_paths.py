"""
Regression test for backend.services.managed_paths.reconcile_orphans().

The real bug: the original version untracked a ManagedPath row from the DB
unconditionally, even when the actual mediamtx remove_path() call failed for
a reason other than "already gone" (404). That silently turned a transient
failure into a permanent orphan — nothing would ever retry removing it,
because the app had already forgotten it existed.
"""

from __future__ import annotations

from sqlmodel import Session, select

from backend.database import engine
from backend.models import ManagedPath, ManagedPathType
from backend.services import managed_paths
from backend.services.mediamtx import MediaMTXError


class FakeClient:
    def __init__(self, behavior: dict[str, object]) -> None:
        # behavior[name] is either None (success), an int status code
        # (raise MediaMTXError with that code), or the string "boom"
        # (raise a generic Exception).
        self._behavior = behavior
        self.remove_calls: list[str] = []

    async def remove_path(self, name: str) -> None:
        self.remove_calls.append(name)
        outcome = self._behavior.get(name)
        if outcome is None:
            return
        if outcome == "boom":
            raise RuntimeError("boom")
        raise MediaMTXError(int(outcome), "mediamtx says no")


def _register(name: str) -> None:
    with Session(engine) as session:
        session.add(ManagedPath(name=name, path_type=ManagedPathType.composite))
        session.commit()


def _tracked_names() -> set[str]:
    with Session(engine) as session:
        return {row.name for row in session.exec(select(ManagedPath)).all()}


class TestReconcileOrphans:
    async def test_successful_removal_untracks(self, monkeypatch):
        _register("mv_ok")
        monkeypatch.setattr(managed_paths, "get_client", lambda: FakeClient({}))

        await managed_paths.reconcile_orphans()

        assert "mv_ok" not in _tracked_names()

    async def test_404_counts_as_already_gone_and_untracks(self, monkeypatch):
        _register("mv_already_gone")
        monkeypatch.setattr(
            managed_paths, "get_client", lambda: FakeClient({"mv_already_gone": 404})
        )

        await managed_paths.reconcile_orphans()

        assert "mv_already_gone" not in _tracked_names()

    async def test_genuine_failure_keeps_it_tracked_for_retry(self, monkeypatch):
        """This is the actual regression: a real failure (mediamtx 500, or
        the request throwing outright) must NOT be treated the same as
        success — the row has to survive so the next startup retries it."""
        _register("mv_stuck")
        monkeypatch.setattr(
            managed_paths, "get_client", lambda: FakeClient({"mv_stuck": 500})
        )

        await managed_paths.reconcile_orphans()

        assert "mv_stuck" in _tracked_names()

    async def test_unexpected_exception_also_keeps_it_tracked(self, monkeypatch):
        _register("mv_exploded")
        monkeypatch.setattr(
            managed_paths, "get_client", lambda: FakeClient({"mv_exploded": "boom"})
        )

        await managed_paths.reconcile_orphans()

        assert "mv_exploded" in _tracked_names()

    async def test_mixed_outcomes_only_untrack_the_resolved_ones(self, monkeypatch):
        _register("mv_ok")
        _register("mv_stuck")
        client = FakeClient({"mv_stuck": 500})
        monkeypatch.setattr(managed_paths, "get_client", lambda: client)

        await managed_paths.reconcile_orphans()

        remaining = _tracked_names()
        assert "mv_ok" not in remaining
        assert "mv_stuck" in remaining

    async def test_no_orphans_does_not_call_mediamtx_at_all(self, monkeypatch):
        client = FakeClient({})
        monkeypatch.setattr(managed_paths, "get_client", lambda: client)

        await managed_paths.reconcile_orphans()

        assert client.remove_calls == []
