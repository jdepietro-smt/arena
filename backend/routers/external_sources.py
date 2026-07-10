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

import httpx
from fastapi import APIRouter, Depends, HTTPException, UploadFile, status
from pydantic import BaseModel, Field

from ..auth import get_current_active_user, require_admin
from ..models import User
from ..services.external_source import COOKIES_PATH, get_external_sources

_PLUGIN_ZIP_URL = (
    "https://github.com/Brainicism/bgutil-ytdlp-pot-provider"
    "/releases/latest/download/bgutil-ytdlp-pot-provider.zip"
)

router = APIRouter(tags=["sources"])

_NAME_RE = re.compile(r"^[A-Za-z0-9_-]{1,64}$")
_MAX_COOKIES_BYTES = 256 * 1024  # cookies.txt files are a few KB at most


def _plugin_dir() -> str:
    home = os.environ.get("HOME") or "/root"
    return os.path.join(home, ".yt-dlp", "plugins")


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

    # Sanity-check the format/contents without exposing any cookie value —
    # a common failure mode is uploading a file yt-dlp silently can't use
    # (wrong export format, or a file with no youtube.com entries at all).
    looks_like_netscape = False
    youtube_cookie_lines = 0
    has_session_cookie = False
    try:
        with open(COOKIES_PATH, "r", encoding="utf-8", errors="replace") as f:
            for line in f:
                stripped = line.strip()
                if stripped.startswith("# Netscape HTTP Cookie File") or stripped.startswith("# HTTP Cookie File"):
                    looks_like_netscape = True
                    continue
                if not stripped or stripped.startswith("#"):
                    continue
                fields = stripped.split("\t")
                if len(fields) >= 7 and "youtube.com" in fields[0]:
                    youtube_cookie_lines += 1
                    if fields[5] in ("SID", "SAPISID", "SSID", "HSID", "__Secure-1PSID", "__Secure-3PSID"):
                        has_session_cookie = True
    except Exception:
        pass

    return {
        "present": True,
        "size_bytes": stat.st_size,
        "modified_at": stat.st_mtime,
        "looks_like_netscape_format": looks_like_netscape,
        "youtube_cookie_lines": youtube_cookie_lines,
        "has_session_cookie": has_session_cookie,
    }


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


@router.get("/debug/pot-provider-health", summary="Debug: is the bgutil Docker provider actually reachable")
async def pot_provider_health(_admin: User = Depends(require_admin)) -> dict:
    # Any HTTP response (even a 404) proves the port is open and something's
    # listening — we don't need to guess the server's exact route layout,
    # just rule out "container isn't actually up/reachable" as the cause.
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            resp = await client.get("http://127.0.0.1:4416/")
            return {"reachable": True, "status_code": resp.status_code, "body": resp.text[:500]}
    except Exception as exc:
        return {"reachable": False, "error": str(exc)}


@router.get("/debug/plugin-dir", summary="Debug: what yt-dlp's plugin dir actually looks like")
async def debug_plugin_dir(_admin: User = Depends(require_admin)) -> dict:
    plugins_dir = _plugin_dir()
    entries = []
    if os.path.isdir(plugins_dir):
        for name in os.listdir(plugins_dir):
            full = os.path.join(plugins_dir, name)
            entries.append({"name": name, "size_bytes": os.path.getsize(full) if os.path.isfile(full) else None,
                             "is_dir": os.path.isdir(full)})
    return {
        "HOME": os.environ.get("HOME"),
        "plugins_dir": plugins_dir,
        "plugins_dir_exists": os.path.isdir(plugins_dir),
        "entries": entries,
    }


@router.post("/debug/fetch-plugin", summary="Debug: server-side download of the bgutil PO-token plugin zip")
async def debug_fetch_plugin(_admin: User = Depends(require_admin)) -> dict:
    plugins_dir = _plugin_dir()
    os.makedirs(plugins_dir, exist_ok=True)
    dest = os.path.join(plugins_dir, "bgutil-ytdlp-pot-provider.zip")

    async with httpx.AsyncClient(follow_redirects=True, timeout=30.0) as client:
        resp = await client.get(_PLUGIN_ZIP_URL)
        if resp.status_code != 200:
            raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=f"GitHub returned {resp.status_code}")
        data = resp.content

    with open(dest, "wb") as f:
        f.write(data)

    return {"saved_to": dest, "size_bytes": len(data)}
