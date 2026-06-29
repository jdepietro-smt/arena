"""
Router: /api/stats

Real-time and historical statistics for stream paths.

- REST endpoints return point-in-time snapshots or history windows.
- WebSocket /api/stats/ws pushes a JSON payload every 2 s for all active
  paths, making it suitable for dashboard polling without client-side timers.

Stats are derived from MediaMTX path data.  Historical storage is backed
by an in-process ring buffer (StatsStore) rather than the SQL DB to avoid
write amplification; the buffer is populated by a background task that runs
in the FastAPI lifespan.
"""

from __future__ import annotations

import asyncio
import json
import logging
from datetime import datetime
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, WebSocket, WebSocketDisconnect, status
from sqlmodel import Session

from ..auth import get_current_active_user
from ..database import get_session
from ..models import StatsSnapshot, User
from ..services.mediamtx import MediaMTXClient, MediaMTXError, get_client

logger = logging.getLogger(__name__)

router = APIRouter(tags=["stats"])

# How often the WebSocket pushes updates to connected clients (seconds).
_WS_PUSH_INTERVAL = 2.0


# ---------------------------------------------------------------------------
# Stats derivation helpers
# ---------------------------------------------------------------------------


def _snapshot_from_path(raw: dict[str, Any]) -> StatsSnapshot:
    """
    Derive a StatsSnapshot from a raw MediaMTX path dict.

    MediaMTX does not expose bitrate/RTT/loss directly on the path object —
    those live on individual SRT connection objects.  We use bytesReceived
    delta as a proxy for bitrate when per-connection data isn't threaded in.

    Callers that want per-connection SRT stats should query /v3/srtconns/list
    and correlate by path name.
    """
    source = raw.get("source") or {}
    # SRT source connections sometimes expose rtt/packetLoss in their detail.
    rtt_ms: float = source.get("rtt", 0.0) or 0.0
    packet_loss: float = source.get("packetLoss", 0.0) or 0.0

    return StatsSnapshot(
        path=raw.get("name", ""),
        timestamp=datetime.utcnow(),
        bitrate_kbps=0.0,  # Populated by StatsStore if delta tracking is active.
        rtt_ms=rtt_ms,
        packet_loss_pct=packet_loss,
        readers=len(raw.get("readers", [])),
        bytes_received=raw.get("bytesReceived", 0),
        bytes_sent=raw.get("bytesSent", 0),
    )


async def _fetch_all_snapshots(
    client: MediaMTXClient,
) -> list[StatsSnapshot]:
    """Pull all MediaMTX paths and convert to StatsSnapshot objects."""
    try:
        raw_paths = await client.get_paths()
    except MediaMTXError as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"MediaMTX unavailable: {exc.detail}",
        )
    return [_snapshot_from_path(p) for p in raw_paths if p.get("ready")]


async def _fetch_snapshot(
    path_name: str,
    client: MediaMTXClient,
) -> StatsSnapshot:
    """Pull a single MediaMTX path and return a StatsSnapshot."""
    try:
        raw = await client.get_path(path_name)
    except MediaMTXError as exc:
        if exc.status_code == 404:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Stream '{path_name}' not found",
            )
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"MediaMTX error: {exc.detail}",
        )
    return _snapshot_from_path(raw)


# ---------------------------------------------------------------------------
# Endpoints — REST
# ---------------------------------------------------------------------------


@router.get("/summary", summary="Current stats for all active streams")
async def stats_summary(
    _user: User = Depends(get_current_active_user),
    client: MediaMTXClient = Depends(get_client),
) -> list[dict[str, Any]]:
    """
    Return a single stats snapshot for every currently-ready stream.

    Useful for dashboard widgets that need an at-a-glance view of all paths
    without opening a WebSocket.
    """
    snapshots = await _fetch_all_snapshots(client)
    return [s.model_dump() for s in snapshots]


