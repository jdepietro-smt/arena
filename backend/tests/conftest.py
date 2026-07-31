"""
Shared pytest fixtures.

Sets DATABASE_URL to an isolated file before any `backend.*` module is
imported — backend.config.settings and backend.database.engine are both
built at import time, so this has to happen before pytest collects any test
module that (transitively) imports them. A file-based SQLite DB (not
":memory:") avoids the multi-connection-sees-empty-db surprise you'd get
from plain in-memory SQLite without a StaticPool.
"""

from __future__ import annotations

import os
import uuid

_TEST_DB_PATH = f"./test_arena_{uuid.uuid4().hex}.db"
os.environ.setdefault("DATABASE_URL", f"sqlite:///{_TEST_DB_PATH}")
os.environ.setdefault("SECRET_KEY", "test-secret-key-not-for-prod")

import pytest  # noqa: E402


@pytest.fixture(scope="session", autouse=True)
def _test_db_lifecycle():
    from backend.database import create_db_and_tables, engine

    create_db_and_tables()
    yield
    engine.dispose()
    try:
        os.remove(_TEST_DB_PATH)
    except OSError:
        pass


@pytest.fixture(autouse=True)
def _clean_managed_paths():
    """Every test starts with an empty managed_paths table — tests that
    register rows should not leak into the next test."""
    from sqlmodel import Session, select

    from backend.database import engine
    from backend.models import ManagedPath

    yield
    with Session(engine) as session:
        for row in session.exec(select(ManagedPath)).all():
            session.delete(row)
        session.commit()
