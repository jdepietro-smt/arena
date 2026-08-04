"""
Router: /api/favorites

Per-user pinned streams — quick access for an operator managing many
streams at once. Every operation is scoped to the calling user; there is
no cross-user visibility or admin override here, unlike users/routes/
alert-rules — a favorite is a personal preference, not something worth
an audit trail entry.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlmodel import Session, select

from ..auth import get_current_active_user
from ..database import get_session
from ..models import FavoriteStream, User

router = APIRouter(tags=["favorites"])


class FavoriteCreate(BaseModel):
    stream_path: str


@router.get("", response_model=list[str], summary="List the current user's favorite stream paths")
async def list_favorites(
    session: Session = Depends(get_session),
    user: User = Depends(get_current_active_user),
) -> list[str]:
    rows = session.exec(
        select(FavoriteStream).where(FavoriteStream.user_id == user.id)
    ).all()
    return [r.stream_path for r in rows]


@router.post("", status_code=status.HTTP_201_CREATED, summary="Pin a stream for the current user")
async def add_favorite(
    body: FavoriteCreate,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_active_user),
) -> dict:
    existing = session.exec(
        select(FavoriteStream).where(
            FavoriteStream.user_id == user.id,
            FavoriteStream.stream_path == body.stream_path,
        )
    ).first()
    if existing:
        return {"stream_path": body.stream_path}

    session.add(FavoriteStream(user_id=user.id, stream_path=body.stream_path))
    session.commit()
    return {"stream_path": body.stream_path}


@router.delete("/{stream_path}", summary="Unpin a stream for the current user")
async def remove_favorite(
    stream_path: str,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_active_user),
) -> dict:
    row = session.exec(
        select(FavoriteStream).where(
            FavoriteStream.user_id == user.id,
            FavoriteStream.stream_path == stream_path,
        )
    ).first()
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not a favorite")
    session.delete(row)
    session.commit()
    return {"ok": True}
