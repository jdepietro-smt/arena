"""
Async mediamtx v1 API client.

Wraps the mediamtx REST API (default base: http://localhost:9997).
All methods return plain dicts / lists; callers are responsible for
mapping to domain models if needed.
"""

from __future__ import annotations

import logging
from typing import Any

import httpx

from ..config import settings

logger = logging.getLogger(__name__)


class MediaMTXError(Exception):
    """Raised when the mediamtx API returns a non-2xx response."""

    def __init__(self, status_code: int, detail: str) -> None:
        self.status_code = status_code
        self.detail = detail
        super().__init__(f"mediamtx API error {status_code}: {detail}")


class MediaMTXClient:
    """
    Async HTTP client for the mediamtx v1/v3 REST API.

    Usage
    -----
    Instantiate once at application startup and share the instance.
    The underlying httpx.AsyncClient maintains a connection pool.

        client = MediaMTXClient()
        paths = await client.get_paths()

    Call ``await client.close()`` during application shutdown.
    """

    def __init__(
        self,
        base_url: str | None = None,
        timeout: float = 10.0,
    ) -> None:
        self._base_url = (base_url or settings.mediamtx_api_url).rstrip("/")
        self._http = httpx.AsyncClient(
            base_url=self._base_url,
            timeout=timeout,
            headers={"Accept": "application/json", "Content-Type": "application/json"},
        )

    # ------------------------------------------------------------------
    # Lifecycle
    # ------------------------------------------------------------------

    async def close(self) -> None:
        """Release the underlying connection pool."""
        await self._http.aclose()

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    async def _get(self, path: str) -> Any:
        try:
            resp = await self._http.get(path)
        except httpx.TransportError as exc:
            raise MediaMTXError(0, f"transport error: {exc}") from exc
        self._raise_for_status(resp)
        return resp.json()

    async def _post(self, path: str, data: dict[str, Any]) -> Any:
        try:
            resp = await self._http.post(path, json=data)
        except httpx.TransportError as exc:
            raise MediaMTXError(0, f"transport error: {exc}") from exc
        self._raise_for_status(resp)
        if resp.status_code == 204 or not resp.content:
            return None
        return resp.json()

    async def _patch(self, path: str, data: dict[str, Any]) -> Any:
        try:
            resp = await self._http.patch(path, json=data)
        except httpx.TransportError as exc:
            raise MediaMTXError(0, f"transport error: {exc}") from exc
        self._raise_for_status(resp)
        if resp.status_code == 204 or not resp.content:
            return None
        return resp.json()

    async def _delete(self, path: str) -> None:
        try:
            resp = await self._http.delete(path)
        except httpx.TransportError as exc:
            raise MediaMTXError(0, f"transport error: {exc}") from exc
        self._raise_for_status(resp)

    @staticmethod
    def _raise_for_status(resp: httpx.Response) -> None:
        if resp.is_success:
            return
        try:
            detail = resp.json().get("error", resp.text)
        except Exception:
            detail = resp.text
        raise MediaMTXError(resp.status_code, detail)

    # ------------------------------------------------------------------
    # Paths
    # ------------------------------------------------------------------

    async def get_paths(self) -> list[dict[str, Any]]:
        """
        Return all active stream paths.

        mediamtx v3: GET /v3/paths/list
        Response: {"items": [...], "itemCount": N}

        Each item contains:
            name, ready, readyTime, tracks[], readers[], source
        """
        data = await self._get("/v3/paths/list")
        return data.get("items", [])

    async def get_path(self, name: str) -> dict[str, Any]:
        """
        Return details for a single path.

        mediamtx v3: GET /v3/paths/get/{name}
        """
        return await self._get(f"/v3/paths/get/{name}")

    async def get_connections(self) -> dict[str, Any]:
        """
        Return all active connections grouped by protocol.

        Queries each protocol endpoint available in mediamtx v3:
            /v3/rtspconns/list
            /v3/rtspsconns/list
            /v3/rtmpconns/list
            /v3/rtmpsconns/list
            /v3/srtconns/list
            /v3/webrtcsessions/list
            /v3/hlsmuxers/list

        Returns a dict keyed by protocol name, value is list of connection dicts.
        Protocols that return an error (e.g. disabled in mediamtx config) are
        omitted rather than raising.
        """
        protocols = [
            ("rtsp", "/v3/rtspconns/list"),
            ("rtsps", "/v3/rtspsconns/list"),
            ("rtmp", "/v3/rtmpconns/list"),
            ("rtmps", "/v3/rtmpsconns/list"),
            ("srt", "/v3/srtconns/list"),
            ("webrtc", "/v3/webrtcsessions/list"),
            ("hls", "/v3/hlsmuxers/list"),
        ]
        result: dict[str, list[dict[str, Any]]] = {}
        for proto, endpoint in protocols:
            try:
                data = await self._get(endpoint)
                result[proto] = data.get("items", [])
            except MediaMTXError as exc:
                if exc.status_code in (404, 400):
                    # Protocol disabled in this mediamtx build/config — skip.
                    logger.debug("Protocol %s not available: %s", proto, exc.detail)
                else:
                    logger.warning("Failed to fetch %s connections: %s", proto, exc)
        return result

    # ------------------------------------------------------------------
    # Path configuration (dynamic path API)
    # ------------------------------------------------------------------

    async def add_path(self, name: str, config: dict[str, Any]) -> None:
        """
        Add a new path configuration.

        mediamtx v3: POST /v3/config/paths/add/{name}
        ``config`` is the path-level configuration object (source, record, etc.).
        """
        await self._post(f"/v3/config/paths/add/{name}", config)
        logger.info("Added mediamtx path: %s", name)

    async def remove_path(self, name: str) -> None:
        """
        Remove a path configuration.

        mediamtx v3: DELETE /v3/config/paths/delete/{name}
        """
        await self._delete(f"/v3/config/paths/delete/{name}")
        logger.info("Removed mediamtx path: %s", name)

    # ------------------------------------------------------------------
    # Global configuration
    # ------------------------------------------------------------------

    async def get_config(self) -> dict[str, Any]:
        """
        Return the full mediamtx running configuration.

        mediamtx v3: GET /v3/config/global/get
        """
        return await self._get("/v3/config/global/get")

    async def patch_config(self, data: dict[str, Any]) -> None:
        """
        Partially update the global mediamtx configuration.

        mediamtx v3: PATCH /v3/config/global/patch
        Only the supplied keys are changed; others remain at their current value.
        """
        await self._patch("/v3/config/global/patch", data)
        logger.info("Patched mediamtx global config: %s", list(data.keys()))


# ---------------------------------------------------------------------------
# Module-level singleton — import and use directly if you don't need DI
# ---------------------------------------------------------------------------

_client: MediaMTXClient | None = None


def get_client() -> MediaMTXClient:
    """Return the module-level singleton, creating it on first call."""
    global _client
    if _client is None:
        _client = MediaMTXClient()
    return _client


async def close_client() -> None:
    """Close the module-level singleton. Call during application shutdown."""
    global _client
    if _client is not None:
        await _client.close()
        _client = None
