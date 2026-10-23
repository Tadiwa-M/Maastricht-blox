"""``blox life``: write ``<out>/life/`` (index + transit + walkways + streets + river JSON).

``life/index.json`` is the only entry point the viewer reads; the world manifest
(CONTRACT 5) is not touched. Each part is optional: a missing input is an error unless that
part is switched off, so a half-written export never looks complete.
"""

from __future__ import annotations

import datetime as dt
import json
import logging
from pathlib import Path
from typing import Any

from .. import geo
from ..geo import RDBox

log = logging.getLogger(__name__)

LIFE_VERSION = 1


def dump(doc: Any, path: Path) -> int:
    """Compact JSON (no spaces). Returns the byte size."""
    path.parent.mkdir(parents=True, exist_ok=True)
    text = json.dumps(doc, separators=(",", ":"), ensure_ascii=False)
    path.write_text(text, "utf-8")
    return len(text.encode("utf-8"))


def export_life(out_dir: Path, *, box: RDBox, gtfs_zip: Path | None, osm: Any | None, start: dt.date,
                margin_m: float, modes: tuple[str, ...] = ("bus",)) -> dict:
    """Write the life files for RD ``box``. ``gtfs_zip`` None skips transit; ``osm`` None skips
    walkways and uses the fallback river line. Returns the index document."""
    from .river import build_river
    from .streets import build_streets
    from .transit import build_transit
    from .walkways import build_walkways

    life = out_dir / "life"
    index: dict[str, Any] = {
        "version": LIFE_VERSION, "kind": "life",
        "generated": dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "boxUnity": [round(box.xmin - geo.X0, 1), round(box.ymin - geo.Y0, 1),
                     round(box.xmax - geo.X0, 1), round(box.ymax - geo.Y0, 1)],
        "files": {}, "bytes": {}, "sources": [],
    }
    if gtfs_zip is not None:
        doc = build_transit(gtfs_zip, box.buffer(margin_m), start, modes)
        index["files"]["transit"] = "transit.json"
        index["bytes"]["transit"] = dump(doc, life / "transit.json")
        index["week"] = doc["meta"]["week"]
        index["sources"].append({"name": "OVapi GTFS", "licence": "open data (OVapi)", "attribution": "OVapi"})
    if osm is not None:
        doc = build_walkways(osm, box)
        index["files"]["walkways"] = "walkways.json"
        index["bytes"]["walkways"] = dump(doc, life / "walkways.json")
        index["files"]["streets"] = "streets.json"
        index["bytes"]["streets"] = dump(build_streets(osm, box), life / "streets.json")
        index["sources"].append({"name": "OpenStreetMap", "licence": "ODbL", "attribution": "OpenStreetMap contributors"})
    river = build_river(osm, box)
    index["files"]["river"] = "river.json"
    index["bytes"]["river"] = dump(river, life / "river.json")
    dump(index, life / "index.json")
    for k, v in index["bytes"].items():
        log.info("life/%s.json: %.1f KiB", k, v / 1024)
    return index
