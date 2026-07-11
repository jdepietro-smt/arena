"""
Router: /api/recordings

Browse, download, and manage completed (and in-progress) recordings
stored on disk and tracked in the database.
"""

from __future__ import annotations

import logging
import os
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import FileResponse
from sqlmodel import Session, select

from ..auth import get_current_active_user, get_current_user_flexible, require_admin
from ..config import settings
from ..database import get_session
from ..models import Recording, RecordingRead, User

logger = logging.getLogger(__name__)

router = APIRouter(tags=["recordings"])


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------


def _recording_base_dir() -> Path:
    """Return the root directory where recordings are stored.

    Reads RECORDINGS_DIR from settings (falls back to './recordings' relative
    to the working directory).  The directory must exist; creation is the
    responsibility of the recorder service.
    """
    try:
        base = Path(settings.RECORDINGS_DIR)  # type: ignore[attr-defined]
    except AttributeError:
        base = Path("recordings")
    return base


def _resolve_path(filename: str) -> Path:
    """Return the absolute path for a recording filename, safely."""
    base = _recording_base_dir().resolve()
    candidate = (base / filename).resolve()
    # Guard against path traversal: ensure candidate is inside base.
    if not str(candidate).startswith(str(base)):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid filename",
        )
    return candidate


def _thumbnail_path(filename: str) -> Optional[Path]:
    """
    Return the thumbnail path for a recording if it exists.

    Convention: same directory, same stem, .jpg extension.
    e.g. recordings/stream_20240101_120000.mp4 → recordings/stream_20240101_120000.jpg
    """
    base = _recording_base_dir().resolve()
    stem = Path(filename).stem
    thumb = base / f"{stem}.jpg"
    return thumb if thumb.exists() else None


async def _get_recording_or_404(session: Session, recording_id: int) -> Recording:
    recording = session.get(Recording, recording_id)
    if recording is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Recording {recording_id} not found",
        )
    return recording


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


@router.get(
    "",
    response_model=list[RecordingRead],
    summary="List all recordings",
)
async def list_recordings(
    stream_path: Optional[str] = Query(default=None, description="Filter by stream path"),
    limit: int = Query(default=100, ge=1, le=1000, description="Max results to return"),
    offset: int = Query(default=0, ge=0, description="Pagination offset"),
    session: Session = Depends(get_session),
    _user: User = Depends(get_current_active_user),
) -> list[RecordingRead]:
    """
    Return recordings sorted by started_at descending (newest first).

    Optionally filter by stream_path.  Supports simple limit/offset pagination.
    """
    query = select(Recording).order_by(Recording.started_at.desc())  # type: ignore[attr-defined]
    if stream_path:
        query = query.where(Recording.stream_path == stream_path)
    query = query.offset(offset).limit(limit)
    recordings = session.exec(query).all()
    return [RecordingRead.model_validate(r) for r in recordings]


@router.get(
    "/{recording_id}",
    response_model=RecordingRead,
    summary="Single recording metadata",
)
async def get_recording(
    recording_id: int,
    session: Session = Depends(get_session),
    _user: User = Depends(get_current_active_user),
) -> RecordingRead:
    """Return metadata for a single recording."""
    recording = await _get_recording_or_404(session, recording_id)
    return RecordingRead.model_validate(recording)


@router.delete(
    "/{recording_id}",
    status_code=status.HTTP_200_OK,
    summary="Delete recording file and DB entry",
)
async def delete_recording(
    recording_id: int,
    session: Session = Depends(get_session),
    _admin: User = Depends(require_admin),
) -> None:
    """
    Permanently delete a recording.

    Removes the file from disk first, then deletes the database row.
    If the file is already missing, the DB row is still removed.
    Requires admin privileges.
    """
    recording = await _get_recording_or_404(session, recording_id)
    file_path = _resolve_path(recording.filename)

    if file_path.exists():
        try:
            file_path.unlink()
            logger.info("Deleted recording file: %s", file_path)
        except OSError as exc:
            logger.error("Could not delete file %s: %s", file_path, exc)
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=f"Could not delete file from disk: {exc}",
            )
    else:
        logger.warning(
            "Recording file %s not found on disk; deleting DB row anyway", file_path
        )

    # Also remove thumbnail if it exists.
    thumb = _thumbnail_path(recording.filename)
    if thumb is not None:
        try:
            thumb.unlink()
        except OSError:
            pass  # Non-fatal; thumbnail cleanup is best-effort.

    session.delete(recording)
    session.commit()


