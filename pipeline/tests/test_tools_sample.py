"""Sample export keeps only the chunks and features around a place."""

from __future__ import annotations

import json
from pathlib import Path

from blox_pipeline.testscene.build import build_testscene
from blox_pipeline.tools.sample import export_sample


def test_export_sample_roundtrip(tmp_path: Path) -> None:
    world = tmp_path / "world"
    build_testscene(world)
    st = export_sample(world, tmp_path / "s", (22, 47), 1)
    assert st["chunks"] == 1 and st["features"] > 0
    m = json.loads((tmp_path / "s" / "manifest.json").read_text())
    assert m["sample"] == {"centre": [22, 47], "radius": 1}
    assert (tmp_path / "s" / m["chunks"][0]["file"]).exists()
