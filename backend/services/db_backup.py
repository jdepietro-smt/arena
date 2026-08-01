"""
Automatic SQLite backups. arena.db is the single point of failure for
every user account, alert rule, redundancy-gateway config, and recording
index — losing it doesn't lose the actual video files on disk, but it
loses all visibility into and access control over them, plus everything
else the app tracks. Nothing backed this up before now.

Uses sqlite3's own online backup API (Connection.backup()), not a raw file
copy — a plain copy while the app is mid-write can capture a torn,
inconsistent snapshot; the backup API takes a consistent copy safely even
while the source is in active use.

Only does anything when DATABASE_URL is actually sqlite (the only backend
this deployment uses) — a real Postgres/MySQL setup needs its own backup
tooling (pg_dump etc.), not this.

Follows the same background-task shape as the other services here: a
manager class with start()/stop(), registered in main.py's lifespan. Runs
daily, not hourly like retention — a day-old backup is an acceptable worst
case for this kind of metadata, and scanning/copying the whole DB file
isn't free.
"""

from __future__ import annotations

import asyncio
import logging
import sqlite3
from datetime import datetime
from pathlib import Path

from ..config import settings

logger = logging.getLogger(__name__)

_TICK_INTERVAL_S = 24 * 3600
_KEEP_LAST = 7


def _sqlite_path() -> Path | None:
    """Parse the file path out of a sqlite DATABASE_URL, or None if this
    deployment isn't using sqlite at all."""
    url = settings.DATABASE_URL
    if not url.startswith("sqlite"):
        return None
    # sqlite:///relative/path.db (3 slashes) or sqlite:////absolute/path.db (4)
    path_part = url.split("///", 1)[-1]
    return Path(path_part) if path_part else None


def _backups_dir(db_path: Path) -> Path:
    return db_path.parent / "backups"


def run_backup_once() -> Path | None:
    """Take one backup now. Returns the backup file path, or None if this
    deployment isn't sqlite. Synchronous — sqlite3's backup API isn't
    async, and a metadata-only DB backup is fast enough not to matter."""
    db_path = _sqlite_path()
    if db_path is None or not db_path.exists():
        return None

    backups_dir = _backups_dir(db_path)
    backups_dir.mkdir(parents=True, exist_ok=True)

    timestamp = datetime.utcnow().strftime("%Y%m%d-%H%M%S")
    dest_path = backups_dir / f"{db_path.stem}-{timestamp}.db"

    source_conn = sqlite3.connect(str(db_path))
    try:
        dest_conn = sqlite3.connect(str(dest_path))
        try:
            source_conn.backup(dest_conn)
        finally:
            dest_conn.close()
    finally:
        source_conn.close()

    _rotate(backups_dir, db_path.stem)
    logger.info("DB backup written: %s", dest_path)
    return dest_path


def _rotate(backups_dir: Path, stem: str) -> None:
    backups = sorted(backups_dir.glob(f"{stem}-*.db"), key=lambda p: p.name)
    for stale in backups[:-_KEEP_LAST]:
        try:
            stale.unlink()
        except OSError:
            logger.warning("DB backup rotation: failed to remove %s", stale, exc_info=True)


class DatabaseBackup:
    def __init__(self) -> None:
        self._task: asyncio.Task | None = None
        self._last_backup: str | None = None

    def start(self) -> None:
        if self._task is None:
            self._task = asyncio.create_task(self._loop())

    async def stop(self) -> None:
        if self._task is not None:
            self._task.cancel()
            self._task = None

    def status(self) -> dict:
        return {"last_backup": self._last_backup}

    async def _loop(self) -> None:
        while True:
            await asyncio.sleep(_TICK_INTERVAL_S)
            try:
                await self.tick()
            except Exception:
                logger.exception("DB backup tick failed")

    async def tick(self) -> None:
        # sqlite3 is synchronous — run it off the event loop thread so a
        # slow backup (large DB, slow disk) doesn't stall request handling.
        path = await asyncio.to_thread(run_backup_once)
        if path is not None:
            self._last_backup = str(path)


_backup: DatabaseBackup | None = None


def get_db_backup() -> DatabaseBackup:
    global _backup
    if _backup is None:
        _backup = DatabaseBackup()
    return _backup
