"""``life/streets.json``: cycle graph, directed road graph, terraces, bike spots, market."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from blox_pipeline import geo
from blox_pipeline.life.streets import (ROAD_CLASSES, build_streets, cycle_kind, drive_class, oneway)
from blox_pipeline.sources.osm import load_osm
from life_fixture import CAFE, LIFE_BOX, ONEWAY, ROAD, SQUARE, TREES, write_osm


@pytest.fixture(scope="module")
def streets(tmp_path_factory) -> dict:
    p = write_osm(tmp_path_factory.mktemp("osm") / "slice.osm.pbf")
    return build_streets(load_osm(p, LIFE_BOX), LIFE_BOX)


def _u(p: tuple[float, float]) -> tuple[float, float]:
    return p[0] - geo.X0, p[1] - geo.Y0


def test_tag_rules() -> None:
    assert cycle_kind({"highway": "cycleway"}) == "cycleway"
    assert cycle_kind({"highway": "tertiary", "cycleway:right": "lane"}) == "lane"
    assert cycle_kind({"highway": "pedestrian"}) is None
    assert cycle_kind({"highway": "pedestrian", "bicycle": "yes"}) == "pedestrian"
    assert cycle_kind({"highway": "footway"}) is None
    assert drive_class({"highway": "pedestrian"}) is None
    assert drive_class({"highway": "footway"}) is None
    assert drive_class({"highway": "service", "service": "parking_aisle"}) is None
    assert drive_class({"highway": "residential", "access": "private"}) is None
    assert drive_class({"highway": "living_street"}) == "living_street"
    assert drive_class({"highway": "trunk_link"}) == "primary"
    assert oneway({"oneway": "yes"}) == 1 and oneway({"oneway": "-1"}) == -1 and oneway({}) == 0
    assert oneway({"junction": "roundabout"}) == 1


def test_road_graph_directed_and_no_pedestrian_streets(streets: dict) -> None:
    r = streets["roads"]
    assert r["classes"] == ROAD_CLASSES
    nodes = r["nodes"]
    xy = [(nodes[2 * q], nodes[2 * q + 1]) for q in range(len(nodes) // 2)]
    zs = {round(z) for _, z in xy}
    assert round(_u(ROAD[0])[1]) in zs and round(_u(ONEWAY[0])[1]) in zs
    assert round(_u((0, 317900.0))[1]) not in zs  # the pedestrian street has no cars
    assert round(_u((0, 317750.0))[1]) not in zs  # nor the parking aisle
    for q, fl in enumerate(r["flags"]):
        a, b = r["edges"][2 * q], r["edges"][2 * q + 1]
        cls = ROAD_CLASSES[fl >> 1]
        if xy[a][0] >= _u(ONEWAY[0])[0] - 0.1:  # same z as ROAD, east of it
            assert fl & 1 and cls == "tertiary"
            assert xy[b][0] > xy[a][0]  # drawn west -> east, one-way along it
        else:
            assert not fl & 1 and cls == "residential"
    assert len(json.dumps(streets)) < 50_000


def test_cycle_graph(streets: dict) -> None:
    c = streets["cycle"]
    assert c["kind"] == "cycle" and len(c["edges"]) >= 2
    zs = {round(c["nodes"][2 * q + 1]) for q in range(len(c["nodes"]) // 2)}
    assert round(_u((0, 317600.0))[1]) in zs  # the cycleway
    assert round(_u((0, 317900.0))[1]) not in zs  # pedestrian street without bicycle=yes


def test_terraces_face_the_street(streets: dict) -> None:
    (cafe,) = streets["pois"]
    assert cafe["kind"] == "cafe"
    assert (cafe["x"], cafe["z"]) == pytest.approx(_u(CAFE), abs=0.1)
    assert cafe["f"] == pytest.approx([0.0, -1.0], abs=0.01)  # the shopping street is 12 m south
    assert cafe["d"] == pytest.approx(12.0, abs=0.2)


def test_bike_spots_and_market(streets: dict) -> None:
    assert streets["bikes"], "a cluster of 3 shops makes a bike spot"
    rows = [b for b in streets["bikes"] if abs(b[0] - _u(TREES[0])[0]) < 0.2]
    assert len(rows) == 2, "bike rows between the trees beside the square"
    assert all(abs(b[2]) < 0.01 and abs(abs(b[3]) - 1) < 0.01 and b[4] == 8.0 for b in rows), "along the tree line, 8 m rows"
    for x, z, dx, dz, *_ in streets["bikes"]:
        assert abs(dx * dx + dz * dz - 1) < 0.01
    m = streets["market"]
    assert m["name"] == "Markt" and m["days"] == [2, 4] and m["open"] == 8 * 3600 and m["close"] == 13 * 3600
    xs, zs = m["poly"][0::2], m["poly"][1::2]
    assert min(xs) == pytest.approx(_u(SQUARE[0])[0], abs=0.6) and max(zs) == pytest.approx(_u(SQUARE[2])[1], abs=0.6)


def test_cli_index_lists_streets(tmp_path: Path) -> None:
    from blox_pipeline.cli import main
    from blox_pipeline.sources.osm import clip_path
    root = tmp_path / "raw"
    write_osm(clip_path(root))
    out = tmp_path / "w"
    assert main(["life", "--out", str(out), "--data-dir", str(root), "--no-transit"]) == 0
    index = json.loads((out / "life" / "index.json").read_text())
    assert index["files"]["streets"] == "streets.json"
    assert json.loads((out / "life" / "streets.json").read_text())["kind"] == "streets"
