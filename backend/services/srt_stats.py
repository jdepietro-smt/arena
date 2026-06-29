"""
SRT / stream stats collector.

Polls the mediamtx API every POLL_INTERVAL seconds and maintains an
in-memory sliding-window history of per-path statistics.

Usage
-----
    collector = StatsCollector()
    await collector.start()

    stats = collector.get_stats("live/camera1")
    history = collector.get_history("live/camera1", seconds=120)

    await collector.stop()
"""

from __future__ import annotations

import asyncio
import logging
import time
from collections import defaultdict, deque
from dataclasses import dataclass, field
from typing import Any

from .mediamtx import MediaMTXClient, MediaMTXError, get_client

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Configuration constants
# ---------------------------------------------------------------------------

POLL_INTERVAL: float = 2.0          # seconds between mediamtx API polls
HISTORY_WINDOW: float = 3600.0      # maximum history retained per path (seconds)
MAX_HISTORY_POINTS: int = int(HISTORY_WINDOW / POLL_INTERVAL)


# ---------------------------------------------------------------------------
# Data types
# ---------------------------------------------------------------------------

@dataclass
class StatsSnapshot:
    """A single point-in-time stats sample for one stream path."""

    path_name: str
    timestamp: float                 # Unix epoch seconds

    # Throughput
    bitrate_kbps: float = 0.0        # calculated from bytesReceived delta

    # SRT-specific (populated from srt connection records when available)
    rtt_ms: float = 0.0
    packet_loss_pct: float = 0.0
    jitter_ms: float = 0.0

    # Session info
    uptime_seconds: float = 0.0
    reader_count: int = 0
    ready: bool = False

    def to_dict(self) -> dict[str, Any]:
        return {
            "path_name": self.path_name,
            "timestamp": self.timestamp,
            "bitrate_kbps": round(self.bitrate_kbps, 2),
            "rtt_ms": round(self.rtt_ms, 2),
            "packet_loss_pct": round(self.packet_loss_pct, 4),
            "jitter_ms": round(self.jitter_ms, 2),
            "uptime_seconds": round(self.uptime_seconds, 1),
            "reader_count": self.reader_count,
            "ready": self.ready,
        }


@dataclass
class _PathAccumulator:
    """Mutable per-path bookkeeping between polls."""
    last_bytes_received: int = 0
    last_poll_time: float = field(default_factory=time.monotonic)


# ---------------------------------------------------------------------------
# Collector
# ---------------------------------------------------------------------------

