"""
Polls configured sdi_receive gateways (SMPTE 2022-7 protection-switch
instances — models.RedundancyGateway) for path1/path2/output health over
their --stats-port HTTP endpoint, and tracks state transitions the same way
AlertManager already does for stream connectivity: fire once when a path
goes down, once when it recovers, never on every poll while it persists.

sdi_receive runs standalone near the decode box, not managed by this
backend — this is read-only monitoring of something already running
elsewhere, not a lifecycle controller for it.

Follows the same background-task shape as alerting.py/compositor.py: a
manager class with start()/stop(), a while-True loop with try/except around
the per-tick body, registered in main.py's lifespan.

API:
    get_redundancy_monitor().start()
    await get_redundancy_monitor().stop()
    get_redundancy_monitor().status() -> dict
"""

from __future__ import annotations

import logging
from typing import Any

import asyncio
import httpx
from sqlmodel import Session, select

from ..config import settings
from ..database import engine
from ..models import RedundancyGateway

logger = logging.getLogger(__name__)

_POLL_INTERVAL_S = 10
_REQUEST_TIMEOUT_S = 4.0


class RedundancyMonitor:
    def __init__(self) -> None:
        self._task: asyncio.Task | None = None
        # gateway id -> last-seen stats dict (None if unreachable)
        self._last: dict[int, dict[str, Any] | None] = {}
        # gateway id -> was any configured path down last tick
        self._degraded: dict[int, bool] = {}

    def start(self) -> None:
        if self._task is None:
            self._task = asyncio.create_task(self._loop())

    async def stop(self) -> None:
        if self._task is not None:
            self._task.cancel()
            self._task = None

    def status(self) -> dict[str, Any]:
        with Session(engine) as session:
            gateways = session.exec(select(RedundancyGateway)).all()
        return {
            "gateways": [
                {
                    "id": gw.id,
                    "name": gw.name,
                    "stream_path": gw.stream_path,
                    "is_active": gw.is_active,
                    "stats": self._last.get(gw.id),
                }
                for gw in gateways
            ]
        }

    async def _loop(self) -> None:
        while True:
            await asyncio.sleep(_POLL_INTERVAL_S)
            try:
                await self.tick()
            except Exception:
                logger.exception("Redundancy gateway poll tick failed")

    async def tick(self) -> None:
        with Session(engine) as session:
            gateways = session.exec(
                select(RedundancyGateway).where(RedundancyGateway.is_active == True)  # noqa: E712
            ).all()
        if not gateways:
            return

        async with httpx.AsyncClient(timeout=_REQUEST_TIMEOUT_S) as client:
            for gw in gateways:
                await self._poll_one(client, gw)

    async def _poll_one(self, client: httpx.AsyncClient, gw: RedundancyGateway) -> None:
        try:
            resp = await client.get(gw.stats_url)
            resp.raise_for_status()
            stats = resp.json()
        except Exception as exc:
            logger.warning("Redundancy gateway '%s' (%s) unreachable: %s", gw.name, gw.stats_url, exc)
            self._last[gw.id] = None
            await self._check_degraded(gw, degraded=True, reason="unreachable")
            return

        self._last[gw.id] = stats

        # A path is "down" if the gateway is configured dual-path and either
        # side is reporting not-running, or the merged output never
        # connected at all — any of these means reduced or zero protection.
        degraded = False
        if stats.get("dual_path"):
            degraded = not (stats.get("path1_up") and stats.get("path2_up"))
        if not stats.get("output_connected"):
            degraded = True

        await self._check_degraded(gw, degraded, reason="path down" if degraded else "")

    async def _check_degraded(self, gw: RedundancyGateway, degraded: bool, reason: str) -> None:
        was_degraded = self._degraded.get(gw.id, False)
        if degraded and not was_degraded:
            self._degraded[gw.id] = True
            await self._notify(f":warning: Redundancy gateway *{gw.name}* degraded ({reason}).")
        elif not degraded and was_degraded:
            self._degraded[gw.id] = False
            await self._notify(f":large_green_circle: Redundancy gateway *{gw.name}* recovered.")

    async def _notify(self, text: str) -> None:
        logger.info("REDUNDANCY: %s", text)
        if not settings.ALERT_WEBHOOK_URL:
            return
        try:
            async with httpx.AsyncClient(timeout=5.0) as client:
                await client.post(settings.ALERT_WEBHOOK_URL, json={"text": text})
        except Exception:
            logger.exception("Failed to deliver redundancy-gateway webhook")


_monitor: RedundancyMonitor | None = None


def get_redundancy_monitor() -> RedundancyMonitor:
    global _monitor
    if _monitor is None:
        _monitor = RedundancyMonitor()
    return _monitor
