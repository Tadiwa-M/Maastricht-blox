import json

import pytest
from shapely.geometry import LineString, Point, box

from blox_pipeline import geo
from blox_pipeline.voxelise.features import FeatureRegistry, build_features


def test_ids_are_sequential_and_keys_merge():
    reg = FeatureRegistry()
    a = reg.add("street", LineString([(175800, 316600), (175810, 316600)]), key="Markt", name="Markt", osm_id="way/1")
    b = reg.add("poi", Point(175900, 316700), name="Café")
    c = reg.add("street", LineString([(175810, 316600), (175830, 316610)]), key="Markt", name="Markt", osm_id="way/2")
    assert (a, b, c) == (1, 2, 1)
    assert reg.get(1).bbox_ij == (200, 200, 259, 219)  # inclusive; max edge on a boundary
    with pytest.raises(ValueError):
        reg.add("spaceship")


def test_build_features_matches_contract_shape():
    reg = FeatureRegistry()
    fp = box(176000, 317000, 176010, 317008)
    reg.add("building", fp, key="NL.IMBAG.Pand.1", name=None, bag_id="NL.IMBAG.Pand.1", year=1650,
            height_m=10.04, address="Vrijthof 1", tags={"wikidata": "Q1"})
    doc = build_features(reg)
    json.dumps(doc)  # serialisable
    [f] = doc["features"]
    assert f == {"id": 1, "kind": "building", "bagId": "NL.IMBAG.Pand.1", "address": "Vrijthof 1",
                 "year": 1650, "heightM": 10.0, "centroid": [610, 1008], "bboxIJ": [600, 1000, 619, 1015],
                 "tags": {"wikidata": "Q1"}}
    I, J = f["centroid"]
    assert fp.contains(Point(*geo.grid_to_rd(I, J, centre=True)))
