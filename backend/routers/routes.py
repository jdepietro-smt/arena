"""
Router: /api/routes

CRUD and activation lifecycle for stream routes.  A "route" is a
MediaMTX path configuration that relays a source to one or more
destinations (SRT forward, HLS pull-push, record, etc.).

The RouteManager service owns the actual relay processes; this router
is the control plane.
"""

from __future__ import annotations

import logging
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from sqlmodel import Session, select

from ..auth import get_current_active_user, require_admin
from ..database import get_session
from ..models import RouteCreate, RouteRead, StreamRoute, User

logger = logging.getLogger(__name__)

router = APIRouter(tags=["routing"])


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------


def _route_to_dict(route: StreamRoute, extra: dict[str, Any] | None = None) -> dict[str, Any]:
    d: dict[str, Any] = {
        "id": route.id,
        "name": route.name,
        "source_path": route.source_path,
        "destinations": route.destinations,
        "is_active": route.is_active,
        "created_at": route.created_at,
    }
    if extra:
        d.update(extra)
    return d


async def _get_route_or_404(session: Session, route_id: int) -> StreamRoute:
    route = session.get(StreamRoute, route_id)
    if route is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Route {route_id} not found",
        )
    return route


async def _get_route_manager():
    """Lazy import of RouteManager to avoid circular imports at module load."""
    try:
        from ..services.route_manager import route_manager  # noqa: PLC0415

        return route_manager
    except ImportError:
        logger.warning("route_manager service not available")
        return None


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


@router.get("/", response_model=list[RouteRead], summary="List all routes")
async def list_routes(
    session: Session = Depends(get_session),
    _user: User = Depends(get_current_active_user),
) -> list[RouteRead]:
    """Return all stream routes ordered by name."""
    routes = session.exec(select(StreamRoute).order_by(StreamRoute.name)).all()
    return [RouteRead.model_validate(r) for r in routes]


@router.post(
    "/",
    response_model=RouteRead,
    status_code=status.HTTP_201_CREATED,
    summary="Create a new route",
)
async def create_route(
    route_in: RouteCreate,
    session: Session = Depends(get_session),
    _user: User = Depends(get_current_active_user),
) -> RouteRead:
    """
    Persist a new stream route.  If ``is_active`` is True the RouteManager
    will immediately attempt to start the relay.
    """
    existing = session.exec(
        select(StreamRoute).where(StreamRoute.name == route_in.name)
    ).first()
    if existing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Route '{route_in.name}' already exists",
        )

    route = StreamRoute(
        name=route_in.name,
        source_path=route_in.source_path,
        destinations=route_in.destinations,
        is_active=False,  # start inactive; activate explicitly below if requested
    )
    session.add(route)
    session.commit()
    session.refresh(route)

    if route_in.is_active:
        manager = await _get_route_manager()
        if manager is not None:
            try:
                await manager.activate(route)
                route.is_active = True
                session.add(route)
                session.commit()
                session.refresh(route)
            except Exception as exc:
                logger.error("Failed to activate route '%s' on create: %s", route.name, exc)
                # Route is saved but inactive — don't fail the creation.

    return RouteRead.model_validate(route)


@router.get("/{route_id}", response_model=RouteRead, summary="Get a single route with status")
async def get_route(
    route_id: int,
    session: Session = Depends(get_session),
    _user: User = Depends(get_current_active_user),
) -> RouteRead:
    """Return a single route.  ``is_active`` reflects both the DB flag and
    whether the relay process is currently running."""
    route = await _get_route_or_404(session, route_id)

    manager = await _get_route_manager()
    if manager is not None:
        try:
            live_active = await manager.is_running(route)
            if live_active != route.is_active:
                # Sync DB with live process state.
                route.is_active = live_active
                session.add(route)
                session.commit()
                session.refresh(route)
        except Exception as exc:
            logger.warning("Could not query route manager for route %d: %s", route_id, exc)

    return RouteRead.model_validate(route)


@router.put("/{route_id}/activate", response_model=RouteRead, summary="Start the relay")
async def activate_route(
    route_id: int,
    session: Session = Depends(get_session),
    _user: User = Depends(get_current_active_user),
) -> RouteRead:
    """
    Tell the RouteManager to start relaying the source to all configured
    destinations and mark the route active in the DB.
    """
    route = await _get_route_or_404(session, route_id)

    if route.is_active:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Route {route_id} is already active",
        )

    manager = await _get_route_manager()
    if manager is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Route manager service is not available",
        )

    try:
        await manager.activate(route)
    except Exception as exc:
        logger.exception("Failed to activate route %d", route_id)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Could not activate route: {exc}",
        )

    route.is_active = True
    session.add(route)
    session.commit()
    session.refresh(route)
    return RouteRead.model_validate(route)


@router.put("/{route_id}/deactivate", response_model=RouteRead, summary="Stop the relay")
async def deactivate_route(
    route_id: int,
    session: Session = Depends(get_session),
    _user: User = Depends(get_current_active_user),
) -> RouteRead:
    """
    Tell the RouteManager to stop relaying and mark the route inactive.
    The route configuration is preserved; call activate to resume.
    """
    route = await _get_route_or_404(session, route_id)

    if not route.is_active:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Route {route_id} is already inactive",
        )

    manager = await _get_route_manager()
    if manager is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Route manager service is not available",
        )

    try:
        await manager.deactivate(route)
    except Exception as exc:
        logger.exception("Failed to deactivate route %d", route_id)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Could not deactivate route: {exc}",
        )

    route.is_active = False
    session.add(route)
    session.commit()
    session.refresh(route)
    return RouteRead.model_validate(route)


@router.delete(
    "/{route_id}",
    status_code=status.HTTP_200_OK,
    summary="Stop and delete a route",
)
async def delete_route(
    route_id: int,
    session: Session = Depends(get_session),
    _admin: User = Depends(require_admin),
) -> None:
    """
    Stop the relay (if running) then permanently delete the route.
    Requires admin privileges.
    """
    route = await _get_route_or_404(session, route_id)

    if route.is_active:
        manager = await _get_route_manager()
        if manager is not None:
            try:
                await manager.deactivate(route)
            except Exception as exc:
                logger.warning(
                    "Could not cleanly stop route %d before delete: %s", route_id, exc
                )

    session.delete(route)
    session.commit()
