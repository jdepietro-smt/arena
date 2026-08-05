"""
Broadcast QC monitoring: frozen-frame, black-video, and silent-audio
detection on live streams.

Runs one ffmpeg process per opted-in stream, pulling it back in via SRT
(same input mechanism as hls_generator.py) and feeding it through
ffmpeg's own freezedetect/blackdetect/silencedetect filters into a null
output — no re-encode, no write, just decode + analyze.

Opt-in via want()/unwant(), same shape and for the same reason as
hls_generator.py: an extra real-time decode per stream is genuine CPU
cost (confirmed there to cause frame-rate slowdown on the multiviewer
compositor when it ran unconditionally for every live path) — QC
monitoring is valuable but not free, so an admin enables it per stream
rather than it running everywhere by default.

What "real-time" actually means here was verified against real ffmpeg
output (a synthetic clip with a frozen/black segment and a silent
segment run through these exact filters), not just the filter docs,
since it changes what each check can honestly claim:

- freezedetect: `freeze_start` fires the instant N seconds of near-zero
  motion is seen — genuinely real-time. `freeze_end` (+ freeze_duration)
  fires once motion resumes. Tracked below as an open/close pair, so
  "frozen right now" is an accurate live status.
- silencedetect: same shape — `silence_start` fires live, `silence_end`
  + `silence_duration` fire together on recovery. Also tracked as an
  open/close pair.
- blackdetect: emits exactly ONE line — `black_start:X black_end:Y
  black_duration:Z` — and only once the black period has already ENDED.
  Confirmed directly: an 8s solid-black test clip produced no output at
  all until the filter flushed at end-of-stream. There is no live
  "black right now" signal from this filter, full stop. A feed stuck on
  solid black is in practice almost always also motion-frozen (identical
  frames), which freezedetect already catches live — so black-detection
  here is logged as a completed, retrospective QC event (useful for
  history/audit: "was black for 12s"), never as a live status.

API:
    get_qc_monitor().start()                # once, at app startup
    await get_qc_monitor().stop_all()       # once, at app shutdown
    await get_qc_monitor().want(path)       # enable QC monitoring for a stream
    await get_qc_monitor().unwant(path)     # disable it
    get_qc_monitor().list_jobs() -> list[dict]
    get_qc_monitor().status() -> dict       # currently-monitored paths + open issues
"""

from __future__ import annotations

import asyncio
import logging
import re
from collections import deque
from datetime import datetime
from typing import Any, Awaitable, Callable

import httpx
from sqlmodel import Session

from ..config import settings
from ..database import engine
from ..models import EventType
from .events import log_event

logger = logging.getLogger(__name__)

_SRT_PORT = settings.MEDIAMTX_SRT_PORT
_RECONCILE_INTERVAL_S = 10
_RESTART_BACKOFF_S = 5.0
_MAX_BACKOFF_S = 30.0

# Filter thresholds — chosen to match common broadcast QC defaults (a
# couple of seconds of no motion/audio is a real fault, not a natural
# quiet beat or a static graphic overlay).
_FREEZE_NOISE_DB = -60
_FREEZE_MIN_DURATION_S = 2
_SILENCE_NOISE_DB = -50
_SILENCE_MIN_DURATION_S = 2
_BLACK_MIN_DURATION_S = 2
_BLACK_PIX_THRESHOLD = 0.10

_FREEZE_START_RE = re.compile(r"lavfi\.freezedetect\.freeze_start:\s*([\d.]+)")
_FREEZE_END_RE = re.compile(r"lavfi\.freezedetect\.freeze_end:\s*([\d.]+)")
_SILENCE_START_RE = re.compile(r"silence_start:\s*([\d.]+)")
_SILENCE_END_RE = re.compile(r"silence_end:\s*([\d.]+)\s*\|\s*silence_duration:\s*([\d.]+)")
_BLACK_RE = re.compile(r"black_start:([\d.]+)\s*black_end:([\d.]+)\s*black_duration:([\d.]+)")

QCEvent = dict[str, Any]
OnEvent = Callable[[str, QCEvent], Awaitable[None]]


