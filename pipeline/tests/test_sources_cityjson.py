import json
from pathlib import Path

import numpy as np
import pytest

from blox_pipeline.geo import RDBox, iter_blocks
from blox_pipeline.sources import bag3d
from blox_pipeline.sources.cityjson import newell_normal, parse_document, parse_seq, read_path

FIXTURE = Path(__file__).parent / "fixtures" / "sources" / "gabled_building.city.json"
BAG_ID = "NL.IMBAG.Pand.0935100000000001"


def _as_feature(doc: dict) -> dict:
    """The same building as a CityJSONFeature (as api.3dbag.nl serves them)."""
    return {"type": "CityJSONFeature", "id": BAG_ID, "CityObjects": doc["CityObjects"], "vertices": doc["vertices"]}


def test_reads_full_document_and_prefers_lod22():
    [b] = read_path(FIXTURE)
    assert b.bag_id == BAG_ID
    assert b.lod == "2.2"
    assert b.year == 1650 and b.ground_z == 50.0 and b.roof_max_z == 60.0
    kinds = [s.kind for s in b.surfaces]
    assert kinds.count("roof") == 2 and kinds.count("wall") == 4 and kinds.count("ground") == 1
    # transform applied: RD metres + NAP
    allv = np.vstack([s.exterior for s in b.surfaces])
    assert allv[:, 0].min() == pytest.approx(176000.0) and allv[:, 0].max() == pytest.approx(176010.0)
    assert allv[:, 2].max() == pytest.approx(60.0)


def test_roof_normals_point_up_and_outward():
    [b] = read_path(FIXTURE)
    roofs = [s for s in b.surfaces if s.kind == "roof"]
    normals = [newell_normal(r.exterior) for r in roofs]
    ys = sorted(n[1] for n in normals)
    assert ys[0] < -0.5 and ys[1] > 0.5  # one face falls to the south, one to the north
    assert all(n[2] == pytest.approx(np.sqrt(0.5)) for n in normals)  # 45 degrees


def test_api_page_and_seq_formats():
    doc = json.loads(FIXTURE.read_text())
    page = {"type": "FeatureCollection", "metadata": {"transform": doc["transform"]},
            "features": [_as_feature(doc)], "links": [{"rel": "next", "href": "https://x/next"}]}
    [b] = parse_document(page)
    assert b.bag_id == BAG_ID and b.lod == "2.2"
    assert bag3d.next_link(page) == "https://x/next"
    assert bag3d.next_link({"links": [{"rel": "self", "href": "a"}]}) is None
    header = json.dumps({"type": "CityJSON", "version": "2.0", "transform": doc["transform"], "CityObjects": {}, "vertices": []})
    [b2] = list(parse_seq([header, json.dumps(_as_feature(doc))]))
    assert np.allclose(b2.surfaces[0].exterior, b.surfaces[0].exterior)


def test_semantics_missing_falls_back_to_normals():
    doc = json.loads(FIXTURE.read_text())
    part = doc["CityObjects"][BAG_ID + "-0"]
    for g in part["geometry"]:
        g.pop("semantics")
    [b] = parse_document(doc)
    kinds = [s.kind for s in b.surfaces]
    assert kinds.count("roof") == 2 and kinds.count("ground") == 1


def test_footprint_and_cached_pages(tmp_path):
    [b] = read_path(FIXTURE)
    fp = bag3d.footprint(b)
    assert fp.area == pytest.approx(80.0)
    doc = json.loads(FIXTURE.read_text())
    bbox = RDBox(175956, 316988, 176212, 317244)
    block = next(iter_blocks(bbox, 256.0))
    d = bag3d.block_dir(block, tmp_path)
    d.mkdir(parents=True)
    page = {"metadata": {"transform": doc["transform"]}, "features": [_as_feature(doc)], "links": []}
    (d / "page_0000.json").write_text(json.dumps(page))
    (d / "page_0001.json").write_text(json.dumps(page))  # duplicates are dropped
    blds = bag3d.load_buildings(bbox, tmp_path)
    assert [x.bag_id for x in blds] == [BAG_ID]
    assert bag3d.load_buildings(RDBox(177000, 318000, 177100, 318100), tmp_path, extra_files=[FIXTURE]) == []


def test_load_buildings_without_cache_errors(tmp_path):
    with pytest.raises(FileNotFoundError):
        bag3d.load_buildings(RDBox(176000, 317000, 176010, 317010), tmp_path)


def test_local_tiles_route_skips_api(tmp_path, monkeypatch):
    """Hand-downloaded tiles in 3dbag/tiles/ are used by load_buildings and stop fetch_bag3d
    from calling the API."""
    import shutil

    d = bag3d.tiles_dir(tmp_path)
    d.mkdir(parents=True)
    shutil.copy(FIXTURE, d / "9-284-556.city.json")
    (d / "notes.txt").write_text("ignored")

    def no_api(*a, **k):
        raise AssertionError("API must not be called when local tiles exist")

    monkeypatch.setattr(bag3d, "download", no_api)
    assert bag3d.fetch_bag3d(RDBox(175956, 316988, 176044, 317044), tmp_path) == [d / "9-284-556.city.json"]
    [b] = bag3d.load_buildings(RDBox(175956, 316988, 176044, 317044), tmp_path)
    assert b.bag_id == "NL.IMBAG.Pand.0935100000000001"