@router.get("/{path_name}", summary="Current stats for one stream")
async def stream_stats(
    path_name: str,
    _user: User = Depends(get_current_active_user),
    client: MediaMTXClient = Depends(get_client),
) -> dict[str, Any]:
    """Return a single stats snapshot for the given stream path."""
    snapshot = await _fetch_snapshot(path_name, client)
    return snapshot.model_dump()


@router.get("/{path_name}/history", summary="Historical stats window")
async def stream_stats_history(
    path_name: str,
    seconds: int = Query(
        default=60,
        ge=1,
        le=3600,
        description="How many seconds of history to return",
    ),
    _user: User = Depends(get_current_active_user),
) -> list[dict[str, Any]]:
    """
    Return the last N seconds of stats history for a stream.

    History is kept in the in-process StatsStore ring buffer populated by
    the background polling task.  If the StatsStore is not running (e.g.
    during tests) an empty list is returned rather than raising.
    """
    try:
        from ..services.stats_store import stats_store  # lazy import

        history = stats_store.get_history(path_name, seconds=seconds)
        return [s.model_dump() for s in history]
    except ImportError:
        logger.warning("stats_store service not available; returning empty history")
        return []
    except Exception as exc:
        logger.error("Error fetching stats history for %s: %s", path_name, exc)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Could not retrieve stats history",
        )


# ---------------------------------------------------------------------------
# WebSocket — live push
# ---------------------------------------------------------------------------


@router.websocket("/ws")
async def stats_websocket(
    websocket: WebSocket,
    client: MediaMTXClient = Depends(get_client),
) -> None:
    """
    WebSocket endpoint that pushes live stats for all active streams every 2 s.

    Protocol
    --------
    Server → Client messages are JSON objects:

        {
            "ts": "<ISO-8601 UTC timestamp>",
            "streams": [
                {
                    "path": "...",
                    "timestamp": "...",
                    "bitrate_kbps": 0.0,
                    "rtt_ms": 0.0,
                    "packet_loss_pct": 0.0,
                    "readers": 0,
                    "bytes_received": 0,
                    "bytes_sent": 0
                },
                ...
            ]
        }

    The client does not need to send any messages; the connection is
    receive-and-hold.  Sending any message is silently ignored.

    Authentication
    --------------
    Pass the JWT bearer token as a query parameter:
        ws://host/api/stats/ws?token=<jwt>

    (Browser WebSocket API does not support custom headers, so query-param
    auth is the standard workaround.)
    """
    # Validate the token before accepting the socket.
    token: Optional[str] = websocket.query_params.get("token")
    if not token:
        await websocket.close(code=4001)
        return

    try:
        # Reuse the same JWT validation logic as HTTP routes.
        from ..auth import get_current_user  # noqa: PLC0415
        from ..database import get_session as _get_session  # noqa: PLC0415

        # Build a minimal mock request environment so we can reuse the dep.
        # Simpler: decode the token directly here.
        from jose import JWTError, jwt  # noqa: PLC0415

        from ..config import settings  # noqa: PLC0415

        payload = jwt.decode(
            token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM]
        )
        if payload.get("sub") is None:
            await websocket.close(code=4001)
            return
    except JWTError:
        await websocket.close(code=4001)
        return

    await websocket.accept()
    logger.info("Stats WebSocket connected: %s", websocket.client)

    try:
        while True:
            # Fetch latest stats from MediaMTX.
            try:
                snapshots = await _fetch_all_snapshots(client)
            except HTTPException:
                snapshots = []

            payload_out = {
                "ts": datetime.utcnow().isoformat() + "Z",
                "streams": [s.model_dump() for s in snapshots],
            }

            try:
                await websocket.send_text(json.dumps(payload_out, default=str))
            except WebSocketDisconnect:
                break

            # Drain any incoming messages (keep the connection healthy).
            try:
                await asyncio.wait_for(websocket.receive_text(), timeout=_WS_PUSH_INTERVAL)
            except asyncio.TimeoutError:
                pass  # Normal — client is just listening.
            except WebSocketDisconnect:
                break

    except WebSocketDisconnect:
        pass
    finally:
        logger.info("Stats WebSocket disconnected: %s", websocket.client)
