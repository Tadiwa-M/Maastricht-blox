import json

import numpy as np

from blox_pipeline.io import read_world_records
from blox_pipeline.testscene import build_testscene, make_scene
from blox_pipeline.testscene.scene import CX, CY


def test_scene_contents():
    cv = make_scene()
    names = {cv.palette[int(c)].name for c in np.unique(cv.color)}
    for want in ("cobble_grey", "mergel", "brick_red", "white", "glass", "roof_tile_red", "slate",
                 "tower_red", "water", "lamp_warm", "leaf", "trunk", "asphalt", "pavement"):
        assert want in names
    assert {1, 2, 3, 4, 6, 7, 8} <= set(np.unique(cv.shape).tolist())


def test_build_testscene(tmp_path):
    st = build_testscene(tmp_path, generated="2026-10-17T12:00:00Z")
    m = json.loads((tmp_path / "manifest.json").read_text())
    assert [(c["cx"], c["cy"]) for c in m["chunks"]] == [(CX, CY)]
    assert m["chunks"][0]["bricks"] == st.bricks > 1000
    feats = json.loads((tmp_path / "features.json").read_text())["features"]
    ids = {f["id"] for f in feats}
    (_, data), = list(read_world_records(tmp_path))
    used = set(np.unique(data.records["featureId"]).tolist()) - {0}
    assert used <= ids
    assert (tmp_path / "preview.png").is_file() and (tmp_path / "preview_iso.png").is_file()
    assert st.layout_s_warm < 2.0
