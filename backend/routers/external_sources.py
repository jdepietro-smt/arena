"""
Router: /api/sources

Add/list/remove external sources (currently just YouTube URLs) that get
ingested into mediamtx as normal paths — once added, a source shows up in
GET /api/streams and behaves like any other live stream.

Auth required for all of these — unlike watching an already-live stream,
claiming a path name and starting a relay is a real, name-colliding action.
"""

from __future__ import annotations

import os
import re

from fastapi import APIRouter, Depends, HTTPException, UploadFile, status
from pydantic import BaseModel, Field

from ..auth import get_current_active_user, require_admin
from ..models import User
from ..services.external_source import COOKIES_PATH, get_external_sources

router = APIRouter(tags=["sources"])

_NAME_RE = re.compile(r"^[A-Za-z0-9_-]{1,64}$")
_MAX_COOKIES_BYTES = 256 * 1024  # cookies.txt files are a few KB at most


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


# ---------------------------------------------------------------------------
# YouTube cookies — lets yt-dlp authenticate as a real signed-in session,
# needed because YouTube challenges plain requests from datacenter IPs.
# Uploaded through the app instead of requiring server file-transfer tooling.
# ---------------------------------------------------------------------------


@router.get("/youtube-cookies/status", summary="Whether a YouTube cookies file is present")
async def youtube_cookies_status(_user: User = Depends(get_current_active_user)) -> dict:
    if not os.path.isfile(COOKIES_PATH):
        return {"present": False}
    stat = os.stat(COOKIES_PATH)
    return {"present": True, "size_bytes": stat.st_size, "modified_at": stat.st_mtime}


@router.post("/youtube-cookies", summary="Upload a youtube.com cookies.txt (Netscape format)")
async def upload_youtube_cookies(
    file: UploadFile,
    _admin: User = Depends(require_admin),
) -> dict:
    data = await file.read(_MAX_COOKIES_BYTES + 1)
    if len(data) > _MAX_COOKIES_BYTES:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="File too large for a cookies export")
    if not data:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Empty file")

    os.makedirs(os.path.dirname(COOKIES_PATH), exist_ok=True)
    with open(COOKIES_PATH, "wb") as f:
        f.write(data)

    return {"saved": True, "size_bytes": len(data)}


@router.delete("/youtube-cookies", summary="Remove the stored YouTube cookies file")
async def delete_youtube_cookies(_admin: User = Depends(require_admin)) -> dict:
    if os.path.isfile(COOKIES_PATH):
        os.remove(COOKIES_PATH)
        return {"removed": True}
    return {"removed": False}