def parse_qc_line(line: str) -> QCEvent | None:
    """Parse one ffmpeg stderr line into a QC event, or None if it isn't one.

    Pulled out as a pure function specifically so the parsing logic (the
    part actually worth getting right) is testable without spawning a
    real ffmpeg process.
    """
    if (m := _FREEZE_START_RE.search(line)) is not None:
        return {"kind": "freeze", "action": "start"}
    if (m := _FREEZE_END_RE.search(line)) is not None:
        return {"kind": "freeze", "action": "end"}
    if (m := _SILENCE_START_RE.search(line)) is not None:
        return {"kind": "silence", "action": "start"}
    if (m := _SILENCE_END_RE.search(line)) is not None:
        return {"kind": "silence", "action": "end", "duration": float(m.group(2))}
    if (m := _BLACK_RE.search(line)) is not None:
        return {"kind": "black", "action": "detected", "duration": float(m.group(3))}
    return None


class _Job:
    def __init__(self, path: str, on_event: OnEvent) -> None:
        self.path = path
        self.on_event = on_event
        self.proc: asyncio.subprocess.Process | None = None
        self.last_error: str | None = None
        self._stop_requested = False
        self._task: asyncio.Task | None = None

    def _build_cmd(self) -> list[str]:
        streamid = f"#!::r={self.path}"
        input_url = f"srt://localhost:{_SRT_PORT}?streamid={streamid}"
        return [
            "ffmpeg", "-loglevel", "info", "-nostats",
            "-i", input_url,
            "-filter:v",
            f"freezedetect=n={_FREEZE_NOISE_DB}dB:d={_FREEZE_MIN_DURATION_S},"
            f"blackdetect=d={_BLACK_MIN_DURATION_S}:pix_th={_BLACK_PIX_THRESHOLD}",
            "-filter:a", f"silencedetect=n={_SILENCE_NOISE_DB}dB:d={_SILENCE_MIN_DURATION_S}",
            "-map", "0:v", "-map", "0:a",
            "-f", "null", "-",
        ]

    async def _run_once(self) -> None:
        self.proc = await asyncio.create_subprocess_exec(
            *self._build_cmd(),
            stdout=asyncio.subprocess.DEVNULL,
            stderr=asyncio.subprocess.PIPE,
        )
        logger.info("QC monitor started for '%s' (pid=%s)", self.path, self.proc.pid)

        tail: deque[str] = deque(maxlen=50)
        assert self.proc.stderr is not None
        async for raw in self.proc.stderr:
            line = raw.decode("utf-8", errors="replace").rstrip()
            tail.append(line)
            event = parse_qc_line(line)
            if event is not None:
                try:
                    await self.on_event(self.path, event)
                except Exception:
                    logger.exception("QC event handler failed for '%s': %s", self.path, event)

        rc = await self.proc.wait()
        self.proc = None
        if not self._stop_requested and rc != 0:
            raise RuntimeError(f"ffmpeg exited rc={rc}: {chr(10).join(tail)[-500:]}")

    async def supervise(self) -> None:
        backoff = _RESTART_BACKOFF_S
        while not self._stop_requested:
            try:
                await self._run_once()
                backoff = _RESTART_BACKOFF_S  # clean exit shouldn't normally happen for a live pull
            except Exception as exc:
                self.last_error = str(exc)
                logger.warning("QC monitor for '%s' failed, retrying in %.0fs: %s", self.path, backoff, exc)
            if self._stop_requested:
                break
            await asyncio.sleep(backoff)
            backoff = min(backoff * 1.5, _MAX_BACKOFF_S)

    def start(self) -> None:
        self._task = asyncio.create_task(self.supervise())

    @property
    def running(self) -> bool:
        return self.proc is not None and self.proc.returncode is None

    @property
    def alive(self) -> bool:
        return self._task is not None and not self._task.done()

    async def stop(self) -> None:
        self._stop_requested = True
        if self._task is not None:
            self._task.cancel()
        if self.proc is not None:
            try:
                self.proc.terminate()
            except ProcessLookupError:
                pass
            try:
                await asyncio.wait_for(self.proc.wait(), timeout=8.0)
            except asyncio.TimeoutError:
                self.proc.kill()
                await self.proc.wait()
        self.proc = None


