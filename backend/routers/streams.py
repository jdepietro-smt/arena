"""
Router: /api/streams

Provides stream listing, detail, preset management, recording control,
and preview URL generation, backed by MediaMTX and the SQLite DB.
"""

from __future__ import annotations

import logging
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from sqlmodel import Session, select

from ..auth import get_current_active_user
from ..config import settings
from ..database import get_session
from ..models import (
    Recording,
    RecordingStatus,
    StreamPreset,
    User,
)
from ..services.mediamtx import MediaMTXClient, MediaMTXError, get_client

logger = logging.getLogger(__name__)

router = APIRouter(tags=["streams"])


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------


def _mediamtx_to_stream_info(path: dict[str, Any]) -> dict[str, Any]:
    """Normalise a raw MediaMTX path item into a consistent dict."""
    source = path.get("source") or {}
    return {
        "path": path.get("name", ""),
        "ready": path.get("ready", False),
        "ready_time": path.get("readyTime"),
        "readers": len(path.get("readers", [])),
        "bytes_received": path.get("bytesReceived", 0),
        "bytes_sent": path.get("bytesSent", 0),
        "source_type": source.get("type"),
        "source_address": source.get("remoteAddr"),
    }


def _preview_urls(path_name: str) -> dict[str, str]:
    ip = settings.SERVER_IP
    return {
        "webrtc": f"http://{ip}:8889/{path_name}/whep",
        "hls": f"http://{ip}:8888/{path_name}/index.m3u8",
        "srt": f"srt://{ip}:{settings.MEDIAMTX_SRT_PORT}?streamid=read:{path_name}",
    }


# ---------------------------------------------------------------------------
# Stream listing & detail
# ---------------------------------------------------------------------------


@router.get("", summary="List all active streams")
async def list_streams(
    session: Session = Depends(get_session),
    _user: User = Depends(get_current_active_user),
    client: MediaMTXClient = Depends(get_client),
) -> list[dict[str, Any]]:
    """
    Return all MediaMTX paths enriched with DB preset metadata (if a preset
    exists whose name matches the stream path).
    """
    try:
        raw_paths = await client.get_paths()
    except MediaMTXError as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"MediaMTX unavailable: {exc.detail}",
        )

    # Build a lookup map of presets keyed by name so we can O(1) enrich.
    presets_by_name: dict[str, StreamPreset] = {
        p.name: p
        for p in session.exec(select(StreamPreset)).all()
    }

    streams = []
    for raw in raw_paths:
        info = _mediamtx_to_stream_info(raw)
        preset = presets_by_name.get(info["path"])
        info["preset"] = (
            {
                "id": preset.id,
                "name": preset.name,
                "description": preset.description,
                "tags": preset.tags,
                "srt_url": preset.srt_url,
            }
            if preset
            else None
        )
        info["preview_urls"] = _preview_urls(info["path"])
        streams.append(info)

    return streams


@router.get("/{path_name}", summary="Single stream detail with connections")
async def get_stream(
    path_name: str,
    _user: User = Depends(get_current_active_user),
    client: MediaMTXClient = Depends(get_client),
) -> dict[str, Any]:
    """
    Return detail for a single MediaMTX path including all active
    connections, grouped by protocol.
    """
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

    try:
        connections = await client.get_connections()
    except MediaMTXError as exc:
        logger.warning("Could not fetch connections: %s", exc)
        connections = {}

    # Filter connections to only those belonging to this path.
    filtered_connections: dict[str, list[dict]] = {}
    for proto, conns in connections.items():
        path_conns = [c for c in conns if c.get("path") == path_name]
        if path_conns:
            filtered_connections[proto] = path_conns

    info = _mediamtx_to_stream_info(raw)
    info["connections"] = filtered_connections
    info["preview_urls"] = _preview_urls(path_name)
    return info


# ---------------------------------------------------------------------------
# Preview URLs
# ---------------------------------------------------------------------------


@router.get("/{path_name}/preview-url", summary="Playback URLs for a stream")
async def stream_preview_url(
    path_name: str,
    _user: User = Depends(get_current_active_user),
) -> dict[str, str]:
    """
    Return the WebRTC WHEP, HLS, and SRT reader URLs for a given stream path.

    WebRTC: http://{SERVER_IP}:8889/{path}/whep
    HLS:    http://{SERVER_IP}:8888/{path}/index.m3u8
    SRT:    srt://{SERVER_IP}:{SRT_PORT}?streamid=read:{path}
    """
    return _preview_urls(path_name)


# ---------------------------------------------------------------------------
# Presets
# ---------------------------------------------------------------------------


