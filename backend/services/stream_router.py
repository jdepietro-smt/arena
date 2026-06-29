"""
Stream routing manager.

A route maps a mediamtx source path to one or more destination URLs.
Routing is implemented either via mediamtx's built-in path-proxy
(preferred, zero-copy inside mediamtx) or via an FFmpeg relay subprocess
when the destination is a remote SRT endpoint.

Route state is persisted in the database via the Route model so that
routes can survive application restarts.

Usage
-----
    router = RouteManager()
    await router.start()                        # re-activate persisted routes

    route = await router.create_route(
        name="studio-to-tx",
        source="live/studio",
        destinations=["srt://192.168.1.10:9000"],
    )
    routes = await router.get_active_routes()
    await router.delete_route(route.id)

    await router.stop()                         # graceful shutdown
"""

from __future__ import annotations

import asyncio
import logging
import time
from typing import Any
from urllib.parse import urlparse

from ..config import settings
from ..models import Route, RouteStatus
from .mediamtx import MediaMTXClient, MediaMTXError, get_client

logger = logging.getLogger(__name__)

# SRT ingest point that mediamtx listens on (default mediamtx SRT port)
_MEDIAMTX_SRT_PORT: int = 8890

# Timeout waiting for a relay process to start successfully
_RELAY_START_TIMEOUT: float = 5.0


def _build_ffmpeg_srt_relay(
    source_path: str,
    destination_url: str,
    mediamtx_srt_port: int = _MEDIAMTX_SRT_PORT,
) -> list[str]:
    """
    Build an FFmpeg command that pulls from a mediamtx SRT publisher and
    pushes to a remote SRT destination.

    mediamtx SRT streamids follow the ``#!::r={path}`` convention for readers.
    """
    streamid = f"#!::r={source_path}"
    input_url = f"srt://localhost:{mediamtx_srt_port}?streamid={streamid}"
    return [
        "ffmpeg",
        "-y",
        "-loglevel", "warning",
        "-re",
        "-i", input_url,
        "-c", "copy",
        "-f", "mpegts",
        destination_url,
    ]


def _is_local_rtsp(url: str) -> bool:
    """Return True when the URL points at the local mediamtx RTSP server."""
    parsed = urlparse(url)
    return parsed.scheme in ("rtsp", "rtsps") and parsed.hostname in (
        "localhost", "127.0.0.1", "::1"
    )


class RelayProcess:
    """Wraps a single FFmpeg relay subprocess."""

    def __init__(self, route_id: int, destination: str) -> None:
        self.route_id = route_id
        self.destination = destination
        self._proc: asyncio.subprocess.Process | None = None
        self._monitor_task: asyncio.Task[None] | None = None

    async def start(self, cmd: list[str]) -> None:
        self._proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.DEVNULL,
            stderr=asyncio.subprocess.PIPE,
        )
        self._monitor_task = asyncio.create_task(
            self._monitor(), name=f"relay-monitor-{self.route_id}"
        )

    async def stop(self) -> None:
        if self._proc is not None:
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
        if self._monitor_task is not None:
            self._monitor_task.cancel()
            try:
                await self._monitor_task
            except asyncio.CancelledError:
                pass
            self._monitor_task = None

    @property
    def pid(self) -> int | None:
        return self._proc.pid if self._proc else None

    @property
    def returncode(self) -> int | None:
        return self._proc.returncode if self._proc else None

    async def _monitor(self) -> None:
        if self._proc is None:
            return
        _, stderr_bytes = await self._proc.communicate()
        rc = self._proc.returncode
        if rc not in (0, -15, -2):   # 0=clean, -15=SIGTERM, -2=SIGINT
            stderr = (stderr_bytes or b"").decode("utf-8", errors="replace").strip()
            logger.error(
                "Relay process for route_id=%d destination=%s exited with rc=%d: %s",
                self.route_id, self.destination, rc, stderr[-400:],
            )


