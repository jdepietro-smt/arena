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


@pytest.fixture(autouse=True)
def _clean_events():
    """Events-router tests create Event rows; keep them from leaking into
    unrelated tests."""
    from sqlmodel import Session, select

    from backend.database import engine
    from backend.models import Event

    yield
    with Session(engine) as session:
        for row in session.exec(select(Event)).all():
            session.delete(row)
        session.commit()


@pytest.fixture(autouse=True)
def _clean_alert_rules_and_gateways():
    """Alerts/redundancy-router tests create AlertRule / RedundancyGateway
    rows; keep them from leaking into unrelated tests."""
    from sqlmodel import Session, select

    from backend.database import engine
    from backend.models import AlertRule, RedundancyGateway

    yield
    with Session(engine) as session:
        for row in session.exec(select(AlertRule)).all():
            session.delete(row)
        for row in session.exec(select(RedundancyGateway)).all():
            session.delete(row)
        session.commit()


@pytest.fixture(autouse=True)
def _clean_recording_config():
    """Settings-router tests write to the RecordingConfig singleton row;
    reset it so later tests see the app's real defaults again."""
    from sqlmodel import Session

    from backend.database import engine
    from backend.models import RecordingConfig

    yield
    with Session(engine) as session:
        config = session.get(RecordingConfig, 1)
        if config is not None:
            session.delete(config)
            session.commit()


@pytest.fixture(autouse=True)
def _clean_stream_presets():
    """Streams-router preset tests create StreamPreset rows; keep them
    from leaking into unrelated tests."""
    from sqlmodel import Session, select

    from backend.database import engine
    from backend.models import StreamPreset

    yield
    with Session(engine) as session:
        for row in session.exec(select(StreamPreset)).all():
            session.delete(row)
        session.commit()


@pytest.fixture(autouse=True)
def _clean_recordings():
    """Recording-router tests create Recording rows; keep them from
    leaking into unrelated tests that list/count recordings."""
    from sqlmodel import Session, select

    from backend.database import engine
    from backend.models import Recording

    yield
    with Session(engine) as session:
        for row in session.exec(select(Recording)).all():
            session.delete(row)
        session.commit()


@pytest.fixture(autouse=True)
def _clean_stream_routes():
    """Route-router tests create StreamRoute rows; keep them from leaking
    into unrelated tests that list/count routes."""
    from sqlmodel import Session, select

    from backend.database import engine
    from backend.models import StreamRoute

    yield
    with Session(engine) as session:
        for row in session.exec(select(StreamRoute)).all():
            session.delete(row)
        session.commit()


@pytest.fixture(autouse=True)
def _clean_users_and_login_limiter():
    """Router tests create their own users and hit /api/auth/token, which
    both writes rows to the users table and accumulates failure counters
    in the in-memory login limiter (keyed by TestClient's fixed source IP,
    'testclient') — without this, a lockout test would poison every test
    that logs in afterward in the same run."""
    from sqlmodel import Session, select

    from backend.database import engine
    from backend.models import User
    from backend.services import login_limiter

    yield
    with Session(engine) as session:
        for row in session.exec(select(User)).all():
            session.delete(row)
        session.commit()
    login_limiter._failures.clear()
    login_limiter._locked_until.clear()


@pytest.fixture
def db_session():
    """Plain SQLModel Session against the test DB, for tests that need to
    insert rows directly (e.g. a pre-existing Recording) rather than going
    through an API call."""
    from sqlmodel import Session

    from backend.database import engine

    with Session(engine) as session:
        yield session


@pytest.fixture
def client():
    """TestClient constructed WITHOUT entering it as a context manager, so
    FastAPI's lifespan (which calls out to a live mediamtx instance and
    starts several background monitor loops) never runs — router tests
    only need the ASGI app + DB, not the full running service."""
    from fastapi.testclient import TestClient

    from backend.main import app

    return TestClient(app)


def _make_user(session, *, username, password, role, email=None, is_active=True):
    from backend.auth import get_password_hash
    from backend.models import User

    user = User(
        username=username,
        # NOT @arena.local — EmailStr/email-validator rejects .local as a
        # reserved special-use TLD (confirmed via a live 422), so any test
        # user needs a normal deliverable-looking domain.
        email=email or f"{username}@example.com",
        hashed_password=get_password_hash(password),
        role=role,
        is_active=is_active,
    )
    session.add(user)
    session.commit()
    session.refresh(user)
    return user


@pytest.fixture
def make_user():
    """Factory fixture: make_user(username=..., password=..., role=...) ->
    User, committed to the test DB."""
    from sqlmodel import Session

    from backend.database import engine

    def _factory(*, username, password="Password123!", role, email=None, is_active=True):
        with Session(engine) as session:
            return _make_user(
                session, username=username, password=password, role=role,
                email=email, is_active=is_active,
            )

    return _factory


@pytest.fixture
def auth_headers(client, make_user):
    """Factory fixture: auth_headers(role=UserRole.admin) -> ({"Authorization":
    "Bearer ..."}, User) for a freshly created user of that role, logged in
    through the real /api/auth/token endpoint."""
    def _factory(role, *, username=None, password="Password123!"):
        from backend.models import UserRole

        username = username or f"{role.value if hasattr(role, 'value') else role}-user"
        user = make_user(username=username, password=password, role=role)
        resp = client.post(
            "/api/auth/token",
            data={"username": username, "password": password},
        )
        assert resp.status_code == 200, resp.text
        token = resp.json()["access_token"]
        return {"Authorization": f"Bearer {token}"}, user

    return _factory
