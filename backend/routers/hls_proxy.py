"""
HLS proxy: forwards requests to mediamtx's HLS port (8888) through the
FastAPI backend so the browser never has to make a cross-origin request.

Mounted at /api/hls — e.g. /api/hls/{path}/index.m3u8
"""

from __future__ import annotations

import logging

import httpx
from fastapi import APIRouter, HTTPException
from fastapi.responses import Response

logger = logging.getLogger(__name__)

router = APIRouter(tags=["hls"])

_MEDIAMTX_HLS = "http://127.0.0.1:8888"

_client: httpx.AsyncClient | None = None


def _get_client() -> httpx.AsyncClient:
    global _client
    if _client is None or _client.is_closed:
        # follow_redirects handles mediamtx's cookieCheck=1 redirect;
        # the client also persists cookies across requests so the check
        # is satisfied on the first real segment fetch.
        _client = httpx.AsyncClient(timeout=10.0, follow_redirects=True)
    return _client


@router.get("/{path_name}/{filename:path}")
async def hls_proxy(path_name: str, filename: str) -> Response:
    url = f"{_MEDIAMTX_HLS}/{path_name}/{filename}"
    try:
        resp = await _get_client().get(url)
    except httpx.RequestError as exc:
        logger.warning("HLS proxy error for %s: %s", url, exc)
        raise HTTPException(status_code=502, detail="HLS upstream unreachable")

    if resp.status_code == 404:
        raise HTTPException(status_code=404, detail="HLS resource not found")
    if resp.status_code != 200:
        raise HTTPException(status_code=resp.status_code, detail="HLS upstream error")

    content_type = resp.headers.get("content-type", "application/octet-stream")
    cache_control = resp.headers.get("cache-control", "no-cache")

    return Response(
        content=resp.content,
        media_type=content_type,
        headers={"Cache-Control": cache_control, "Access-Control-Allow-Origin": "*"},
    )
