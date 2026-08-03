"""
Tests for services.rate_limiter — the general-purpose sliding-window
limiter backing the global per-IP backstop middleware and the per-action
limits on expensive endpoints (recording toggle, DB backup, source add,
cookies upload, multiview job creation).
"""

from __future__ import annotations

from fastapi import Depends, FastAPI
from fastapi.testclient import TestClient

from backend.services.rate_limiter import check_and_record, rate_limit


def test_allows_requests_under_the_limit():
    for _ in range(5):
        assert check_and_record("k1", max_requests=5, window_s=60) is None


def test_blocks_the_request_that_exceeds_the_limit():
    for _ in range(3):
        check_and_record("k2", max_requests=3, window_s=60)

    retry_after = check_and_record("k2", max_requests=3, window_s=60)

    assert retry_after is not None
    assert retry_after > 0


def test_different_keys_have_independent_buckets():
    for _ in range(3):
        check_and_record("bucket-a", max_requests=3, window_s=60)

    # bucket-a is now full, but bucket-b is untouched.
    assert check_and_record("bucket-a", max_requests=3, window_s=60) is not None
    assert check_and_record("bucket-b", max_requests=3, window_s=60) is None


def test_old_hits_outside_the_window_are_forgotten(monkeypatch):
    mono_time = [1000.0]
    monkeypatch.setattr("backend.services.rate_limiter.time.monotonic", lambda: mono_time[0])

    for _ in range(3):
        check_and_record("k3", max_requests=3, window_s=10)
    assert check_and_record("k3", max_requests=3, window_s=10) is not None

    mono_time[0] += 11  # past the 10s window
    assert check_and_record("k3", max_requests=3, window_s=10) is None


def test_rate_limit_dependency_raises_429_via_fastapi():
    app = FastAPI()
    limiter = rate_limit(2, 60, scope="test-endpoint")

    @app.get("/ping")
    async def ping(_rl: None = Depends(limiter)):
        return {"ok": True}

    client = TestClient(app)

    assert client.get("/ping").status_code == 200
    assert client.get("/ping").status_code == 200
    third = client.get("/ping")

    assert third.status_code == 429
    assert "Retry-After" in third.headers
    assert "Rate limit exceeded" in third.json()["detail"]
