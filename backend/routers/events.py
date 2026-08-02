"""
Router: /api/events

Read-only feed of stream connect/disconnect, recording start/stop, and
alert transitions — written by services/alerting.py and services/recorder.py
via services/events.log_event(). Backs the dashboard's "Recent Events"
sidebar, which previously had no backend behind it at all.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from sqlmodel import Session, select

from ..auth import get_current_active_user
from ..database import get_session
from ..models import Event, EventRead, User

router = APIRouter(tags=["events"])


@router.get("", response_model=list[EventRead], summary="Recent events, newest first")
async def list_events(
    limit: int = Query(default=50, ge=1, le=200),
    session: Session = Depends(get_session),
    _user: User = Depends(get_current_active_user),
) -> list[Event]:
    return session.exec(select(Event).order_by(Event.id.desc()).limit(limit)).all()
