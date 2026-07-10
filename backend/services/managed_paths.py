"""
Registry of mediamtx paths this app created and is responsible for.

CompositorManager and ExternalSourceManager track their running jobs in an
in-memory dict that's wiped on every process restart, but the mediamtx path
configs they create via add_path are not — they persist as permanently-dead
path entries until removed. This module backs that in-memory state with a
DB table (ManagedPath) that survives restarts, so a fresh process can look
up what its predecessor left behind and clean it up.

Usage:
    register_path(name, ManagedPathType.composite)     # after a successful add_path
    unregister_path(name)                              # after a clean remove_path
    await reconcile_orphans()                          # once, at startup
"""

from __future__ import annotations

import logging

from sqlmodel import Session, select

from ..database import engine
from ..models import ManagedPath, ManagedPathType
from .mediamtx import get_client

logger = logging.getLogger(__name__)


def register_path(name: str, path_type: ManagedPathType) -> None:
    with Session(engine) as session:
        existing = session.exec(select(ManagedPath).where(ManagedPath.name == name)).first()
        if existing is not None:
            existing.path_type = path_type
        else:
            session.add(ManagedPath(name=name, path_type=path_type))
        session.commit()


def unregister_path(name: str) -> None:
    with Session(engine) as session:
        existing = session.exec(select(ManagedPath).where(ManagedPath.name == name)).first()
        if existing is not None:
            session.delete(existing)
            session.commit()


async def reconcile_orphans() -> None:
    """
    Remove mediamtx paths left behind by a previous process's lifetime.

    Called once at startup, before the compositor/external-source managers
    start accepting new jobs. Every row still in managed_paths at this point
    is guaranteed to be an orphan — a fresh process has no legitimate
    in-memory jobs yet, so nothing could have re-registered it.
    """
    with Session(engine) as session:
        orphans = session.exec(select(ManagedPath)).all()

    if not orphans:
        return

    client = get_client()
    removed = 0
    for orphan in orphans:
        try:
            await client.remove_path(orphan.name)
            removed += 1
        except Exception as exc:
            logger.warning("Startup reconciliation: failed to remove orphan path %s: %s", orphan.name, exc)

    with Session(engine) as session:
        for orphan in orphans:
            row = session.get(ManagedPath, orphan.id)
            if row is not None:
                session.delete(row)
        session.commit()

    logger.info("Startup reconciliation: removed %d/%d orphaned mediamtx path(s)", removed, len(orphans))
