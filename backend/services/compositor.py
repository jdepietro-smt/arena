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
from collections import deque

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

# Rolling stderr tail per job, updated continuously (not just captured on
# exit) — for debugging things like audio/video stutter while a job is still
# running, without needing server console access. Kept around briefly after
# a job is torn down too.
_STDERR_TAIL_LINES = 200
_stderr_tails: dict[str, deque] = {}


def get_job_log(job_id: str) -> str:
    tail = _stderr_tails.get(job_id)
    return "\n".join(tail) if tail else ""


def _job_id(paths: list[str], audio_path: str | None, blank_slots: int) -> str:
    key = "|".join(sorted(paths)) + "::audio=" + (audio_path or "") + f"::blanks={blank_slots}"
    return "mv_" + hashlib.sha1(key.encode()).hexdigest()[:12]


def _grid(n: int) -> tuple[int, int]:
    """
    Smallest near-square cols x rows with cols*rows >= n.

    Any cells beyond n are filled with a black lavfi source rather than left
    to xstack's grid=/fill= shorthand (added in FFmpeg 5.1+, unsupported on
    this server's build, and previously required an exact cols*rows == n
    factorization — producing an awkward single-row layout for prime counts
    like 3 or 5). Providing our own filler frames means any near-square
    layout is fine regardless of the real/reserved cell count.
    """
    cols = math.ceil(math.sqrt(n))
    rows = math.ceil(n / cols)
    return cols, rows


def _even(n: int) -> int:
    return n - (n % 2)


