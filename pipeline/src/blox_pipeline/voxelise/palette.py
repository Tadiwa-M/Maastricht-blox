"""Palette lookup by name, read from ``contract/palette.json`` (never hard-coded indices)."""

from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path

import numpy as np

from ..sources.config import contract_dir


@lru_cache(maxsize=None)
def _entries(path: str) -> tuple[tuple[int, str, str | None, str], ...]:
    doc = json.loads(Path(path).read_text(encoding="utf-8"))
    return tuple((int(e["idx"]), str(e["name"]), e.get("srgb"), str(e["material"])) for e in doc["entries"])


def entries() -> tuple[tuple[int, str, str | None, str], ...]:
    return _entries(str(contract_dir() / "palette.json"))


@lru_cache(maxsize=None)
def _by_name() -> dict[str, int]:
    return {name: idx for idx, name, _, _ in entries()}


def idx(name: str) -> int:
    """Palette index for ``name``; raises KeyError for unknown names."""
    try:
        return _by_name()[name]
    except KeyError:
        raise KeyError(f"palette has no colour {name!r}") from None


def material(index: int) -> str:
    for i, _, _, mat in entries():
        if i == index:
            return mat
    raise KeyError(index)


def rgb(name: str) -> tuple[int, int, int]:
    for _, n, hexs, _ in entries():
        if n == name and hexs:
            h = hexs.lstrip("#")
            return int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)
    raise KeyError(name)


def nearest(colours: np.ndarray, candidates: list[str]) -> np.ndarray:
    """Quantise ``(..., 3)`` uint8 RGB to the nearest of ``candidates`` (palette idx)."""
    pal = np.array([rgb(c) for c in candidates], dtype=np.float32)
    ids = np.array([idx(c) for c in candidates], dtype=np.uint8)
    d = ((colours[..., None, :].astype(np.float32) - pal) ** 2).sum(-1)
    return ids[np.argmin(d, axis=-1)]
