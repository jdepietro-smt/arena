"""
In-memory login brute-force throttle — /auth/token had zero protection
against repeated password guesses (confirmed: no attempt counter, no
delay, no lockout anywhere in the codebase), and the seeded default
account (admin/admin123) makes that a real, not theoretical, risk until an
operator changes it.

Keyed by client IP rather than username: locking out a *username* means
anyone who knows "admin" is a valid login can lock the real admin out from
their own IP by deliberately failing a few times elsewhere. Locking the
*source* instead only ever blocks the actual attacker.

Single-box, in-memory, no persistence needed — restart clears it, which is
fine (an attacker who can restart the process already has the box).
"""

from __future__ import annotations

import time

_MAX_ATTEMPTS = 5
_WINDOW_S = 15 * 60
_LOCKOUT_S = 15 * 60

_failures: dict[str, list[float]] = {}
_locked_until: dict[str, float] = {}


def seconds_until_unlocked(key: str) -> float | None:
    """None if not locked, else remaining lockout seconds."""
    until = _locked_until.get(key)
    if until is None:
        return None
    remaining = until - time.monotonic()
    if remaining <= 0:
        _locked_until.pop(key, None)
        _failures.pop(key, None)
        return None
    return remaining


def record_failure(key: str) -> None:
    now = time.monotonic()
    attempts = [t for t in _failures.get(key, []) if t >= now - _WINDOW_S]
    attempts.append(now)
    _failures[key] = attempts
    if len(attempts) >= _MAX_ATTEMPTS:
        _locked_until[key] = now + _LOCKOUT_S


def record_success(key: str) -> None:
    _failures.pop(key, None)
    _locked_until.pop(key, None)
