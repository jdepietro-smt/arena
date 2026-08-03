"""
General-purpose in-memory rate limiter.

login_limiter.py already does exactly this shape of thing (sliding
window, keyed by client IP, in-memory, no persistence needed — a restart
clears it, which is fine) for the login endpoint specifically. Everything
else — starting a recording, adding an external source, triggering a DB
backup, uploading a cookies file — was completely unthrottled: a
compromised or just-misbehaving client could hammer any of those in a
tight loop with no pushback at all. This generalizes the same primitive
so it can be applied per-endpoint via a FastAPI dependency, plus a
coarser default across the whole API as a backstop.

Single-box, in-memory: same tradeoff login_limiter.py already accepts.
"""

from __future__ import annotations

import time

from fastapi import HTTPException, Request, status

# key -> list of monotonic-clock hit timestamps within the current window.
_hits: dict[str, list[float]] = {}


def check_and_record(key: str, max_requests: int, window_s: float) -> float | None:
    """
    Record one request against *key* if the sliding window isn't full.

    Returns None if the request is allowed (and records it). Returns the
    number of seconds until the oldest hit in the window expires — i.e.
    how long until a slot frees up — if the limit is currently exceeded
    (the request is NOT recorded in that case).
    """
    now = time.monotonic()
    recent = [t for t in _hits.get(key, []) if t >= now - window_s]
    if len(recent) >= max_requests:
        _hits[key] = recent
        return recent[0] + window_s - now
    recent.append(now)
    _hits[key] = recent
    return None


def _client_key(request: Request) -> str:
    return request.client.host if request.client else "unknown"


def rate_limit(max_requests: int, window_s: float, scope: str):
    """
    FastAPI dependency factory: `Depends(rate_limit(10, 60, scope="add-source"))`
    allows *max_requests* per client IP per *window_s* seconds, scoped
    separately per *scope* string so different endpoints don't share a
    bucket just because they share a client IP.
    """

    async def _dependency(request: Request) -> None:
        key = f"{scope}:{_client_key(request)}"
        retry_after = check_and_record(key, max_requests, window_s)
        if retry_after is not None:
            wait_s = int(retry_after) + 1
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail=f"Rate limit exceeded for this action. Try again in {wait_s}s.",
                headers={"Retry-After": str(wait_s)},
            )

    return _dependency