class _Job:
    def __init__(self, job_id: str, paths: list[str], audio_path: str | None, blank_slots: int = 0) -> None:
        self.job_id = job_id
        self.paths = paths
        self.audio_path = audio_path
        self.blank_slots = blank_slots
        self.created_at = time.monotonic()
        self.proc: asyncio.subprocess.Process | None = None
        self.zero_reader_hits = 0

    def _build_cmd(self) -> list[str]:
        n_real = len(self.paths)
        # blank_slots are cells reserved for something the frontend overlays
        # client-side (a YouTube iframe) — the grid is sized to fit real +
        # reserved cells, and any leftover cells from rounding up to a
        # near-square shape are genuinely wasted (always solid black).
        # Reserved cells are placed LAST (after real streams AND after any
        # genuinely-wasted filler), so they land at the end of row-major
        # order — bottom-right-most for a typical near-square grid, matching
        # where a human would expect an "extra" tile to go.
        needed = n_real + self.blank_slots
        cols, rows = _grid(needed)
        grid_capacity = cols * rows
        wasted_slots = grid_capacity - needed
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
        # Every non-real cell (wasted rounding + reserved) is a solid black
        # lavfi source at the exact cell size — keeps xstack's canvas math
        # (and every other cell's position) correct without a real input.
        total_fillers = wasted_slots + self.blank_slots
        for _ in range(total_fillers):
            cmd += ["-f", "lavfi", "-i", f"color=black:size={cell_w}x{cell_h}:rate={_OUTPUT_FPS}"]

        # fps= normalizes each source to a common, fixed rate independently
        # (duplicating/dropping frames per-stream) before they reach xstack —
        # without it, two sources with slightly different or drifting frame
        # rates make the combined output freeze whenever they fall out of step.
        #
        # Crop-to-fill (increase+crop) vs. letterbox (decrease+pad) depends
        # on row count. With 2+ rows, cells end up noticeably more square
        # than 16:9, and padding every 16:9 source to fit put visible black
        # bars top/bottom of every cell — bars from adjacent rows stacked
        # into what read as one big gap across the screen; cropping avoided
        # that. But a single-row layout (e.g. exactly 2 real tiles: cols=2,
        # rows=1 gives 960x1080 cells) has no such stacking risk — any bars
        # only land at the very top/bottom of the whole canvas, normal
        # letterboxing. Cropping a 960x1080 (portrait-ish) cell out of 16:9
        # source there means zooming in ~2x and cutting away roughly half
        # the picture's width, which reads as broken/zoomed aspect ratio
        # rather than a sensible crop. Letterbox instead for rows == 1.
        if rows == 1:
            scale_filter = (
                f"scale={cell_w}:{cell_h}:force_original_aspect_ratio=decrease,"
                f"pad={cell_w}:{cell_h}:(ow-iw)/2:(oh-ih)/2:color=black"
            )
        else:
            scale_filter = (
                f"scale={cell_w}:{cell_h}:force_original_aspect_ratio=increase,"
                f"crop={cell_w}:{cell_h}"
            )
        scale_parts = [
            f"[{i}:v]fps={_OUTPUT_FPS},{scale_filter}[v{i}]"
            for i in range(n_real)
        ]
        # Filler (lavfi) inputs are already exactly cell_w x cell_h — reference
        # them directly, no scale/pad needed.
        stack_inputs = (
            "".join(f"[v{i}]" for i in range(n_real))
            + "".join(f"[{n_real + j}:v]" for j in range(total_fillers))
        )

        # Explicit pixel-offset layout instead of xstack's grid=/fill= shorthand
        # — those were only added in FFmpeg 5.1, and this server's build predates
        # it. layout=x_y|x_y|... has been supported since xstack was introduced.
        layout = "|".join(
            f"{(i % cols) * cell_w}_{(i // cols) * cell_h}" for i in range(grid_capacity)
        )
        filter_complex = (
            ";".join(scale_parts)
            + (";" if scale_parts else "")
            + f"{stack_inputs}xstack=inputs={grid_capacity}:layout={layout}[outv]"
        )

        cmd += ["-filter_complex", filter_complex, "-map", "[outv]"]

        # Map the selected source's audio straight off its own input — it's
        # already being pulled for video, so this costs nothing extra to
        # decode. Re-encoding to Opus (not copy) because the composite muxes
        # into a fresh container on a fresh timeline; Opus is also what the
        # browser side actually expects for WebRTC audio.
        #
        # Tried adding aresample=async=1 here to match a fix that helped the
        # (non-realtime, single-input) recording pipeline — regressed this
        # job instead: audio cutting out AND video stutter together as soon
        # as audio_path was set, never when muted. This process runs -tune
        # zerolatency compositing multiple live sources into one real-time
        # RTSP muxer; audio and video share the same process/timeline here,
        # unlike the recorder, so a resampler buffering/stretching to
        # compensate for drift backs up the whole pipeline instead of just
        # smoothing the audio track. Reverted — do not re-add without
        # confirming it doesn't reproduce the stutter first.
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

    async def ensure_job(
        self, paths: list[str], audio_path: str | None = None, blank_slots: int = 0
    ) -> str:
        job_id = _job_id(paths, audio_path, blank_slots)
        is_new = False
        async with self._lock:
            job = self._jobs.get(job_id)
            if job is not None and job.running:
                return job_id

            job = _Job(job_id, paths, audio_path, blank_slots)
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
        silent hang, not a crash), keeping a rolling tail so things like
        audio/video stutter can be diagnosed via get_job_log() while the
        job is still running, not just after an unexpected exit.
        """
        proc = job.proc
        if proc is None or proc.stderr is None:
            return
        tail = _stderr_tails.setdefault(job.job_id, deque(maxlen=_STDERR_TAIL_LINES))
        try:
            while True:
                line = await proc.stderr.readline()
                if not line:
                    break
                tail.append(line.decode("utf-8", errors="replace").rstrip())
        except Exception:
            pass

        async with self._lock:
            if self._jobs.get(job.job_id) is job and job.proc is proc:
                self._jobs.pop(job.job_id, None)
            else:
                return  # replaced or stopped intentionally — nothing to log

        logger.error(
            "Composite job %s exited unexpectedly (rc=%s): %s",
            job.job_id, proc.returncode, "\n".join(tail)[-2000:],
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
