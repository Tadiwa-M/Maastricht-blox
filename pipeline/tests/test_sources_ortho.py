"""Aerial photo blocks: PDOK's WMS serves JPEG only (2026-11); older PNG caches still load."""

import numpy as np
from PIL import Image

from blox_pipeline import geo
from blox_pipeline.geo import RDBox
from blox_pipeline.sources import config, ortho

BLOCK = next(geo.iter_blocks(RDBox(175710.0, 316510.0, 175720.0, 316520.0), config.ORTHO_BLOCK_M))


def _block_image(path, rgb):
    n = int(round((BLOCK.xmax - BLOCK.xmin) / geo.STUD_M))
    path.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(np.full((n, n, 3), rgb, np.uint8)).save(path)


def test_asks_for_jpeg():
    assert ortho.wms_params(BLOCK)["FORMAT"] == "image/jpeg"
    assert ortho.block_path(BLOCK).suffix == ".jpg"


def test_loads_jpeg_and_legacy_png_blocks(tmp_path):
    box = RDBox(BLOCK.xmin, BLOCK.ymin, BLOCK.xmin + 4, BLOCK.ymin + 4)
    assert ortho.load_ortho(box, tmp_path) is None
    _block_image(ortho.block_path(BLOCK, tmp_path, ".png"), (10, 200, 30))
    assert tuple(ortho.load_ortho(box, tmp_path).rgb[0, 0]) == (10, 200, 30)
    _block_image(ortho.block_path(BLOCK, tmp_path), (200, 20, 20))  # a fresh JPEG wins
    r, g, b = ortho.load_ortho(box, tmp_path).rgb[0, 0]
    assert r > 180 and g < 50 and b < 50


def test_cached_png_is_not_fetched_again(tmp_path, monkeypatch):
    _block_image(ortho.block_path(BLOCK, tmp_path, ".png"), (1, 2, 3))
    monkeypatch.setattr(ortho, "download", lambda *a, **k: (_ for _ in ()).throw(AssertionError("fetched")))
    assert ortho.fetch_ortho(RDBox(BLOCK.xmin, BLOCK.ymin, BLOCK.xmin + 4, BLOCK.ymin + 4), tmp_path)[0].suffix == ".png"
