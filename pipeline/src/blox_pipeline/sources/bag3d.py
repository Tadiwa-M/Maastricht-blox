"""3D BAG buildings: page through the OGC API per block and cache the raw pages."""

from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Any

from shapely import box as shp_box
from shapely.geometry import Polygon
from shapely.ops import unary_union

from .. import geo
from ..geo import RDBox
from . import config
from .cityjson import read_path
from .http import JSON_MAGIC, download, expect_magic, make_session
from .model import Building

log = logging.getLogger(__name__)


def block_dir(block: RDBox, root: Path | None = None) -> Path:
    return (root or config.data_dir()) / "3dbag" / f"{int(block.xmin)}_{int(block.ymin)}_{int(block.xmax - block.xmin)}"


def tiles_dir(root: Path | None = None) -> Path:
    """Hand-downloaded 3D BAG CityJSON tiles (``*.city.json`` / ``*.city.jsonl``, e.g. via
    ``https://data.3dbag.nl/latest/tile_index.fgb``) are read from here as well."""
    return (root or config.data_dir()) / "3dbag" / "tiles"


def local_tiles(root: Path | None = None) -> list[Path]:
    d = tiles_dir(root)
    if not d.is_dir():
        return []
    return sorted(p for p in d.iterdir() if p.name.endswith((".city.json", ".city.jsonl")))


def fetch_bag3d(bbox: RDBox, root: Path | None = None) -> list[Path]:
    """Download every API page for each block of ``bbox``. A block is complete when its
    ``done`` marker exists; pages already on disk are not fetched again. When local tiles
    exist in :func:`tiles_dir`, the API is not contacted (the user chose that route)."""
    tiles = local_tiles(root)
    if tiles:
        log.info("3D BAG: using %d local tiles in %s, API skipped", len(tiles), tiles_dir(root))
        return tiles
    sess = make_session()
    pages: list[Path] = []
    for block in geo.iter_blocks(bbox, config.BAG3D_BLOCK_M):
        d = block_dir(block, root)
        if (d / "done").exists():
            pages.extend(sorted(d.glob("page_*.json")))
            continue
        url: str | None = config.BAG3D_API_URL
        params: dict[str, str] | None = {
            "bbox": f"{block.xmin},{block.ymin},{block.xmax},{block.ymax}",
            "limit": str(config.BAG3D_PAGE_LIMIT),
        }
        n = 0
        while url:
            dest = d / f"page_{n:04d}.json"
            download(url, dest, params=params, session=sess, validate=expect_magic(*JSON_MAGIC))
            pages.append(dest)
            url = next_link(json.loads(dest.read_text(encoding="utf-8")))
            params = None  # the next link carries its own query
            n += 1
        (d / "done").write_text(str(n))
        log.info("3D BAG block %s: %d pages", block.as_tuple(), n)
    return pages


def next_link(page: dict[str, Any]) -> str | None:
    for link in page.get("links", []):
        if link.get("rel") == "next" and link.get("href"):
            return str(link["href"])
    return None


def footprint(b: Building) -> Polygon | None:
    """2D footprint: union of roof projections (falls back to ground surfaces)."""
    polys = [_poly2d(s.exterior, s.holes) for s in b.surfaces if s.kind == "roof"]
    if not polys:
        polys = [_poly2d(s.exterior, s.holes) for s in b.surfaces if s.kind == "ground"]
    polys = [p for p in polys if p is not None and p.area > 1e-6]
    if not polys:
        return None
    u = unary_union(polys)
    return u if not u.is_empty else None


def _poly2d(ext, holes) -> Polygon | None:
    if len(ext) < 3:
        return None
    p = Polygon(ext[:, :2], [h[:, :2] for h in holes if len(h) >= 3])
    return p if p.is_valid else p.buffer(0)


def load_buildings(bbox: RDBox, root: Path | None = None, extra_files: list[Path] | None = None) -> list[Building]:
    """Parse cached pages (and optional local CityJSON tiles), dedupe by BAG id and keep
    buildings whose footprint touches ``bbox``."""
    files: list[Path] = []
    for block in geo.iter_blocks(bbox, config.BAG3D_BLOCK_M):
        files.extend(sorted(block_dir(block, root).glob("page_*.json")))
    files.extend(local_tiles(root))
    files.extend(extra_files or [])
    if not files:
        raise FileNotFoundError(f"no 3D BAG data cached: run 'blox fetch', or put CityJSON tiles in {tiles_dir(root)}")
    area = shp_box(*bbox.as_tuple())
    seen: dict[str, Building] = {}
    for f in files:
        for b in read_path(f):
            if b.bag_id in seen:
                continue
            fp = footprint(b)
            if fp is not None and fp.intersects(area):
                seen[b.bag_id] = b
    return [seen[k] for k in sorted(seen)]