@router.get(
    "/{recording_id}/download",
    summary="Download a recording file",
)
async def download_recording(
    recording_id: int,
    session: Session = Depends(get_session),
    _user: User = Depends(get_current_active_user),
) -> FileResponse:
    """
    Serve the recording file as a binary download.

    The Content-Disposition header prompts the browser to save with the
    original filename.
    """
    recording = await _get_recording_or_404(session, recording_id)
    file_path = _resolve_path(recording.filename)

    if not file_path.exists():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Recording file not found on disk",
        )

    # Determine media type from extension; default to octet-stream.
    suffix = file_path.suffix.lower()
    media_type_map = {
        ".mp4": "video/mp4",
        ".mkv": "video/x-matroska",
        ".ts": "video/mp2t",
        ".mov": "video/quicktime",
    }
    media_type = media_type_map.get(suffix, "application/octet-stream")

    return FileResponse(
        path=str(file_path),
        media_type=media_type,
        filename=file_path.name,
        headers={"Content-Disposition": f'attachment; filename="{file_path.name}"'},
    )


@router.get(
    "/{recording_id}/stream",
    summary="Stream a recording inline for browser preview",
)
async def stream_recording(
    recording_id: int,
    session: Session = Depends(get_session),
    _user: User = Depends(get_current_user_flexible),
) -> FileResponse:
    """
    Same file as /download, but without Content-Disposition: attachment —
    lets a <video> element play it in place instead of the browser treating
    every request as a save-to-disk. FileResponse (Starlette) already
    supports Range requests, so seeking works normally — but only if the
    caller is an actual <video src>/range-requesting client and not a blob
    fetch, which pulls the whole file before resolving. Auth accepts a
    `token` query param (via get_current_user_flexible) for exactly that
    reason: a <video> element can't send an Authorization header.
    """
    recording = await _get_recording_or_404(session, recording_id)
    file_path = _resolve_path(recording.filename)

    if not file_path.exists():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Recording file not found on disk",
        )

    suffix = file_path.suffix.lower()
    media_type_map = {
        ".mp4": "video/mp4",
        ".mkv": "video/x-matroska",
        ".ts": "video/mp2t",
        ".mov": "video/quicktime",
    }
    media_type = media_type_map.get(suffix, "application/octet-stream")

    return FileResponse(path=str(file_path), media_type=media_type)


@router.get(
    "/debug/path-config/{path_name}",
    summary="Debug: mediamtx's actual running config for a path (source, runOnReady, etc.)",
)
async def debug_path_config(path_name: str, _admin: User = Depends(require_admin)) -> dict:
    from ..services.mediamtx import MediaMTXError, get_client as get_mediamtx_client

    client = get_mediamtx_client()
    try:
        return await client.get_path_config(path_name)
    except MediaMTXError as exc:
        # Live streams usually aren't individually configured — they match a
        # wildcard entry (e.g. "all") rather than having their own named
        # config — so also try that, and fall back to the full global config
        # (which includes the paths section) so there's always something to
        # compare rather than a bare error.
        try:
            wildcard = await client.get_path_config("all")
        except Exception:
            wildcard = None
        return {
            "error_for_exact_name": str(exc),
            "wildcard_all_config": wildcard,
        }
    except Exception as exc:
        return {"unexpected_error": f"{type(exc).__name__}: {exc}"}


