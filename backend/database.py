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


def create_db_and_tables() -> None:
    """Create all tables defined by SQLModel metadata.

    Call this once at application startup (e.g. in a lifespan handler).
    Safe to call multiple times — SQLModel / SQLAlchemy uses CREATE TABLE IF NOT EXISTS.
    """
    # Import all models so their metadata is registered before create_all.
    from . import models  # noqa: F401 — side-effect import

    SQLModel.metadata.create_all(engine)
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
