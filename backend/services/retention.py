"""
Recording retention — deletes completed recordings oldest-first once total
storage exceeds RecordingConfig.max_storage_gb, but only when
RecordingConfig.auto_delete is on (the Settings page's Recording tab
already had UI for both of these; nothing ever backed it — see
routers/settings.py and models.RecordingConfig).

Deliberately conservative about what it touches:
  - Never a recording still in progress (status != complete) — an
    in-progress row's size_bytes is 0 anyway (only set on stop_recording),
    so it would look like free space it isn't.
  - Never a recording whose file is already gone from disk on its own —
    that's just DB-row cleanup, not a storage-driven deletion, and isn't
    this service's job.

Follows the same background-task shape as alerting.py/redundancy.py: a
manager class with start()/stop(), a while-True loop with try/except
around the per-tick body, registered in main.py's lifespan. Runs hourly,
not on the 10s cadence the health-monitoring services use — storage usage
doesn't change fast enough to warrant tighter polling, and every tick scans
every completed recording row.
"""

from __future__ import annotations

import asyncio
import logging

from sqlmodel import Session, select

from ..database import engine
from ..models import Recording, RecordingStatus
from .recording_config import get_recording_config, get_recordings_dir

logger = logging.getLogger(__name__)

_TICK_INTERVAL_S = 3600
_BYTES_PER_GB = 1_000_000_000


class RecordingRetention:
    def __init__(self) -> None:
        self._task: asyncio.Task | None = None
        self._last_deleted: list[str] = []  # most recent tick's deletions, for status()

    def start(self) -> None:
        if self._task is None:
            self._task = asyncio.create_task(self._loop())

    async def stop(self) -> None:
        if self._task is not None:
            self._task.cancel()
            self._task = None

    def status(self) -> dict:
        return {"last_deleted": list(self._last_deleted)}

    async def _loop(self) -> None:
        while True:
            await asyncio.sleep(_TICK_INTERVAL_S)
            try:
                await self.tick()
            except Exception:
                logger.exception("Recording retention tick failed")

    async def tick(self) -> None:
        with Session(engine) as session:
            config = get_recording_config(session)
            if not config.auto_delete:
                return

            max_bytes = config.max_storage_gb * _BYTES_PER_GB
            recordings = session.exec(
                select(Recording)
                .where(Recording.status == RecordingStatus.complete)
                .order_by(Recording.started_at.asc())
            ).all()

            total_bytes = sum(r.size_bytes for r in recordings)
            if total_bytes <= max_bytes:
                self._last_deleted = []
                return

            recordings_dir = get_recordings_dir(session)
            deleted: list[str] = []
            for recording in recordings:
                if total_bytes <= max_bytes:
                    break
                _delete_recording_files(recordings_dir, recording)
                total_bytes -= recording.size_bytes
                deleted.append(recording.filename)
                session.delete(recording)

            session.commit()
            self._last_deleted = deleted
            if deleted:
                logger.info(
                    "Recording retention: deleted %d recording(s) to get under %.0f GB: %s",
                    len(deleted), config.max_storage_gb, ", ".join(deleted),
                )


def _delete_recording_files(recordings_dir, recording: Recording) -> None:
    """Unlink a recording's file and thumbnail (if present) — same
    tolerant-of-already-missing pattern as routers/recordings.py's own
    delete endpoint, since a retention sweep racing a manual delete (or a
    file already lost some other way) shouldn't crash the whole tick."""
    file_path = recordings_dir / recording.filename
    try:
        file_path.unlink(missing_ok=True)
    except OSError:
        logger.warning("Retention: failed to unlink %s", file_path, exc_info=True)

    thumb_path = recordings_dir / f"{file_path.stem}.jpg"
    try:
        thumb_path.unlink(missing_ok=True)
    except OSError:
        pass


_retention: RecordingRetention | None = None


def get_recording_retention() -> RecordingRetention:
    global _retention
    if _retention is None:
        _retention = RecordingRetention()
    return _retention
