"""
Router: /api/audit

Read-only, admin-only view of the audit log (services/audit.py writes it
from the mutating endpoints themselves).
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from sqlmodel import Session, select

from ..auth import require_admin
from ..database import get_session
from ..models import AuditLogEntry, User

router = APIRouter(tags=["audit"])


@router.get("", response_model=list[AuditLogEntry], summary="Recent audit log entries, newest first (admin only)")
async def list_audit_log(
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    session: Session = Depends(get_session),
    _admin: User = Depends(require_admin),
) -> list[AuditLogEntry]:
    return session.exec(
        select(AuditLogEntry).order_by(AuditLogEntry.id.desc()).offset(offset).limit(limit)
    ).all()