class QCMonitor:
    def __init__(self) -> None:
        self._jobs: dict[str, _Job] = {}
        self._wanted: set[str] = set()
        self._lock = asyncio.Lock()
        self._reconcile_task: asyncio.Task | None = None
        # (path, kind) -> ISO timestamp the issue started — freeze/silence
        # only; black has no "started" moment we ever observe live (see
        # module docstring), so it never appears here.
        self._active_issues: dict[tuple[str, str], str] = {}

    async def _handle_event(self, path: str, event: QCEvent) -> None:
        kind = event["kind"]
        if kind in ("freeze", "silence"):
            key = (path, kind)
            if event["action"] == "start":
                if key in self._active_issues:
                    return  # already open — a stray duplicate start, not a new incident
                self._active_issues[key] = datetime.utcnow().isoformat()
                self._log_event(EventType.qc_issue_detected, path, f"{kind} detected")
                await self._notify(f":warning: {kind.title()} detected on *{path}*")
            else:
                if key not in self._active_issues:
                    return  # end with no matching start (e.g. we started monitoring mid-freeze)
                del self._active_issues[key]
                duration = event.get("duration")
                suffix = f" (lasted {duration:.1f}s)" if duration is not None else ""
                self._log_event(EventType.qc_issue_cleared, path, f"{kind} cleared{suffix}")
                await self._notify(f":white_check_mark: {kind.title()} cleared on *{path}*{suffix}")
        elif kind == "black":
            # Always retrospective (see module docstring) — log the
            # completed occurrence rather than pretending it's live.
            duration = event.get("duration", 0.0)
            self._log_event(EventType.qc_issue_detected, path, f"black video detected (lasted {duration:.1f}s)")
            await self._notify(f":warning: Black video detected on *{path}* (lasted {duration:.1f}s)")

    def _log_event(self, event_type: EventType, stream_path: str, message: str) -> None:
        try:
            with Session(engine) as session:
                log_event(session, event_type, stream_path=stream_path, message=message)
        except Exception:
            logger.exception("Failed to record QC event %s for %s", event_type.value, stream_path)

    async def _notify(self, text: str) -> None:
        logger.info("QC: %s", text)
        if not settings.ALERT_WEBHOOK_URL:
            return
        try:
            async with httpx.AsyncClient(timeout=5.0) as client:
                await client.post(settings.ALERT_WEBHOOK_URL, json={"text": text})
        except Exception:
            logger.exception("Failed to deliver QC alert webhook")

    async def ensure_job(self, path: str) -> None:
        async with self._lock:
            job = self._jobs.get(path)
            if job is not None and job.alive:
                return
            job = _Job(path, self._handle_event)
            job.start()
            self._jobs[path] = job

    async def stop_job(self, path: str) -> bool:
        async with self._lock:
            job = self._jobs.pop(path, None)
        if job is None:
            return False
        await job.stop()
        # Don't let a stopped monitor claim a stale open issue forever —
        # silent cleanup, not a real recovery, so no event/notify here.
        for kind in ("freeze", "silence"):
            self._active_issues.pop((path, kind), None)
        return True

    async def want(self, path: str) -> None:
        self._wanted.add(path)
        await self.ensure_job(path)

    async def unwant(self, path: str) -> None:
        self._wanted.discard(path)
        await self.stop_job(path)

    async def _reconcile_once(self) -> None:
        for path in set(self._wanted):
            await self.ensure_job(path)

    async def _reconcile_loop(self) -> None:
        while True:
            await asyncio.sleep(_RECONCILE_INTERVAL_S)
            try:
                await self._reconcile_once()
            except Exception:
                logger.exception("QC monitor reconciliation failed")

    def start(self) -> None:
        if self._reconcile_task is None:
            self._reconcile_task = asyncio.create_task(self._reconcile_loop())
            asyncio.create_task(self._reconcile_once())

    async def stop_all(self) -> None:
        if self._reconcile_task is not None:
            self._reconcile_task.cancel()
            self._reconcile_task = None
        async with self._lock:
            jobs = list(self._jobs.values())
            self._jobs.clear()
        for job in jobs:
            await job.stop()

    def list_jobs(self) -> list[dict]:
        return [
            {"path": p, "running": j.running, "last_error": j.last_error}
            for p, j in self._jobs.items()
        ]

    def status(self) -> dict:
        return {
            "monitored_paths": sorted(self._wanted),
            "active_issues": [
                {"path": p, "kind": k, "started_at": started_at}
                for (p, k), started_at in sorted(self._active_issues.items())
            ],
        }


_monitor: QCMonitor | None = None


def get_qc_monitor() -> QCMonitor:
    global _monitor
    if _monitor is None:
        _monitor = QCMonitor()
    return _monitor
