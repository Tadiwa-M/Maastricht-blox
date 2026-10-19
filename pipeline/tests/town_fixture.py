"""Synthetic "town" fixture for the facade grammar on real-data code paths.

A terraced street block of four gabled LoD2.2 buildings (two ridge directions, crossing a
chunk border along i, the back wall on a chunk border along j), a fifth building turned
30 degrees, a residential street in front, a pedestrian street along the west end and a
café POI inside the third house. Ground slopes gently east (1 %).

Islands (CONTRACT 5.1): behind the block, a terrace of three touching houses turned
-20 degrees (one island, yaw +20) with a pedestrian street along their north front, and a
house turned only 2 degrees, which must stay on the world grid.

Written as a cached data dir exactly like ``blox fetch`` leaves it (AHN blocks, a 3D BAG
CityJSON tile, the OSM clip), so tests and ``blox build --data-dir`` read it the real way::

    uv run python tests/town_fixture.py ../build/fixture_data
    uv run blox build --data-dir ../build/fixture_data --bbox 176215,317495,176305,317550 \\
        --out ../build/fixture_world --no-ortho
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

BBOX = RDBox(176215, 317495, 176305, 317550)  # chunks (16..18, 31..32)
LOAD = RDBox(175900, 317300, 176500, 317800)
TERRACE = [  # bag id suffix, x0, x1, eave z, ridge z, ridge along x?, year
    ("1", 176230.0, 176237.0, 62.0, 66.0, True, 1650),
    ("2", 176237.0, 176243.0, 60.0, 64.5, False, 1780),
    ("3", 176243.0, 176251.0, 64.5, 69.0, True, 1890),
    ("4", 176251.0, 176258.0, 59.0, 62.5, True, 1925),
]
# front (south) and back walls; the back wall's cells start chunk row cy=32 (J 2048) while
# the wall plane behind them is in cy=31, so its sills straddle a chunk border
Y0, Y1 = 317510.0, 317524.5
ROTATED = ("5", (176290.0, 317530.0), 10.0, 12.0, 30.0, 58.0, 62.0, 1962)  # id, centre, w, d, deg, eave, ridge, year
# rotated terrace: (id, x0, x1 along the street from the centre, eave, ridge, year); all share
# TURNED_CENTRE, TURNED_DEG and a depth of TURNED_DEPTH, front (north side) faces the street
TURNED_CENTRE, TURNED_DEG, TURNED_DEPTH = (176250.0, 317540.0), -20.0, 10.0
TURNED_TERRACE = [
    ("6", -9.5, -3.5, 60.0, 64.0, 1700),
    ("7", -3.5, 3.5, 62.5, 67.0, 1850),
    ("8", 3.5, 9.5, 59.5, 63.5, 1910),
]
NEAR_GRID = ("9", (176274.0, 317538.0), 8.0, 10.0, 2.0, 59.0, 63.0, 1935)  # like ROTATED, 2 degrees
CAFE = (176247.0, 317511.0)
STREET = ((176200.0, 317505.0), (176320.0, 317505.0))      # residential, 7 m
PEDESTRIAN = ((176225.0, 317480.0), (176225.0, 317545.0))  # pedestrian, 6 m


def turned_axes() -> tuple[np.ndarray, np.ndarray]:
    """Unit vectors along the turned terrace's street (u) and towards its front (v)."""
    a = math.radians(TURNED_DEG)
    return np.array([math.cos(a), math.sin(a)]), np.array([-math.sin(a), math.cos(a)])


def turned_street() -> tuple[tuple[float, float], tuple[float, float]]:
    """Pedestrian street along the turned terrace's front, 6 m wide, 0.5 m from the wall."""
    u, v = turned_axes()
    c = np.array(TURNED_CENTRE) + (TURNED_DEPTH / 2 + 3.5) * v
    a, b = c - 12.0 * u, c + 12.0 * u
    return (float(a[0]), float(a[1])), (float(b[0]), float(b[1]))


def ground_z(x: float | np.ndarray, y: float | np.ndarray = 0.0) -> float | np.ndarray:
    return 50.0 + 0.01 * (np.asarray(x) - 176200.0)


def bag_id(suffix: str) -> str:
    return f"NL.IMBAG.Pand.09351000000T000{suffix}"


