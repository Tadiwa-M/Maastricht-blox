"""BGT (Basisregistratie Grootschalige Topografie) from PDOK's OGC API Features.

The BGT maps every surface of the city as polygons: road parts (carriageway, footway, cycle
path, parking), verges, green and unplanted terrain, water and banks, plus bridge decks,
platforms, walls and canopies. At ``relatieve_hoogteligging`` 0 the polygons partition the
ground (buildings excepted), so inside the fetched area it replaces OSM lines buffered by
guessed widths.

Cache layout (like 3D BAG): ``bgt/<x>_<y>_<size>/<collection>/page_NNNN.json`` plus a ``done``
marker per collection; a block counts as fetched when every collection is done. Pages are
slimmed before they are stored: the API returns historic versions too (``eind_registratie``
set), which are dropped, and only the attributes in ``KEEP_PROPS`` are kept, coordinates to
the millimetre. An interrupted fetch resumes at the first missing page.
"""

from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Any

import shapely
from shapely import box as shp_box
from shapely.geometry import shape
from shapely.ops import unary_union

from .. import geo
from ..geo import RDBox
from . import config
from .http import JSON_MAGIC, download, expect_magic, make_session
from .model import BgtData, BgtFeature

log = logging.getLogger(__name__)

KEEP_PROPS = (
    "functie", "plus_functie", "fysiek_voorkomen", "plus_fysiek_voorkomen", "type", "plus_type",
    "relatieve_hoogteligging", "hoort_bij_typeoverbrugging", "type_overbruggingsdeel",
    "overbrugging_is_beweegbaar",
)


def base_dir(root: Path | None = None) -> Path:
    return (root or config.data_dir()) / "bgt"


def block_dir(block: RDBox, root: Path | None = None) -> Path:
    return base_dir(root) / f"{int(block.xmin)}_{int(block.ymin)}_{int(block.xmax - block.xmin)}"


def block_complete(d: Path, collections: tuple[str, ...] = config.BGT_COLLECTIONS) -> bool:
    return all((d / c / "done").exists() for c in collections)


def fetch_bgt(bbox: RDBox, root: Path | None = None,
              collections: tuple[str, ...] = config.BGT_COLLECTIONS) -> list[Path]:
    """Fetch every collection for each block of ``bbox`` into the cache. Returns the page files."""
    sess = make_session()
    pages: list[Path] = []
    blocks = list(geo.iter_blocks(bbox, config.BGT_BLOCK_M))
    for nb, block in enumerate(blocks, 1):
        d = block_dir(block, root)
        for coll in collections:
            pages += _fetch_collection(block, coll, d / coll, sess)
        log.info("BGT block %d/%d %s done", nb, len(blocks), block.as_tuple())
    return pages


def _fetch_collection(block: RDBox, coll: str, d: Path, sess) -> list[Path]:
    if (d / "done").exists():
        return sorted(d.glob("page_*.json"))
    url: str | None = config.BGT_API_URL.format(collection=coll)
    params: dict[str, str] | None = {
        "f": "json", "limit": str(config.BGT_PAGE_LIMIT),
        "bbox": f"{block.xmin},{block.ymin},{block.xmax},{block.ymax}",
        "bbox-crs": config.BGT_CRS, "crs": config.BGT_CRS,
    }
    out: list[Path] = []
    n = 0
    while url:
        dest = d / f"page_{n:04d}.json"
        if not dest.exists():
            raw = download(url, d / f"raw_{n:04d}.json", params=params, session=sess,
                           validate=expect_magic(*JSON_MAGIC))
            page = slim_page(json.loads(raw.read_text(encoding="utf-8")))
            tmp = dest.with_name(dest.name + ".tmp")
            tmp.write_text(json.dumps(page, separators=(",", ":")), encoding="utf-8")
            tmp.replace(dest)
            raw.unlink()
        out.append(dest)
        url = json.loads(dest.read_text(encoding="utf-8")).get("next")
        params = None  # the next link carries its own query
        n += 1
    (d / "done").write_text(str(n))
    return out


def slim_page(page: dict[str, Any]) -> dict[str, Any]:
    """Current objects only, the attributes in ``KEEP_PROPS``, millimetre coordinates."""
    feats = []
    for f in page.get("features", []):
        p = f.get("properties") or {}
        if p.get("eind_registratie") is not None or not f.get("geometry"):
            continue  # a historic version
        g = f["geometry"]
        feats.append({
            "id": p.get("lokaal_id") or str(f.get("id")),
            "p": {k: p[k] for k in KEEP_PROPS if p.get(k) is not None},
            "g": {"type": g["type"], "coordinates": _round(g["coordinates"])},
        })
    nxt = next((l["href"] for l in page.get("links", []) if l.get("rel") == "next" and l.get("href")), None)
    return {"next": nxt, "returned": len(page.get("features", [])), "features": feats}


def _round(c: Any) -> Any:
    if isinstance(c, (int, float)):
        return round(float(c), 3)
    return [_round(v) for v in c]


def cached_blocks(bbox: RDBox, root: Path | None = None) -> list[tuple[Path, RDBox]]:
    """Complete cached blocks whose area touches ``bbox`` (any block grid)."""
    base = base_dir(root)
    if not base.is_dir():
        return []
    out = []
    for d in sorted(base.iterdir()):
        parts = d.name.split("_")
        if len(parts) != 3 or not all(p.lstrip("-").isdigit() for p in parts):
            continue
        x, y, size = (int(p) for p in parts)
        b = RDBox(x, y, x + size, y + size)
        if not (b.xmin < bbox.xmax and b.xmax > bbox.xmin and b.ymin < bbox.ymax and b.ymax > bbox.ymin):
            continue
        if not block_complete(d):
            log.warning("BGT block %s is incomplete (run 'blox fetch --only bgt'): OSM is used there", d.name)
            continue
        out.append((d, b))
    return out


def load_bgt(bbox: RDBox, root: Path | None = None) -> BgtData | None:
    """Current BGT objects touching ``bbox`` from the complete cached blocks (deduplicated by
    layer and ``lokaal_id``: an object crossing a block edge is in both blocks). None when
    nothing is cached."""
    blocks = cached_blocks(bbox, root)
    if not blocks:
        return None
    area = shp_box(*bbox.as_tuple())
    seen: dict[tuple[str, str], BgtFeature] = {}
    for d, _ in blocks:
        for coll in config.BGT_COLLECTIONS:
            for page in sorted((d / coll).glob("page_*.json")):
                for f in json.loads(page.read_text(encoding="utf-8"))["features"]:
                    key = (coll, f["id"])
                    if key in seen:
                        continue
                    g = shape(f["g"])
                    if g.is_empty or not g.intersects(area):
                        continue
                    if not g.is_valid:
                        g = shapely.make_valid(g)
                    seen[key] = BgtFeature(coll, f["id"], f["p"], g)
    extent = unary_union([shp_box(*b.as_tuple()) for _, b in blocks]).intersection(area)
    feats = [seen[k] for k in sorted(seen)]
    log.info("BGT: %d objects, %.2f km² covered", len(feats), extent.area / 1e6)
    return BgtData(feats, extent)
