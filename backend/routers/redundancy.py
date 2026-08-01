"""
Router: /api/redundancy

CRUD for RedundancyGateway (a configured sdi_receive instance's stats
endpoint) plus a status endpoint returning the last-polled path1/path2/
output health for each — the API surface for the SMPTE 2022-7
protection-switch monitoring in services/redundancy.py.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlmodel import Session, select

from ..auth import get_current_active_user, require_admin
from ..database import get_session
from ..models import RedundancyGateway, User
from ..services.redundancy import get_redundancy_monitor

router = APIRouter(tags=["redundancy"])


class RedundancyGatewayCreate(BaseModel):
    name: str
    stats_url: str
    stream_path: str | None = None


@router.get("", response_model=list[RedundancyGateway], summary="List redundancy gateways")
async def list_gateways(
    session: Session = Depends(get_session),
    _user: User = Depends(get_current_active_user),
) -> list[RedundancyGateway]:
    return session.exec(select(RedundancyGateway)).all()


@router.post("", response_model=RedundancyGateway, summary="Register a redundancy gateway")
async def create_gateway(
    body: RedundancyGatewayCreate,
    session: Session = Depends(get_session),
    _admin: User = Depends(require_admin),
) -> RedundancyGateway:
    gateway = RedundancyGateway(**body.model_dump())
    session.add(gateway)
    session.commit()
    session.refresh(gateway)
    return gateway


@router.patch("/{gateway_id}/toggle", response_model=RedundancyGateway, summary="Enable/disable a gateway")
async def toggle_gateway(
    gateway_id: int,
    session: Session = Depends(get_session),
    _admin: User = Depends(require_admin),
) -> RedundancyGateway:
    gateway = session.get(RedundancyGateway, gateway_id)
    if gateway is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Gateway {gateway_id} not found")
    gateway.is_active = not gateway.is_active
    session.add(gateway)
    session.commit()
    session.refresh(gateway)
    return gateway


@router.delete("/{gateway_id}", summary="Remove a redundancy gateway")
async def delete_gateway(
    gateway_id: int,
    session: Session = Depends(get_session),
    _admin: User = Depends(require_admin),
) -> dict:
    gateway = session.get(RedundancyGateway, gateway_id)
    if gateway is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Gateway {gateway_id} not found")
    session.delete(gateway)
    session.commit()
    return {"deleted": gateway_id}


@router.get("/status", summary="Last-polled path1/path2/output health per gateway")
async def redundancy_status(_user: User = Depends(get_current_active_user)) -> dict:
    return get_redundancy_monitor().status()
