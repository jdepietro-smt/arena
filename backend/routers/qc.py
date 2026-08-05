"""
Router: /api/qc

Enable/disable frozen-frame, black-video, and silent-audio monitoring
per stream, and read back which streams are monitored plus any
currently-open issues. Backs services/qc_monitor.py — see its module
docstring for what "currently open" honestly means per check (freeze
and silence are live; black is always retrospective).

Enabling QC monitoring starts a real extra ffmpeg decode process per
stream (see qc_monitor.py's docstring on why this is opt-in, not
automatic), so enable/disable are admin-only; status is readable by
anyone authenticated, same as alert status.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends

from ..auth import get_current_active_user, require_admin
from ..models import User
from ..services.qc_monitor import get_qc_monitor

router = APIRouter(tags=["qc"])


@router.get("/status", summary="Monitored streams and any currently-open QC issues")
async def qc_status(_user: User = Depends(get_current_active_user)) -> dict:
    return get_qc_monitor().status()


@router.post("/{path_name}/enable", summary="Enable QC monitoring for a stream (admin only)")
async def enable_qc(path_name: str, _admin: User = Depends(require_admin)) -> dict:
    await get_qc_monitor().want(path_name)
    return {"path": path_name, "monitoring": True}


@router.post("/{path_name}/disable", summary="Disable QC monitoring for a stream (admin only)")
async def disable_qc(path_name: str, _admin: User = Depends(require_admin)) -> dict:
    await get_qc_monitor().unwant(path_name)
    return {"path": path_name, "monitoring": False}