def gabled(oid: str, corners: list[tuple[float, float]], eave: float, ridge: float, year: int) -> tuple[dict, list]:
    """CityObjects + vertices (RD metres) for a gabled box; ``corners`` CCW, the ridge runs
    parallel to corners[0] -> corners[1]."""
    p = [np.array(c) for c in corners]
    g = min(float(ground_z(c[0])) for c in corners)
    r0, r1 = (p[3] + p[0]) / 2, (p[1] + p[2]) / 2
    verts = [(*c, g) for c in p] + [(*c, eave) for c in p] + [(*r0, ridge), (*r1, ridge)]
    attrs = {"identificatie": oid, "oorspronkelijkbouwjaar": year, "status": "Pand in gebruik",
             "b3_h_maaiveld": g, "b3_h_dak_max": ridge, "b3_dak_type": "slanted"}
    objs = {
        oid: {"type": "Building", "attributes": attrs, "children": [f"{oid}-0"]},
        f"{oid}-0": {"type": "BuildingPart", "parents": [oid], "geometry": [{
            "type": "Solid", "lod": "2.2",
            "boundaries": [[[[0, 3, 2, 1]], [[0, 1, 5, 4]], [[2, 3, 7, 6]], [[3, 0, 4, 8, 7]],
                            [[1, 2, 6, 9, 5]], [[4, 5, 9, 8]], [[6, 7, 8, 9]]]],
            "semantics": {"surfaces": [{"type": "GroundSurface"}, {"type": "WallSurface"}, {"type": "RoofSurface"}],
                          "values": [[0, 1, 1, 1, 1, 2, 2]]},
        }]},
    }
    return objs, [list(v) for v in verts]


def city_json() -> dict:
    objects: dict = {}
    verts: list = []
    parts = []
    for sfx, x0, x1, eave, ridge, along_x, year in TERRACE:
        if along_x:
            corners = [(x0, Y0), (x1, Y0), (x1, Y1), (x0, Y1)]
        else:  # ridge runs back from the street: start the ring on the east side
            corners = [(x1, Y0), (x1, Y1), (x0, Y1), (x0, Y0)]
        parts.append(gabled(bag_id(sfx), corners, eave, ridge, year))
    for sfx, (cx, cy), w, d, deg, eave, ridge, year in (ROTATED, NEAR_GRID):
        a = math.radians(deg)
        ux, uy, vx, vy = math.cos(a), math.sin(a), -math.sin(a), math.cos(a)
        corners = [(cx + sx * w / 2 * ux + sy * d / 2 * vx, cy + sx * w / 2 * uy + sy * d / 2 * vy)
                   for sx, sy in ((-1, -1), (1, -1), (1, 1), (-1, 1))]
        parts.append(gabled(bag_id(sfx), corners, eave, ridge, year))
    u, v = turned_axes()
    c0 = np.array(TURNED_CENTRE)
    for sfx, a0, a1, eave, ridge, year in TURNED_TERRACE:  # CCW, ridge along the street
        h = TURNED_DEPTH / 2
        corners = [tuple(float(t) for t in c0 + a * u + b * v) for a, b in ((a0, -h), (a1, -h), (a1, h), (a0, h))]
        parts.append(gabled(bag_id(sfx), corners, eave, ridge, year))
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


def write_osm(path: Path) -> None:
    ts = turned_street()
    pts = {1: STREET[0], 2: STREET[1], 3: PEDESTRIAN[0], 4: PEDESTRIAN[1], 5: ts[0], 6: ts[1], 10: CAFE}
    tags = {10: {"amenity": "cafe", "name": "Café De Hoek", "addr:street": "Teststraat", "addr:housenumber": "3"}}
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists():
        path.unlink()
    with osmium.SimpleWriter(str(path)) as w:
        for nid, (x, y) in sorted(pts.items()):
            w.add_node(Node(id=nid, location=_ll(x, y), tags=tags.get(nid, {})))
        w.add_way(Way(id=100, nodes=[1, 2], tags={"highway": "residential", "name": "Teststraat", "width": "7"}))
        w.add_way(Way(id=101, nodes=[3, 4], tags={"highway": "pedestrian", "name": "Kleine Staat", "width": "6"}))
        w.add_way(Way(id=102, nodes=[5, 6], tags={"highway": "pedestrian", "name": "Schuine Steeg", "width": "6"}))


def write_data_dir(root: Path) -> Path:
    from test_sources_ahn import write_tif

    for kind in ("dtm", "dsm"):
        for block in iter_blocks(LOAD, src_config.AHN_BLOCK_M):
            n = int((block.xmax - block.xmin) / 0.5)
            xs = block.xmin + (np.arange(n) + 0.5) * 0.5
            z = np.broadcast_to(ground_z(xs)[None, :], (n, n)).astype(np.float32)
            write_tif(ahn.block_path(kind, block, root), block.xmin, block.ymax, z)
    tiles = bag3d.tiles_dir(root)
    tiles.mkdir(parents=True, exist_ok=True)
    (tiles / "town.city.json").write_text(json.dumps(city_json()))
    write_osm(osm.clip_path(root))
    return root


if __name__ == "__main__":
    sys.path.insert(0, str(Path(__file__).parent))
    print(write_data_dir(Path(sys.argv[1]).resolve()))
