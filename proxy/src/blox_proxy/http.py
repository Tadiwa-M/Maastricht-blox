"""Shared HTTP client and conditional (ETag / Last-Modified) GET helper."""

from __future__ import annotations

from dataclasses import dataclass

import httpx

from .config import USER_AGENT


def make_client(timeout_s: float = 30.0, transport: httpx.AsyncBaseTransport | None = None) -> httpx.AsyncClient:
    return httpx.AsyncClient(
        headers={"User-Agent": USER_AGENT, "Accept-Encoding": "gzip"},
        timeout=httpx.Timeout(timeout_s),
        follow_redirects=True,
        transport=transport,
    )


class UpstreamError(RuntimeError):
    """An upstream returned something unusable (HTTP error, bad payload, no data)."""


@dataclass
class _Validators:
    etag: str | None = None
    last_modified: str | None = None


class ConditionalFetcher:
    """GET a URL, sending If-None-Match / If-Modified-Since when the server supports them.

    ``fetch`` returns the body, or ``None`` on ``304 Not Modified`` (caller keeps old data).
    """

    def __init__(self, client: httpx.AsyncClient, url: str) -> None:
        self._client = client
        self.url = url
        self._v = _Validators()

    async def fetch(self) -> bytes | None:
        headers: dict[str, str] = {}
        if self._v.etag:
            headers["If-None-Match"] = self._v.etag
        if self._v.last_modified:
            headers["If-Modified-Since"] = self._v.last_modified
        resp = await self._client.get(self.url, headers=headers)
        if resp.status_code == 304:
            return None
        if resp.status_code != 200:
            raise UpstreamError(f"GET {self.url} -> HTTP {resp.status_code}")
        self._v = _Validators(resp.headers.get("ETag"), resp.headers.get("Last-Modified"))
        return resp.content
