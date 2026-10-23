"""Rotation helpers against the shared cross-language vectors (contract/test_vectors)."""

from __future__ import annotations

import json

import pytest

from blox_pipeline.catalogue import repo_root
from blox_pipeline.rotation import (
    Facing,
    facing_to_rot,
    footprint_cell,
    footprint_cells,
    front_dir,
    rot_to_facing,
    rotated_extent,
)

VECTORS = json.loads((repo_root() / "contract" / "test_vectors" / "rotation.json").read_text())


def test_facing_table():
    for name, rot in VECTORS["facing"].items():
        assert facing_to_rot(name) == rot
        assert facing_to_rot(Facing[name]) == rot
        assert rot_to_facing(rot) is Facing[name]
    assert facing_to_rot("s") == 2 and Facing.parse(3) is Facing.W


def test_front_dir():
    for rot, step in VECTORS["front_dir"].items():
        assert front_dir(int(rot)) == tuple(step)


@pytest.mark.parametrize("case", VECTORS["cases"], ids=lambda c: f"{c['w']}x{c['d']}r{c['rot']}")
def test_case(case):
    w, d, rot = case["w"], case["d"], case["rot"]
    assert rotated_extent(w, d, rot) == tuple(case["extent"])
    for a, b, di, dj in case["cells"]:
        assert footprint_cell(w, d, rot, a, b) == (di, dj)
    got = sorted(footprint_cells(w, d, rot))
    assert got == sorted(tuple(c) for c in case["cells"])


def test_cells_fill_the_extent_exactly():
    for w, d in ((1, 1), (2, 4), (4, 1), (6, 1), (2, 3)):
        for rot in range(4):
            si, sj = rotated_extent(w, d, rot)
            cells = {(di, dj) for _, _, di, dj in footprint_cells(w, d, rot)}
            assert cells == {(i, j) for i in range(si) for j in range(sj)}


def test_bad_input():
    with pytest.raises(ValueError):
        front_dir(4)
    with pytest.raises(ValueError):
        footprint_cell(2, 1, 0, 2, 0)
    with pytest.raises(KeyError):
        facing_to_rot("X")
