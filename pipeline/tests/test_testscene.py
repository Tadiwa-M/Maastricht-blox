import json

import numpy as np

from blox_pipeline.io import read_world_records
from blox_pipeline.testscene import build_testscene, make_scene
from blox_pipeline.testscene.scene import CX, CY


def test_scene_contents():
    cv = make_scene()
    names = {cv.palette[int(c)].name for c in np.unique(cv.color)}
    for want in ("cobble_dark", "limestone", "plaster_white", "limestone_dark", "mergel", "brick_red", "white", "glass", "roof_tile_red", "slate",
                 "tower_red", "water", "lamp_warm", "leaf", "trunk", "asphalt", "pavement"):
        assert want in names
    assert {1, 2, 3, 4, 6, 7, 8} <= set(np.unique(cv.shape).tolist())


def test_build_testscene(tmp_path):
    st = build_testscene(tmp_path, generated="2026-10-17T12:00:00Z")
    m = json.loads((tmp_path / "manifest.json").read_text())
    assert [(c["cx"], c["cy"]) for c in m["chunks"]] == [(CX, CY), (CX + 1, CY)]  # + the look-v2 row
    assert sum(c["bricks"] for c in m["chunks"]) == st.bricks > 1000
    feats = json.loads((tmp_path / "features.json").read_text())["features"]
    ids = {f["id"] for f in feats}
    parts = list(read_world_records(tmp_path))
    assert len(parts) == 2
    used = set(np.unique(np.concatenate([d.records["featureId"] for _, d in parts])).tolist()) - {0}
    assert used <= ids
    assert (tmp_path / "preview.png").is_file() and (tmp_path / "preview_iso.png").is_file()
    assert st.layout_s_warm < 2.0


def test_scene_uses_detail_pieces_and_hides_buried_studs():
    from blox_pipeline.catalogue import load_catalogue
    from blox_pipeline.layout.records import FLAG_HIDE_STUDS
    from blox_pipeline.testscene.build import lay_out_scene

    rec, _, _ = lay_out_scene()  # raises if verify_layout finds a problem
    cat = load_catalogue()
    names = {cat[int(t)].name for t in rec["type"]}
    for piece in ("window_1x2x3", "door_1x2x4", "arch_1x4", "fence_1x4", "jumper_1x2",
                  "round_tile_1x1", "grille_1x2", "slope30_1x2", "window_1x2x2",
                  # look v2 (the Markt row, chunk CX + 1): every new piece is used
                  "window_1x2x4", "shop_window_1x2x4", "balcony_2x4", "railing_1x2", "pediment_1x4",
                  "lamp_double_1x3", "bollard_1x1", "chain_1x4", "vent_1x2"):
        assert piece in names
    assert ((rec["flags"] & FLAG_HIDE_STUDS) != 0).any()
