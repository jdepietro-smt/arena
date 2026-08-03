"""
Integration tests confirming rate limiting is actually wired up on real
endpoints — test_rate_limiter_service.py covers the primitive in
isolation; this confirms the Depends() wiring on a real router and the
global per-IP middleware backstop in main.py.
"""

from __future__ import annotations

from backend.models import UserRole


def test_recording_toggle_endpoint_is_rate_limited(client, auth_headers):
    auth, _ = auth_headers(UserRole.viewer, username="viewer1")

    # Each call 404s (no such stream/recording) well before reaching the
    # rate limiter's bucket check — the dependency runs first regardless,
    # so 20 rapid calls should still fill the "recording-toggle" bucket.
    for _ in range(20):
        resp = client.post("/api/streams/nope/stop-recording", headers=auth)
        assert resp.status_code == 404

    limited = client.post("/api/streams/nope/stop-recording", headers=auth)

    assert limited.status_code == 429
    assert "Retry-After" in limited.headers


def test_global_middleware_rate_limits_across_endpoints(client, auth_headers, monkeypatch):
    # auth_headers() itself makes one HTTP call (POST /api/auth/token),
    # which counts against the same global:testclient bucket — patched
    # limit is 6 so that call plus 5 more all succeed, and a 6th is the
    # one that finally trips it.
    monkeypatch.setattr("backend.main._GLOBAL_RATE_LIMIT", 6)
    auth, _ = auth_headers(UserRole.viewer, username="viewer1")

    for _ in range(5):
        resp = client.get("/api/auth/me", headers=auth)
        assert resp.status_code == 200

    limited = client.get("/api/auth/me", headers=auth)

    assert limited.status_code == 429
    assert "Retry-After" in limited.headers
