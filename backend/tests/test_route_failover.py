"""
Unit tests for services/route_failover.check_and_failover().

RouteManager is faked (no real ffmpeg spawn) — this is about the
selection/state-transition logic (which routes qualify, what changes,
what gets logged/notified), not about the relay subprocess itself.
"""

from __future__ import annotations

from sqlmodel import Session

from backend.database import engine
from backend.models import StreamRoute
from backend.services.route_failover import check_and_failover


class FakeRouteManager:
    def __init__(self):
        self.activate_calls = []
        self.deactivate_calls = []
        self.fail_activate_for = set()

    async def activate(self, route, source_override=None):
        if route.id in self.fail_activate_for:
            raise RuntimeError("ffmpeg not in PATH")
        self.activate_calls.append((route.id, source_override))

    async def deactivate(self, route):
        self.deactivate_calls.append(route.id)


def _make_route(**kwargs) -> StreamRoute:
    defaults = dict(
        name="cam1-route", source_path="cam1", destinations=[],
        is_active=True, backup_source_path="cam1-backup", failed_over=False,
    )
    defaults.update(kwargs)
    with Session(engine) as session:
        route = StreamRoute(**defaults)
        session.add(route)
        session.commit()
        session.refresh(route)
        return route


async def _record_notify(sink):
    async def notify(text):
        sink.append(text)
    return notify


class TestCheckAndFailover:
    async def test_fails_over_a_matching_active_route_with_a_backup(self, monkeypatch):
        route = _make_route()
        fake = FakeRouteManager()
        import backend.services.stream_router as stream_router_module
        monkeypatch.setattr(stream_router_module, "get_router", lambda: fake)
        notified = []

        await check_and_failover("cam1", await _record_notify(notified))

        assert fake.deactivate_calls == [route.id]
        assert fake.activate_calls == [(route.id, "cam1-backup")]
        assert len(notified) == 1
        assert "cam1-route" in notified[0]
        assert "cam1-backup" in notified[0]

        with Session(engine) as session:
            refreshed = session.get(StreamRoute, route.id)
            assert refreshed.failed_over is True

    async def test_ignores_a_route_with_no_backup_configured(self, monkeypatch):
        _make_route(backup_source_path=None)
        fake = FakeRouteManager()
        import backend.services.stream_router as stream_router_module
        monkeypatch.setattr(stream_router_module, "get_router", lambda: fake)
        notified = []

        await check_and_failover("cam1", await _record_notify(notified))

        assert fake.activate_calls == []
        assert notified == []

    async def test_ignores_an_inactive_route(self, monkeypatch):
        _make_route(is_active=False)
        fake = FakeRouteManager()
        import backend.services.stream_router as stream_router_module
        monkeypatch.setattr(stream_router_module, "get_router", lambda: fake)
        notified = []

        await check_and_failover("cam1", await _record_notify(notified))

        assert fake.activate_calls == []
        assert notified == []

    async def test_ignores_a_route_already_failed_over(self, monkeypatch):
        _make_route(failed_over=True)
        fake = FakeRouteManager()
        import backend.services.stream_router as stream_router_module
        monkeypatch.setattr(stream_router_module, "get_router", lambda: fake)
        notified = []

        await check_and_failover("cam1", await _record_notify(notified))

        assert fake.activate_calls == []
        assert notified == []

    async def test_ignores_routes_on_a_different_source_path(self, monkeypatch):
        _make_route(source_path="other-cam")
        fake = FakeRouteManager()
        import backend.services.stream_router as stream_router_module
        monkeypatch.setattr(stream_router_module, "get_router", lambda: fake)
        notified = []

        await check_and_failover("cam1", await _record_notify(notified))

        assert fake.activate_calls == []
        assert notified == []

    async def test_a_failed_activate_does_not_mark_the_route_failed_over(self, monkeypatch):
        route = _make_route()
        fake = FakeRouteManager()
        fake.fail_activate_for.add(route.id)
        import backend.services.stream_router as stream_router_module
        monkeypatch.setattr(stream_router_module, "get_router", lambda: fake)
        notified = []

        await check_and_failover("cam1", await _record_notify(notified))

        assert notified == []  # never got far enough to notify
        with Session(engine) as session:
            refreshed = session.get(StreamRoute, route.id)
            assert refreshed.failed_over is False

    async def test_multiple_qualifying_routes_all_fail_over(self, monkeypatch):
        route_a = _make_route(name="route-a")
        route_b = _make_route(name="route-b")
        fake = FakeRouteManager()
        import backend.services.stream_router as stream_router_module
        monkeypatch.setattr(stream_router_module, "get_router", lambda: fake)
        notified = []

        await check_and_failover("cam1", await _record_notify(notified))

        assert {c[0] for c in fake.activate_calls} == {route_a.id, route_b.id}
        assert len(notified) == 2
