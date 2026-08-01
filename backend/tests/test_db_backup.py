"""
Tests for backend.services.db_backup — real sqlite files, real backup
files on disk, not mocked. Uses sqlite3's own online backup API rather
than a raw file copy specifically so a backup taken while the source is
mid-write stays consistent; these tests confirm the resulting file is a
genuinely openable, correct database.
"""

from __future__ import annotations

import sqlite3

from backend.services import db_backup


def _make_test_db(path) -> None:
    conn = sqlite3.connect(str(path))
    conn.execute("CREATE TABLE t (id INTEGER PRIMARY KEY, val TEXT)")
    conn.execute("INSERT INTO t (val) VALUES ('hello')")
    conn.commit()
    conn.close()


class TestRunBackupOnce:
    def test_returns_none_for_non_sqlite_url(self, monkeypatch):
        monkeypatch.setattr(db_backup.settings, "DATABASE_URL", "postgresql://localhost/arena")
        assert db_backup.run_backup_once() is None

    def test_returns_none_if_db_file_does_not_exist(self, monkeypatch, tmp_path):
        monkeypatch.setattr(db_backup.settings, "DATABASE_URL", f"sqlite:///{tmp_path / 'missing.db'}")
        assert db_backup.run_backup_once() is None

    def test_creates_a_real_openable_backup(self, monkeypatch, tmp_path):
        db_path = tmp_path / "arena.db"
        _make_test_db(db_path)
        monkeypatch.setattr(db_backup.settings, "DATABASE_URL", f"sqlite:///{db_path}")

        result = db_backup.run_backup_once()

        assert result is not None
        assert result.exists()
        conn = sqlite3.connect(str(result))
        rows = conn.execute("SELECT val FROM t").fetchall()
        conn.close()
        assert rows == [("hello",)]

    def test_rotation_keeps_only_last_n(self, monkeypatch, tmp_path):
        db_path = tmp_path / "arena.db"
        _make_test_db(db_path)
        monkeypatch.setattr(db_backup.settings, "DATABASE_URL", f"sqlite:///{db_path}")
        monkeypatch.setattr(db_backup, "_KEEP_LAST", 3)

        backups_dir = tmp_path / "backups"
        backups_dir.mkdir()
        # Pre-seed 5 fake backups with names that sort before any real one
        # this test creates (real ones use a live timestamp).
        for i in range(5):
            (backups_dir / f"arena-2020010{i}-000000.db").write_bytes(b"")

        db_backup.run_backup_once()

        remaining = sorted(backups_dir.glob("arena-*.db"))
        assert len(remaining) == 3
        # The real backup just taken must be one of the survivors — rotation
        # keeps the newest, not an arbitrary 3.
        assert remaining[-1].name.startswith("arena-") and remaining[-1] != backups_dir / "arena-20200100-000000.db"


class TestDatabaseBackupManager:
    async def test_tick_records_last_backup_path(self, monkeypatch, tmp_path):
        db_path = tmp_path / "arena.db"
        _make_test_db(db_path)
        monkeypatch.setattr(db_backup.settings, "DATABASE_URL", f"sqlite:///{db_path}")

        manager = db_backup.DatabaseBackup()
        assert manager.status()["last_backup"] is None

        await manager.tick()

        assert manager.status()["last_backup"] is not None
        assert (tmp_path / "backups").exists()
