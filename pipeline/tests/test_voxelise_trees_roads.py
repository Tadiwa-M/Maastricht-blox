"""Tree trunks never stand on a carriageway (prepare_osm.off_carriageway)."""

from __future__ import annotations

from shapely.geometry import LineString, Point

from blox_pipeline.sources.model import OsmData, OsmFeature
from blox_pipeline.voxelise.prepare_osm import ROAD_WIDTH_M, TREE_KERB_M, off_carriageway


def _osm(*ways: tuple[dict[str, str], LineString]) -> OsmData:
    return OsmData(roads=[OsmFeature(f"way/{n}", t, g) for n, (t, g) in enumerate(ways)])


ROAD = ({"highway": "residential"}, LineString([(0, 0), (100, 0)]))
REACH = ROAD_WIDTH_M["residential"] / 2 + TREE_KERB_M


def test_trunk_on_the_road_moves_to_its_kerb() -> None:
    out = dict(off_carriageway([("a", Point(50, 1.0)), ("b", Point(50, -2.0))], _osm(ROAD)))
    assert abs(out["a"].y - REACH) < 1e-6 and abs(out["a"].x - 50) < 1e-6  # same side, straight out
    assert abs(out["b"].y + REACH) < 1e-6


def test_trees_off_the_road_and_on_footways_stay() -> None:
    pts = [("a", Point(50, 6.0)), ("b", Point(20, 30.0))]
    foot = ({"highway": "footway"}, LineString([(20, 25), (20, 35)]))
    assert off_carriageway(pts, _osm(ROAD, foot)) == pts


def test_bus_street_counts_and_no_room_drops() -> None:
    bus = ({"highway": "pedestrian", "bus": "designated"}, LineString([(0, 5), (100, 5)]))
    out = dict(off_carriageway([("a", Point(50, 2.5))], _osm(ROAD, bus)))  # between two roads 5 m apart
    assert "a" not in out


def test_width_tag_and_tunnels() -> None:
    wide = ({"highway": "residential", "width": "12"}, LineString([(0, 0), (100, 0)]))
    out = dict(off_carriageway([("a", Point(50, 5.0))], _osm(wide)))
    assert abs(out["a"].y - (6 + TREE_KERB_M)) < 1e-6
    tunnel = ({"highway": "primary", "tunnel": "yes"}, LineString([(0, 0), (100, 0)]))
    assert off_carriageway([("a", Point(50, 1.0))], _osm(tunnel)) == [("a", Point(50, 1.0))]
