"""
Tests for backend.services.retention.RecordingRetention.

Real deletion behavior, not just accounting: recordings are created as real
files under tmp_path, and the assertions check both the DB rows AND that
the files/thumbnails are actually gone from disk afterward.
"""

from __future__ import annotations

import pytest
from sqlmodel import Session, select

from backend.database import engine
from backend.models import Recording, RecordingConfig, RecordingStatus
from backend.services.retention import RecordingRetention


@pytest.fixture(autouse=True)
def _clean_recordings_table():
    # retention.tick() sums size_bytes across every "complete" Recording row
    # in the whole DB, not just the ones a given test created — this is a
    # real shared table across the whole suite (a single persistent SQLite
    # file, not reset per test), so a leftover row from an earlier test file
    # would silently inflate every "under/over limit" calculation here.
    with Session(engine) as session:
        for row in session.exec(select(Recording)).all():
            session.delete(row)
        session.commit()
    yield


def _make_recording(session: Session, tmp_path, name: str, size_mb: int, status=RecordingStatus.complete) -> Recording:
    path = tmp_path / name
    path.write_bytes(b"0" * (size_mb * 1_000_000))
    recording = Recording(
        stream_path="Golf_Channel",
        filename=name,
        size_bytes=size_mb * 1_000_000,
        status=status,
    )
    session.add(recording)
    session.commit()
    session.refresh(recording)
    return recording


def _set_config(session: Session, tmp_path, max_storage_gb: float, auto_delete: bool) -> None:
    config = session.get(RecordingConfig, 1) or RecordingConfig(id=1)
    config.output_dir = str(tmp_path)
    config.max_storage_gb = max_storage_gb
    config.auto_delete = auto_delete
    session.add(config)
    session.commit()


class TestRetention:
    async def test_auto_delete_off_never_deletes_even_over_limit(self, tmp_path):
        with Session(engine) as session:
            _set_config(session, tmp_path, max_storage_gb=0.001, auto_delete=False)
            r = _make_recording(session, tmp_path, "a.mp4", size_mb=50)
            rid = r.id

        retention = RecordingRetention()
        await retention.tick()

        with Session(engine) as session:
            assert session.get(Recording, rid) is not None
        assert (tmp_path / "a.mp4").exists()

        _cleanup(rid)

    async def test_under_limit_does_not_delete(self, tmp_path):
        with Session(engine) as session:
            _set_config(session, tmp_path, max_storage_gb=1.0, auto_delete=True)
            r = _make_recording(session, tmp_path, "b.mp4", size_mb=50)
            rid = r.id

        retention = RecordingRetention()
        await retention.tick()

        with Session(engine) as session:
            assert session.get(Recording, rid) is not None
        assert (tmp_path / "b.mp4").exists()

        _cleanup(rid)

    async def test_over_limit_deletes_oldest_first_until_under(self, tmp_path):
        with Session(engine) as session:
            # 0.03 GB = 30 MB cap. Three 20MB recordings = 60MB total, over cap.
            _set_config(session, tmp_path, max_storage_gb=0.03, auto_delete=True)
            oldest = _make_recording(session, tmp_path, "oldest.mp4", size_mb=20)
            middle = _make_recording(session, tmp_path, "middle.mp4", size_mb=20)
            newest = _make_recording(session, tmp_path, "newest.mp4", size_mb=20)
            ids = [oldest.id, middle.id, newest.id]

        retention = RecordingRetention()
        await retention.tick()

        with Session(engine) as session:
            remaining = {r.filename for r in session.exec(select(Recording).where(Recording.id.in_(ids))).all()}

        # Deletes oldest-first until total <= cap: removing "oldest" alone
        # gets to 40MB (still over 30MB cap), so "middle" must go too,
        # leaving just "newest" (20MB, under cap).
        assert remaining == {"newest.mp4"}
        assert not (tmp_path / "oldest.mp4").exists()
        assert not (tmp_path / "middle.mp4").exists()
        assert (tmp_path / "newest.mp4").exists()
        assert retention.status()["last_deleted"] == ["oldest.mp4", "middle.mp4"]

        _cleanup(*ids)

    async def test_in_progress_recording_is_never_a_deletion_candidate(self, tmp_path):
        with Session(engine) as session:
            _set_config(session, tmp_path, max_storage_gb=0.001, auto_delete=True)
            in_progress = _make_recording(
                session, tmp_path, "live.mp4", size_mb=0, status=RecordingStatus.recording,
            )
            rid = in_progress.id

        retention = RecordingRetention()
        await retention.tick()

        with Session(engine) as session:
            row = session.get(Recording, rid)
            assert row is not None
            assert row.status == RecordingStatus.recording

        _cleanup(rid)

    async def test_deletes_thumbnail_alongside_video(self, tmp_path):
        with Session(engine) as session:
            _set_config(session, tmp_path, max_storage_gb=0.001, auto_delete=True)
            r = _make_recording(session, tmp_path, "with_thumb.mp4", size_mb=10)
            (tmp_path / "with_thumb.jpg").write_bytes(b"jpeg")
            rid = r.id

        retention = RecordingRetention()
        await retention.tick()

        assert not (tmp_path / "with_thumb.mp4").exists()
        assert not (tmp_path / "with_thumb.jpg").exists()

        _cleanup(rid)


def _cleanup(*ids: int) -> None:
    with Session(engine) as session:
        for rid in ids:
            row = session.get(Recording, rid)
            if row is not None:
                session.delete(row)
        session.commit()
