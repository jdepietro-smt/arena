"""
Tests for backend.services.alerting.AlertManager.

The interesting behavior here is entirely about state TRANSITIONS: an
alert must fire once when a stream goes down / a rule starts breaching,
and once again on recovery — never on every poll while the condition
persists (that's how "alerting" becomes noise nobody reads), and never for
a stream that's simply never come up yet.
"""

from __future__ import annotations

from sqlmodel import Session

from backend.database import engine
from backend.models import AlertAction, AlertRule, CompareOperator, MetricType
from backend.services import alerting as alerting_module
from backend.services.alerting import AlertManager


class FakeMediaMTXClient:
    def __init__(self, paths: list[dict]) -> None:
        self._paths = paths

    async def get_paths(self) -> list[dict]:
        return self._paths


class FakeCollector:
    def __init__(self, stats: dict[str, dict] | None = None) -> None:
        self._stats = stats or {}

    def get_stats(self, path_name: str):
        return self._stats.get(path_name)


def _ready(name: str) -> dict:
    return {"name": name, "ready": True}


def _not_ready(name: str) -> dict:
    return {"name": name, "ready": False}


class TestConnectivity:
    async def test_never_seen_ready_is_not_a_down_event(self, monkeypatch):
        """A stream that's never existed isn't "down" — only track paths
        we've actually observed ready at some point."""
        manager = AlertManager()
        notified: list[str] = []
        monkeypatch.setattr(manager, "_notify", _record(notified))
        monkeypatch.setattr(alerting_module, "get_client", lambda: FakeMediaMTXClient([]))

        await manager._check_connectivity()

        assert notified == []
        assert manager._currently_down == set()

    async def test_down_after_consecutive_misses_notifies_once(self, monkeypatch):
        manager = AlertManager()
        notified: list[str] = []
        monkeypatch.setattr(manager, "_notify", _record(notified))

        # First seen ready.
        monkeypatch.setattr(alerting_module, "get_client", lambda: FakeMediaMTXClient([_ready("Golf_Channel")]))
        await manager._check_connectivity()
        assert notified == []

        # First miss — below the debounce threshold, no alert yet.
        monkeypatch.setattr(alerting_module, "get_client", lambda: FakeMediaMTXClient([]))
        await manager._check_connectivity()
        assert notified == []
        assert "Golf_Channel" not in manager._currently_down

        # Second consecutive miss — now it's actually down.
        await manager._check_connectivity()
        assert len(notified) == 1
        assert "went down" in notified[0]
        assert "Golf_Channel" in manager._currently_down

        # Third miss while already down — must NOT notify again.
        await manager._check_connectivity()
        assert len(notified) == 1

    async def test_recovery_notifies_once(self, monkeypatch):
        manager = AlertManager()
        notified: list[str] = []
        monkeypatch.setattr(manager, "_notify", _record(notified))

        monkeypatch.setattr(alerting_module, "get_client", lambda: FakeMediaMTXClient([_ready("Golf_Channel")]))
        await manager._check_connectivity()
        monkeypatch.setattr(alerting_module, "get_client", lambda: FakeMediaMTXClient([]))
        await manager._check_connectivity()
        await manager._check_connectivity()  # now down, 1 notify
        assert len(notified) == 1

        monkeypatch.setattr(alerting_module, "get_client", lambda: FakeMediaMTXClient([_ready("Golf_Channel")]))
        await manager._check_connectivity()

        assert len(notified) == 2
        assert "recovered" in notified[1]
        assert "Golf_Channel" not in manager._currently_down

    async def test_composite_paths_are_ignored(self, monkeypatch):
        manager = AlertManager()
        notified: list[str] = []
        monkeypatch.setattr(manager, "_notify", _record(notified))

        monkeypatch.setattr(alerting_module, "get_client", lambda: FakeMediaMTXClient([_ready("mv_abc123")]))
        await manager._check_connectivity()
        monkeypatch.setattr(alerting_module, "get_client", lambda: FakeMediaMTXClient([]))
        await manager._check_connectivity()
        await manager._check_connectivity()

        assert notified == []


class TestRuleEvaluation:
    async def test_breach_then_recovery_notifies_twice(self, monkeypatch):
        with Session(engine) as session:
            rule = AlertRule(
                stream_path="Golf_Channel", metric=MetricType.bitrate,
                operator=CompareOperator.lt, threshold=5000.0, action=AlertAction.webhook,
            )
            session.add(rule)
            session.commit()
            session.refresh(rule)
            rule_id = rule.id

        manager = AlertManager()
        notified: list[str] = []
        monkeypatch.setattr(manager, "_notify", _record(notified))

        monkeypatch.setattr(alerting_module, "get_collector", lambda: FakeCollector(
            {"Golf_Channel": {"bitrate_kbps": 1000.0}}
        ))
        await manager._check_rules()
        assert len(notified) == 1
        assert "bitrate" in notified[0]
        assert manager._rule_firing[rule_id] is True

        # Still breaching — must not notify again.
        await manager._check_rules()
        assert len(notified) == 1

        # Recovers.
        monkeypatch.setattr(alerting_module, "get_collector", lambda: FakeCollector(
            {"Golf_Channel": {"bitrate_kbps": 9000.0}}
        ))
        await manager._check_rules()
        assert len(notified) == 2
        assert "back to normal" in notified[1]
        assert manager._rule_firing[rule_id] is False

        with Session(engine) as session:
            session.delete(session.get(AlertRule, rule_id))
            session.commit()

    async def test_no_data_yet_does_not_notify(self, monkeypatch):
        with Session(engine) as session:
            rule = AlertRule(
                stream_path="Nonexistent", metric=MetricType.rtt,
                operator=CompareOperator.gt, threshold=100.0, action=AlertAction.webhook,
            )
            session.add(rule)
            session.commit()
            rule_id = rule.id

        manager = AlertManager()
        notified: list[str] = []
        monkeypatch.setattr(manager, "_notify", _record(notified))
        monkeypatch.setattr(alerting_module, "get_collector", lambda: FakeCollector({}))

        await manager._check_rules()

        assert notified == []

        with Session(engine) as session:
            session.delete(session.get(AlertRule, rule_id))
            session.commit()

    async def test_email_action_is_skipped_not_fatal(self, monkeypatch):
        """AlertAction.email exists on the model but there's no SMTP config
        or recipient field anywhere — must be skipped cleanly, not silently
        claim delivery or raise."""
        with Session(engine) as session:
            rule = AlertRule(
                stream_path="Golf_Channel", metric=MetricType.bitrate,
                operator=CompareOperator.lt, threshold=5000.0, action=AlertAction.email,
            )
            session.add(rule)
            session.commit()
            rule_id = rule.id

        manager = AlertManager()
        notified: list[str] = []
        monkeypatch.setattr(manager, "_notify", _record(notified))
        monkeypatch.setattr(alerting_module, "get_collector", lambda: FakeCollector(
            {"Golf_Channel": {"bitrate_kbps": 1000.0}}
        ))

        await manager._check_rules()  # must not raise

        assert notified == []

        with Session(engine) as session:
            session.delete(session.get(AlertRule, rule_id))
            session.commit()


def _record(sink: list[str]):
    async def _fake_notify(text: str) -> None:
        sink.append(text)

    return _fake_notify
