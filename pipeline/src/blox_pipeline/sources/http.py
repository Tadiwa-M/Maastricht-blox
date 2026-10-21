"""Idempotent, resumable HTTP downloads into the raw cache.

A finished download is ``dest``; an interrupted one is ``dest + '.part'`` and is resumed
with an HTTP ``Range`` request when the server supports it. Existing complete files are
never fetched again (delete them to refresh).
"""

from __future__ import annotations

import logging
import time
from pathlib import Path
from typing import Callable, Mapping

import requests

from . import config

log = logging.getLogger(__name__)

Validator = Callable[[Path], None]


class DownloadError(RuntimeError):
    pass


def make_session() -> requests.Session:
    s = requests.Session()
    s.headers["User-Agent"] = config.USER_AGENT
    return s


def download(
    url: str,
    dest: Path,
    *,
    params: Mapping[str, str] | list[tuple[str, str]] | None = None,
    session: requests.Session | None = None,
    validate: Validator | None = None,
    retries: int = 4,
    chunk_bytes: int = 1 << 20,
) -> Path:
    """Download ``url`` to ``dest`` unless it already exists. Returns ``dest``.

    ``validate`` is called on the finished ``.part`` file and should raise if the
    payload is wrong (e.g. an XML error document instead of a GeoTIFF); the file is
    then removed and the error re-raised without retrying.
    """
    if dest.exists() and dest.stat().st_size > 0:
        log.debug("cached %s", dest)
        return dest
    dest.parent.mkdir(parents=True, exist_ok=True)
    part = dest.with_name(dest.name + ".part")
    sess = session or make_session()
    last_err: Exception | None = None
    for attempt in range(retries):
        try:
            _fetch_into(sess, url, params, part, chunk_bytes)
            break
        except (requests.RequestException, DownloadError) as exc:
            last_err = exc
            wait = 2**attempt
            log.warning("download %s failed (%s); retry in %ss", url, exc, wait)
            if attempt + 1 < retries:
                time.sleep(wait)
    else:
        raise DownloadError(f"giving up on {url}: {last_err}")
    if validate is not None:
        try:
            validate(part)
        except Exception:
            part.unlink(missing_ok=True)
            raise
    part.replace(dest)
    return dest


def _fetch_into(
    sess: requests.Session,
    url: str,
    params: Mapping[str, str] | list[tuple[str, str]] | None,
    part: Path,
    chunk_bytes: int,
) -> None:
    have = part.stat().st_size if part.exists() else 0
    headers = {"Range": f"bytes={have}-"} if have else {}
    with sess.get(url, params=params, headers=headers, stream=True, timeout=config.HTTP_TIMEOUT_S) as r:
        if r.status_code == 416:  # range not satisfiable: we already have everything
            return
        if r.status_code not in (200, 206):
            raise DownloadError(f"HTTP {r.status_code} for {r.url}")
        mode = "ab" if (have and r.status_code == 206) else "wb"
        expected = r.headers.get("Content-Length")
        written = 0
        with open(part, mode) as fh:
            for block in r.iter_content(chunk_bytes):
                fh.write(block)
                written += len(block)
        if expected is not None and written < int(expected):
            raise DownloadError(f"truncated: {written}/{expected} bytes from {r.url}")


# ---------------------------------------------------------------- validators
def expect_magic(*magics: bytes) -> Validator:
    """Validator: file must start with one of the given byte strings."""

    def _check(path: Path) -> None:
        with open(path, "rb") as fh:
            head = fh.read(max(len(m) for m in magics))
        if not any(head.startswith(m) for m in magics):
            snippet = path.read_bytes()[:300].decode("utf-8", "replace")
            raise DownloadError(f"{path.name}: unexpected payload: {snippet!r}")

    return _check


TIFF_MAGIC = (b"II*\x00", b"MM\x00*", b"II+\x00", b"MM\x00+")
PNG_MAGIC = (b"\x89PNG",)
JSON_MAGIC = (b"{",)
PBF_MAGIC = (b"\x00\x00",)  # BlobHeader length prefix starts with zero bytes
