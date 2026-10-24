"""Synthetic "Markt" fixture for look v2 (the owner's Markt photos) on the real-data path.

Around the CONTRACT reference point of the Markt (RD 176430, 318007): the **Stadhuis**
(a 46 x 38 m 3D BAG block named "Stadhuis" in OSM, replaced by the hand-authored model), the
cobbled square around it (an OSM ``place=square`` area), a terrace of old townhouses along
the south side facing the square (ridges parallel to the street, so dormers sit on the
front slope), a second terrace on the east side, a residential street with a pavement in
front of the south terrace (kerbs, bollards with chains), a tree row of plane trees along
the square's edge, and a pedestrian street leaving to the west (lamps).

Written as a cached data dir exactly like ``blox fetch`` leaves it, like ``town_fixture``::

    uv run python tests/markt_fixture.py ../build/markt_data [stadhuis_deg]
    uv run blox build --data-dir ../build/markt_data --bbox 176340,317890,176540,318090 \\
        --out ../build/markt_world --no-ortho

``stadhuis_deg`` turns the Stadhuis footprint (default 0: on the world grid; 12 makes it an
island, CONTRACT 5.1).
"""

from __future__ import annotations

import json
import math
import sys
from pathlib import Path

import numpy as np
import osmium
from osmium.osm.mutable import Node, Way

from blox_pipeline import geo
from blox_pipeline.geo import RDBox, iter_blocks
from blox_pipeline.sources import ahn, bag3d, osm
from blox_pipeline.sources import config as src_config

BBOX = RDBox(176340, 317890, 176540, 318090)
LOAD = RDBox(176100, 317700, 176700, 318300)
GROUND = 49.0
STADHUIS = ((176430.0, 318007.0), 46.0, 38.0)  # centre, width (x), depth (y)
SQUARE = (176352.0, 317934.0, 176528.0, 318080.0)
# south terrace (front at y = SOUTH_Y, facing north to the square): x0, x1, eave, ridge, year
SOUTH_Y, SOUTH_DEPTH = 317924.0, 12.0
SOUTH = [(176356.0, 176363.0, 62.5, 66.5, 1680), (176363.0, 176371.0, 63.5, 67.5, 1750),
         (176371.0, 176377.5, 61.5, 65.0, 1820), (176377.5, 176386.0, 64.0, 68.5, 1765),
         (176386.0, 176393.0, 62.0, 66.0, 1860), (176393.0, 176401.5, 63.0, 67.5, 1700),
         (176401.5, 176408.0, 61.0, 64.5, 1885), (176408.0, 176416.0, 64.5, 69.0, 1790)]
# east terrace (front at x = EAST_X, facing west): y0, y1, eave, ridge, year
EAST_X, EAST_DEPTH = 176532.0, 11.0
EAST = [(317960.0, 317968.0, 62.0, 66.0, 1720), (317968.0, 317975.5, 63.5, 67.5, 1840),
        (317975.5, 317984.0, 61.5, 65.5, 1780), (317984.0, 317991.0, 64.0, 68.0, 1890)]
STREET = ((176345.0, 317930.5), (176530.0, 317930.5))     # residential, 6 m (317927.5 .. 317933.5)
PAVEMENT = ((176345.0, 317925.75), (176530.0, 317925.75))  # footway, 3.5 m against the facades
TREES = ((176358.0, 317940.0), (176522.0, 317940.0))        # tree row along the square's edge
LANE = ((176300.0, 318030.0), (176352.0, 318030.0))         # pedestrian street to the west, 8 m


def bag_id(suffix: str) -> str:
    return f"NL.IMBAG.Pand.09351000000M{suffix:0>4}"


def _gabled(oid: str, corners: list[tuple[float, float]], eave: float, ridge: float, year: int):
    from town_fixture import gabled

    objs, verts = gabled(oid, corners, eave, ridge, year)
    g = GROUND
    verts = [[x, y, g] if n < 4 else [x, y, z] for n, (x, y, z) in enumerate(verts)]
    objs[oid]["attributes"]["b3_h_maaiveld"] = g
    return objs, verts


def stadhuis_corners(deg: float) -> list[tuple[float, float]]:
    (cx, cy), w, d = STADHUIS
    a = math.radians(deg)
    ux, uy, vx, vy = math.cos(a), math.sin(a), -math.sin(a), math.cos(a)
    return [(cx + sx * w / 2 * ux + sy * d / 2 * vx, cy + sx * w / 2 * uy + sy * d / 2 * vy)
            for sx, sy in ((-1, -1), (1, -1), (1, 1), (-1, 1))]


