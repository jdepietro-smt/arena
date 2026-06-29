"""
Recording manager — SQLModel edition.

Exposes two module-level coroutines that streams.py calls:
    start_recording(session, stream_path) -> Recording
    stop_recording(session, recording_id) -> Recording

FFmpeg processes are tracked in module-level dicts (one per recording id).
"""

from __future__ import annotations

import asyncio
import logging
import time
from datetime import datetime
from pathlib import Path

from sqlmodel import Session

from ..config import settings
from ..models import Recording, RecordingStatus

logger = logging.getLogger(__name__)

_OUTPUT_DIR = Path("/opt/arena/recordings")
_HLS_BASE = settings.MEDIAMTX_HLS.rstrip("/")

# In-memory process tracking  (recording_id -> ...)
_processes: dict[int, asyncio.subprocess.Process] = {}
_output_paths: dict[int, Path] = {}
_start_times: dict[int, float] = {}
_lock = asyncio.Lock()


async def start_recording(session: Session, stream_path: str) -> Recording:
    _OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    timestamp = int(time.time())
    safe = stream_path.replace("/", "_")
    filename = f"{safe}_{timestamp}.mp4"
    output_path = _OUTPUT_DIR / filename
    input_url = f"{_HLS_BASE}/{stream_path}/index.m3u8"

    recording = Recording(
        stream_path=stream_path,
        filename=filename,
        status=RecordingStatus.recording,
        started_at=datetime.utcnow(),
    )
    session.add(recording)
    session.commit()
    session.refresh(recording)

    cmd = [
        "ffmpeg", "-y", "-loglevel", "warning",
        "-i", input_url,
        "-c", "copy", "-movflags", "+faststart",
        str(output_path),
    ]

    try:
        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.DEVNULL,
            stderr=asyncio.subprocess.PIPE,
        )
    except (FileNotFoundError, OSError) as exc:
        recording.status = RecordingStatus.error
        session.add(recording)
        session.commit()
        raise RuntimeError(f"ffmpeg failed to start: {exc}") from exc

    async with _lock:
        _processes[recording.id] = proc
        _output_paths[recording.id] = output_path
        _start_times[recording.id] = time.monotonic()

    asyncio.create_task(_monitor(recording.id, proc), name=f"rec-{recording.id}")
    logger.info("Recording started: id=%d path=%s -> %s", recording.id, stream_path, output_path)
    return recording


async def stop_recording(session: Session, recording_id: int) -> Recording:
    async with _lock:
        proc = _processes.pop(recording_id, None)
        output_path = _output_paths.pop(recording_id, None)
        start_mono = _start_times.pop(recording_id, None)

    if proc is not None:
        try:
            proc.terminate()
        except ProcessLookupError:
            pass
        try:
            await asyncio.wait_for(proc.wait(), timeout=10.0)
        except asyncio.TimeoutError:
            proc.kill()
            await proc.wait()

    duration = time.monotonic() - start_mono if start_mono else 0.0
    size = output_path.stat().st_size if output_path and output_path.exists() else 0

    recording = session.get(Recording, recording_id)
    if recording is None:
        raise RuntimeError(f"Recording {recording_id} not found")

    recording.status = RecordingStatus.complete
    recording.ended_at = datetime.utcnow()
    recording.duration_seconds = round(duration, 1)
    recording.size_bytes = size
    session.add(recording)
    session.commit()
    session.refresh(recording)
    logger.info("Recording stopped: id=%d duration=%.1fs size=%d", recording_id, duration, size)
    return recording


def get_active_ids() -> list[int]:
    return list(_processes.keys())


async def _monitor(recording_id: int, proc: asyncio.subprocess.Process) -> None:
    """Log unexpected FFmpeg exits."""
    try:
        _, stderr_bytes = await proc.communicate()
    except Exception:
        return

    async with _lock:
        still_active = recording_id in _processes
        if still_active:
            _processes.pop(recording_id, None)
            _output_paths.pop(recording_id, None)
            _start_times.pop(recording_id, None)
        else:
            return  # normal stop via stop_recording

    stderr = (stderr_bytes or b"").decode("utf-8", errors="replace").strip()
    logger.error(
        "FFmpeg exited unexpectedly for recording id=%d (rc=%d): %s",
        recording_id, proc.returncode, stderr[-300:],
    )
