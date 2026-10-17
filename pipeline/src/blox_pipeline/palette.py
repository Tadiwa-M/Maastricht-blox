"""Colour palette (``contract/palette.json``, CONTRACT.md section 3)."""

from __future__ import annotations

import json
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

import numpy as np
from numpy.typing import NDArray

from .catalogue import contract_dir

MATERIALS = ("none", "solid", "trans", "glass", "emissive", "metal")
SEE_THROUGH = ("trans", "glass")


@dataclass(frozen=True)
class PaletteEntry:
    idx: int
    name: str
    srgb: str | None
    material: str

    @property
    def rgb(self) -> tuple[int, int, int]:
        if not self.srgb:
            return (0, 0, 0)
        h = self.srgb.lstrip("#")
        return (int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16))

    @property
    def see_through(self) -> bool:
        return self.material in SEE_THROUGH


class Palette:
    def __init__(self, entries: list[PaletteEntry], version: int = 1) -> None:
        self.version = version
        self.entries = list(entries)
        self._by_idx = {e.idx: e for e in entries}
        self._by_name = {e.name: e for e in entries}
        if len(self._by_idx) != len(entries) or len(self._by_name) != len(entries):
            raise ValueError("duplicate palette indices or names")
        if any(not 0 <= e.idx < 256 for e in entries):
            raise ValueError("palette idx must fit in uint8")

    def __getitem__(self, key: int | str) -> PaletteEntry:
        return self._by_name[key] if isinstance(key, str) else self._by_idx[key]

    def __contains__(self, key: int | str) -> bool:
        return key in (self._by_name if isinstance(key, str) else self._by_idx)

    def idx(self, name: str) -> int:
        return self._by_name[name].idx

    def rgb_table(self) -> NDArray[np.uint8]:
        """``(256, 3)`` sRGB lookup; unknown / air entries are black."""
        t = np.zeros((256, 3), np.uint8)
        for e in self.entries:
            t[e.idx] = e.rgb
        return t

    def material_mask(self, *materials: str) -> NDArray[np.bool_]:
        """``(256,)`` bool lookup: palette idx has one of ``materials``."""
        m = np.zeros(256, bool)
        for e in self.entries:
            m[e.idx] = e.material in materials
        return m

    def see_through_mask(self) -> NDArray[np.bool_]:
        """Air plus ``trans``/``glass``: neighbours that expose a face (CONTRACT section 4)."""
        m = self.material_mask(*SEE_THROUGH)
        m[0] = True
        known = np.zeros(256, bool)
        known[[e.idx for e in self.entries]] = True
        m[~known] = True  # undefined colours behave like air
        return m


def parse_palette(doc: dict) -> Palette:
    entries = [
        PaletteEntry(int(e["idx"]), str(e["name"]), e.get("srgb"), str(e["material"]))
        for e in doc["entries"]
    ]
    for e in entries:
        if e.material not in MATERIALS:
            raise ValueError(f"unknown material {e.material!r} for {e.name}")
    return Palette(entries, int(doc.get("version", 1)))


def palette_path() -> Path:
    return contract_dir() / "palette.json"


@lru_cache(maxsize=4)
def _load(path: str) -> Palette:
    return parse_palette(json.loads(Path(path).read_text(encoding="utf-8")))


def load_palette(path: Path | str | None = None) -> Palette:
    """Load (and cache) the palette; defaults to the contract copy."""
    return _load(str(Path(path) if path else palette_path()))
