"""
Composite multiviewer manager.

Combines N live stream paths into a single tiled, video-only stream via
FFmpeg + mediamtx's dynamic path API, so any number of browsers can watch
one WHEP connection instead of each decoding N streams individually. Audio
is deliberately dropped here — the frontend picks one source's audio at a
time via a separate lightweight audio-only WHEP connection.

API expected by the multiview router:
    await get_compositor().ensure_job(paths: list[str]) -> str   # mediamtx path name

A background reaper stops a job once mediamtx reports zero readers on its
composite path for two consecutive checks, so nothing has to be told
explicitly when the last viewer leaves.
"""

from __future__ import annotations

import asyncio
import hashlib
import logging
import math
import time

from .mediamtx import get_client

logger = logging.getLogger(__name__)

_RTSP_PORT = 8554
_CANVAS_W = 1920
_CANVAS_H = 1080
_REAP_INTERVAL_S = 20
_REAP_GRACE_S = 30  # don't reap a job younger than this — give the first viewer time to connect


def _job_id(paths: list[str]) -> str:
    key = "|".join(sorted(paths))
    return "mv_" + hashlib.sha1(key.encode()).hexdigest()[:12]


def _grid(n: int) -> tuple[int, int]:
    """
    Pick cols/rows whose product is exactly n (no leftover cells).

    xstack's `grid=WxH` shorthand requires exactly cols*rows inputs; the
    `fill` option that pads a partial grid only exists in FFmpeg 5.1+, and
    this server's build doesn't have it, so we can't rely on it. Search
    upward from sqrt(n) for the first exact divisor instead — a "most
    square" factor pair when n has one, otherwise a single row (e.g. a
    prime count like 5 or 7 renders 5x1 rather than crashing).
    """
    cols = math.ceil(math.sqrt(n))
    while n % cols != 0:
        cols += 1
    rows = n // cols
    return cols, rows


def _even(n: int) -> int:
    return n - (n % 2)


class _Job:
    def __init__(self, job_id: str, paths: list[str]) -> None:
        self.job_id = job_id
        self.paths = paths
        self.created_at = time.monotonic()
        self.proc: asyncio.subprocess.Process | None = None
        self.zero_reader_hits = 0

    def _build_cmd(self) -> list[str]:
        cols, rows = _grid(len(self.paths))
        cell_w = _even(_CANVAS_W // cols)
        cell_h = _even(_CANVAS_H // rows)

        cmd = ["ffmpeg", "-y", "-loglevel", "warning"]
        for path in self.paths:
            cmd += ["-rtsp_transport", "tcp", "-i", f"rtsp://localhost:{_RTSP_PORT}/{path}"]

        scale_parts = [f"[{i}:v]scale={cell_w}:{cell_h}[v{i}]" for i in range(len(self.paths))]
        stack_inputs = "".join(f"[v{i}]" for i in range(len(self.paths)))
        filter_complex = (
            ";".join(scale_parts)
            + f";{stack_inputs}xstack=inputs={len(self.paths)}:grid={cols}x{rows}[outv]"
        )

        return cmd + [
            "-filter_complex", filter_complex,
            "-map", "[outv]", "-an",
            "-c:v", "libx264", "-preset", "ultrafast", "-tune", "zerolatency",
            "-g", "60", "-b:v", "4M",
            "-f", "rtsp", f"rtsp://localhost:{_RTSP_PORT}/{self.job_id}",
        ]

    async def start(self) -> None:
        self.proc = await asyncio.create_subprocess_exec(
            *self._build_cmd(),
            stdout=asyncio.subprocess.DEVNULL,
            stderr=asyncio.subprocess.PIPE,
        )
        logger.info("Composite job started: %s <- %s (pid=%s)", self.job_id, self.paths, self.proc.pid)

    async def stop(self) -> None:
        if self.proc is None:
            return
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

    @property
    def running(self) -> bool:
        return self.proc is not None and self.proc.returncode is None


class CompositorManager:
    def __init__(self) -> None:
        self._jobs: dict[str, _Job] = {}
        self._lock = asyncio.Lock()
        self._reaper_task: asyncio.Task | None = None

    async def ensure_job(self, paths: list[str]) -> str:
        job_id = _job_id(paths)
        async with self._lock:
            job = self._jobs.get(job_id)
            if job is not None and job.running:
                return job_id

            job = _Job(job_id, paths)
            client = get_client()
            try:
                await client.add_path(job_id, {"source": "publisher"})
            except Exception as exc:
                logger.warning("add_path failed for %s (may already exist): %s", job_id, exc)
            await job.start()
            self._jobs[job_id] = job
            asyncio.create_task(self._watch_job(job))
            return job_id

    async def _watch_job(self, job: _Job) -> None:
        """
        Drain the job's stderr pipe for its whole lifetime (a PIPE that's
        never read can fill and block ffmpeg's write() calls forever — a
        silent hang, not a crash) and log the tail if it exits unexpectedly.
        """
        proc = job.proc
        if proc is None:
            return
        try:
            _, stderr_bytes = await proc.communicate()
        except Exception:
            return

        async with self._lock:
            if self._jobs.get(job.job_id) is job and job.proc is proc:
                self._jobs.pop(job.job_id, None)
            else:
                return  # replaced or stopped intentionally — nothing to log

        stderr = (stderr_bytes or b"").decode("utf-8", errors="replace").strip()
        logger.error(
            "Composite job %s exited unexpectedly (rc=%s): %s",
            job.job_id, proc.returncode, stderr[-2000:],
        )

    async def _reap_once(self) -> None:
        client = get_client()
        async with self._lock:
            job_ids = list(self._jobs.keys())
        for job_id in job_ids:
            job = self._jobs.get(job_id)
            if job is None or not job.running:
                continue
            if time.monotonic() - job.created_at < _REAP_GRACE_S:
                continue
            try:
                info = await client.get_path(job_id)
                readers = info.get("readers", [])
            except Exception as exc:
                logger.warning("Could not query readers for %s: %s", job_id, exc)
                continue
            if readers:
                job.zero_reader_hits = 0
                continue
            job.zero_reader_hits += 1
            if job.zero_reader_hits >= 2:
                logger.info("Composite job %s has no readers — tearing down", job_id)
                await job.stop()
                try:
                    await client.remove_path(job_id)
                except Exception:
                    pass
                async with self._lock:
                    self._jobs.pop(job_id, None)

    async def _reap_loop(self) -> None:
        while True:
            await asyncio.sleep(_REAP_INTERVAL_S)
            try:
                await self._reap_once()
            except Exception:
                logger.exception("Compositor reaper iteration failed")

    def start_reaper(self) -> None:
        if self._reaper_task is None:
            self._reaper_task = asyncio.create_task(self._reap_loop())

    async def stop(self) -> None:
        if self._reaper_task is not None:
            self._reaper_task.cancel()
            self._reaper_task = None
        async with self._lock:
            jobs = list(self._jobs.values())
            self._jobs.clear()
        client = get_client()
        for job in jobs:
            await job.stop()
            try:
                await client.remove_path(job.job_id)
            except Exception:
                pass


_manager: CompositorManager | None = None


def get_compositor() -> CompositorManager:
    global _manager
    if _manager is None:
        _manager = CompositorManager()
    return _manager