@router.get(
    "/{recording_id}/debug/last-error",
    summary="Debug: the last ffmpeg error for this recording, if it exited unexpectedly",
)
async def debug_recording_last_error(recording_id: int, _admin: User = Depends(require_admin)) -> dict:
    from ..services.recorder import get_last_error

    return {"last_error": get_last_error(recording_id)}


@router.get(
    "/debug/hls-generators",
    summary="Debug: status of the per-stream keyframe-forcing HLS generators",
)
async def debug_hls_generators(_admin: User = Depends(require_admin)) -> list[dict]:
    from ..services.hls_generator import get_hls_generator

    return get_hls_generator().list_jobs()


@router.get(
    "/debug/probe-native-hls/{path_name}",
    summary="Debug: ffprobe mediamtx's own native HLS output for a path, live",
)
async def debug_probe_native_hls(path_name: str, _admin: User = Depends(require_admin)) -> dict:
    import asyncio
    import json

    from ..config import settings

    url = f"{settings.MEDIAMTX_HLS.rstrip('/')}/{path_name}/index.m3u8"
    proc = await asyncio.create_subprocess_exec(
        "ffprobe", "-v", "quiet", "-print_format", "json", "-show_streams", "-timeout", "8000000", url,
        stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
    )
    try:
        stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=15)
    except asyncio.TimeoutError:
        proc.kill()
        return {"url": url, "error": "ffprobe timed out"}
    if proc.returncode != 0:
        return {"url": url, "error": (stderr or b"").decode("utf-8", errors="replace")[-1000:]}
    return {"url": url, "probe": json.loads(stdout.decode("utf-8", errors="replace"))}


@router.get(
    "/debug/hls-dir",
    summary="Debug: what's actually in /tmp/arena-hls right now",
)
async def debug_hls_dir(_admin: User = Depends(require_admin)) -> dict:
    base = Path("/tmp/arena-hls")
    if not base.is_dir():
        return {"exists": False, "path": str(base)}
    entries = {}
    for stream_dir in base.iterdir():
        if not stream_dir.is_dir():
            continue
        files = sorted(p.name for p in stream_dir.iterdir())
        entries[stream_dir.name] = files
    return {"exists": True, "path": str(base), "entries": entries}


@router.get(
    "/{recording_id}/debug/probe",
    summary="Debug: ffprobe the recording's actual codecs",
)
async def probe_recording(
    recording_id: int,
    session: Session = Depends(get_session),
    _admin: User = Depends(require_admin),
) -> dict:
    import asyncio
    import json

    recording = await _get_recording_or_404(session, recording_id)
    file_path = _resolve_path(recording.filename)
    if not file_path.exists():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Recording file not found on disk")

    proc = await asyncio.create_subprocess_exec(
        "ffprobe", "-v", "quiet", "-print_format", "json", "-show_streams", "-show_format", str(file_path),
        stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
    )
    stdout, stderr = await proc.communicate()
    if proc.returncode != 0:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                             detail=(stderr or b"").decode("utf-8", errors="replace")[-1000:])
    return json.loads(stdout.decode("utf-8", errors="replace"))


@router.get(
    "/{recording_id}/thumbnail",
    summary="Return recording thumbnail image",
)
async def get_thumbnail(
    recording_id: int,
    session: Session = Depends(get_session),
    _user: User = Depends(get_current_active_user),
) -> FileResponse:
    """
    Return a JPEG thumbnail for the recording.

    Thumbnail is expected to be pre-generated by the recorder service at
    the time of recording completion (same directory, same stem, .jpg
    extension).  If not present this endpoint returns 404.

    To generate thumbnails manually:
        ffmpeg -i <recording.mp4> -ss 00:00:01 -vframes 1 <recording.jpg>
    """
    recording = await _get_recording_or_404(session, recording_id)
    thumb = _thumbnail_path(recording.filename)

    if thumb is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Thumbnail not available for this recording",
        )

    return FileResponse(
        path=str(thumb),
        media_type="image/jpeg",
        filename=thumb.name,
    )
