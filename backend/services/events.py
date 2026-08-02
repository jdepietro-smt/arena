"""
Event log writer — backs the dashboard's "Recent Events" feed.

Not a background service (no start()/stop(), nothing to poll): callers that
already detect a transition (alerting.py, recorder.py) call log_event()
directly at the point of detection. Kept as a plain function rather than a
class since there's no in-process state to hold beyond the DB itself.
"""

from __future__ import annotations

import logging

from sqlmodel import Session, select

from ..models import Event, EventType

logger = logging.getLogger(__name__)

# Ring-buffer cap so the table doesn't grow forever on a long-running
# instance — recent events are all a dashboard sidebar needs.
_MAX_ROWS = 500


def log_event(
    session: Session,
    event_type: EventType,
    stream_path: str | None = None,
    message: str | None = None,
) -> Event:
    event = Event(type=event_type, stream_path=stream_path, message=message)
    session.add(event)
    session.commit()
    session.refresh(event)

    overflow = session.exec(
        select(Event).order_by(Event.id.desc()).offset(_MAX_ROWS)
    ).all()
    for old in overflow:
        session.delete(old)
    if overflow:
        session.commit()

    return event
