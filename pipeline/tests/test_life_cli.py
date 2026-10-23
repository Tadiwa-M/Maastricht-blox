"""``blox life`` end to end: cached GTFS + OSM clip -> <out>/life/*.json."""

from __future__ import annotations

import json
from pathlib import Path

from blox_pipeline.cli import main
from blox_pipeline.life.fetch import gtfs_path
from blox_pipeline.sources.osm import clip_path
from life_fixture import MONDAY, build_gtfs_zip, write_osm


def test_life_command_writes_index_and_parts(tmp_path: Path) -> None:
    root = tmp_path / "raw"
    build_gtfs_zip(gtfs_path(root))
    write_osm(clip_path(root))
    out = tmp_path / "world"
    assert main(["life", "--out", str(out), "--data-dir", str(root), "--date", MONDAY]) == 0
    index = json.loads((out / "life" / "index.json").read_text())
    assert index["kind"] == "life" and index["version"] == 1
    assert index["files"] == {"transit": "transit.json", "walkways": "walkways.json", "streets": "streets.json", "river": "river.json"}
    for name, f in index["files"].items():
        doc = json.loads((out / "life" / f).read_text())
        assert doc["kind"] == name
        assert index["bytes"][name] == len((out / "life" / f).read_bytes())
    assert index["week"][0] == MONDAY
    assert not (out / "manifest.json").exists()  # the world manifest is not touched


def test_life_command_missing_inputs(tmp_path: Path, capsys) -> None:
    assert main(["life", "--out", str(tmp_path / "w"), "--data-dir", str(tmp_path)]) == 1
    assert "blox fetch --only gtfs" in capsys.readouterr().err
    assert main(["life", "--out", str(tmp_path / "w"), "--data-dir", str(tmp_path), "--no-transit", "--no-walkways"]) == 0
    assert json.loads((tmp_path / "w" / "life" / "index.json").read_text())["files"] == {"river": "river.json"}
