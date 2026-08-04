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
from .uptime import record_sample

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

# Predictive alerting — trend-project each live stream's recent telemetry
# forward and flag it as "at risk" BEFORE it actually breaches a hard
# threshold, instead of only reacting once it already has (that's what
# _check_connectivity/_check_rules already do). Same debounce shape as the
# down-streak check: a trend has to hold for 2 consecutive ticks before it's
# reported, so one noisy sample doesn't flap the status.
_PREDICTION_WINDOW_S = 90.0     # how much recent history to fit a trend over
_PROJECTION_HORIZON_S = 120.0   # how far ahead to project that trend
_PREDICTION_MIN_SAMPLES = 5     # below this, a slope estimate is just noise
_PREDICTION_CONSECUTIVE_TICKS = 2
_RTT_CRITICAL_MS = 300.0        # matches the frontend's metricTone() critical band
_PACKET_LOSS_CRITICAL_PCT = 5.0
_BITRATE_COLLAPSE_RATIO = 0.2   # projected bitrate below 20% of its own recent average


def _linear_trend(points: list[tuple[float, float]]) -> tuple[float, float] | None:
    """Least-squares slope (unit/second) and current (last) value, or None
    if there aren't enough points to fit a meaningful line."""
    if len(points) < _PREDICTION_MIN_SAMPLES:
        return None
    t0 = points[0][0]
    xs = [p[0] - t0 for p in points]
    ys = [p[1] for p in points]
    n = len(points)
    mean_x = sum(xs) / n
    mean_y = sum(ys) / n
    denom = sum((x - mean_x) ** 2 for x in xs)
    if denom == 0:
        return None
    slope = sum((x - mean_x) * (y - mean_y) for x, y in zip(xs, ys)) / denom
    return slope, ys[-1]


class AlertManager:
    def __init__(self) -> None:
        self._task: asyncio.Task | None = None
        # path -> consecutive not-ready polls seen so far
        self._down_streak: dict[str, int] = {}
        # paths currently considered down (already notified)
        self._currently_down: set[str] = set()
        # AlertRule.id -> currently breaching (already notified)
        self._rule_firing: dict[int, bool] = {}
        # path -> consecutive ticks the predictive check has flagged risk
        self._risk_streak: dict[str, int] = {}
        # path -> human-readable reason, only present while actively flagged
        self._predicted_risks: dict[str, str] = {}

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
            "predicted_risks": dict(sorted(self._predicted_risks.items())),
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
        await self._check_predictions()

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
        if tracked:
            with Session(engine) as session:
                for name in tracked:
                    record_sample(session, name, name in ready_names)
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

    async def _check_predictions(self) -> None:
        collector = get_collector()
        # Only ever predict for paths currently live and not already flagged
        # down — a stream that's already down or never existed has nothing
        # to "predict", and re-flagging it as also "at risk" would just be
        # duplicate noise on top of the connectivity alert.
        candidates = set(collector.get_all_paths()) - self._currently_down
        seen_this_tick: set[str] = set()

        for path in candidates:
            history = collector.get_history(path, seconds=_PREDICTION_WINDOW_S)
            if not history or not history[-1].get("ready", True):
                continue

            reason = self._predict_risk(history)
            if reason:
                seen_this_tick.add(path)
                self._risk_streak[path] = self._risk_streak.get(path, 0) + 1
                if (
                    self._risk_streak[path] >= _PREDICTION_CONSECUTIVE_TICKS
                    and path not in self._predicted_risks
                ):
                    self._predicted_risks[path] = reason
                    await self._notify(f":crystal_ball: *{path}* trending toward trouble: {reason}")
                    self._log_event(EventType.predicted_risk, path, reason)
            else:
                self._risk_streak.pop(path, None)

        # Anything that was flagged but isn't a candidate/at-risk this tick
        # (trend reversed, or the stream went down/disappeared) recovers.
        recovered = set(self._predicted_risks) - seen_this_tick
        for path in recovered:
            reason = self._predicted_risks.pop(path)
            await self._notify(f":large_green_circle: *{path}* trend recovered ({reason} no longer projected).")
            self._log_event(EventType.predicted_risk_cleared, path, f"Recovered from: {reason}")

    def _predict_risk(self, history: list[dict]) -> str | None:
        """Return a human-readable risk reason if this stream's trend
        projects a threshold breach within the horizon, else None."""
        rtt_points = [(h["timestamp"], h["rtt_ms"]) for h in history if h.get("rtt_ms") is not None]
        rtt_trend = _linear_trend(rtt_points)
        if rtt_trend:
            slope, current = rtt_trend
            projected = current + slope * _PROJECTION_HORIZON_S
            if current < _RTT_CRITICAL_MS <= projected:
                return f"RTT projected to hit {projected:.0f}ms within ~{_PROJECTION_HORIZON_S / 60:.0f}min (currently {current:.0f}ms)"

        loss_points = [(h["timestamp"], h["packet_loss_pct"]) for h in history if h.get("packet_loss_pct") is not None]
        loss_trend = _linear_trend(loss_points)
        if loss_trend:
            slope, current = loss_trend
            projected = current + slope * _PROJECTION_HORIZON_S
            if current < _PACKET_LOSS_CRITICAL_PCT <= projected:
                return f"Packet loss projected to hit {projected:.1f}% within ~{_PROJECTION_HORIZON_S / 60:.0f}min (currently {current:.1f}%)"

        bitrate_points = [(h["timestamp"], h["bitrate_kbps"]) for h in history if h.get("bitrate_kbps") is not None]
        bitrate_trend = _linear_trend(bitrate_points)
        if bitrate_trend:
            slope, current = bitrate_trend
            avg = sum(y for _, y in bitrate_points) / len(bitrate_points)
            projected = current + slope * _PROJECTION_HORIZON_S
            if avg > 100 and slope < 0 and projected < avg * _BITRATE_COLLAPSE_RATIO:
                return f"Bitrate collapsing — projected {projected:.0f}kbps vs a recent average of {avg:.0f}kbps"

        return None

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
