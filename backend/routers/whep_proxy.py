"""
WHEP signaling proxy — forwards SDP offer/answer through FastAPI to avoid
cross-origin issues. The browser posts to /api/whep/{name}/whep (same origin
as the ArenaHub app). This router forwards to mediamtx at localhost:8889.

WebRTC media (RTP/UDP) still flows directly between the browser and the
server's public IP on port 8889 — the proxy only handles the HTTP signaling,
so latency is not affected.
"""

import httpx
from fastapi import APIRouter, Request, Response
from fastapi.responses import RedirectResponse

router = APIRouter(tags=["whep"])

MEDIAMTX_WEBRTC = "http://localhost:8889"


@router.get("/{stream_name}/whep")
async def whep_info(stream_name: str) -> RedirectResponse:
    # Browser navigated to the WHEP endpoint directly (GET). Redirect to the
    # dashboard so the user sees the stream there instead of a bare 404.
    return RedirectResponse(url="/", status_code=302)


@router.post("/{stream_name}/whep")
async def whep_proxy(stream_name: str, request: Request) -> Response:
    body = await request.body()

    async with httpx.AsyncClient() as client:
        try:
            r = await client.post(
                f"{MEDIAMTX_WEBRTC}/{stream_name}/whep",
                content=body,
                headers={"Content-Type": "application/sdp"},
                timeout=10.0,
            )
        except httpx.RequestError as exc:
            return Response(status_code=503, content=f"mediamtx unreachable: {exc}")

    headers = {"Content-Type": r.headers.get("Content-Type", "application/sdp")}
    if loc := r.headers.get("Location"):
        headers["Location"] = loc

    return Response(content=r.content, status_code=r.status_code, headers=headers)
