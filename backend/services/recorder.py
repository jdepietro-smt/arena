"""
Recording manager.

Starts and stops FFmpeg processes that pull HLS from mediamtx and write
MP4 files.  Active processes are tracked in memory; metadata is persisted
via the Recording ORM model.

Usage
-----
    manager = RecordingManager()

    rec = await manager.start_recording("live/camera1")
    ...
    updated_rec = await manager.stop_recording(rec.id)
"""

from __future__ import annotations

import asyncio
import logging
import os
import time
from pathlib import Path
from typing import Any

from ..config import settings
from ..models import Recording, RecordingStatus

logger = logging.getLogger(__name__)

# mediamtx HLS endpoint template — {base} is e.g. http://localhost:8888
_HLS_URL_TEMPLATE = "{base}/{path}/index.m3u8"

# FFmpeg command template.  We use -c copy so there is no transcode penalty.
# -loglevel warning suppresses the per-frame spam while keeping errors visible.
_FFMPEG_CMD = [
    "ffmpeg",
    "-y",                           # overwrite output without prompting
    "-loglevel", "warning",
    "-i", "{input_url}",
    "-c", "copy",
    "-movflags", "+faststart",      # enable streaming-friendly MP4 structure
    "{output_path}",
]


class RecordingError(Exception):
    """Raised for unrecoverable recording errors."""


