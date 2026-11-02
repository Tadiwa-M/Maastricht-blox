"""BGT source: page slimming, cached block fetch with resume, loading (fixtures are two real
PDOK pages of ``wegdeel`` near the Markt, fetched 2026-11-02 with ``limit=2``)."""

import json
import shutil
from pathlib import Path

import pytest

from blox_pipeline import geo
from blox_pipeline.geo import RDBox
from blox_pipeline.sources import bgt, config

FIX = Path(__file__).parent / "fixtures" / "sources" / "bgt"
PAGE0 = json.loads((FIX / "wegdeel_page0.json").read_text(encoding="utf-8"))
PAGE1 = json.loads((FIX / "wegdeel_page1.json").read_text(encoding="utf-8"))
# one 512 m block of the centre slice (X0 175700, Y0 316500) holds the fixture objects
BLOCK = RDBox(176212.0, 317524.0, 176724.0, 318036.0)
BBOX = RDBox(176400.0, 317990.0, 176460.0, 318030.0)


def test_slim_page_keeps_current_objects_and_used_fields():
    s = bgt.slim_page(PAGE1)
    assert s["returned"] == 2
    assert len(s["features"]) == 1  # the 2024 version of the square was replaced
    f = s["features"][0]
    assert f["id"] == "G0935.72c73ecc58874d958eda6b124fcb2295"
    assert f["p"]["functie"] == "voetgangersgebied"
    assert f["p"]["plus_fysiek_voorkomen"] == "sierbestrating"
    assert f["p"]["relatieve_hoogteligging"] == 0
    assert set(f["p"]) <= set(bgt.KEEP_PROPS)
    assert f["g"]["type"] == "Polygon"
    x, y = f["g"]["coordinates"][0][0]
    assert round(x, 3) == x and 176000 < x < 177000 and 317000 < y < 319000
    assert s["next"] is None  # the last page only links back (rel=prev)
    assert bgt.slim_page(PAGE0)["next"].startswith("https://api.pdok.nl/")


def test_block_grid_matches_the_fixture():
    assert [b.as_tuple() for b in geo.iter_blocks(BBOX, config.BGT_BLOCK_M)] == [BLOCK.as_tuple()]


class FakeApi:
    """Stands in for ``download``: serves the fixture pages for ``wegdeel``, empty pages for
    the other collections, and records every request."""

    def __init__(self):
        self.calls: list[str] = []
        self.fail = False

    def __call__(self, url, dest, *, params=None, session=None, validate=None):
        if self.fail:
            raise AssertionError(f"unexpected request {url}")
        self.calls.append(url)
        if "/wegdeel/" in url:
            assert params is not None or "cursor=" in url
            if params is not None:
                assert params["bbox"] == f"{BLOCK.xmin},{BLOCK.ymin},{BLOCK.xmax},{BLOCK.ymax}"
                assert params["crs"].endswith("28992") and params["bbox-crs"].endswith("28992")
            page = PAGE1 if "cursor=" in url else PAGE0
        else:
            page = {"type": "FeatureCollection", "features": [], "links": [], "numberReturned": 0}
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_text(json.dumps(page), encoding="utf-8")
        if validate:
            validate(dest)
        return dest


@pytest.fixture
def api(monkeypatch):
    fake = FakeApi()
    monkeypatch.setattr(bgt, "download", fake)
    return fake


def test_fetch_caches_slim_pages_per_collection(api, tmp_path):
    bgt.fetch_bgt(BBOX, tmp_path)
    d = bgt.block_dir(BLOCK, tmp_path)
    assert bgt.block_complete(d)
    assert sorted(p.name for p in (d / "wegdeel").iterdir()) == ["done", "page_0000.json", "page_0001.json"]
    assert not list(d.rglob("raw_*"))  # raw API pages are removed once slimmed
    assert len(api.calls) == 1 + len(config.BGT_COLLECTIONS)  # wegdeel has two pages
    # complete: a second run asks nothing
    api.fail = True
    bgt.fetch_bgt(BBOX, tmp_path)


def test_fetch_resumes_at_the_first_missing_page(api, tmp_path):
    bgt.fetch_bgt(BBOX, tmp_path)
    d = bgt.block_dir(BLOCK, tmp_path) / "wegdeel"
    (d / "done").unlink()
    (d / "page_0001.json").unlink()
    api.calls.clear()
    bgt.fetch_bgt(BBOX, tmp_path)
    assert len(api.calls) == 1 and "cursor=" in api.calls[0]  # page 0 came from the cache
    assert (d / "done").read_text() == "2"


def test_load_dedupes_and_reports_the_covered_area(api, tmp_path):
    assert bgt.load_bgt(BBOX, tmp_path) is None  # nothing cached
    bgt.fetch_bgt(BBOX, tmp_path)
    # the same block cached under a second grid (another slice) must not double the objects
    shutil.copytree(bgt.block_dir(BLOCK, tmp_path), bgt.base_dir(tmp_path) / "176200_317500_512")
    data = bgt.load_bgt(BBOX, tmp_path)
    assert data is not None
    ids = [f.lid for f in data.features]
    assert len(ids) == len(set(ids)) == 3
    assert {f.props["functie"] for f in data.features} == {"voetpad", "voetpad op trap", "voetgangersgebied"}
    assert all(f.layer == "wegdeel" and f.level == 0 and f.geom.is_valid for f in data.features)
    assert data.extent.area == pytest.approx((BBOX.xmax - BBOX.xmin) * (BBOX.ymax - BBOX.ymin))


def test_incomplete_blocks_are_left_to_osm(api, tmp_path):
    bgt.fetch_bgt(BBOX, tmp_path)
    (bgt.block_dir(BLOCK, tmp_path) / "waterdeel" / "done").unlink()
    assert bgt.load_bgt(BBOX, tmp_path) is None