def city_json(stadhuis_deg: float = 0.0) -> dict:
    parts = [_gabled(bag_id("1"), stadhuis_corners(stadhuis_deg), 66.0, 74.0, 1664)]
    for n, (x0, x1, eave, ridge, year) in enumerate(SOUTH):
        y0, y1 = SOUTH_Y - SOUTH_DEPTH, SOUTH_Y
        parts.append(_gabled(bag_id(f"S{n}"), [(x0, y0), (x1, y0), (x1, y1), (x0, y1)], eave, ridge, year))
    for n, (y0, y1, eave, ridge, year) in enumerate(EAST):
        x0, x1 = EAST_X, EAST_X + EAST_DEPTH
        parts.append(_gabled(bag_id(f"E{n}"), [(x0, y1), (x0, y0), (x1, y0), (x1, y1)], eave, ridge, year))
    objects: dict = {}
    verts: list = []
    for objs, vs in parts:
        base = len(verts)
        for o in objs.values():
            for geom in o.get("geometry", []):
                geom["boundaries"] = [[[[v + base for v in ring] for ring in face] for face in shell]
                                      for shell in geom["boundaries"]]
        objects.update(objs)
        verts.extend(vs)
    scale, t = 0.001, (176000.0, 317000.0, 0.0)
    ints = [[round((v[n] - t[n]) / scale) for n in range(3)] for v in verts]
    return {"type": "CityJSON", "version": "2.0",
            "transform": {"scale": [scale] * 3, "translate": list(t)},
            "metadata": {"referenceSystem": "https://www.opengis.net/def/crs/EPSG/0/7415"},
            "CityObjects": objects, "vertices": ints}


def _ll(x: float, y: float) -> tuple[float, float]:
    lon, lat = geo.rd_to_wgs84(x, y)
    return float(lon), float(lat)


def write_osm(path: Path, stadhuis_deg: float = 0.0) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists():
        path.unlink()
    nid = [0]

    def node(w, x: float, y: float, tags: dict | None = None) -> int:
        nid[0] += 1
        w.add_node(Node(id=nid[0], location=_ll(x, y), tags=tags or {}))
        return nid[0]

    with osmium.SimpleWriter(str(path)) as w:
        x0, y0, x1, y1 = SQUARE
        sq = [node(w, x, y) for x, y in ((x0, y0), (x1, y0), (x1, y1), (x0, y1))]
        st = [node(w, *p) for p in STREET]
        pv = [node(w, *p) for p in PAVEMENT]
        tr = [node(w, *p) for p in TREES]
        ln = [node(w, *p) for p in LANE]
        sh = [node(w, *p) for p in stadhuis_corners(stadhuis_deg)]
        cafe = node(w, 176390.0, 317921.0, {"amenity": "cafe", "name": "Café Markt"})
        assert cafe
        w.add_way(Way(id=200, nodes=sq + sq[:1], tags={"place": "square", "highway": "pedestrian", "area": "yes",
                                                      "name": "Markt"}))
        w.add_way(Way(id=201, nodes=st, tags={"highway": "residential", "name": "Markt", "width": "6"}))
        w.add_way(Way(id=202, nodes=pv, tags={"highway": "footway", "width": "3.5"}))
        w.add_way(Way(id=203, nodes=tr, tags={"natural": "tree_row"}))
        w.add_way(Way(id=204, nodes=ln, tags={"highway": "pedestrian", "name": "Grote Staat", "width": "8"}))
        w.add_way(Way(id=205, nodes=sh + sh[:1], tags={"building": "yes", "name": "Stadhuis",
                                                      "amenity": "townhall"}))


def write_data_dir(root: Path, stadhuis_deg: float = 0.0) -> Path:
    from test_sources_ahn import write_tif

    for kind in ("dtm", "dsm"):
        for block in iter_blocks(LOAD, src_config.AHN_BLOCK_M):
            n = int((block.xmax - block.xmin) / 0.5)
            z = np.full((n, n), GROUND, np.float32)
            write_tif(ahn.block_path(kind, block, root), block.xmin, block.ymax, z)
    tiles = bag3d.tiles_dir(root)
    tiles.mkdir(parents=True, exist_ok=True)
    (tiles / "markt.city.json").write_text(json.dumps(city_json(stadhuis_deg)))
    write_osm(osm.clip_path(root), stadhuis_deg)
    return root


if __name__ == "__main__":
    sys.path.insert(0, str(Path(__file__).parent))
    deg = float(sys.argv[2]) if len(sys.argv) > 2 else 0.0
    print(write_data_dir(Path(sys.argv[1]).resolve(), deg))
