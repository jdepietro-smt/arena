"""
Tests for backend.services.login_limiter — the brute-force throttle on
/auth/token. Keyed by client IP (not username) specifically so that
locking out an attacker never locks out the real admin logging in from a
different address; these tests pin that down along with the actual
lock/unlock transitions.
"""

from __future__ import annotations

import pytest

from backend.services import login_limiter


@pytest.fixture(autouse=True)
def _reset_module_state():
    # Real module-level dicts shared process-wide, not per-instance state —
    # must be cleared between tests the same way test_recorder.py resets
    # recorder's module dicts.
    login_limiter._failures.clear()
    login_limiter._locked_until.clear()
    yield
    login_limiter._failures.clear()
    login_limiter._locked_until.clear()


class TestLoginLimiter:
    def test_not_locked_initially(self):
        assert login_limiter.seconds_until_unlocked("1.2.3.4") is None

    def test_locks_after_max_attempts(self):
        for _ in range(4):
            login_limiter.record_failure("1.2.3.4")
        assert login_limiter.seconds_until_unlocked("1.2.3.4") is None  # not yet

        login_limiter.record_failure("1.2.3.4")  # 5th failure
        remaining = login_limiter.seconds_until_unlocked("1.2.3.4")
        assert remaining is not None
        assert remaining > 0

    def test_success_clears_failures(self):
        for _ in range(4):
            login_limiter.record_failure("1.2.3.4")
        login_limiter.record_success("1.2.3.4")

        # One more failure shouldn't lock it — the earlier 4 were cleared.
        login_limiter.record_failure("1.2.3.4")
        assert login_limiter.seconds_until_unlocked("1.2.3.4") is None

    def test_different_ips_are_independent(self):
        for _ in range(5):
            login_limiter.record_failure("1.2.3.4")

        assert login_limiter.seconds_until_unlocked("1.2.3.4") is not None
        # A different source (e.g. the real admin, elsewhere) is unaffected —
        # this is the whole point of keying by IP instead of username.
        assert login_limiter.seconds_until_unlocked("5.6.7.8") is None

    def test_unlocks_after_lockout_window_elapses(self, monkeypatch):
        fake_now = [1000.0]
        monkeypatch.setattr(login_limiter.time, "monotonic", lambda: fake_now[0])

        for _ in range(5):
            login_limiter.record_failure("1.2.3.4")
        assert login_limiter.seconds_until_unlocked("1.2.3.4") is not None

        fake_now[0] += login_limiter._LOCKOUT_S + 1
        assert login_limiter.seconds_until_unlocked("1.2.3.4") is None

    def test_old_failures_outside_window_do_not_count(self, monkeypatch):
        fake_now = [1000.0]
        monkeypatch.setattr(login_limiter.time, "monotonic", lambda: fake_now[0])

        for _ in range(4):
            login_limiter.record_failure("1.2.3.4")

        # Jump past the failure-counting window — those 4 should no longer
        # count towards the threshold.
        fake_now[0] += login_limiter._WINDOW_S + 1
        login_limiter.record_failure("1.2.3.4")  # only 1 "recent" failure now

        assert login_limiter.seconds_until_unlocked("1.2.3.4") is None


class TestStatusAndClear:
    def test_status_is_empty_with_no_activity(self):
        assert login_limiter.status() == []

    def test_status_reports_an_unlocked_ip_with_partial_attempts(self):
        for _ in range(2):
            login_limiter.record_failure("1.2.3.4")

        entries = login_limiter.status()
        assert entries == [{"ip": "1.2.3.4", "attempt_count": 2, "locked": False, "seconds_remaining": None}]

    def test_status_reports_a_locked_ip_with_remaining_seconds(self):
        for _ in range(5):
            login_limiter.record_failure("1.2.3.4")

        entries = login_limiter.status()
        assert len(entries) == 1
        assert entries[0]["ip"] == "1.2.3.4"
        assert entries[0]["locked"] is True
        assert entries[0]["seconds_remaining"] > 0

    def test_status_sorts_locked_ips_before_unlocked_ones(self):
        for _ in range(2):
            login_limiter.record_failure("unlocked-ip")
        for _ in range(5):
            login_limiter.record_failure("locked-ip")

        entries = login_limiter.status()
        assert [e["ip"] for e in entries] == ["locked-ip", "unlocked-ip"]

    def test_clear_lifts_a_lockout_and_reports_it_was_tracked(self):
        for _ in range(5):
            login_limiter.record_failure("1.2.3.4")
        assert login_limiter.seconds_until_unlocked("1.2.3.4") is not None

        was_tracked = login_limiter.clear("1.2.3.4")

        assert was_tracked is True
        assert login_limiter.seconds_until_unlocked("1.2.3.4") is None
        assert login_limiter.status() == []

    def test_clear_on_an_untracked_ip_reports_false_and_does_not_raise(self):
        assert login_limiter.clear("9.9.9.9") is False
