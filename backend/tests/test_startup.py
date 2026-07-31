"""
Regression test for backend.main._apply_srt_publish_passphrase().

The real incident: srtPublishPassphrase was applied via the mediamtx
*global* config PATCH endpoint, which mediamtx rejected outright with a 400
("json: unknown field") — this setting is per-path, living on the "all"
wildcard path, not global. The failure itself was caught and logged rather
than crashing startup (the try/except here is intentional), so the app
stayed up, but the passphrase silently never got applied. This test pins
down which endpoint/path actually gets patched.
"""

from __future__ import annotations

import pytest

from backend import main as main_module
from backend.config import settings


class FakeClient:
    def __init__(self) -> None:
        self.patch_path_calls: list[tuple[str, dict]] = []

    async def patch_path_config(self, name: str, data: dict) -> None:
        self.patch_path_calls.append((name, data))


class TestApplySrtPublishPassphrase:
    async def test_patches_the_all_wildcard_path_not_global(self, monkeypatch):
        monkeypatch.setattr(settings, "SRT_PUBLISH_PASSPHRASE", "a-real-passphrase-value")
        fake = FakeClient()
        monkeypatch.setattr(main_module, "get_client", lambda: fake)

        await main_module._apply_srt_publish_passphrase()

        assert fake.patch_path_calls == [
            ("all", {"srtPublishPassphrase": "a-real-passphrase-value"})
        ]

    async def test_unset_passphrase_does_not_call_mediamtx(self, monkeypatch):
        monkeypatch.setattr(settings, "SRT_PUBLISH_PASSPHRASE", "")
        fake = FakeClient()
        monkeypatch.setattr(main_module, "get_client", lambda: fake)

        await main_module._apply_srt_publish_passphrase()

        assert fake.patch_path_calls == []

    async def test_mediamtx_failure_does_not_raise(self, monkeypatch):
        """This must never crash app startup — a mediamtx-side failure here
        should be logged, not fatal (confirmed live: it wasn't fatal, which
        is exactly why the service stayed up while this bug was live)."""

        class ExplodingClient:
            async def patch_path_config(self, *_a, **_kw):
                raise RuntimeError("mediamtx unreachable")

        monkeypatch.setattr(settings, "SRT_PUBLISH_PASSPHRASE", "a-real-passphrase-value")
        monkeypatch.setattr(main_module, "get_client", lambda: ExplodingClient())

        await main_module._apply_srt_publish_passphrase()  # must not raise
