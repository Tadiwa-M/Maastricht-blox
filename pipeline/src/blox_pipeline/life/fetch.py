"""Download the national GTFS zip (OVapi) into the raw cache."""

from __future__ import annotations

import logging
import time
from pathlib import Path

from ..sources import config
from ..sources.http import download, make_session

log = logging.getLogger(__name__)

MAX_AGE_DAYS = 7.0  # a timetable goes stale: refetch an older zip


def gtfs_path(root: Path | None = None) -> Path:
    return (root or config.data_dir()) / "gtfs" / config.GTFS_URL.rsplit("/", 1)[-1]


def _validate_zip(path: Path) -> None:
    with open(path, "rb") as f:
        if f.read(2) != b"PK":
            raise ValueError(f"{path.name} is not a zip (an error page?)")


def fetch_gtfs(root: Path | None = None, max_age_days: float = MAX_AGE_DAYS) -> Path:
    """Fetch ``gtfs-nl.zip`` unless a fresh copy is cached (older than ``max_age_days`` is replaced)."""
    dest = gtfs_path(root)
    if dest.exists() and time.time() - dest.stat().st_mtime > max_age_days * 86400:
        log.info("GTFS: cached feed is older than %.0f days, fetching a new one", max_age_days)
        dest.replace(dest.with_name(dest.name + ".old"))
    if not dest.exists():
        log.info("GTFS: downloading the national feed (~240 MB) from %s", config.GTFS_URL)
    return download(config.GTFS_URL, dest, session=make_session(), validate=_validate_zip)
