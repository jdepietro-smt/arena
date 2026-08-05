"""
Automatic route failover.

Redundancy monitoring elsewhere in this app (services/redundancy.py) is
explicitly read-only — it watches an external sdi_receive instance this
backend doesn't control the lifecycle of, so it can only alert a human to
go fix a protection switch by hand. Routes are different: this backend
already owns the relay process end-to-end (services/stream_router.py
starts/stops the actual ffmpeg relay), so a route with a configured
backup source can genuinely be failed over automatically, not just
alerted on.

Triggered from alerting.py's AlertManager the instant it marks a stream
down — the same connectivity detection every other down-alert already
uses (_DOWN_CONSECUTIVE_MISSES debounce included), so this never fires on
a single missed poll. No polling loop of its own.

Failback (switching back to the primary once it recovers) is deliberately
NOT automatic. Two real sources that are both intermittently bad will
flap the relay back and forth forever if failback triggers on the first
sign of recovery — worse for viewers than staying on a known-working
backup until an operator deliberately calls PUT /routes/{id}/fail-back
once they've confirmed the primary is actually stable again.
"""

from __future__ import annotations

import logging
from typing import Awaitable, Callable

from sqlmodel import Session, select

from ..database import engine
from ..models import EventType, StreamRoute
from .audit import log_audit
from .events import log_event

logger = logging.getLogger(__name__)

Notifier = Callable[[str], Awaitable[None]]


async def check_and_failover(down_path: str, notify: Notifier) -> None:
    with Session(engine) as session:
        candidates = session.exec(
            select(StreamRoute).where(
                StreamRoute.is_active == True,  # noqa: E712
                StreamRoute.failed_over == False,  # noqa: E712
                StreamRoute.source_path == down_path,
            )
        ).all()
        targets = [r for r in candidates if r.backup_source_path]
        if not targets:
            return

        from .stream_router import get_router  # local import avoids a cycle at module load
        manager = get_router()

        for route in targets:
            try:
                await manager.deactivate(route)
                await manager.activate(route, source_override=route.backup_source_path)
            except Exception:
                logger.exception("Automatic failover failed for route '%s'", route.name)
                continue

            route.failed_over = True
            session.add(route)
            session.commit()
            log_event(
                session, EventType.route_failed_over, stream_path=down_path,
                message=f"Route '{route.name}' failed over to backup source '{route.backup_source_path}'",
            )
            log_audit(
                session, "system", "route.failover", target=route.name,
                detail=f"{down_path} -> {route.backup_source_path}",
            )
            logger.warning("Route '%s' automatically failed over: %s -> %s", route.name, down_path, route.backup_source_path)
            await notify(
                f":rotating_light: Route *{route.name}* automatically failed over to backup source "
                f"*{route.backup_source_path}* — primary *{down_path}* went down."
            )
