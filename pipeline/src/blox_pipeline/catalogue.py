"""Brick catalogue (``contract/brick_catalogue.json``, CONTRACT.md section 2).

Loads the catalogue and offers lookups by id/name. All rotation maths (extent of a
turned piece, which cell lands where, which way the front faces) lives in
:mod:`blox_pipeline.rotation`; this module only asks it.

Kinds: the six v1 kinds are what the voxel layout packs automatically; the v2 detail
kinds (``arch``, ``window``, ...) are only ever *placed* explicitly (CONTRACT 2.1).
"""

from __future__ import annotations

import json
import os
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

import numpy as np
from numpy.typing import NDArray

from .rotation import footprint_cell, rotated_extent

LAYOUT_KINDS = ("brick", "plate", "tile", "slope", "slope_double", "round")
DETAIL_KINDS = ("arch", "window", "door", "fence", "round_tile", "jumper", "tile_grille")
KINDS = LAYOUT_KINDS + DETAIL_KINDS


def repo_root() -> Path:
    """Repository root: the first ancestor of this file containing ``contract/``."""
    here = Path(__file__).resolve()
    for parent in here.parents:
        if (parent / "contract" / "brick_catalogue.json").is_file():
            return parent
    raise FileNotFoundError("could not locate the repository root (contract/ directory)")


def contract_dir() -> Path:
    """Directory holding the contract JSON files (override with ``BLOX_CONTRACT_DIR``)."""
    env = os.environ.get("BLOX_CONTRACT_DIR")
    return Path(env) if env else repo_root() / "contract"


@dataclass(frozen=True)
class BrickType:
    id: int
    name: str
    kind: str
    w: int
    d: int
    h: int
    studs: str
    stud_rows: int = 0

    def extent(self, rot: int) -> tuple[int, int]:
        """Footprint ``(size along i, size along j)`` at rotation ``rot``."""
        return rotated_extent(self.w, self.d, rot)

    @property
    def is_slope(self) -> bool:
        return self.kind in ("slope", "slope_double")

    @property
    def is_detail(self) -> bool:
        """A v2 detail piece: placed explicitly, never produced by the voxel layout."""
        return self.kind in DETAIL_KINDS

    def stud_offsets(self, rot: int) -> list[tuple[int, int]]:
        """Footprint offsets ``(di, dj)`` from the record position that carry a stud.

        ``backRows`` slopes have studs on the ``studRows`` rows farthest from the low
        front edge (front = +j at rot 0, so the back rows are the low ``b`` values).
        A ``center`` stud (jumper) straddles the whole footprint, so every cell counts.
        """
        if self.studs == "none" or (self.studs == "backRows" and self.stud_rows == 0):
            return []
        cells = []
        for a in range(self.w):
            for b in range(self.d):
                if self.studs == "backRows" and b >= self.stud_rows:
                    continue
                cells.append(footprint_cell(self.w, self.d, rot, a, b))
        return cells


class Catalogue:
    def __init__(self, types: list[BrickType], version: int = 1) -> None:
        self.version = version
        self.types = list(types)
        self._by_id = {t.id: t for t in types}
        self._by_name = {t.name: t for t in types}
        if len(self._by_id) != len(types) or len(self._by_name) != len(types):
            raise ValueError("duplicate brick ids or names in catalogue")
        if 0 in self._by_id:
            raise ValueError("brick id 0 is reserved")

    def __getitem__(self, key: int | str) -> BrickType:
        return self._by_name[key] if isinstance(key, str) else self._by_id[key]

    def __contains__(self, key: int | str) -> bool:
        return key in (self._by_name if isinstance(key, str) else self._by_id)

    def id(self, name: str) -> int:
        return self._by_name[name].id

    def of_kind(self, kind: str) -> list[BrickType]:
        return [t for t in self.types if t.kind == kind]

    def extent_tables(self) -> tuple[NDArray[np.int32], NDArray[np.int32], NDArray[np.int32]]:
        """Lookup arrays indexed ``[typeId, rot]``: extent along i, along j; ``[typeId]``: h.

        Unknown ids have zero extent.
        """
        ei = np.zeros((256, 4), np.int32)
        ej = np.zeros((256, 4), np.int32)
        h = np.zeros(256, np.int32)
        for t in self.types:
            for r in range(4):
                ei[t.id, r], ej[t.id, r] = t.extent(r)
            h[t.id] = t.h
        return ei, ej, h


def parse_catalogue(doc: dict) -> Catalogue:
    types = [
        BrickType(
            id=int(t["id"]), name=str(t["name"]), kind=str(t["kind"]), w=int(t["w"]),
            d=int(t["d"]), h=int(t["h"]), studs=str(t["studs"]),
            stud_rows=int(t.get("studRows", 0)),
        )
        for t in doc["types"]
    ]
    for t in types:
        if t.kind not in KINDS:
            raise ValueError(f"unknown brick kind {t.kind!r} for {t.name}")
    return Catalogue(types, int(doc.get("version", 1)))


def catalogue_path() -> Path:
    return contract_dir() / "brick_catalogue.json"


@lru_cache(maxsize=4)
def _load(path: str) -> Catalogue:
    return parse_catalogue(json.loads(Path(path).read_text(encoding="utf-8")))


def load_catalogue(path: Path | str | None = None) -> Catalogue:
    """Load (and cache) the brick catalogue; defaults to the contract copy."""
    return _load(str(Path(path) if path else catalogue_path()))
