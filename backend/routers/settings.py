"""
Router: /api/settings

Backs the Settings page's Recording tab (frontend/src/pages/SettingsPage.jsx)
— that UI already existed with a directory field, a storage-limit slider,
and an auto-delete toggle, calling GET/PUT /api/settings/recording, but
no such endpoint existed anywhere in the backend, so every save silently
no-op'd. This is that missing endpoint, backed by models.RecordingConfig.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlmodel import Session

from ..auth import get_current_active_user, require_admin
from ..database import get_session
from ..models import User
from ..services.recording_config import get_recording_config

router = APIRouter(tags=["settings"])


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
