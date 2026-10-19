"""Brick models (CONTRACT 7.1): the generated files are valid and in sync with the code."""

from __future__ import annotations

import copy
from collections import Counter

import pytest

from blox_pipeline.catalogue import load_catalogue
from blox_pipeline.models import BUILDERS, check_model, load_model, models_dir, write_model
from blox_pipeline.models.builder import ModelBuilder
from blox_pipeline.models.document import brick_cells

CAT = load_catalogue()


@pytest.mark.parametrize("name", sorted(BUILDERS))
def test_model_file_is_valid_and_current(name):
    path = models_dir() / f"{name}.json"
    doc = load_model(path)
    assert check_model(doc) == []
    assert doc == BUILDERS[name]().document(), "run: uv run python -m blox_pipeline.models"


@pytest.mark.parametrize("name", sorted(BUILDERS))
def test_bricks_inside_size_and_pivots_inside_box(name):
    doc = BUILDERS[name]().document()
    size = doc["size"]
    cells = [c for b in doc["bricks"] for c in brick_cells(b, CAT)]
    assert len(cells) == len(set(cells))  # no overlaps
    for n in range(3):
        assert min(c[n] for c in cells) == 0 and max(c[n] for c in cells) == size[n] - 1  # tight box
    for p in doc["parts"].values():
        assert all(0 <= p["pivot"][n] <= size[n] for n in range(3))
    for part in doc["parts"]:
        assert any(b.get("part") == part for b in doc["bricks"])


def test_bus():
    doc = BUILDERS["bus"]().document()
    assert doc["size"] == [5, 24, 16]
    names = Counter(CAT[b["type"]].name for b in doc["bricks"])
    assert names["window_1x2x2"] >= 15 and names["door_1x2x4"] == 2
    assert sorted(doc["parts"]) == ["wheel_fl", "wheel_fr", "wheel_rl", "wheel_rr"]
    doors = [b for b in doc["bricks"] if CAT[b["type"]].name == "door_1x2x4"]
    assert all(b["rot"] == 1 and b["i"] == 4 for b in doors)  # facing E: the +i (kerb) side
    wheels = [b for b in doc["bricks"] if b.get("part", "").startswith("wheel")]
    assert all(CAT[b["type"]].kind == "round" and b["k"] == 0 for b in wheels)


def test_boat():
    doc = BUILDERS["boat"]().document()
    names = Counter(CAT[b["type"]].name for b in doc["bricks"])
    assert 28 <= doc["size"][1] <= 32 and names["window_1x2x3"] >= 10 and names["fence_1x4"] >= 4
    assert doc["pivot"][2] == 3.0  # waterline


def test_character_is_an_original_blocky_figure():
    doc = BUILDERS["character"]().document()
    assert 9 <= doc["size"][2] <= 10
    kinds = {CAT[b["type"]].kind for b in doc["bricks"]}
    assert kinds <= {"brick", "plate"}  # no round head, no special hands
    assert sorted(doc["parts"]) == ["arm_l", "arm_r", "leg_l", "leg_r"]
    legs = [b for b in doc["bricks"] if b.get("part", "").startswith("leg")]
    assert all(doc["parts"][b["part"]]["pivot"][2] == b["k"] + CAT[b["type"]].h for b in legs)  # hip on top


def test_check_model_finds_problems():
    good = BUILDERS["character"]().document()
    bad = copy.deepcopy(good)
    bad["bricks"].append(dict(bad["bricks"][0]))
    assert any("overlaps" in e for e in check_model(bad))
    bad = copy.deepcopy(good)
    bad["bricks"][0]["i"] = 9
    assert any("outside" in e for e in check_model(bad))
    bad = copy.deepcopy(good)
    bad["bricks"][0]["part"] = "tail"
    assert any("unknown part" in e for e in check_model(bad))
    bad = copy.deepcopy(good)
    bad["parts"]["leg_l"]["pivot"] = [0, 0, 99]
    assert any("pivot" in e for e in check_model(bad))


def test_builder_guards_and_fills_around_pieces(tmp_path):
    m = ModelBuilder("t", (4, 4, 6), (2, 2, 0))
    m.place("window_1x2x2", 0, 0, 0, "S", "white")
    with pytest.raises(ValueError, match="overlaps"):
        m.place("brick_1x1", 1, 0, 0, "N", "white")
    with pytest.raises(ValueError, match="leaves"):
        m.place("brick_1x4", 3, 2, 0, "N", "white")
    m.box(0, 4, 0, 4, 0, 6, "bus_red", top="tile")
    doc = m.document()
    assert sum(len(brick_cells(b, CAT)) for b in doc["bricks"]) == 4 * 4 * 6
    assert CAT[doc["bricks"][-1]["type"]].kind == "tile"
    path = write_model(doc, tmp_path)
    assert load_model(path) == doc
