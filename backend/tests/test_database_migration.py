"""
Test for database._ensure_users_last_login_column — the idempotent
ALTER TABLE that has to run for any DB created before the last_login
column existed on the User model.

create_db_and_tables() in the shared test fixture already builds a fresh
DB from the current model (last_login included from the start), so the
main test suite never actually exercises the ALTER TABLE branch. This
uses its own throwaway sqlite file with a users table built WITHOUT the
column, to simulate an already-deployed pre-existing DB.
"""

from __future__ import annotations

import os
import uuid

from sqlalchemy import create_engine

from backend.database import _ensure_stream_routes_failover_columns, _ensure_users_last_login_column


def test_adds_the_column_to_a_table_that_predates_it(monkeypatch):
    db_path = f"./_migration_test_{uuid.uuid4().hex}.db"
    try:
        old_engine = create_engine(f"sqlite:///{db_path}")
        with old_engine.connect() as conn:
            conn.exec_driver_sql(
                "CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT, "
                "email TEXT, hashed_password TEXT, role TEXT, is_active BOOLEAN, created_at TIMESTAMP)"
            )
            conn.commit()
        old_engine.dispose()

        import backend.database as database_module
        monkeypatch.setattr(database_module, "engine", create_engine(f"sqlite:///{db_path}"))
        monkeypatch.setattr(database_module.settings, "DATABASE_URL", f"sqlite:///{db_path}")

        _ensure_users_last_login_column()

        with database_module.engine.connect() as conn:
            columns = {row[1] for row in conn.exec_driver_sql("PRAGMA table_info(users)").fetchall()}
        assert "last_login" in columns
    finally:
        try:
            os.remove(db_path)
        except OSError:
            pass


def test_is_a_no_op_when_the_column_already_exists():
    """Calling it again against the real (already-migrated) test DB must
    not raise "duplicate column"."""
    _ensure_users_last_login_column()
    _ensure_users_last_login_column()


def test_adds_the_failover_columns_to_a_table_that_predates_them(monkeypatch):
    db_path = f"./_migration_test_{uuid.uuid4().hex}.db"
    try:
        old_engine = create_engine(f"sqlite:///{db_path}")
        with old_engine.connect() as conn:
            conn.exec_driver_sql(
                "CREATE TABLE stream_routes (id INTEGER PRIMARY KEY, name TEXT, "
                "source_path TEXT, destinations TEXT, is_active BOOLEAN, created_at TIMESTAMP)"
            )
            conn.commit()
        old_engine.dispose()

        import backend.database as database_module
        monkeypatch.setattr(database_module, "engine", create_engine(f"sqlite:///{db_path}"))
        monkeypatch.setattr(database_module.settings, "DATABASE_URL", f"sqlite:///{db_path}")

        _ensure_stream_routes_failover_columns()

        with database_module.engine.connect() as conn:
            columns = {row[1] for row in conn.exec_driver_sql("PRAGMA table_info(stream_routes)").fetchall()}
        assert "backup_source_path" in columns
        assert "failed_over" in columns
    finally:
        try:
            os.remove(db_path)
        except OSError:
            pass


def test_failover_columns_migration_is_a_no_op_when_already_present():
    _ensure_stream_routes_failover_columns()
    _ensure_stream_routes_failover_columns()
