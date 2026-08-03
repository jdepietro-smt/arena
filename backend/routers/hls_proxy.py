"""
HLS proxy: serves files written by the per-stream ffmpeg HLS generator
(started via mediamtx runOnReady hook) from /tmp/arena-hls/{path}/{file}.

Why not mediamtx's built-in HLS muxer?
  The encoder (arena_stream.exe) uses libx264 with ~8s keyframe intervals.
  mediamtx's HLS muxer waits for a keyframe to close each 1s segment.
  Without a keyframe, the segment grows until it hits the size limit and
  crashes. The external ffmpeg generator forces keyframes every 1s via
  -g 30 -keyint_min 30 -sc_threshold 0, producing correct HLS segments.

Mounted at /api/hls — e.g. /api/hls/Golf_Channel/index.m3u8
"""

from __future__ import annotations

import logging
import os
from pathlib import Path

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse, Response

logger = logging.getLogger(__name__)

router = APIRouter(tags=["hls"])

HLS_DIR = "/tmp/arena-hls"

_CORS = {"Access-Control-Allow-Origin": "*"}


@router.get("/{path_name}/{filename:path}")
async def hls_proxy(path_name: str, filename: str) -> Response:
    # This endpoint takes no auth (watching a live stream isn't a
    # privileged action here — see multiview.py's create_job for the same
    # call), so the path-traversal guard below is the only thing standing
    # between an anonymous request and arbitrary file read: filename uses
    # FastAPI's `:path` converter to allow segment separators for nested
    # HLS assets, which also means it happily accepts "../" — confirmed
    # live that "cam1/../../../etc/passwd" resolves clean outside HLS_DIR
    # without this check.
    base = Path(HLS_DIR).resolve()
    file_path = (base / path_name / filename).resolve()
    if base not in file_path.parents and file_path != base:
        raise HTTPException(status_code=400, detail="Invalid path")
    file_path = str(file_path)

    if not os.path.isfile(file_path):
        # Stream not live yet or segment rolled off — HLS.js will retry
        logger.debug("HLS file not found: %s", file_path)
        raise HTTPException(status_code=404, detail="HLS file not available")

    if filename.endswith(".m3u8"):
        try:
            with open(file_path, "rb") as f:
                content = f.read()
        except OSError as exc:
            logger.warning("HLS manifest read error %s: %s", file_path, exc)
            raise HTTPException(status_code=503, detail="HLS manifest temporarily unavailable")
        return Response(
            content=content,
            media_type="application/vnd.apple.mpegurl",
            headers={"Cache-Control": "no-cache", **_CORS},
        )

    # Segment files (.ts)
    return FileResponse(
        file_path,
        media_type="video/mp2t",
        headers={"Cache-Control": "no-cache", **_CORS},
    )
