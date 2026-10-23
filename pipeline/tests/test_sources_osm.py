from pathlib import Path

import osmium
import pytest
from osmium.osm.mutable import Node, Relation, Way

from blox_pipeline import geo
from blox_pipeline.geo import RDBox
from blox_pipeline.sources.osm import clip_pbf, load_osm
from blox_pipeline.sources.osm_classify import classify_area, classify_node, classify_way

BBOX = RDBox(176000, 317000, 176200, 317200)


def _ll(x: float, y: float) -> tuple[float, float]:
    lon, lat = geo.rd_to_wgs84(x, y)
    return float(lon), float(lat)


def write_osm(path: Path) -> None:
    """A tiny but realistic extract: a street, a cobbled pedestrian way, a railway,
    a closed park way, a multipolygon pond, a tree, a named café and a far-away way."""
    pts = {
        1: (176010, 317100), 2: (176190, 317100),  # street
        3: (176050, 317020), 4: (176050, 317180),  # pedestrian
        5: (176000, 317150), 6: (176200, 317160),  # railway
        10: (176120, 317010), 11: (176180, 317010), 12: (176180, 317060), 13: (176120, 317060),  # park
        20: (176020, 317020), 21: (176040, 317020), 22: (176040, 317040), 23: (176020, 317040),  # pond
        30: (176100, 317130),  # tree
        31: (176070, 317070),  # cafe
        40: (179000, 319000), 41: (179100, 319000),  # outside the bbox
    }
    node_tags = {30: {"natural": "tree"}, 31: {"amenity": "cafe", "name": "Café Test", "addr:street": "Markt",
                                                 "addr:housenumber": "1"}}
    with osmium.SimpleWriter(str(path)) as w:
        for nid, (x, y) in sorted(pts.items()):
            w.add_node(Node(id=nid, location=_ll(x, y), tags=node_tags.get(nid, {})))
        w.add_way(Way(id=100, nodes=[1, 2], tags={"highway": "residential", "name": "Teststraat", "width": "6 m"}))
        w.add_way(Way(id=101, nodes=[3, 4], tags={"highway": "pedestrian", "name": "Grote Staat"}))
        w.add_way(Way(id=102, nodes=[5, 6], tags={"railway": "rail"}))
        w.add_way(Way(id=103, nodes=[10, 11, 12, 13, 10], tags={"leisure": "park", "name": "Stadspark"}))
        w.add_way(Way(id=104, nodes=[20, 21, 22, 23, 20], tags={}))
        w.add_way(Way(id=105, nodes=[40, 41], tags={"highway": "primary"}))
        w.add_relation(Relation(id=200, members=[("w", 104, "outer")],
                                tags={"type": "multipolygon", "natural": "water", "name": "Vijver"}))


def test_classify_rules():
    assert classify_node({"natural": "tree"}) == ["trees"]
    assert classify_node({"name": "X", "amenity": "cafe", "addr:housenumber": "2"}) == ["addresses", "pois"]
    assert classify_way({"highway": "residential"}) == ["roads"]
    assert classify_way({"highway": "residential", "tunnel": "yes"}) == []
    assert classify_way({"railway": "rail"}) == ["railways"]
    assert classify_area({"building": "yes", "addr:housenumber": "1"}) == ["buildings", "addresses"]
    assert classify_area({"waterway": "riverbank"}) == ["water"]
    assert classify_area({"highway": "pedestrian", "area": "yes", "name": "Vrijthof"}) == ["road_areas"]
    assert classify_area({"place": "square", "name": "Markt"}) == ["road_areas"]
    assert classify_area({"highway": "residential"}) == []  # roundabout ring, not an area


def test_load_osm_groups_and_coordinates(tmp_path):
    f = tmp_path / "t.osm.pbf"
    write_osm(f)
    data = load_osm(f, BBOX)
    assert [r.tags["name"] for r in data.roads] == ["Teststraat", "Grote Staat"]
    street = data.roads[0]
    assert street.osm_id == "way/100"
    x0, y0 = street.geom.coords[0]
    assert x0 == pytest.approx(176010, abs=0.05) and y0 == pytest.approx(317100, abs=0.05)
    assert len(data.railways) == 1
    assert [w.name for w in data.water] == ["Vijver"] and data.water[0].osm_id == "relation/200"
    assert data.water[0].geom.area == pytest.approx(400, rel=0.01)
    assert [p.name for p in data.landuse] == ["Stadspark"] and data.landuse[0].osm_id == "way/103"
    assert len(data.trees) == 1 and data.trees[0].geom.geom_type == "Point"
    assert [p.name for p in data.pois] == ["Café Test"]
    assert len(data.addresses) == 1
    # the far-away primary road is not inside the bbox
    assert all(r.tags.get("highway") != "primary" for r in data.roads)


def test_clip_keeps_complete_geometries(tmp_path):
    src = tmp_path / "src.osm.pbf"
    write_osm(src)
    dst = tmp_path / "clip.osm.pbf"
    clip_pbf(src, dst, (*_ll(176000, 317000), *_ll(176060, 317050)))
    ids = {(o.type_str(), o.id) for o in osmium.FileProcessor(str(dst))}
    # way 101 has only node 3 inside, but its other node comes along as a back-reference
    assert ("w", 101) in ids and ("n", 4) in ids
    assert ("r", 200) in ids and ("w", 104) in ids
    assert ("w", 105) not in ids and ("n", 40) not in ids
    data = load_osm(dst, BBOX)
    assert {r.osm_id for r in data.roads} == {"way/101"}  # way 100 lies outside the clip
    assert len(data.water) == 1