@router.post("/preset", status_code=status.HTTP_201_CREATED, summary="Save a stream preset")
async def create_preset(
    preset_in: StreamPreset,
    session: Session = Depends(get_session),
    _user: User = Depends(get_current_active_user),
) -> dict[str, Any]:
    """
    Persist a StreamPreset to the database.  The preset name should
    typically match the MediaMTX path name so that list_streams can
    enrich stream data automatically.
    """
    existing = session.exec(
        select(StreamPreset).where(StreamPreset.name == preset_in.name)
    ).first()
    if existing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Preset '{preset_in.name}' already exists",
        )

    # SQLModel assigns the id during commit; make sure we don't carry a
    # caller-supplied id that could conflict.
    preset_in.id = None
    session.add(preset_in)
    session.commit()
    session.refresh(preset_in)
    return {
        "id": preset_in.id,
        "name": preset_in.name,
        "srt_url": preset_in.srt_url,
        "description": preset_in.description,
        "tags": preset_in.tags,
    }


@router.get("/presets", summary="List saved stream presets")
async def list_presets(
    session: Session = Depends(get_session),
    _user: User = Depends(get_current_active_user),
) -> list[dict[str, Any]]:
    """Return all saved stream presets ordered by name."""
    presets = session.exec(select(StreamPreset).order_by(StreamPreset.name)).all()
    return [
        {
            "id": p.id,
            "name": p.name,
            "srt_url": p.srt_url,
            "description": p.description,
            "tags": p.tags,
        }
        for p in presets
    ]


@router.delete("/presets/{preset_id}", status_code=status.HTTP_200_OK, summary="Delete a preset")
async def delete_preset(
    preset_id: int,
    session: Session = Depends(get_session),
    _user: User = Depends(get_current_active_user),
) -> None:
    """Permanently remove a stream preset from the database."""
    preset = session.get(StreamPreset, preset_id)
    if preset is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Preset {preset_id} not found",
        )
    session.delete(preset)
    session.commit()


# ---------------------------------------------------------------------------
# Recording control
# ---------------------------------------------------------------------------


@router.post("/{path_name}/start-recording", summary="Start recording a stream")
async def start_recording(
    path_name: str,
    session: Session = Depends(get_session),
    _user: User = Depends(get_current_active_user),
    client: MediaMTXClient = Depends(get_client),
) -> dict[str, Any]:
    """
    Instruct the recorder service to begin capturing the given stream.
    Creates a Recording DB entry with status=recording and calls
    recorder.start_recording().
    """
    # Verify the path exists in MediaMTX before starting.
    try:
        await client.get_path(path_name)
    except MediaMTXError as exc:
        if exc.status_code == 404:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Stream '{path_name}' not found in MediaMTX",
            )
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"MediaMTX error: {exc.detail}",
        )

    # Guard: don't start a second recording on the same path.
    active = session.exec(
        select(Recording).where(
            Recording.stream_path == path_name,
            Recording.status == RecordingStatus.recording,
        )
    ).first()
    if active:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Recording already active for stream '{path_name}' (id={active.id})",
        )

    try:
        from ..services.recorder import start_recording as _start  # lazy import

        recording = await _start(session, path_name)
    except Exception as exc:
        logger.exception("Failed to start recording for %s", path_name)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Could not start recording: {exc}",
        )

    return {
        "recording_id": recording.id,
        "stream_path": recording.stream_path,
        "filename": recording.filename,
        "started_at": recording.started_at,
        "status": recording.status,
    }


@router.post("/{path_name}/stop-recording", summary="Stop recording a stream")
async def stop_recording(
    path_name: str,
    session: Session = Depends(get_session),
    _user: User = Depends(get_current_active_user),
) -> dict[str, Any]:
    """
    Stop an active recording for the given stream path and finalise the
    Recording DB entry (status=complete, ended_at=now).
    """
    active = session.exec(
        select(Recording).where(
            Recording.stream_path == path_name,
            Recording.status == RecordingStatus.recording,
        )
    ).first()
    if active is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"No active recording found for stream '{path_name}'",
        )

    try:
        from ..services.recorder import stop_recording as _stop  # lazy import

        recording = await _stop(session, active.id)
    except Exception as exc:
        logger.exception("Failed to stop recording %s", active.id)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Could not stop recording: {exc}",
        )

    return {
        "recording_id": recording.id,
        "stream_path": recording.stream_path,
        "filename": recording.filename,
        "started_at": recording.started_at,
        "ended_at": recording.ended_at,
        "duration_seconds": recording.duration_seconds,
        "size_bytes": recording.size_bytes,
        "status": recording.status,
    }
