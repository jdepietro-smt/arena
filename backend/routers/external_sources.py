"""
Router: /api/sources

Add/list/remove external sources (currently just YouTube URLs) that get
ingested into mediamtx as normal paths — once added, a source shows up in
GET /api/streams and behaves like any other live stream.

Auth required for all of these — unlike watching an already-live stream,
claiming a path name and starting a relay is a real, name-colliding action.
"""

from __future__ import annotations

import re

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field

from ..auth import get_current_active_user
from ..models import User
from ..services.external_source import get_external_sources

router = APIRouter(tags=["sources"])

_NAME_RE = re.compile(r"^[A-Za-z0-9_-]{1,64}$")


class YoutubeSourceRequest(BaseModel):
    name: str = Field(..., description="Path name this source will be served as")
    url: str = Field(..., description="YouTube video/live URL")


class YoutubeSourceInfo(BaseModel):
    name: str
    url: str
    status: str
    last_error: str | None
    age_seconds: float


@router.post("/youtube", response_model=YoutubeSourceInfo, status_code=status.HTTP_201_CREATED,
             summary="Add a YouTube URL as a live source")
async def add_youtube_source(
    body: YoutubeSourceRequest,
    _user: User = Depends(get_current_active_user),
) -> YoutubeSourceInfo:
    name = body.name.strip()
    url = body.url.strip()
    if not _NAME_RE.match(name):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Name must be 1-64 chars of letters, numbers, - or _",
        )
    if not url:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="URL is required")

    manager = get_external_sources()
    try:
        await manager.add(name, url)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc))

    info = next((j for j in manager.list() if j["name"] == name), None)
    return YoutubeSourceInfo(**info)


@router.get("", response_model=list[YoutubeSourceInfo], summary="List external sources")
async def list_sources(_user: User = Depends(get_current_active_user)) -> list[YoutubeSourceInfo]:
    return [YoutubeSourceInfo(**s) for s in get_external_sources().list()]


@router.delete("/{name}", summary="Stop and remove an external source")
async def remove_source(name: str, _user: User = Depends(get_current_active_user)) -> dict:
    removed = await get_external_sources().remove(name)
    if not removed:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"No source '{name}'")
    return {"removed": name}