class RouteManager:
    """
    Manages stream routes: creates, activates, deactivates, and persists them.
    """

    def __init__(self, client: MediaMTXClient | None = None) -> None:
        self._client = client or get_client()
        self._mediamtx_srt_port: int = getattr(
            settings, "mediamtx_srt_port", _MEDIAMTX_SRT_PORT
        )

        # route_id -> list[RelayProcess]  (one per destination that needs FFmpeg)
        self._relays: dict[int, list[RelayProcess]] = {}
        # route_id -> mediamtx proxy path name (for paths added to mediamtx)
        self._proxy_paths: dict[int, str] = {}

        self._lock = asyncio.Lock()

    # ------------------------------------------------------------------
    # Lifecycle
    # ------------------------------------------------------------------

    async def start(self) -> None:
        """
        Re-activate any routes persisted in the database with status=ACTIVE.
        Call once at application startup.
        """
        active_routes = await Route.filter(status=RouteStatus.ACTIVE).all()
        for route in active_routes:
            try:
                await self._activate_route(route)
                logger.info("Re-activated route id=%d (%s)", route.id, route.name)
            except Exception:
                logger.exception(
                    "Failed to re-activate route id=%d (%s)", route.id, route.name
                )
                await route.update(status=RouteStatus.ERROR)

    async def stop(self) -> None:
        """Stop all active relays. Does NOT change DB status (routes remain ACTIVE for restart)."""
        async with self._lock:
            route_ids = list(self._relays.keys())
        for route_id in route_ids:
            await self._deactivate_relays(route_id)
        logger.info("RouteManager stopped; all relay processes terminated")

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    async def create_route(
        self,
        name: str,
        source: str,
        destinations: list[str],
    ) -> Route:
        """
        Create a new route and immediately activate it.

        Parameters
        ----------
        name:
            Human-readable label for this route.
        source:
            mediamtx source path, e.g. ``live/studio``.
        destinations:
            List of destination URLs.  Supported schemes:

            * ``srt://host:port[?params]`` — FFmpeg SRT relay
            * ``rtsp://localhost/...``     — mediamtx internal proxy path

        Returns
        -------
        Route
            Persisted DB record with status=ACTIVE.
        """
        route = await Route.create(
            name=name,
            source=source,
            destinations=destinations,
            status=RouteStatus.INACTIVE,
            created_at=time.time(),
        )
        try:
            await self._activate_route(route)
            await route.update(status=RouteStatus.ACTIVE)
        except Exception as exc:
            await route.update(status=RouteStatus.ERROR, error=str(exc))
            raise
        logger.info(
            "Created route id=%d name=%r source=%s -> %s",
            route.id, name, source, destinations,
        )
        return route

    async def delete_route(self, route_id: int) -> None:
        """
        Stop the route's relays and remove it from the database.

        Raises
        ------
        ValueError
            If *route_id* does not exist in the database.
        """
        route = await Route.get_or_none(id=route_id)
        if route is None:
            raise ValueError(f"Route id={route_id} not found")

        await self._deactivate_relays(route_id)
        await self._remove_proxy_path(route_id)
        await route.delete()
        logger.info("Deleted route id=%d", route_id)

    async def get_active_routes(self) -> list[dict[str, Any]]:
        """
        Return all routes from the database with their current runtime status.
        """
        routes = await Route.filter().order_by("-created_at").all()
        result = []
        for route in routes:
            async with self._lock:
                relay_pids = [
                    r.pid for r in self._relays.get(route.id, []) if r.pid is not None
                ]
                relay_exit_codes = [
                    r.returncode
                    for r in self._relays.get(route.id, [])
                    if r.returncode is not None
                ]
            healthy = (
                route.status == RouteStatus.ACTIVE
                and len(relay_exit_codes) == 0   # no relays have exited unexpectedly
            )
            result.append(
                {
                    "id": route.id,
                    "name": route.name,
                    "source": route.source,
                    "destinations": route.destinations,
                    "status": route.status,
                    "created_at": route.created_at,
                    "relay_pids": relay_pids,
                    "healthy": healthy,
                    "error": getattr(route, "error", None),
                }
            )
        return result

    async def pause_route(self, route_id: int) -> Route:
        """Stop relays for a route without removing it from the database."""
        route = await Route.get(id=route_id)
        await self._deactivate_relays(route_id)
        await self._remove_proxy_path(route_id)
        await route.update(status=RouteStatus.INACTIVE)
        return route

    async def resume_route(self, route_id: int) -> Route:
        """Re-activate a paused route."""
        route = await Route.get(id=route_id)
        await self._activate_route(route)
        await route.update(status=RouteStatus.ACTIVE)
        return route

    # ------------------------------------------------------------------
    # Internal activation helpers
    # ------------------------------------------------------------------

    async def _activate_route(self, route: Route) -> None:
        """
        Activate a route by starting relays and/or mediamtx proxy paths
        for each destination.
        """
        relay_tasks = []
        proxy_config: dict[str, Any] | None = None

        for dest_url in route.destinations:
            parsed = urlparse(dest_url)

            if parsed.scheme == "srt":
                # FFmpeg SRT relay
                relay_tasks.append(
                    self._start_srt_relay(route.id, route.source, dest_url)
                )
            elif _is_local_rtsp(dest_url):
                # mediamtx internal proxy — configure a path that sources from
                # this route's mediamtx source path.
                proxy_config = {
                    "source": f"rtsp://localhost:{getattr(settings, 'mediamtx_rtsp_port', 8554)}/{route.source}",
                    "sourceOnDemand": False,
                }
            else:
                # Generic URL — use FFmpeg as a relay regardless of scheme.
                relay_tasks.append(
                    self._start_generic_relay(route.id, route.source, dest_url)
                )

        # Set up mediamtx proxy path (if any destination needs it)
        if proxy_config is not None:
            proxy_path_name = f"_route_{route.id}"
            try:
                await self._client.add_path(proxy_path_name, proxy_config)
                async with self._lock:
                    self._proxy_paths[route.id] = proxy_path_name
            except MediaMTXError as exc:
                logger.warning(
                    "Could not add mediamtx proxy path for route id=%d: %s",
                    route.id, exc,
                )

        # Start relay processes concurrently
        if relay_tasks:
            await asyncio.gather(*relay_tasks)

    async def _start_srt_relay(
        self, route_id: int, source_path: str, destination_url: str
    ) -> None:
        cmd = _build_ffmpeg_srt_relay(
            source_path, destination_url, self._mediamtx_srt_port
        )
        relay = RelayProcess(route_id=route_id, destination=destination_url)
        try:
            await relay.start(cmd)
        except FileNotFoundError as exc:
            raise RuntimeError("ffmpeg not found in PATH — cannot start SRT relay") from exc

        logger.info(
            "Started SRT relay: route_id=%d src=%s -> %s (pid=%s)",
            route_id, source_path, destination_url, relay.pid,
        )

        # Brief pause to surface immediate startup failures (e.g. bad URL)
        await asyncio.sleep(0.5)
        if relay.returncode is not None and relay.returncode not in (None, 0):
            raise RuntimeError(
                f"SRT relay exited immediately (rc={relay.returncode}) for {destination_url}"
            )

        async with self._lock:
            self._relays.setdefault(route_id, []).append(relay)

    async def _start_generic_relay(
        self, route_id: int, source_path: str, destination_url: str
    ) -> None:
        """Generic FFmpeg relay for non-SRT destinations (e.g. RTMP)."""
        # Pull from mediamtx RTSP and push to destination
        rtsp_port = getattr(settings, "mediamtx_rtsp_port", 8554)
        input_url = f"rtsp://localhost:{rtsp_port}/{source_path}"
        cmd = [
            "ffmpeg",
            "-y",
            "-loglevel", "warning",
            "-re",
            "-i", input_url,
            "-c", "copy",
            "-f", "flv",
            destination_url,
        ]
        relay = RelayProcess(route_id=route_id, destination=destination_url)
        try:
            await relay.start(cmd)
        except FileNotFoundError as exc:
            raise RuntimeError("ffmpeg not found in PATH") from exc

        logger.info(
            "Started generic relay: route_id=%d src=%s -> %s (pid=%s)",
            route_id, source_path, destination_url, relay.pid,
        )

        await asyncio.sleep(0.5)
        if relay.returncode is not None and relay.returncode not in (None, 0):
            raise RuntimeError(
                f"Generic relay exited immediately (rc={relay.returncode}) for {destination_url}"
            )

        async with self._lock:
            self._relays.setdefault(route_id, []).append(relay)

    async def _deactivate_relays(self, route_id: int) -> None:
        async with self._lock:
            relays = self._relays.pop(route_id, [])
        await asyncio.gather(*(r.stop() for r in relays), return_exceptions=True)

    async def _remove_proxy_path(self, route_id: int) -> None:
        async with self._lock:
            proxy_path = self._proxy_paths.pop(route_id, None)
        if proxy_path:
            try:
                await self._client.remove_path(proxy_path)
            except MediaMTXError as exc:
                logger.warning(
                    "Could not remove mediamtx proxy path %s: %s", proxy_path, exc
                )


# ---------------------------------------------------------------------------
# Module-level singleton
# ---------------------------------------------------------------------------

_router: RouteManager | None = None


def get_router() -> RouteManager:
    global _router
    if _router is None:
        _router = RouteManager()
    return _router


async def start_router() -> None:
    await get_router().start()


async def stop_router() -> None:
    if _router is not None:
        await _router.stop()