class RecordingManager:
    """
    Manages FFmpeg-based recording sessions.

    One RecordingManager instance should be created at application startup
    and shared across request handlers.  It is safe to call from multiple
    coroutines concurrently.
    """

    def __init__(
        self,
        default_output_dir: str | None = None,
        hls_base_url: str | None = None,
    ) -> None:
        self._default_output_dir = Path(
            default_output_dir or getattr(settings, "recordings_dir", "/opt/dvr/recordings")
        )
        self._hls_base = (
            hls_base_url or getattr(settings, "mediamtx_hls_url", "http://localhost:8888")
        ).rstrip("/")

        # recording_id -> asyncio.subprocess.Process
        self._processes: dict[int, asyncio.subprocess.Process] = {}
        # recording_id -> output Path (so we can stat it on stop)
        self._output_paths: dict[int, Path] = {}
        # recording_id -> start monotonic time
        self._start_times: dict[int, float] = {}

        self._lock = asyncio.Lock()

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    async def start_recording(
        self,
        stream_path: str,
        output_dir: str | None = None,
    ) -> Recording:
        """
        Start recording *stream_path* to an MP4 file.

        Parameters
        ----------
        stream_path:
            mediamtx path name, e.g. ``live/camera1``.
        output_dir:
            Directory in which to write the output file.
            Defaults to ``settings.recordings_dir``.

        Returns
        -------
        Recording
            Freshly created DB record with status=RECORDING.
        """
        out_dir = Path(output_dir) if output_dir else self._default_output_dir
        out_dir.mkdir(parents=True, exist_ok=True)

        timestamp = int(time.time())
        safe_name = stream_path.replace("/", "_")
        filename = f"{safe_name}_{timestamp}.mp4"
        output_path = out_dir / filename

        input_url = _HLS_URL_TEMPLATE.format(
            base=self._hls_base, path=stream_path
        )

        # Persist the recording record before we launch FFmpeg so that we
        # always have a DB row even if FFmpeg fails to start.
        recording = await Recording.create(
            stream_path=stream_path,
            filename=filename,
            output_path=str(output_path),
            status=RecordingStatus.RECORDING,
            started_at=time.time(),
        )

        cmd = [
            c.format(input_url=input_url, output_path=str(output_path))
            for c in _FFMPEG_CMD
        ]

        try:
            proc = await asyncio.create_subprocess_exec(
                *cmd,
                stdout=asyncio.subprocess.DEVNULL,
                stderr=asyncio.subprocess.PIPE,
            )
        except FileNotFoundError as exc:
            await recording.update(status=RecordingStatus.ERROR, error="ffmpeg not found")
            raise RecordingError("ffmpeg executable not found in PATH") from exc
        except OSError as exc:
            await recording.update(status=RecordingStatus.ERROR, error=str(exc))
            raise RecordingError(f"Failed to launch ffmpeg: {exc}") from exc

        async with self._lock:
            self._processes[recording.id] = proc
            self._output_paths[recording.id] = output_path
            self._start_times[recording.id] = time.monotonic()

        # Monitor the process asynchronously so we can update DB status
        # if FFmpeg exits unexpectedly.
        asyncio.create_task(
            self._monitor_process(recording.id, proc),
            name=f"rec-monitor-{recording.id}",
        )

        logger.info(
            "Recording started: id=%d path=%s -> %s (pid=%d)",
            recording.id, stream_path, output_path, proc.pid,
        )
        return recording

    async def stop_recording(self, recording_id: int) -> Recording:
        """
        Stop an active recording, update duration and file size in DB.

        Parameters
        ----------
        recording_id:
            The ``Recording.id`` returned by :meth:`start_recording`.

        Returns
        -------
        Recording
            Updated record with status=COMPLETED, duration, and file_size.

        Raises
        ------
        RecordingError
            If *recording_id* is not currently active.
        """
        async with self._lock:
            proc = self._processes.pop(recording_id, None)
            output_path = self._output_paths.pop(recording_id, None)
            start_mono = self._start_times.pop(recording_id, None)

        if proc is None:
            raise RecordingError(f"No active recording with id={recording_id}")

        # Send SIGTERM / CTRL_BREAK (platform-appropriate) so FFmpeg flushes
        # the MP4 container before exiting.
        try:
            proc.terminate()
        except ProcessLookupError:
            pass  # process already exited

        try:
            await asyncio.wait_for(proc.wait(), timeout=10.0)
        except asyncio.TimeoutError:
            logger.warning(
                "FFmpeg pid=%s did not exit after 10s; sending SIGKILL", proc.pid
            )
            proc.kill()
            await proc.wait()

        duration_seconds: float = (
            time.monotonic() - start_mono if start_mono is not None else 0.0
        )
        file_size_bytes: int = 0
        if output_path and output_path.exists():
            file_size_bytes = output_path.stat().st_size

        recording = await Recording.get(id=recording_id)
        await recording.update(
            status=RecordingStatus.COMPLETED,
            stopped_at=time.time(),
            duration_seconds=round(duration_seconds, 1),
            file_size_bytes=file_size_bytes,
        )

        logger.info(
            "Recording stopped: id=%d duration=%.1fs size=%d bytes",
            recording_id, duration_seconds, file_size_bytes,
        )
        return recording

    async def get_recordings(self) -> list[Recording]:
        """Return all recordings from the database, newest first."""
        return await Recording.filter().order_by("-started_at").all()

    async def delete_recording(self, recording_id: int) -> None:
        """
        Delete a recording's file and its database entry.

        If the recording is currently active it is stopped first.

        Parameters
        ----------
        recording_id:
            The ``Recording.id`` to delete.

        Raises
        ------
        RecordingError
            If the recording does not exist in the database.
        """
        recording = await Recording.get_or_none(id=recording_id)
        if recording is None:
            raise RecordingError(f"Recording id={recording_id} not found")

        # Stop if still running
        async with self._lock:
            is_active = recording_id in self._processes
        if is_active:
            try:
                await self.stop_recording(recording_id)
            except RecordingError:
                pass

        # Delete the file
        output_path = Path(recording.output_path)
        if output_path.exists():
            try:
                output_path.unlink()
                logger.info("Deleted recording file: %s", output_path)
            except OSError as exc:
                logger.warning("Could not delete file %s: %s", output_path, exc)

        await recording.delete()
        logger.info("Deleted recording record: id=%d", recording_id)

    def get_active_recording_ids(self) -> list[int]:
        """Return a list of recording IDs that currently have an active FFmpeg process."""
        return list(self._processes.keys())

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    async def _monitor_process(
        self, recording_id: int, proc: asyncio.subprocess.Process
    ) -> None:
        """
        Await the FFmpeg process and update DB status when it exits
        unexpectedly (i.e. before stop_recording is called).
        """
        stderr_bytes = b""
        try:
            _, stderr_bytes = await proc.communicate()
        except Exception:
            pass

        exit_code = proc.returncode

        # If recording_id is still tracked, FFmpeg exited without being
        # explicitly stopped — treat as an error.
        async with self._lock:
            still_active = recording_id in self._processes
            if still_active:
                self._processes.pop(recording_id, None)
                output_path = self._output_paths.pop(recording_id, None)
                start_mono = self._start_times.pop(recording_id, None)
            else:
                output_path = None
                start_mono = None

        if still_active:
            stderr_text = (stderr_bytes or b"").decode("utf-8", errors="replace").strip()
            logger.error(
                "FFmpeg exited unexpectedly for recording id=%d (exit=%d): %s",
                recording_id, exit_code, stderr_text[-500:],
            )
            duration_seconds: float = (
                time.monotonic() - start_mono if start_mono is not None else 0.0
            )
            file_size_bytes: int = 0
            if output_path and output_path.exists():
                file_size_bytes = output_path.stat().st_size
            try:
                recording = await Recording.get(id=recording_id)
                await recording.update(
                    status=RecordingStatus.ERROR,
                    stopped_at=time.time(),
                    duration_seconds=round(duration_seconds, 1),
                    file_size_bytes=file_size_bytes,
                    error=stderr_text[-200:] if stderr_text else f"exit code {exit_code}",
                )
            except Exception:
                logger.exception(
                    "Failed to update DB status for failed recording id=%d", recording_id
                )


# ---------------------------------------------------------------------------
# Module-level singleton
# ---------------------------------------------------------------------------

_manager: RecordingManager | None = None


def get_manager() -> RecordingManager:
    global _manager
    if _manager is None:
        _manager = RecordingManager()
    return _manager
