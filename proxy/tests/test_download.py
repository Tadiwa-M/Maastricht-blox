from __future__ import annotations

from pathlib import Path

import httpx

from blox_proxy.gtfs.download import download_if_changed
from blox_proxy.http import make_client


async def test_conditional_download(tmp_path: Path) -> None:
    seen: list[dict[str, str | None]] = []

    def handler(req: httpx.Request) -> httpx.Response:
        seen.append({"inm": req.headers.get("If-None-Match"), "ims": req.headers.get("If-Modified-Since")})
        if req.headers.get("If-None-Match") == '"abc"':
            return httpx.Response(304)
        return httpx.Response(200, content=b"PK-zip-bytes", headers={"ETag": '"abc"', "Last-Modified": "Fri, 16 Oct 2026 03:00:00 GMT"})

    target = tmp_path / "gtfs-nl.zip"
    async with make_client(transport=httpx.MockTransport(handler)) as c:
        assert await download_if_changed(c, "https://gtfs.ovapi.nl/gtfs-nl.zip", target) is True
        assert target.read_bytes() == b"PK-zip-bytes"
        assert not target.with_suffix(".zip.part").exists()
        assert await download_if_changed(c, "https://gtfs.ovapi.nl/gtfs-nl.zip", target) is False
    assert seen[0] == {"inm": None, "ims": None}
    assert seen[1] == {"inm": '"abc"', "ims": "Fri, 16 Oct 2026 03:00:00 GMT"}
