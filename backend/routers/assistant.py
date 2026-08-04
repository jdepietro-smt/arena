"""
Router: /api/assistant

Natural-language Q&A over live stream/alert/event state, backed by the
Anthropic API (services/assistant.py). Reuses the existing streams/events
list functions directly rather than re-querying MediaMTX/the DB, so the
assistant's view of the world always matches what the dashboard shows.
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlmodel import Session

from ..auth import get_current_active_user
from ..database import get_session
from ..models import User
from ..services import assistant as assistant_service
from ..services.alerting import get_alert_manager
from ..services.mediamtx import MediaMTXClient, get_client
from .events import list_events
from .streams import list_streams

logger = logging.getLogger(__name__)

router = APIRouter(tags=["assistant"])


class AssistantQuery(BaseModel):
    question: str


class AssistantAnswer(BaseModel):
    answer: str


def _build_context(streams: list[dict], alert_status: dict, events: list) -> dict:
    return {
        "streams": [
            {
                "name": s.get("name") or s.get("path"),
                "path": s.get("path"),
                "live": s.get("ready", False),
                "recording": s.get("recording", False),
                "bitrate_kbps": s.get("bitrate_kbps"),
                "rtt_ms": s.get("rtt_ms"),
                "packet_loss_pct": s.get("packet_loss_pct"),
                "viewers": s.get("readers"),
            }
            for s in streams
        ],
        "down_streams": alert_status.get("down_streams", []),
        "firing_alert_rule_ids": alert_status.get("firing_rule_ids", []),
        "recent_events": [
            {
                "type": e.type,
                "stream_path": e.stream_path,
                "message": e.message,
                "at": e.created_at.isoformat() if e.created_at else None,
            }
            for e in events
        ],
    }


@router.post(
    "/query",
    response_model=AssistantAnswer,
    summary="Ask the ops assistant a question about live system state",
)
async def query_assistant(
    body: AssistantQuery,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_active_user),
    client: MediaMTXClient = Depends(get_client),
) -> AssistantAnswer:
    if not body.question.strip():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="question must not be empty")

    streams = await list_streams(session=session, _user=user, client=client)
    events = await list_events(limit=15, session=session, _user=user)
    alert_status = get_alert_manager().status()

    context = _build_context(streams, alert_status, events)

    try:
        answer = await assistant_service.ask(body.question, context)
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc))

    return AssistantAnswer(answer=answer)
