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

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlmodel import Session

from ..auth import get_current_active_user, require_admin
from ..database import get_session
from ..models import User
from ..services.db_backup import get_db_backup, run_backup_once
from ..services.rate_limiter import rate_limit
from ..services.recording_config import get_recording_config

router = APIRouter(tags=["settings"])

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
