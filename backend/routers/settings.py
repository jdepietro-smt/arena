"""
Router: /api/settings

Backs the Settings page's Recording tab (frontend/src/pages/SettingsPage.jsx)
— that UI already existed with a directory field, a storage-limit slider,
and an auto-delete toggle, calling GET/PUT /api/settings/recording, but
no such endpoint existed anywhere in the backend, so every save silently
no-op'd. This is that missing endpoint, backed by models.RecordingConfig.
"""

from __future__ import annotations

import asyncio
import logging
import subprocess
from pathlib import Path

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlmodel import Session

from ..auth import get_current_active_user, require_admin
from ..config import settings
from ..database import get_session
from ..models import User
from ..services.db_backup import get_db_backup, run_backup_once
from ..services.rate_limiter import rate_limit
from ..services.recording_config import get_recording_config

logger = logging.getLogger(__name__)

router = APIRouter(tags=["settings"])

# backend/routers/settings.py -> backend/routers -> backend -> repo root
_REPO_ROOT = Path(__file__).resolve().parent.parent.parent

# A backup reads the whole sqlite file via sqlite3's backup API — cheap
# for this app's DB size, but there's no reason for it to run more than
# a couple of times a minute even under a scripted/automated trigger.
_backup_rate_limit = rate_limit(5, 60, scope="db-backup")


class RecordingSettingsUpdate(BaseModel):
    output_dir: str
    max_storage_gb: float
    auto_delete: bool


@router.get("/recording", summary="Get recording storage/retention settings")
async def get_recording_settings(
    session: Session = Depends(get_session),
    _user: User = Depends(get_current_active_user),
) -> dict:
    config = get_recording_config(session)
    return {
        "output_dir": config.output_dir,
        "max_storage_gb": config.max_storage_gb,
        "auto_delete": config.auto_delete,
    }


@router.get("/server", summary="Server/network configuration for the Settings page's Server tab")
async def get_server_settings(_user: User = Depends(get_current_active_user)) -> dict:
    """
    The frontend has called this since the Server tab was first built,
    but the endpoint never existed — every request 404'd, silently
    swallowed by the page's own .catch(() => ({})), so the tab always
    showed blank/default fields with no visible error. Caught by an E2E
    smoke test against a real server; a mocked unit test can't see a
    404 against an endpoint that was never wired up on either side.

    No TURN server is configured for this deployment (WebRTC playback
    works today without one — Settings page already renders "Disabled"
    for turn_enabled=False), so those fields are left null rather than
    invented.
    """
    return {
        "server_ip": settings.SERVER_IP,
        "mediamtx_api_url": settings.MEDIAMTX_API,
        "srt_port": settings.MEDIAMTX_SRT_PORT,
        "hls_base_url": settings.MEDIAMTX_HLS,
        "turn_host": None,
        "turn_port": None,
        "turn_username": None,
        "turn_enabled": False,
    }


def _git_output(*args: str) -> str | None:
    try:
        result = subprocess.run(
            ["git", *args], cwd=_REPO_ROOT, capture_output=True, text=True, timeout=5, check=True,
        )
        return result.stdout.strip() or None
    except Exception as exc:
        logger.debug("git %s failed: %s", " ".join(args), exc)
        return None


@router.get("/about", summary="Version/build info for the Settings page's About tab")
async def get_about_info(_user: User = Depends(get_current_active_user)) -> dict:
    """
    Same missing-endpoint story as /server above. mediamtx/GStreamer/
    FFmpeg version fields are left null rather than shelling out to
    probe installed binaries — this FastAPI service doesn't itself
    depend on GStreamer at all (that's the separate C++/GStreamer
    pipeline scaffold, not this app), so reporting a version for it
    here would be reporting on a dependency this service doesn't have.
    """
    return {
        "version": "1.0.0",  # matches main.py's FastAPI(version=...)
        "mediamtx_version": None,
        "gstreamer_version": None,
        "ffmpeg_version": None,
        "build_date": _git_output("log", "-1", "--format=%cI"),
        "commit": _git_output("rev-parse", "HEAD"),
    }


@router.get("/backup/status", summary="Last automatic DB backup timestamp")
async def backup_status(_user: User = Depends(get_current_active_user)) -> dict:
    return get_db_backup().status()


@router.post("/backup", summary="Take a database backup right now (admin only)")
async def trigger_backup(
    _admin: User = Depends(require_admin),
    _rl: None = Depends(_backup_rate_limit),
) -> dict:
    path = await asyncio.to_thread(run_backup_once)
    if path is None:
        return {"ok": False, "reason": "DATABASE_URL is not sqlite, or the DB file doesn't exist yet"}
    return {"ok": True, "path": str(path)}


@router.put("/recording", summary="Update recording storage/retention settings")
async def update_recording_settings(
    body: RecordingSettingsUpdate,
    session: Session = Depends(get_session),
    _admin: User = Depends(require_admin),
) -> dict:
    config = get_recording_config(session)
    config.output_dir = body.output_dir
    config.max_storage_gb = body.max_storage_gb
    config.auto_delete = body.auto_delete
    session.add(config)
    session.commit()
    session.refresh(config)
    return {
        "output_dir": config.output_dir,
        "max_storage_gb": config.max_storage_gb,
        "auto_delete": config.auto_delete,
    }