class StatsCollector:
    """
    Background polling task that keeps a sliding window of stream stats.

    Thread-safety: all public methods are coroutine-safe via asyncio.Lock.
    The class is designed to live for the lifetime of the application; call
    ``await collector.start()`` once and ``await collector.stop()`` on shutdown.
    """

    def __init__(
        self,
        client: MediaMTXClient | None = None,
        poll_interval: float = POLL_INTERVAL,
    ) -> None:
        self._client = client or get_client()
        self._poll_interval = poll_interval

        # path_name -> deque of StatsSnapshot
        self._history: defaultdict[str, deque[StatsSnapshot]] = defaultdict(
            lambda: deque(maxlen=MAX_HISTORY_POINTS)
        )
        # path_name -> most recent StatsSnapshot
        self._current: dict[str, StatsSnapshot] = {}
        # path_name -> accumulator for delta calculations
        self._accumulators: dict[str, _PathAccumulator] = {}

        self._lock = asyncio.Lock()
        self._task: asyncio.Task[None] | None = None
        self._running = False

    # ------------------------------------------------------------------
    # Lifecycle
    # ------------------------------------------------------------------

    async def start(self) -> None:
        """Start the background polling task."""
        if self._running:
            logger.warning("StatsCollector.start() called while already running")
            return
        self._running = True
        self._task = asyncio.create_task(self._poll_loop(), name="stats-collector")
        logger.info(
            "StatsCollector started (poll interval: %.1fs)", self._poll_interval
        )

    async def stop(self) -> None:
        """Stop the background polling task and release resources."""
        self._running = False
        if self._task is not None:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
            self._task = None
        logger.info("StatsCollector stopped")

    # ------------------------------------------------------------------
    # Public query API
    # ------------------------------------------------------------------

    def get_stats(self, path_name: str) -> dict[str, Any] | None:
        """
        Return the most recent StatsSnapshot for *path_name*, or None if
        no data has been collected for that path yet.
        """
        snap = self._current.get(path_name)
        return snap.to_dict() if snap is not None else None

    def get_history(
        self, path_name: str, seconds: float = 60.0
    ) -> list[dict[str, Any]]:
        """
        Return up to *seconds* of history snapshots for *path_name*,
        ordered oldest → newest.

        Returns an empty list if no history exists for the path.
        """
        history = self._history.get(path_name)
        if not history:
            return []
        cutoff = time.time() - seconds
        return [s.to_dict() for s in history if s.timestamp >= cutoff]

    def get_all_paths(self) -> list[str]:
        """Return a sorted list of paths currently being tracked."""
        return sorted(self._current.keys())

    # ------------------------------------------------------------------
    # Background polling
    # ------------------------------------------------------------------

    async def _poll_loop(self) -> None:
        while self._running:
            poll_start = time.monotonic()
            try:
                await self._poll_once()
            except asyncio.CancelledError:
                raise
            except Exception:
                logger.exception("Unhandled error in stats poll loop")
            elapsed = time.monotonic() - poll_start
            sleep_for = max(0.0, self._poll_interval - elapsed)
            await asyncio.sleep(sleep_for)

    async def _poll_once(self) -> None:
        """Fetch mediamtx data and update internal state."""
        now = time.time()
        mono_now = time.monotonic()

        try:
            paths, srt_conns = await asyncio.gather(
                self._client.get_paths(),
                self._fetch_srt_connections(),
            )
        except MediaMTXError as exc:
            logger.warning("mediamtx API error during stats poll: %s", exc)
            return

        # Build a lookup of SRT stats keyed by the path name the connection
        # is publishing to.  mediamtx SRT connection records carry a
        # ``path`` field when the connection is a publisher.
        srt_by_path: dict[str, dict[str, Any]] = {}
        for conn in srt_conns:
            p = conn.get("path") or conn.get("query", "")
            if p:
                srt_by_path[p] = conn

        async with self._lock:
            seen_paths: set[str] = set()

            for item in paths:
                name: str = item.get("name", "")
                if not name:
                    continue
                seen_paths.add(name)

                ready: bool = bool(item.get("ready", False))
                readers: list[Any] = item.get("readers", []) or []
                reader_count: int = len(readers)

                # Uptime
                ready_time_str: str | None = item.get("readyTime")
                uptime_seconds: float = 0.0
                if ready_time_str:
                    try:
                        import datetime
                        dt = datetime.datetime.fromisoformat(
                            ready_time_str.replace("Z", "+00:00")
                        )
                        uptime_seconds = (
                            datetime.datetime.now(datetime.timezone.utc) - dt
                        ).total_seconds()
                    except Exception:
                        pass

                # Byte-based bitrate calculation
                source: dict[str, Any] = item.get("source") or {}
                bytes_received: int = int(source.get("bytesReceived", 0))
                acc = self._accumulators.setdefault(name, _PathAccumulator())
                delta_bytes = max(0, bytes_received - acc.last_bytes_received)
                delta_time = mono_now - acc.last_poll_time
                bitrate_kbps = (
                    (delta_bytes * 8 / 1000 / delta_time) if delta_time > 0 else 0.0
                )
                acc.last_bytes_received = bytes_received
                acc.last_poll_time = mono_now

                # SRT stats (RTT, loss, jitter) from connection record
                rtt_ms: float = 0.0
                packet_loss_pct: float = 0.0
                jitter_ms: float = 0.0
                srt_conn = srt_by_path.get(name)
                if srt_conn:
                    rtt_ms = float(srt_conn.get("msRTT") or srt_conn.get("rtt", 0))
                    pkt_sent = int(srt_conn.get("pktSentTotal", 0))
                    pkt_lost = int(srt_conn.get("pktSndLossTotal", 0))
                    if pkt_sent > 0:
                        packet_loss_pct = pkt_lost / pkt_sent * 100.0
                    jitter_ms = float(
                        srt_conn.get("msRcvTsbPdDelay")
                        or srt_conn.get("jitter", 0)
                    )

                snap = StatsSnapshot(
                    path_name=name,
                    timestamp=now,
                    bitrate_kbps=bitrate_kbps,
                    rtt_ms=rtt_ms,
                    packet_loss_pct=packet_loss_pct,
                    jitter_ms=jitter_ms,
                    uptime_seconds=uptime_seconds,
                    reader_count=reader_count,
                    ready=ready,
                )
                self._current[name] = snap
                self._history[name].append(snap)

            # Remove accumulators and current entries for paths no longer active.
            gone = set(self._current.keys()) - seen_paths
            for name in gone:
                self._current.pop(name, None)
                self._accumulators.pop(name, None)
                # History is intentionally retained so callers can query
                # recent history for a stream that just went offline.

    async def _fetch_srt_connections(self) -> list[dict[str, Any]]:
        """Fetch SRT connection list; return empty list on any error."""
        try:
            conns = await self._client.get_connections()
            return conns.get("srt", [])
        except Exception as exc:
            logger.debug("Could not fetch SRT connections: %s", exc)
            return []


# ---------------------------------------------------------------------------
# Module-level singleton
# ---------------------------------------------------------------------------

_collector: StatsCollector | None = None


def get_collector() -> StatsCollector:
    global _collector
    if _collector is None:
        _collector = StatsCollector()
    return _collector


async def start_collector() -> None:
    await get_collector().start()


async def stop_collector() -> None:
    if _collector is not None:
        await _collector.stop()
