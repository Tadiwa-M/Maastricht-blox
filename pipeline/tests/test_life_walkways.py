"""``blox life`` walkways + river from OSM (synthetic extract)."""

from __future__ import annotations

from pathlib import Path

import numpy as np
import pytest

from blox_pipeline import geo
from blox_pipeline.life.river import build_river
from blox_pipeline.life.walkways import build_walkways, is_walk_area, sidewalk_sides, way_kind
from blox_pipeline.sources.osm import load_osm
from life_fixture import CYCLE, FOOT, LIFE_BOX, NOFOOT, PED, ROAD, SHOP, SQUARE, write_osm


@pytest.fixture(scope="module")
def osm_file(tmp_path_factory: pytest.TempPathFactory) -> Path:
    return write_osm(tmp_path_factory.mktemp("osm") / "clip.osm.pbf")


@pytest.fixture(scope="module")
def doc(osm_file: Path) -> dict:
    return build_walkways(load_osm(osm_file, LIFE_BOX), LIFE_BOX)


def _nodes(doc: dict) -> np.ndarray:
    return np.asarray(doc["nodes"]).reshape(-1, 2) + [geo.X0, geo.Y0]  # back to RD


def _near(doc: dict, p: tuple[float, float], r: float) -> np.ndarray:
    n = _nodes(doc)
    return np.nonzero(np.hypot(n[:, 0] - p[0], n[:, 1] - p[1]) <= r)[0]


def test_tag_rules() -> None:
    assert way_kind({"highway": "footway", "footway": "sidewalk"}) == "sidewalk"
    assert way_kind({"highway": "pedestrian"}) == "pedestrian"
    assert way_kind({"highway": "cycleway"}) is None
    assert way_kind({"highway": "cycleway", "foot": "designated"}) == "path"
    assert way_kind({"highway": "footway", "access": "private"}) is None
    assert sidewalk_sides({"sidewalk": "both"}) == [1, -1]
    assert sidewalk_sides({"sidewalk": "separate"}) == []
    assert sidewalk_sides({"sidewalk:right": "yes"}) == [-1]
    assert is_walk_area({"place": "square"}) and not is_walk_area({"amenity": "parking", "place": "square"})


def test_graph_is_valid(doc: dict) -> None:
    n = len(doc["nodes"]) // 2
    e = np.asarray(doc["edges"]).reshape(-1, 2)
    assert n > 20 and len(doc["weights"]) == n
    assert e.min() >= 0 and e.max() < n and np.all(e[:, 0] != e[:, 1])
    pts = _nodes(doc)
    assert np.hypot(*(pts[e[:, 0]] - pts[e[:, 1]]).T).max() <= 12.0 * 1.42 + 0.2  # ways <= 12 m, square diagonals


def test_ways_walked_and_skipped(doc: dict) -> None:
    assert len(_near(doc, PED[0], 0.2)) == 1 and len(_near(doc, FOOT[0], 0.2)) == 1
    mid = lambda line: ((line[0][0] + line[1][0]) / 2, (line[0][1] + line[1][1]) / 2)  # noqa: E731
    assert len(_near(doc, mid(CYCLE), 3)) == 0
    assert len(_near(doc, mid(NOFOOT), 3)) == 0
    assert len(_near(doc, mid(ROAD), 2)) == 0  # the carriageway itself is not walked


def test_sidewalks_offset_from_road(doc: dict) -> None:
    x = (ROAD[0][0] + ROAD[1][0]) / 2
    side = [n for n in _near(doc, (x, ROAD[0][1]), 8.0)]
    ys = sorted({round(float(_nodes(doc)[n][1] - ROAD[0][1]), 1) for n in side})
    assert ys == [-4.0, 4.0]  # width 6 / 2 + 1 m


def test_dead_end_snapped_to_street(doc: dict) -> None:
    end = _near(doc, FOOT[1], 0.2)[0]
    e = np.asarray(doc["edges"]).reshape(-1, 2)
    nbrs = set(e[e[:, 0] == end, 1]) | set(e[e[:, 1] == end, 0])
    on_ped = [n for n in nbrs if abs(_nodes(doc)[n][1] - PED[0][1]) < 0.2]
    assert on_ped, "footway end 3 m short of the pedestrian street should be joined to it"


def test_square_grid_and_weights(doc: dict) -> None:
    w = np.asarray(doc["weights"])
    pts = _nodes(doc)
    x0, y0 = SQUARE[0]
    x1, y1 = SQUARE[2]
    inside = np.nonzero((pts[:, 0] > x0) & (pts[:, 0] < x1) & (pts[:, 1] > y0) & (pts[:, 1] < y1))[0]
    assert len(inside) >= 25  # 6 m lattice over 40 x 40 m
    assert w[inside].min() >= 8  # squares are busiest (4.0 -> 8)
    near_shop = _near(doc, SHOP, 25)
    far_on_ped = [n for n in _near(doc, PED[1], 30) if abs(pts[n][1] - PED[0][1]) < 0.2 and n not in near_shop]
    assert w[near_shop].max() > max(w[far_on_ped])  # shops make a street busier
    assert doc["meta"]["areas"] == 1


def test_river_from_osm_and_fallback(osm_file: Path) -> None:
    box = geo.slice_box()
    doc = build_river(load_osm(osm_file, box), box)
    path = np.asarray(doc["path"]).reshape(-1, 2)
    assert doc["meta"]["source"] == "osm"
    assert path[0, 1] == pytest.approx(0, abs=0.1) and path[-1, 1] == pytest.approx(geo.SLICE_M, abs=0.1)  # clipped to the slice
    assert np.hypot(*np.diff(path, axis=0).T).max() <= 20.01
    fb = build_river(None, box)
    assert fb["meta"]["source"] == "fallback" and len(fb["path"]) >= 4
