"""
Router: /api/users

User management endpoints.  All routes except GET /me require admin
privileges; GET /me is available to any authenticated active user.

Uses SQLModel + the shared get_session dependency for DB access and
the auth module's require_admin / get_current_active_user dependencies
for access control.
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlmodel import Session, select

from ..auth import get_current_active_user, get_password_hash, require_admin
from ..database import get_session
from ..models import User, UserCreate, UserRead, UserRole

logger = logging.getLogger(__name__)

router = APIRouter(tags=["users"])


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------


async def _get_user_or_404(session: Session, user_id: int) -> User:
    user = session.get(User, user_id)
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"User {user_id} not found",
        )
    return user


def _assert_not_self(current_user: User, target_id: int, action: str = "perform this action on") -> None:
    """Raise 403 if the current user is the target of a destructive action."""
    if current_user.id == target_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"You cannot {action} your own account",
        )


# ---------------------------------------------------------------------------
# Request / response schemas
# ---------------------------------------------------------------------------

from pydantic import BaseModel, EmailStr  # noqa: E402 — after imports above for clarity


class UserUpdate(BaseModel):
    """Fields an admin can change on an existing user."""

    role: UserRole | None = None
    is_active: bool | None = None
    email: EmailStr | None = None
    password: str | None = None  # If provided, the password is re-hashed.


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


@router.get("/me", response_model=UserRead, summary="Get the authenticated user's profile")
async def get_me(
    current_user: User = Depends(get_current_active_user),
) -> UserRead:
    """Return the profile of the currently authenticated user.
    Available to all authenticated active users, not just admins."""
    return UserRead.model_validate(current_user)


@router.get(
    "/",
    response_model=list[UserRead],
    summary="List all users (admin only)",
)
async def list_users(
    role: UserRole | None = Query(default=None, description="Filter by role"),
    is_active: bool | None = Query(default=None, description="Filter by active status"),
    limit: int = Query(default=100, ge=1, le=1000),
    offset: int = Query(default=0, ge=0),
    session: Session = Depends(get_session),
    _admin: User = Depends(require_admin),
) -> list[UserRead]:
    """
    Return all user accounts with optional filters.

    Supports filtering by role and active/inactive status, with
    limit/offset pagination.  Ordered by username ascending.
    """
    query = select(User).order_by(User.username)
    if role is not None:
        query = query.where(User.role == role)
    if is_active is not None:
        query = query.where(User.is_active == is_active)
    query = query.offset(offset).limit(limit)
    users = session.exec(query).all()
    return [UserRead.model_validate(u) for u in users]


@router.post(
    "/",
    response_model=UserRead,
    status_code=status.HTTP_201_CREATED,
    summary="Create a user (admin only)",
)
async def create_user(
    user_in: UserCreate,
    session: Session = Depends(get_session),
    _admin: User = Depends(require_admin),
) -> UserRead:
    """
    Create a new user account.

    - Username and email must be unique.
    - Password is hashed before storage (bcrypt).
    - Default role is viewer unless overridden in the request.
    """
    # Uniqueness checks.
    if session.exec(select(User).where(User.username == user_in.username)).first():
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Username '{user_in.username}' is already taken",
        )
    if session.exec(select(User).where(User.email == user_in.email)).first():
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Email '{user_in.email}' is already registered",
        )

    new_user = User(
        username=user_in.username,
        email=user_in.email,
        hashed_password=get_password_hash(user_in.password),
        role=user_in.role,
        is_active=True,
    )
    session.add(new_user)
    session.commit()
    session.refresh(new_user)
    logger.info("Admin created user '%s' with role %s", new_user.username, new_user.role)
    return UserRead.model_validate(new_user)


@router.get(
    "/{user_id}",
    response_model=UserRead,
    summary="Get a user by ID (admin or self)",
)
async def get_user(
    user_id: int,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_active_user),
) -> UserRead:
    """
    Return a user's profile.

    Admins may retrieve any user.  Non-admins may only retrieve their own
    profile (equivalent to /me but addressed by ID).
    """
    if current_user.role != UserRole.admin and current_user.id != user_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You can only view your own profile",
        )
    user = await _get_user_or_404(session, user_id)
    return UserRead.model_validate(user)


@router.put(
    "/{user_id}",
    response_model=UserRead,
    summary="Update user role or status (admin only)",
)
async def update_user(
    user_id: int,
    update_in: UserUpdate,
    session: Session = Depends(get_session),
    current_admin: User = Depends(require_admin),
) -> UserRead:
    """
    Update a user's role, active status, email, or password.

    All fields are optional; only supplied fields are changed.

    Admins cannot demote or deactivate their own account via this endpoint
    (they would lock themselves out).  Use a separate admin account for
    self-management.
    """
    user = await _get_user_or_404(session, user_id)

    # Prevent self-demotion / self-deactivation.
    if user_id == current_admin.id:
        if update_in.role is not None and update_in.role != UserRole.admin:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You cannot demote your own admin account",
            )
        if update_in.is_active is False:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You cannot deactivate your own account",
            )

    if update_in.role is not None:
        user.role = update_in.role

    if update_in.is_active is not None:
        user.is_active = update_in.is_active

    if update_in.email is not None:
        # Check uniqueness, excluding the current user.
        clash = session.exec(
            select(User).where(User.email == update_in.email, User.id != user_id)
        ).first()
        if clash:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"Email '{update_in.email}' is already registered",
            )
        user.email = update_in.email

    if update_in.password is not None:
        if len(update_in.password) < 8:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Password must be at least 8 characters",
            )
        user.hashed_password = get_password_hash(update_in.password)

    session.add(user)
    session.commit()
    session.refresh(user)
    logger.info(
        "Admin '%s' updated user '%s' (id=%d)",
        current_admin.username,
        user.username,
        user.id,
    )
    return UserRead.model_validate(user)


@router.delete(
    "/{user_id}",
    status_code=status.HTTP_200_OK,
    summary="Delete a user (admin only, cannot delete own account)",
)
async def delete_user(
    user_id: int,
    session: Session = Depends(get_session),
    current_admin: User = Depends(require_admin),
) -> None:
    """
    Permanently delete a user account.

    An admin cannot delete their own account — this prevents accidental
    lockout.  To remove the last admin, first promote another user.
    """
    _assert_not_self(current_admin, user_id, action="delete")

    user = await _get_user_or_404(session, user_id)

    # Extra guard: if the target is the only admin, refuse.
    if user.role == UserRole.admin:
        admin_count = len(
            session.exec(select(User).where(User.role == UserRole.admin)).all()
        )
        if admin_count <= 1:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Cannot delete the only remaining admin account",
            )

    logger.info(
        "Admin '%s' deleted user '%s' (id=%d)",
        current_admin.username,
        user.username,
        user.id,
    )
    session.delete(user)
    session.commit()
