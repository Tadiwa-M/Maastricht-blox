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
    assert st["chunks"] == 2 and st["features"] > 0  # the look test is two chunks (CX, CX + 1)
    m = json.loads((tmp_path / "s" / "manifest.json").read_text())
    assert m["sample"] == {"centre": [22, 47], "radius": 1}
    assert (tmp_path / "s" / m["chunks"][0]["file"]).exists()


def test_export_sample_copies_islands(tmp_path: Path) -> None:
    town = Path(__file__).parent / "fixtures" / "town_world"
    m = json.loads((town / "manifest.json").read_text())
    c = m["islands"][0]
    st = export_sample(town, tmp_path / "s", (c["cx"], c["cy"]), 2)
    out = json.loads((tmp_path / "s" / "manifest.json").read_text())
    assert st["islands"] >= 1 and len(out["islands"]) == st["islands"]
    for isl in out["islands"]:
        assert (tmp_path / "s" / isl["file"]).exists()
