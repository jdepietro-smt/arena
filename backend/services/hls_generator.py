"""
Per-stream HLS generator.

mediamtx's own native HLS muxer breaks for this encoder's video: it waits
for a keyframe before it can close each ~1s segment, but the encoder's own
GOP is ~8s, so a segment just keeps growing until it hits mediamtx's size
limit — confirmed live: the audio track keeps working throughout, the
video track silently doesn't make it into recordings pulled from that
source, even with explicit stream mapping and generous ffmpeg probe
settings.

This runs one ffmpeg process per currently-live stream that pulls it back
in via SRT, forces a real keyframe every 1s (independent of the source's
own GOP), and writes properly segmented HLS to /tmp/arena-hls — the same
place hls_proxy.py already serves from and recorder.py already prefers,
so both live preview and recording get real, complete HLS without either
needing to know this exists.

A background reconciliation loop keeps exactly one generator running per
currently-live stream: starting one the moment a stream goes ready,
stopping it when the stream goes away, and restarting it (with backoff)
if the ffmpeg process itself dies — nothing needs to be wired up per
stream by hand.

API:
    get_hls_generator().start()             # once, at app startup
    await get_hls_generator().stop_all()     # once, at app shutdown
    get_hls_generator().list_jobs() -> list[dict]
"""

from __future__ import annotations

import asyncio
import logging
import os
import shutil

from ..config import settings
from .mediamtx import get_client

logger = logging.getLogger(__name__)

HLS_DIR = "/tmp/arena-hls"
_SRT_PORT = settings.MEDIAMTX_SRT_PORT
_RECONCILE_INTERVAL_S = 10
_RESTART_BACKOFF_S = 5.0
_MAX_BACKOFF_S = 30.0


class _Job:
    def __init__(self, path: str) -> None:
        self.path = path
        self.proc: asyncio.subprocess.Process | None = None
        self.last_error: str | None = None
        self._stop_requested = False
        self._task: asyncio.Task | None = None

    def _build_cmd(self) -> list[str]:
        out_dir = os.path.join(HLS_DIR, self.path)
        os.makedirs(out_dir, exist_ok=True)
        streamid = f"#!::r={self.path}"
        input_url = f"srt://localhost:{_SRT_PORT}?streamid={streamid}"
        return [
            "ffmpeg", "-y", "-loglevel", "warning",
            # This SRT source's own embedded PTS turned out to be unreliable
            # over longer live captures — confirmed via ffprobe on real
            # recordings: video frame counts inflated to ~3x the actual
            # elapsed wall-clock time on one stream, audio timestamps
            # under-counted on another, both consistent with bad/wrapping
            # source timestamps rather than an encoder problem. Stamping
            # with wall-clock arrival time instead fixes that.
            #
            # But raw wallclock timestamps aren't evenly spaced — frames
            # that arrive in the same tick (more likely at 60fps than 30fps)
            # get equal/decreasing timestamps. "-vsync 0" (strict passthrough)
            # let those collide straight into the muxer — confirmed via a
            # full decode pass (ffmpeg -f null -), not just ffprobe: "non
            # monotonically increasing dts to muxer" throughout the file,
            # which is exactly the kind of corruption that makes a browser
            # refuse to play the file at all rather than just stutter.
            # "-vsync vfr" keeps real frame count (no CFR duplication) but
            # drops any frame whose timestamp doesn't strictly advance,
            # guaranteeing a valid monotonic timeline for the muxer.
            "-use_wallclock_as_timestamps", "1",
            "-i", input_url,
            "-vsync", "vfr",
            "-c:v", "libx264", "-preset", "veryfast", "-tune", "zerolatency",
            "-force_key_frames", "expr:gte(t,n_forced*1)",
            "-c:a", "aac", "-b:a", "128k", "-ar", "48000", "-af", "aresample=async=1",
            # 30s retained (vs. the old 6s) — recorder.py briefly probes the
            # playlist before it starts copying; too small a window here and
            # the earliest segments it looked at get deleted before it can
            # read them, corrupting the recording's timeline (stretched/
            # duplicated video PTS, or a missing initial keyframe entirely).
            "-f", "hls", "-hls_time", "1", "-hls_list_size", "30",
            "-hls_flags", "delete_segments+independent_segments",
            "-hls_segment_filename", os.path.join(out_dir, "index%d.ts"),
            os.path.join(out_dir, "index.m3u8"),
        ]

    async def _run_once(self) -> None:
        self.proc = await asyncio.create_subprocess_exec(
            *self._build_cmd(),
            stdout=asyncio.subprocess.DEVNULL,
            stderr=asyncio.subprocess.PIPE,
        )
        logger.info("HLS generator started for '%s' (pid=%s)", self.path, self.proc.pid)
        _, stderr_bytes = await self.proc.communicate()
        rc = self.proc.returncode
        self.proc = None
        if not self._stop_requested and rc != 0:
            stderr = (stderr_bytes or b"").decode("utf-8", errors="replace").strip()
            raise RuntimeError(f"ffmpeg exited rc={rc}: {stderr[-500:]}")

    async def supervise(self) -> None:
        backoff = _RESTART_BACKOFF_S
        while not self._stop_requested:
            try:
                await self._run_once()
                backoff = _RESTART_BACKOFF_S  # clean exit shouldn't normally happen for a live pull
            except Exception as exc:
                self.last_error = str(exc)
                logger.warning("HLS generator for '%s' failed, retrying in %.0fs: %s", self.path, backoff, exc)
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
        # Actively running OR mid-backoff between attempts — distinguishes
        # "temporarily between attempts" from "fully torn down".
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
        shutil.rmtree(os.path.join(HLS_DIR, self.path), ignore_errors=True)


class HlsGeneratorManager:
    def __init__(self) -> None:
        self._jobs: dict[str, _Job] = {}
        self._lock = asyncio.Lock()
        self._reconcile_task: asyncio.Task | None = None

    async def ensure_job(self, path: str) -> None:
        async with self._lock:
            job = self._jobs.get(path)
            if job is not None and job.alive:
                return
            job = _Job(path)
            job.start()
            self._jobs[path] = job

    async def stop_job(self, path: str) -> bool:
        async with self._lock:
            job = self._jobs.pop(path, None)
        if job is None:
            return False
        await job.stop()
        return True

    async def _reconcile_once(self) -> None:
        try:
            paths = await get_client().get_paths()
        except Exception as exc:
            logger.warning("HLS generator reconcile: could not list mediamtx paths: %s", exc)
            return

        # mv_* composite paths and anything not ready don't need HLS at all.
        live = {p["name"] for p in paths if p.get("ready") and not p.get("name", "").startswith("mv_")}
        async with self._lock:
            tracked = set(self._jobs.keys())

        for path in live - tracked:
            await self.ensure_job(path)
        for path in tracked - live:
            await self.stop_job(path)

    async def _reconcile_loop(self) -> None:
        while True:
            await asyncio.sleep(_RECONCILE_INTERVAL_S)
            try:
                await self._reconcile_once()
            except Exception:
                logger.exception("HLS generator reconciliation failed")

    def start(self) -> None:
        if self._reconcile_task is None:
            self._reconcile_task = asyncio.create_task(self._reconcile_loop())
            asyncio.create_task(self._reconcile_once())  # don't wait a full interval on startup

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


_manager: HlsGeneratorManager | None = None


def get_hls_generator() -> HlsGeneratorManager:
    global _manager
    if _manager is None:
        _manager = HlsGeneratorManager()
    return _manager
