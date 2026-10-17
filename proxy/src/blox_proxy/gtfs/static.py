"""Owns the current ``GtfsIndex``: load from cache at startup, refresh in the background."""

from __future__ import annotations

import asyncio
import logging
from pathlib import Path

import httpx

from ..config import SLICE_BBOX_RD, Settings
from .cache import load_index, save_index
from .download import download_if_changed
from .model import GtfsIndex
from .preprocess import build_index

log = logging.getLogger(__name__)


class GtfsStatic:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self.index: GtfsIndex = GtfsIndex()
        self.version = 0  # bumps whenever ``index`` is replaced

    @property
    def zip_path(self) -> Path:
        return self.settings.cache_dir / "gtfs-nl.zip"

    @property
    def cache_path(self) -> Path:
        return self.settings.cache_dir / "gtfs_slice.json.gz"

    @property
    def loaded(self) -> bool:
        return bool(self.index.trips)

    def set_index(self, index: GtfsIndex) -> None:
        self.index = index
        self.version += 1

    def load_cached(self) -> bool:
        idx = load_index(self.cache_path)
        if idx is None:
            return False
        self.set_index(idx)
        log.info("GTFS slice cache loaded: %d trips, %d shapes", len(idx.trips), len(idx.shapes))
        return True

    def rebuild_from_zip(self, zip_path: Path | None = None) -> GtfsIndex:
        """Blocking: filter the (downloaded) zip and write the cache."""
        idx = build_index(
            zip_path or self.zip_path,
            SLICE_BBOX_RD.expanded(self.settings.gtfs_static_filter_margin_m),
            self.settings.shape_densify_m,
        )
        save_index(idx, self.cache_path)
        return idx

    async def refresh(self, client: httpx.AsyncClient) -> bool:
        """Download if changed (or cache missing) and rebuild. Returns True if index changed."""
        changed = await download_if_changed(client, self.settings.gtfs_static_url, self.zip_path)
        if not changed and self.loaded:
            return False
        idx = await asyncio.to_thread(self.rebuild_from_zip)
        self.set_index(idx)
        return True

