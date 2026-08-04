"""Unit tests for the pure trend-fitting logic in storage_forecast.py,
independent of the router/DB — see test_recordings_router.py for the
endpoint-level tests (auth, config wiring, response shape)."""

from __future__ import annotations

from datetime import datetime, timedelta

from backend.models import Recording, RecordingStatus
from backend.services.storage_forecast import compute_storage_forecast


def _rec(days_ago: int, gb: float) -> Recording:
    started = datetime.utcnow() - timedelta(days=days_ago)
    return Recording(
        stream_path="cam1", filename=f"r{days_ago}.mp4",
        size_bytes=int(gb * 1024**3), started_at=started,
        status=RecordingStatus.complete,
    )


def test_unavailable_with_no_recordings():
    assert compute_storage_forecast([], max_storage_gb=500) == {"available": False}


def test_unavailable_with_all_recordings_on_the_same_day():
    recs = [_rec(0, 1), _rec(0, 2), _rec(0, 3)]
    assert compute_storage_forecast(recs, max_storage_gb=500) == {"available": False}


def test_no_projection_when_all_growth_happened_on_a_single_day():
    # Cumulative size is monotonically non-decreasing, so the only way to
    # get a ~flat trend is for almost all growth to land on one day —
    # here day 3 gets everything and days 2/1/0 contribute nothing new.
    recs = [_rec(3, 100), _rec(3, 0.001), _rec(2, 0), _rec(1, 0), _rec(0, 0)]
    result = compute_storage_forecast(recs, max_storage_gb=500)
    assert result["available"] is True
    assert result["trend_gb_per_day"] < 0.1
    assert result["days_until_full"] is None or result["days_until_full"] > 1000


def test_growth_trend_projects_days_until_full():
    recs = [_rec(3, 2), _rec(2, 4), _rec(1, 6), _rec(0, 8)]  # 2 GB/day, cumulative
    result = compute_storage_forecast(recs, max_storage_gb=100)
    assert result["available"] is True
    assert result["trend_gb_per_day"] > 0
    assert result["current_gb"] > 0
    assert result["days_until_full"] > 0


def test_already_over_the_limit_clamps_to_zero_days():
    recs = [_rec(3, 100), _rec(2, 200), _rec(1, 300), _rec(0, 400)]
    result = compute_storage_forecast(recs, max_storage_gb=50)
    assert result["days_until_full"] == 0.0
