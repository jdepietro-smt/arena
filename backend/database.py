from __future__ import annotations

import logging
from typing import Generator

from sqlmodel import Session, SQLModel, create_engine, select

from .config import settings

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Engine
# ---------------------------------------------------------------------------

# connect_args is SQLite-specific; harmless to include, ignored by other DBs.
_connect_args = (
    {"check_same_thread": False}
    if settings.DATABASE_URL.startswith("sqlite")
    else {}
)

engine = create_engine(
    settings.DATABASE_URL,
    echo=False,               # set True to log all SQL for debugging
    connect_args=_connect_args,
)


# ---------------------------------------------------------------------------
# Session dependency
# ---------------------------------------------------------------------------


def get_session() -> Generator[Session, None, None]:
    """FastAPI dependency that yields a database session per request."""
    with Session(engine) as session:
        try:
            yield session
        except Exception:
            session.rollback()
            raise


# ---------------------------------------------------------------------------
# Schema creation
# ---------------------------------------------------------------------------


def _ensure_users_last_login_column() -> None:
    """
    create_all() only creates tables that don't exist yet — it never alters
    an existing table's columns, so a `users` table from before this field
    was added would otherwise make every query touching User.last_login
    fail with "no such column" on an already-deployed DB. Idempotent: only
    ALTERs when the column is actually missing.

    SQLite-specific (PRAGMA table_info) — fine here since this app has no
    other supported database backend.
    """
    if not settings.DATABASE_URL.startswith("sqlite"):
        return
    with engine.connect() as conn:
        columns = {row[1] for row in conn.exec_driver_sql("PRAGMA table_info(users)").fetchall()}
        if "last_login" not in columns:
            conn.exec_driver_sql("ALTER TABLE users ADD COLUMN last_login TIMESTAMP")
            conn.commit()
            logger.info("Added users.last_login column to existing database.")


def _ensure_stream_routes_failover_columns() -> None:
    """Same story as _ensure_users_last_login_column() above — an existing
    stream_routes table from before automatic failover shipped needs these
    two columns ALTERed in, since create_all() never does that itself."""
    if not settings.DATABASE_URL.startswith("sqlite"):
        return
    with engine.connect() as conn:
        columns = {row[1] for row in conn.exec_driver_sql("PRAGMA table_info(stream_routes)").fetchall()}
        if "backup_source_path" not in columns:
            conn.exec_driver_sql("ALTER TABLE stream_routes ADD COLUMN backup_source_path TEXT")
            conn.commit()
            logger.info("Added stream_routes.backup_source_path column to existing database.")
        if "failed_over" not in columns:
            conn.exec_driver_sql("ALTER TABLE stream_routes ADD COLUMN failed_over BOOLEAN DEFAULT 0")
            conn.commit()
            logger.info("Added stream_routes.failed_over column to existing database.")


def create_db_and_tables() -> None:
    """Create all tables defined by SQLModel metadata.

    Call this once at application startup (e.g. in a lifespan handler).
    Safe to call multiple times — SQLModel / SQLAlchemy uses CREATE TABLE IF NOT EXISTS.
    """
    # Import all models so their metadata is registered before create_all.
    from . import models  # noqa: F401 — side-effect import

    SQLModel.metadata.create_all(engine)
    _ensure_users_last_login_column()
    _ensure_stream_routes_failover_columns()
    logger.info("Database tables created (or already exist).")


# ---------------------------------------------------------------------------
# Seed
# ---------------------------------------------------------------------------


def seed_default_admin() -> None:
    """Insert an admin/admin123 user if the users table is empty.

    This gives operators a first login without having to touch the DB directly.
    The password should be changed immediately after first login.
    """
    # Deferred import to avoid circular dependency at module load time.
    from .auth import get_password_hash
    from .models import User, UserRole

    with Session(engine) as session:
        existing = session.exec(select(User)).first()
        if existing is not None:
            logger.debug("seed_default_admin: users already exist, skipping.")
            return

        admin = User(
            username="admin",
            email="admin@arena.local",
            hashed_password=get_password_hash("admin123"),
            role=UserRole.admin,
            is_active=True,
        )
        session.add(admin)
        session.commit()
        logger.warning(
            "Default admin user created (username=admin, password=admin123). "
            "Change this password immediately."
        )
