"""
Stream relay manager.

DB operations belong to the routes router.  This service only manages
FFmpeg relay subprocesses in memory.

API expected by routes.py:
    await manager.activate(route: StreamRoute)
    await manager.deactivate(route: StreamRoute)
    await manager.is_running(route: StreamRoute) -> bool
"""

from __future__ import annotations

import asyncio
import logging
from urllib.parse import urlparse

from ..config import settings
from ..models import StreamRoute
from .mediamtx import get_client

logger = logging.getLogger(__name__)

_SRT_PORT = settings.MEDIAMTX_SRT_PORT


class _Relay:
    def __init__(self, route_id: int, dest: str) -> None:
        self.route_id = route_id
        self.dest = dest
        self._proc: asyncio.subprocess.Process | None = None

    async def start(self, cmd: list[str]) -> None:
        self._proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.DEVNULL,
            stderr=asyncio.subprocess.PIPE,
        )
        logger.info("Relay started: route_id=%d -> %s (pid=%s)", self.route_id, self.dest, self._proc.pid)

    async def stop(self) -> None:
        if self._proc is None:
            return
        try:
            self._proc.terminate()
        except ProcessLookupError:
            pass
        try:
            await asyncio.wait_for(self._proc.wait(), timeout=8.0)
        except asyncio.TimeoutError:
            self._proc.kill()
            await self._proc.wait()
        self._proc = None

    @property
    def running(self) -> bool:
        return self._proc is not None and self._proc.returncode is None


class RouteManager:
    def __init__(self) -> None:
        self._relays: dict[int, list[_Relay]] = {}
        self._lock = asyncio.Lock()

    async def activate(self, route: StreamRoute) -> None:
        started: list[_Relay] = []
        destinations = route.destinations or []
        for dest in destinations:
            url = dest.get("url") if isinstance(dest, dict) else str(dest)
            if not url:
                continue
            cmd = self._cmd(route.source_path, url)
            relay = _Relay(route.id, url)
            try:
                await relay.start(cmd)
                started.append(relay)
            except FileNotFoundError:
                logger.error("ffmpeg not in PATH — cannot relay to %s", url)
            except Exception as exc:
                logger.error("Failed to start relay to %s: %s", url, exc)
        async with self._lock:
            self._relays[route.id] = started

    async def deactivate(self, route: StreamRoute) -> None:
        async with self._lock:
            relays = self._relays.pop(route.id, [])
        await asyncio.gather(*(r.stop() for r in relays), return_exceptions=True)
        logger.info("Route id=%d deactivated", route.id)

    async def is_running(self, route: StreamRoute) -> bool:
        relays = self._relays.get(route.id, [])
        return any(r.running for r in relays)

    def _cmd(self, source_path: str, dest_url: str) -> list[str]:
        parsed = urlparse(dest_url)
        if parsed.scheme == "srt":
            streamid = f"#!::r={source_path}"
            inp = f"srt://localhost:{_SRT_PORT}?streamid={streamid}"
            return ["ffmpeg", "-y", "-loglevel", "warning", "-re",
                    "-i", inp, "-c", "copy", "-f", "mpegts", dest_url]
        else:
            inp = f"rtsp://localhost:8554/{source_path}"
            return ["ffmpeg", "-y", "-loglevel", "warning", "-re",
                    "-i", inp, "-c", "copy", "-f", "flv", dest_url]


_manager: RouteManager | None = None


def get_router() -> RouteManager:
    global _manager
    if _manager is None:
        _manager = RouteManager()
    return _manager
