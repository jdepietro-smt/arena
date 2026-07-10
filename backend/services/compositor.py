"""
Composite multiviewer manager.

Combines N live stream paths into a single tiled video via FFmpeg +
mediamtx's dynamic path API, so any number of browsers can watch one WHEP
connection instead of each decoding N streams individually. Optionally
muxes in ONE selected source's audio directly in the same FFmpeg process
that produces the video — deliberately not a separate audio pipeline, so
audio and video share one encode and one timeline and sync the same way
the main SDI encoder's muxed output does. Switching which source's audio
plays means requesting a different job (a few seconds to restart), which
is the tradeoff for getting real sync instead of a guessed delay.

API expected by the multiview router:
    await get_compositor().ensure_job(paths: list[str], audio_path: str | None) -> str

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

from ..models import ManagedPathType
from .managed_paths import register_path, unregister_path
from .mediamtx import get_client

logger = logging.getLogger(__name__)

_RTSP_PORT = 8554
_CANVAS_W = 1920
_CANVAS_H = 1080
_OUTPUT_FPS = 30
_REAP_INTERVAL_S = 20
_REAP_GRACE_S = 30  # don't reap a job younger than this — give the first viewer time to connect


def _job_id(paths: list[str], audio_path: str | None) -> str:
    key = "|".join(sorted(paths)) + "::audio=" + (audio_path or "")
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
    def __init__(self, job_id: str, paths: list[str], audio_path: str | None) -> None:
        self.job_id = job_id
        self.paths = paths
        self.audio_path = audio_path
        self.created_at = time.monotonic()
        self.proc: asyncio.subprocess.Process | None = None
        self.zero_reader_hits = 0

    def _build_cmd(self) -> list[str]:
        cols, rows = _grid(len(self.paths))
        cell_w = _even(_CANVAS_W // cols)
        cell_h = _even(_CANVAS_H // rows)

        cmd = ["ffmpeg", "-y", "-loglevel", "warning"]
        for path in self.paths:
            # thread_queue_size avoids input buffers overflowing/blocking when
            # several independent live sources feed one filter graph.
            # use_wallclock_as_timestamps stamps each frame with real arrival
            # time instead of trusting the source's own PTS — genpts (tried
            # first) instead *interpolated* timestamps from an assumed frame
            # rate, and when that guess didn't match the source, the fps=
            # filter below stretched playback against it, causing slow motion.
            cmd += [
                "-thread_queue_size", "512",
                "-rtsp_transport", "tcp",
                "-use_wallclock_as_timestamps", "1",
                "-i", f"rtsp://localhost:{_RTSP_PORT}/{path}",
            ]

        n = len(self.paths)
        # fps= normalizes each source to a common, fixed rate independently
        # (duplicating/dropping frames per-stream) before they reach xstack —
        # without it, two sources with slightly different or drifting frame
        # rates make the combined output freeze whenever they fall out of step.
        # scale uses force_original_aspect_ratio+pad rather than a flat WxH,
        # since a flat scale stretches/squishes the source to fill the cell
        # whenever the cell's aspect ratio doesn't match the source's own.
        scale_parts = [
            f"[{i}:v]fps={_OUTPUT_FPS},"
            f"scale={cell_w}:{cell_h}:force_original_aspect_ratio=decrease,"
            f"pad={cell_w}:{cell_h}:(ow-iw)/2:(oh-ih)/2:color=black[v{i}]"
            for i in range(n)
        ]
        stack_inputs = "".join(f"[v{i}]" for i in range(n))

        # Explicit pixel-offset layout instead of xstack's grid=/fill= shorthand
        # — those were only added in FFmpeg 5.1, and this server's build predates
        # it. layout=x_y|x_y|... has been supported since xstack was introduced.
        layout = "|".join(
            f"{(i % cols) * cell_w}_{(i // cols) * cell_h}" for i in range(n)
        )
        filter_complex = (
            ";".join(scale_parts)
            + f";{stack_inputs}xstack=inputs={n}:layout={layout}[outv]"
        )

        cmd += ["-filter_complex", filter_complex, "-map", "[outv]"]

        # Map the selected source's audio straight off its own input — it's
        # already being pulled for video, so this costs nothing extra to
        # decode. Re-encoding to Opus (not copy) because the composite muxes
        # into a fresh container on a fresh timeline; Opus is also what the
        # browser side actually expects for WebRTC audio.
        if self.audio_path is not None and self.audio_path in self.paths:
            audio_idx = self.paths.index(self.audio_path)
            cmd += ["-map", f"{audio_idx}:a", "-c:a", "libopus", "-b:a", "128k", "-ar", "48000"]
        else:
            cmd += ["-an"]

        return cmd + [
            "-r", str(_OUTPUT_FPS),
            "-c:v", "libx264", "-preset", "veryfast", "-tune", "zerolatency",
            "-g", str(_OUTPUT_FPS * 2),
            "-b:v", "6M", "-maxrate", "6M", "-bufsize", "6M",
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

    async def ensure_job(self, paths: list[str], audio_path: str | None = None) -> str:
        job_id = _job_id(paths, audio_path)
        is_new = False
        async with self._lock:
            job = self._jobs.get(job_id)
            if job is not None and job.running:
                return job_id

            job = _Job(job_id, paths, audio_path)
            client = get_client()
            try:
                await client.add_path(job_id, {"source": "publisher"})
            except Exception as exc:
                logger.warning("add_path failed for %s (may already exist): %s", job_id, exc)
            register_path(job_id, ManagedPathType.composite)
            await job.start()
            self._jobs[job_id] = job
            asyncio.create_task(self._watch_job(job))
            is_new = True

        if is_new:
            # Wait for ffmpeg to actually start publishing before handing the
            # job_id back — otherwise the frontend's first WHEP attempt races
            # a still-starting composite and gets a 404. Don't hold the
            # manager lock while doing this; it only touches this one job.
            await self._wait_until_ready(job_id)
        return job_id

    def list_jobs(self) -> list[dict]:
        return [
            {
                "job_id": job.job_id,
                "paths": job.paths,
                "audio_path": job.audio_path,
                "running": job.running,
                "age_seconds": round(time.monotonic() - job.created_at, 1),
            }
            for job in self._jobs.values()
        ]

    async def stop_job(self, job_id: str) -> bool:
        """Explicitly tear a job down regardless of reader count. Returns
        False if no such job is tracked by this process."""
        async with self._lock:
            job = self._jobs.pop(job_id, None)
        if job is None:
            return False
        await job.stop()
        try:
            await get_client().remove_path(job_id)
        except Exception:
            pass
        unregister_path(job_id)
        return True

    async def _wait_until_ready(self, job_id: str, timeout: float = 10.0, interval: float = 0.5) -> None:
        client = get_client()
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            try:
                info = await client.get_path(job_id)
                if info.get("ready"):
                    return
            except Exception:
                pass
            await asyncio.sleep(interval)

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
                unregister_path(job_id)
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
            unregister_path(job.job_id)


_manager: CompositorManager | None = None


def get_compositor() -> CompositorManager:
    global _manager
    if _manager is None:
        _manager = CompositorManager()
    return _manager
