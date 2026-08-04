"""
Audit log writer — who did what, for accountability on a multi-operator
team. Same shape as services/events.py's log_event(): a plain function
called directly at the point of action, no background service.

log_audit() never raises — a logging failure must not block the mutation
it's describing. Call it with the SAME session the caller is about to
commit, right before that commit, so the audit row and the actual change
land in one transaction (or neither does, on rollback).
"""

from __future__ import annotations

import logging

from sqlmodel import Session, select

from ..models import AuditLogEntry

logger = logging.getLogger(__name__)

# Ring-buffer cap, same rationale as events.py's — this is an operational
# accountability trail for recent activity, not a permanent compliance
# record requiring unbounded retention.
_MAX_ROWS = 2000


def log_audit(
    session: Session,
    username: str,
    action: str,
    target: str | None = None,
    detail: str | None = None,
) -> None:
    try:
        entry = AuditLogEntry(username=username, action=action, target=target, detail=detail)
        session.add(entry)
        session.commit()

        overflow = session.exec(
            select(AuditLogEntry).order_by(AuditLogEntry.id.desc()).offset(_MAX_ROWS)
        ).all()
        for old in overflow:
            session.delete(old)
        if overflow:
            session.commit()
    except Exception:
        logger.exception("Failed to write audit log entry: %s %s", action, target)
