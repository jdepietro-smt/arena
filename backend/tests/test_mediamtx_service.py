"""
Tests for services.mediamtx.MediaMTXClient — the mediamtx v3 REST API
wrapper every other router depends on. No real mediamtx instance: each
test swaps the client's internal httpx.AsyncClient for one built on
httpx.MockTransport, so requests never leave the process.
"""

from __future__ import annotations

import httpx
import pytest

from backend.services.mediamtx import MediaMTXClient, MediaMTXError


def _client_with_handler(handler):
    client = MediaMTXClient(base_url="http://mediamtx.test")
    client._http = httpx.AsyncClient(
        base_url="http://mediamtx.test",
        transport=httpx.MockTransport(handler),
    )
    return client


async def test_get_paths_returns_items_list():
    def handler(request):
        assert request.url.path == "/v3/paths/list"
        return httpx.Response(200, json={"items": [{"name": "cam1"}], "itemCount": 1})

    client = _client_with_handler(handler)
    paths = await client.get_paths()

    assert paths == [{"name": "cam1"}]


async def test_get_path_hits_correct_endpoint():
    def handler(request):
        assert request.url.path == "/v3/paths/get/cam1"
        return httpx.Response(200, json={"name": "cam1", "ready": True})

    client = _client_with_handler(handler)
    path = await client.get_path("cam1")

    assert path["name"] == "cam1"


async def test_non_2xx_response_raises_mediamtx_error_with_detail():
    def handler(request):
        return httpx.Response(404, json={"error": "path not found"})

    client = _client_with_handler(handler)

    with pytest.raises(MediaMTXError) as exc_info:
        await client.get_path("nope")

    assert exc_info.value.status_code == 404
    assert exc_info.value.detail == "path not found"


async def test_non_json_error_body_falls_back_to_raw_text():
    def handler(request):
        return httpx.Response(500, text="internal server error")

    client = _client_with_handler(handler)

    with pytest.raises(MediaMTXError) as exc_info:
        await client.get_path("cam1")

    assert exc_info.value.status_code == 500
    assert exc_info.value.detail == "internal server error"


async def test_transport_error_is_wrapped_as_mediamtx_error():
    def handler(request):
        raise httpx.ConnectError("connection refused")

    client = _client_with_handler(handler)

    with pytest.raises(MediaMTXError) as exc_info:
        await client.get_paths()

    assert exc_info.value.status_code == 0
    assert "connection refused" in exc_info.value.detail


async def test_get_connections_groups_by_protocol():
    def handler(request):
        if "srtconns" in request.url.path:
            return httpx.Response(200, json={"items": [{"path": "cam1", "id": "a"}]})
        if "rtspconns" in request.url.path:
            return httpx.Response(200, json={"items": []})
        return httpx.Response(404, json={"error": "disabled"})

    client = _client_with_handler(handler)
    connections = await client.get_connections()

    assert connections["srt"] == [{"path": "cam1", "id": "a"}]
    assert connections["rtsp"] == []
    # Protocols that 404 (disabled in this mediamtx build) are omitted,
    # not raised — the caller shouldn't see a hard failure just because
    # e.g. RTMP is turned off in mediamtx's config.
    assert "rtmp" not in connections


async def test_get_connections_logs_but_does_not_raise_on_unexpected_error(caplog):
    def handler(request):
        return httpx.Response(500, json={"error": "boom"})

    client = _client_with_handler(handler)
    connections = await client.get_connections()

    assert connections == {}


async def test_add_path_posts_config_to_correct_endpoint():
    seen = {}

    def handler(request):
        seen["path"] = request.url.path
        seen["body"] = request.content
        return httpx.Response(200, json={})

    client = _client_with_handler(handler)
    await client.add_path("cam1", {"source": "publisher"})

    assert seen["path"] == "/v3/config/paths/add/cam1"
    assert b"publisher" in seen["body"]


async def test_remove_path_deletes_correct_endpoint():
    seen = {}

    def handler(request):
        seen["method"] = request.method
        seen["path"] = request.url.path
        return httpx.Response(200)

    client = _client_with_handler(handler)
    await client.remove_path("cam1")

    assert seen["method"] == "DELETE"
    assert seen["path"] == "/v3/config/paths/delete/cam1"


async def test_patch_path_config_patches_correct_endpoint():
    seen = {}

    def handler(request):
        seen["method"] = request.method
        seen["path"] = request.url.path
        return httpx.Response(200, json={"ok": True})

    client = _client_with_handler(handler)
    await client.patch_path_config("cam1", {"srtPublishPassphrase": "secret"})

    assert seen["method"] == "PATCH"
    assert seen["path"] == "/v3/config/paths/patch/cam1"


async def test_204_response_returns_none():
    def handler(request):
        return httpx.Response(204)

    client = _client_with_handler(handler)
    result = await client.patch_path_config("cam1", {})

    assert result is None


async def test_get_config_returns_global_config():
    def handler(request):
        assert request.url.path == "/v3/config/global/get"
        return httpx.Response(200, json={"logLevel": "info"})

    client = _client_with_handler(handler)
    config = await client.get_config()

    assert config == {"logLevel": "info"}


def test_get_client_returns_singleton():
    from backend.services import mediamtx

    mediamtx._client = None
    first = mediamtx.get_client()
    second = mediamtx.get_client()
    assert first is second
    mediamtx._client = None
