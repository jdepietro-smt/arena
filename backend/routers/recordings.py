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

from ..auth import get_current_active_user, require_admin
from ..config import settings
from ..database import get_session
from ..models import Recording, RecordingRead, User

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/recordings", tags=["recordings"])


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
    "/",
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
    status_code=status.HTTP_204_NO_CONTENT,
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
