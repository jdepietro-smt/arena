"""
Unit tests for services/assistant.py's ask() — the Anthropic API call
itself, isolated from the router/auth/MediaMTX layers tested elsewhere.
"""

from __future__ import annotations

import httpx
import pytest

from backend.services import assistant


@pytest.mark.asyncio
async def test_ask_raises_when_api_key_unset(monkeypatch):
    monkeypatch.setattr(assistant.settings, "ANTHROPIC_API_KEY", "")

    with pytest.raises(RuntimeError, match="ANTHROPIC_API_KEY"):
        await assistant.ask("are any streams down?", {"streams": []})


@pytest.mark.asyncio
async def test_ask_returns_the_model_text_on_success(monkeypatch):
    monkeypatch.setattr(assistant.settings, "ANTHROPIC_API_KEY", "test-key")

    async def _fake_post(self, url, json=None, headers=None):
        return httpx.Response(
            200,
            json={"content": [{"type": "text", "text": "cam1 is down, last seen 4 minutes ago."}]},
            request=httpx.Request("POST", url),
        )
    monkeypatch.setattr(httpx.AsyncClient, "post", _fake_post)

    answer = await assistant.ask("why is cam1 down?", {"streams": []})

    assert answer == "cam1 is down, last seen 4 minutes ago."


@pytest.mark.asyncio
async def test_ask_raises_on_non_200_response(monkeypatch):
    monkeypatch.setattr(assistant.settings, "ANTHROPIC_API_KEY", "test-key")

    async def _fake_post(self, url, json=None, headers=None):
        return httpx.Response(401, json={"error": "invalid key"}, request=httpx.Request("POST", url))
    monkeypatch.setattr(httpx.AsyncClient, "post", _fake_post)

    with pytest.raises(RuntimeError, match="401"):
        await assistant.ask("why is cam1 down?", {"streams": []})


@pytest.mark.asyncio
async def test_ask_raises_a_friendly_error_on_network_failure(monkeypatch):
    monkeypatch.setattr(assistant.settings, "ANTHROPIC_API_KEY", "test-key")

    async def _fake_post(self, url, json=None, headers=None):
        raise httpx.ConnectError("connection refused")
    monkeypatch.setattr(httpx.AsyncClient, "post", _fake_post)

    with pytest.raises(RuntimeError, match="Could not reach"):
        await assistant.ask("why is cam1 down?", {"streams": []})
