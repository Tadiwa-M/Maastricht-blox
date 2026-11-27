"""Nobody walks on water (accuracy A2): walkway edges over water go, bridges stay."""

from shapely.geometry import LineString, box

from blox_pipeline import geo
from blox_pipeline.geo import RDBox
from blox_pipeline.life.walkways import build_walkways
from blox_pipeline.life.water import wet_area
from blox_pipeline.sources.model import BgtData, BgtFeature, OsmData, OsmFeature

X, Y = 176000.0, 317000.0
BOX = RDBox(X, Y, X + 200, Y + 200)
RIVER = box(X + 80, Y, X + 120, Y + 200)


def path(osm_id, y, **tags):
    return OsmFeature(osm_id, {"highway": "footway", **tags}, LineString([(X + 10, Y + y), (X + 190, Y + y)]))


def edges_over_river(doc):
    n = [(doc["nodes"][2 * k] + geo.X0, doc["nodes"][2 * k + 1] + geo.Y0) for k in range(len(doc["nodes"]) // 2)]
    e = doc["edges"]
    return [(n[e[k]], n[e[k + 1]]) for k in range(0, len(e), 2)
            if X + 82 < (n[e[k]][0] + n[e[k + 1]][0]) / 2 < X + 118]


def test_a_path_mapped_across_the_river_is_cut_a_bridge_is_not():
    osm = OsmData(roads=[path("way/1", 50), path("way/2", 150, bridge="yes")],
                  water=[OsmFeature("way/9", {"natural": "water"}, RIVER)])
    doc = build_walkways(osm, BOX, wet=wet_area(osm))
    ys = {round(a[1] - Y) for a, _ in edges_over_river(doc)}
    assert ys == {150}
    assert doc["meta"]["wet"] > 0


def test_bgt_water_and_bridges_count_too():
    osm = OsmData(roads=[path("way/1", 50), path("way/2", 150)])
    bgt = BgtData([BgtFeature("waterdeel", "w", {"type": "waterloop"}, RIVER),
                   BgtFeature("overbruggingsdeel", "b", {"relatieve_hoogteligging": 1}, box(X + 75, Y + 146, X + 125, Y + 154))],
                  RIVER)
    doc = build_walkways(osm, BOX, wet=wet_area(osm, bgt))
    assert {round(a[1] - Y) for a, _ in edges_over_river(doc)} == {150}


def test_no_water_no_change():
    osm = OsmData(roads=[path("way/1", 50)])
    assert wet_area(osm) is None
    assert build_walkways(osm, BOX, wet=None) == build_walkways(osm, BOX)
