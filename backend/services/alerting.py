"""
Lightweight alerting: watches stream connectivity plus user-defined
AlertRule thresholds (models.AlertRule — the table already existed with no
router, service, or evaluation loop ever referencing it), notifying via
webhook on state TRANSITIONS only — down/breach, and again on recovery —
not on every poll while a condition persists, or every notification
becomes noise nobody reads.

Follows the same background-task shape as compositor.py's reaper: a
manager class with start()/stop(), a while-True loop with try/except
around the per-tick body, registered in main.py's lifespan.

Connectivity (stream up/down) is a built-in, always-on check across every
currently-tracked path — going down matters for every stream, not
something you'd want to opt into per stream via a rule. AlertRule handles
the narrower, per-stream/per-metric case (bitrate/rtt/packet_loss
thresholds) that already had a schema and nothing using it.

API:
    get_alert_manager().start()             # once, at app startup
    await get_alert_manager().stop()        # once, at app shutdown
    get_alert_manager().status() -> dict     # current down streams / firing rules
"""

from __future__ import annotations

import asyncio
import logging
from typing import Any

import httpx
from sqlmodel import Session, select

from ..config import settings
from ..database import engine
from ..models import AlertAction, AlertRule, CompareOperator, EventType
from .events import log_event
from .mediamtx import get_client
from .srt_stats import get_collector

logger = logging.getLogger(__name__)

_POLL_INTERVAL_S = 10
# Consecutive missed polls before declaring a stream down — a single missed
# poll is well within normal jitter (mediamtx itself glitching momentarily,
# a poll racing a reconnect); this is the same debounce shape as
# compositor.py's zero_reader_hits >= 2 check.
_DOWN_CONSECUTIVE_MISSES = 2

_METRIC_FIELD = {
    "bitrate": "bitrate_kbps",
    "rtt": "rtt_ms",
    "packet_loss": "packet_loss_pct",
}


class AlertManager:
    def __init__(self) -> None:
        self._task: asyncio.Task | None = None
        # path -> consecutive not-ready polls seen so far
        self._down_streak: dict[str, int] = {}
        # paths currently considered down (already notified)
        self._currently_down: set[str] = set()
        # AlertRule.id -> currently breaching (already notified)
        self._rule_firing: dict[int, bool] = {}

    def start(self) -> None:
        if self._task is None:
            self._task = asyncio.create_task(self._loop())

    async def stop(self) -> None:
        if self._task is not None:
            self._task.cancel()
            self._task = None

    def status(self) -> dict[str, Any]:
        return {
            "down_streams": sorted(self._currently_down),
            "firing_rule_ids": sorted(rid for rid, firing in self._rule_firing.items() if firing),
        }

    async def _loop(self) -> None:
        while True:
            await asyncio.sleep(_POLL_INTERVAL_S)
            try:
                await self.tick()
            except Exception:
                logger.exception("Alert evaluation tick failed")

    async def tick(self) -> None:
        await self._check_connectivity()
        await self._check_rules()

    async def _check_connectivity(self) -> None:
        try:
            paths = await get_client().get_paths()
        except Exception as exc:
            logger.warning("Alerting: could not list mediamtx paths: %s", exc)
            return

        # mv_* composite paths are derived, ephemeral, and torn down the
        # moment nobody's watching — "down" there is normal, not an incident.
        ready_names = {
            p["name"] for p in paths if p.get("ready") and not p.get("name", "").startswith("mv_")
        }

        # Only track paths we've actually seen before — a stream that has
        # never come up isn't "down", it just doesn't exist yet.
        tracked = set(self._down_streak) | self._currently_down | ready_names
        for name in tracked:
            if name in ready_names:
                self._down_streak[name] = 0
                if name in self._currently_down:
                    self._currently_down.discard(name)
                    await self._notify(f":large_green_circle: Stream *{name}* recovered.")
                    self._log_event(EventType.stream_connected, name, "Stream reconnected")
            else:
                self._down_streak[name] = self._down_streak.get(name, 0) + 1
                if self._down_streak[name] >= _DOWN_CONSECUTIVE_MISSES and name not in self._currently_down:
                    self._currently_down.add(name)
                    await self._notify(f":red_circle: Stream *{name}* went down.")
                    self._log_event(EventType.stream_disconnected, name, "Stream went down")

    async def _check_rules(self) -> None:
        with Session(engine) as session:
            rules = session.exec(select(AlertRule).where(AlertRule.is_active == True)).all()  # noqa: E712
        if not rules:
            return

        collector = get_collector()
        for rule in rules:
            if rule.action != AlertAction.webhook:
                # AlertRule.action also allows "email", but there's no SMTP
                # config or recipient field on the model to send one to —
                # skip rather than silently pretend it was delivered.
                logger.warning(
                    "Alert rule %d for '%s' has action=%s, which isn't implemented "
                    "(only webhook is) — skipping.",
                    rule.id, rule.stream_path, rule.action.value,
                )
                continue

            snap = collector.get_stats(rule.stream_path)
            if snap is None:
                continue
            field = _METRIC_FIELD[rule.metric.value]
            value = snap.get(field)
            if value is None:
                continue

            breaching = (value < rule.threshold) if rule.operator == CompareOperator.lt else (value > rule.threshold)
            was_firing = self._rule_firing.get(rule.id, False)

            if breaching and not was_firing:
                self._rule_firing[rule.id] = True
                text = (
                    f"{rule.metric.value} {rule.operator.value} {rule.threshold} "
                    f"(currently {value:.2f})"
                )
                await self._notify(f":warning: *{rule.stream_path}*: {text}")
                self._log_event(EventType.alert_fired, rule.stream_path, text)
            elif not breaching and was_firing:
                self._rule_firing[rule.id] = False
                text = f"{rule.metric.value} back to normal ({value:.2f})"
                await self._notify(f":large_green_circle: *{rule.stream_path}*: {text}.")
                self._log_event(EventType.alert_recovered, rule.stream_path, text)

    def _log_event(self, event_type: EventType, stream_path: str, message: str) -> None:
        try:
            with Session(engine) as session:
                log_event(session, event_type, stream_path=stream_path, message=message)
        except Exception:
            logger.exception("Failed to record event %s for %s", event_type.value, stream_path)

    async def _notify(self, text: str) -> None:
        logger.info("ALERT: %s", text)
        if not settings.ALERT_WEBHOOK_URL:
            return
        try:
            async with httpx.AsyncClient(timeout=5.0) as client:
                await client.post(settings.ALERT_WEBHOOK_URL, json={"text": text})
        except Exception:
            logger.exception("Failed to deliver alert webhook")


_manager: AlertManager | None = None


def get_alert_manager() -> AlertManager:
    global _manager
    if _manager is None:
        _manager = AlertManager()
    return _manager
