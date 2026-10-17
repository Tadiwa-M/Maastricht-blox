"""Download the national GTFS zip with conditional GET; validators stored in a sidecar."""

from __future__ import annotations

import json
import logging
import os
from pathlib import Path

import httpx

from ..http import UpstreamError

log = logging.getLogger(__name__)


def _sidecar(zip_path: Path) -> Path:
    return zip_path.with_suffix(".validators.json")


def _load_validators(zip_path: Path) -> dict[str, str]:
    p = _sidecar(zip_path)
    if not zip_path.exists() or not p.exists():
        return {}
    try:
        return {k: v for k, v in json.loads(p.read_text("utf-8")).items() if isinstance(v, str)}
    except (OSError, ValueError):
        return {}


async def download_if_changed(client: httpx.AsyncClient, url: str, zip_path: Path) -> bool:
    """Download ``url`` to ``zip_path`` unless unchanged. Returns True if a new file was written.

    The feed is ~240 MB, so it is streamed to ``<zip>.part`` and renamed when complete.
    """
    v = _load_validators(zip_path)
    headers: dict[str, str] = {}
    if "etag" in v:
        headers["If-None-Match"] = v["etag"]
    if "last_modified" in v:
        headers["If-Modified-Since"] = v["last_modified"]
    zip_path.parent.mkdir(parents=True, exist_ok=True)
    part = zip_path.with_suffix(zip_path.suffix + ".part")
    timeout = httpx.Timeout(60.0, read=600.0)
    async with client.stream("GET", url, headers=headers, timeout=timeout) as resp:
        if resp.status_code == 304:
            log.info("GTFS static unchanged (304)")
            return False
        if resp.status_code != 200:
            raise UpstreamError(f"GET {url} -> HTTP {resp.status_code}")
        size = 0
        with open(part, "wb") as f:
            async for chunk in resp.aiter_bytes(1 << 20):
                f.write(chunk)
                size += len(chunk)
        new_v = {k: val for k, val in (("etag", resp.headers.get("ETag")), ("last_modified", resp.headers.get("Last-Modified"))) if val}
    os.replace(part, zip_path)
    _sidecar(zip_path).write_text(json.dumps(new_v), "utf-8")
    log.info("GTFS static downloaded: %.1f MB", size / 1e6)
    return True
