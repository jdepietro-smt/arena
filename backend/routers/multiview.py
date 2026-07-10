"""
Router: /api/multiview

Ensures a server-side composited (tiled, video-only) stream exists for a
given set of source paths, so any number of viewers can watch one combined
WHEP stream instead of each decoding every source individually.

No auth required, same as the WHEP proxy — watching already-live streams
isn't treated as a privileged action in this app. Composite jobs are torn
down automatically by the compositor's reaper once nobody is watching.
"""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, Field

from ..services.compositor import get_compositor

router = APIRouter(tags=["multiview"])


class CompositeJobRequest(BaseModel):
    paths: list[str] = Field(..., min_length=1, max_length=16)


class CompositeJobResponse(BaseModel):
    job_id: str


@router.post("/jobs", response_model=CompositeJobResponse, summary="Ensure a composite job is running")
async def create_job(body: CompositeJobRequest) -> CompositeJobResponse:
    paths = [p.strip() for p in body.paths if p.strip()]
    if not paths:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="No stream paths supplied")

    try:
        job_id = await get_compositor().ensure_job(paths)
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Could not start composite job: {exc}",
        )

    return CompositeJobResponse(job_id=job_id)
