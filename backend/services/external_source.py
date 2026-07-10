"""
External source manager — ingests non-native sources (currently: YouTube
URLs) into mediamtx as normal paths, so they behave exactly like any other
live stream: WHEP-playable, listed in /api/streams, addable to the
multiviewer.

YouTube doesn't expose a stable, directly-ingestible media URL — yt-dlp
resolves the actual underlying manifest URL from the page URL, and that
resolved URL can expire (especially for live streams, where it's a
time-limited token) or the pull can simply drop. So unlike a plain external
SRT source (which mediamtx could just be configured to pull forever on its
own), a YouTube source needs an actively-supervised loop here: resolve,
spawn ffmpeg, and if it ever exits, re-resolve and restart with backoff.

API:
    await get_external_sources().add(name: str, url: str) -> None
    await get_external_sources().remove(name: str) -> bool
    get_external_sources().list() -> list[dict]
"""

from __future__ import annotations

import asyncio
import logging
import os
import time

from ..models import ManagedPathType
from .managed_paths import register_path, unregister_path
from .mediamtx import get_client

logger = logging.getLogger(__name__)

_RTSP_PORT = 8554
_RESTART_BACKOFF_S = 5.0
_MAX_BACKOFF_S = 60.0

# Prefer an mp4/m4a pairing (cheap to decode) but fall back to whatever's
# available — we re-encode regardless, so ffmpeg just needs to be able to
# decode it, not match any particular downstream codec requirement.
_YTDLP_FORMAT = "best[ext=mp4]/bestvideo[ext=mp4]+bestaudio[ext=m4a]/best"

# YouTube frequently challenges requests from datacenter IPs (like this
# server's) with a "confirm you're not a bot" gate that a plain request
# can't pass. Exporting cookies from a real signed-in browser session and
# dropping the file here lets yt-dlp authenticate as that session instead.
COOKIES_PATH = "/opt/arena/youtube_cookies.txt"


class _YoutubeSource:
    def __init__(self, name: str, url: str) -> None:
        self.name = name
        self.url = url
        self.created_at = time.monotonic()
        self.proc: asyncio.subprocess.Process | None = None
        self.status = "starting"  # starting | live | error | stopped
        self.last_error: str | None = None
        self._stop_requested = False
        self._task: asyncio.Task | None = None

    async def _resolve(self) -> list[str]:
        # --verbose so we can tell whether the PO-token plugin actually
        # loaded (yt-dlp prints that at the very start of stderr) — without
        # it we can only see the final extractor error, not why the plugin
        # path didn't help.
        cmd = ["yt-dlp", "-g", "-f", _YTDLP_FORMAT, "--no-playlist", "--verbose"]
        if os.path.isfile(COOKIES_PATH):
            cmd += ["--cookies", COOKIES_PATH]
        cmd.append(self.url)

        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, stderr = await proc.communicate()
        if proc.returncode != 0:
            text = (stderr or b"").decode("utf-8", errors="replace").strip()
            # Keep the plugin-loading header (start of output) *and* the
            # actual error (end of output) — a plain tail truncation drops
            # the header entirely on verbose runs.
            head, tail = text[:1200], text[-800:]
            raise RuntimeError(f"{head}\n...\n{tail}" if len(text) > 2000 else text)
        urls = [u for u in stdout.decode().strip().splitlines() if u]
        if not urls:
            raise RuntimeError("yt-dlp returned no stream URL")
        return urls

    async def _run_once(self) -> None:
        urls = await self._resolve()

        cmd = ["ffmpeg", "-y", "-loglevel", "warning"]
        for u in urls:
            cmd += [
                "-reconnect", "1", "-reconnect_streamed", "1", "-reconnect_delay_max", "5",
                "-i", u,
            ]
        if len(urls) >= 2:
            # Separate video/audio DASH streams — map one of each explicitly.
            cmd += ["-map", "0:v:0", "-map", "1:a:0"]
        cmd += [
            "-c:v", "libx264", "-preset", "veryfast", "-tune", "zerolatency", "-g", "60",
            "-c:a", "libopus", "-b:a", "128k", "-ar", "48000",
            "-f", "rtsp", f"rtsp://localhost:{_RTSP_PORT}/{self.name}",
        ]

        self.proc = await asyncio.create_subprocess_exec(
            *cmd, stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.PIPE,
        )
        logger.info("YouTube source '%s' started (pid=%s) <- %s", self.name, self.proc.pid, self.url)
        self.status = "live"
        self.last_error = None

        _, stderr_bytes = await self.proc.communicate()
        rc = self.proc.returncode
        self.proc = None
        if not self._stop_requested and rc != 0:
            stderr = (stderr_bytes or b"").decode("utf-8", errors="replace").strip()
            raise RuntimeError(f"ffmpeg exited rc={rc}: {stderr[-500:]}")

    async def _supervise(self) -> None:
        backoff = _RESTART_BACKOFF_S
        while not self._stop_requested:
            try:
                await self._run_once()
                backoff = _RESTART_BACKOFF_S  # clean exit shouldn't normally happen for a live pull
            except Exception as exc:
                self.status = "error"
                self.last_error = str(exc)
                logger.warning("YouTube source '%s' failed, retrying in %.0fs: %s", self.name, backoff, exc)
            if self._stop_requested:
                break
            await asyncio.sleep(backoff)
            backoff = min(backoff * 1.5, _MAX_BACKOFF_S)

    def start(self) -> None:
        self._task = asyncio.create_task(self._supervise())

    async def stop(self) -> None:
        self._stop_requested = True
        self.status = "stopped"
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


class ExternalSourceManager:
    def __init__(self) -> None:
        self._sources: dict[str, _YoutubeSource] = {}
        self._lock = asyncio.Lock()

    async def add(self, name: str, url: str) -> None:
        async with self._lock:
            if name in self._sources:
                raise ValueError(f"Source '{name}' already exists")
            client = get_client()
            try:
                await client.add_path(name, {"source": "publisher"})
            except Exception as exc:
                logger.warning("add_path failed for %s (may already exist): %s", name, exc)
            register_path(name, ManagedPathType.external_source)
            source = _YoutubeSource(name, url)
            source.start()
            self._sources[name] = source

    async def remove(self, name: str) -> bool:
        async with self._lock:
            source = self._sources.pop(name, None)
        if source is None:
            return False
        await source.stop()
        try:
            await get_client().remove_path(name)
        except Exception:
            pass
        unregister_path(name)
        return True

    def list(self) -> list[dict]:
        return [
            {
                "name": s.name,
                "url": s.url,
                "status": s.status,
                "last_error": s.last_error,
                "age_seconds": round(time.monotonic() - s.created_at, 1),
            }
            for s in self._sources.values()
        ]

    async def stop_all(self) -> None:
        async with self._lock:
            sources = list(self._sources.values())
            self._sources.clear()
        client = get_client()
        for s in sources:
            await s.stop()
            try:
                await client.remove_path(s.name)
            except Exception:
                pass
            unregister_path(s.name)


_manager: ExternalSourceManager | None = None


def get_external_sources() -> ExternalSourceManager:
    global _manager
    if _manager is None:
        _manager = ExternalSourceManager()
    return _manager
