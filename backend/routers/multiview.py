"""
Router: /api/multiview

Ensures a server-side composited (tiled, video-only) stream exists for a
given set of source paths, so any number of viewers can watch one combined
WHEP stream instead of each decoding every source individually.

Job creation requires no auth, same as the WHEP proxy — watching an
already-live stream isn't a privileged action in this app. Listing/stopping
jobs does require auth, since that's visibility into and control over
every running composite, not just the one you asked for.

Composite jobs are also torn down automatically by the compositor's reaper
once nobody is watching, but that depends on mediamtx's reader count ever
reaching zero (e.g. a browser tab left open, or a slow/stalled disconnect
won't reap for a while) — the explicit stop endpoint doesn't wait on that.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field

from ..auth import get_current_active_user, require_admin
from ..models import User
from ..services.compositor import get_compositor, get_job_log

router = APIRouter(tags=["multiview"])


class CompositeJobRequest(BaseModel):
    paths: list[str] = Field(..., min_length=1, max_length=16)
    audio_path: str | None = Field(default=None, description="One of paths, or null for no audio")
    blank_slots: int = Field(
        default=0, ge=0, le=16,
        description="Grid cells to reserve (always last/bottom-right-most) for client-side overlays, e.g. YouTube embeds",
    )


class CompositeJobResponse(BaseModel):
    job_id: str


class CompositeJobInfo(BaseModel):
    job_id: str
    paths: list[str]
    audio_path: str | None
    running: bool
    age_seconds: float


@router.post("/jobs", response_model=CompositeJobResponse, summary="Ensure a composite job is running")
async def create_job(body: CompositeJobRequest) -> CompositeJobResponse:
    paths = [p.strip() for p in body.paths if p.strip()]
    if not paths:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="No stream paths supplied")

    audio_path = body.audio_path.strip() if body.audio_path else None
    if audio_path and audio_path not in paths:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="audio_path must be one of paths")

    try:
        job_id = await get_compositor().ensure_job(paths, audio_path, body.blank_slots)
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Could not start composite job: {exc}",
        )

    return CompositeJobResponse(job_id=job_id)


@router.get("/jobs", response_model=list[CompositeJobInfo], summary="List active composite jobs")
async def list_jobs(_user: User = Depends(get_current_active_user)) -> list[CompositeJobInfo]:
    return [CompositeJobInfo(**j) for j in get_compositor().list_jobs()]


@router.delete("/jobs/{job_id}", summary="Stop a composite job immediately")
async def stop_job(job_id: str, _user: User = Depends(get_current_active_user)) -> dict:
    stopped = await get_compositor().stop_job(job_id)
    if not stopped:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"No running job '{job_id}'")
    return {"stopped": job_id}


@router.get("/jobs/{job_id}/log", summary="Recent ffmpeg stderr for a composite job (debug)")
async def job_log(job_id: str, _admin: User = Depends(require_admin)) -> dict:
    return {"job_id": job_id, "log": get_job_log(job_id)}
