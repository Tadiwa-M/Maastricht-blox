"""Slope and ridge cells -> slope / double-slope bricks.

Input convention (matches ``voxelise.grid``): a slope surface is a vertical stack of
3 cells (one brick height) carrying shape 1..4 (low edge faces +j, +i, -j, -i), a ridge
stack carries shape 5 (ridge along i) or 6 (ridge along j). Runs of slope cells that are
not a multiple of 3 high leave their remainder to the plate packer ("fallback").

Slope depth (along the facing direction) is read from the grid: walking from the low
front edge backwards over stacks of the same shape/colour/feature gives ``n`` stacks;
if the cell column behind them is a full cell of the same colour/feature it can serve as
the studded back row. ``n + back`` cells are split into 33deg (depth 3) and 45deg (depth
2) slopes; a lone stack with no back row cannot become a slope and falls back to plates.
Equal slopes side by side along the ridge direction merge into wider slopes (4/2/1 for
45deg, 2/1 for 33deg); ridges pair across and merge along the ridge (2/1).
"""

from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass, field

import numpy as np
from numpy.typing import NDArray

from ..catalogue import Catalogue

FWD = {1: (0, 1), 2: (1, 0), 3: (0, -1), 4: (-1, 0)}
ROT_OF_SLOPE = {1: 0, 2: 1, 3: 2, 4: 3}
STACK = 3
WIDTHS = {2: (4, 2, 1), 3: (2, 1)}
SLOPE_NAMES = {
    (2, 1): "slope45_1x2", (2, 2): "slope45_2x2", (2, 4): "slope45_4x2",
    (3, 1): "slope33_1x3", (3, 2): "slope33_2x3",
}
RIDGE_NAMES = {1: "slope_double45_1x2", 2: "slope_double45_2x2"}

Key = tuple[int, int, int]  # (shape, colour, feature)
Pos = tuple[int, int, int]  # (i, j, kb) of a stack's bottom cell


@dataclass
class SlopeResult:
    # local (i, j, k, typeId, rot, colour, feature) per slope brick
    bricks: list[tuple[int, int, int, int, int, int, int]] = field(default_factory=list)
    used: NDArray[np.bool_] | None = None  # cells consumed by slope bricks
    fallback: NDArray[np.bool_] | None = None  # slope cells left to the plate packer


class _Grid:
    def __init__(self, color, feature, shape, emit, cxi, cyj) -> None:
        self.color, self.feature, self.shape, self.emit = color, feature, shape, emit
        self.cxi, self.cyj = cxi, cyj
        self.nx, self.ny, self.nz = color.shape
        self.used = np.zeros(color.shape, bool)
        self.units: dict[Pos, Key] = {}
        self.taken: set[Pos] = set()
        self.fallback = np.zeros(color.shape, bool)

    def inside(self, i: int, j: int) -> bool:
        return 0 <= i < self.nx and 0 <= j < self.ny

    def same_chunk(self, i: int, j: int, i2: int, j2: int) -> bool:
        return self.cxi[i] == self.cxi[i2] and self.cyj[j] == self.cyj[j2]

    def free_unit(self, p: Pos, key: Key, home: Pos) -> bool:
        return (
            self.inside(p[0], p[1]) and self.units.get(p) == key and p not in self.taken
            and self.same_chunk(p[0], p[1], home[0], home[1])
        )

    def full_back(self, i: int, j: int, kb: int, c: int, f: int, home: Pos) -> bool:
        if not self.inside(i, j) or not self.same_chunk(i, j, home[0], home[1]):
            return False
        s = slice(kb, kb + STACK)
        return bool(
            np.all(self.emit[i, j, s]) and np.all(self.shape[i, j, s] == 0)
            and np.all(self.color[i, j, s] == c) and np.all(self.feature[i, j, s] == f)
            and not np.any(self.used[i, j, s])
        )

    def take(self, p: Pos) -> None:
        self.taken.add(p)
        self.used[p[0], p[1], p[2] : p[2] + STACK] = True


def _find_units(g: _Grid) -> None:
    sl = (g.shape >= 1) & (g.shape <= 6) & (g.color != 0) & g.emit
    for i, j in zip(*np.nonzero(sl.any(axis=2))):
        ks = np.flatnonzero(sl[i, j])
        run_start = 0
        for idx in range(1, len(ks) + 1):
            k_prev = ks[idx - 1]
            key_prev = (int(g.shape[i, j, k_prev]), int(g.color[i, j, k_prev]), int(g.feature[i, j, k_prev]))
            if idx < len(ks):
                k = ks[idx]
                key = (int(g.shape[i, j, k]), int(g.color[i, j, k]), int(g.feature[i, j, k]))
                if k == k_prev + 1 and key == key_prev:
                    continue
            k0, length = int(ks[run_start]), idx - run_start
            stacks = length // STACK
            for t in range(stacks):
                g.units[(int(i), int(j), k0 + STACK * t)] = key_prev
            g.fallback[i, j, k0 + STACK * stacks : k0 + length] = True
            run_start = idx


def _split_runs(coords: list[int], chunk_of: NDArray[np.int64], widths: tuple[int, ...]) -> list[tuple[int, int]]:
    """Sorted coordinates -> ``(start, width)`` pieces over contiguous same-chunk runs."""
    out: list[tuple[int, int]] = []
    coords = sorted(coords)
    a = 0
    while a < len(coords):
        b = a + 1
        while b < len(coords) and coords[b] == coords[b - 1] + 1 and chunk_of[coords[b]] == chunk_of[coords[a]]:
            b += 1
        pos, left = coords[a], b - a
        while left:
            w = next(w for w in widths if w <= left)
            out.append((pos, w))
            pos += w
            left -= w
        a = b
    return out


def _ridges(g: _Grid, cat: Catalogue, res: SlopeResult) -> None:
    groups: dict[tuple, list[int]] = defaultdict(list)
    for p in sorted(g.units, key=lambda p: (p[2], p[1], p[0])):
        s, c, f = g.units[p]
        if s not in (5, 6) or p in g.taken:
            continue
        ax, ay = (0, 1) if s == 5 else (1, 0)
        away = (1, 3) if s == 5 else (2, 4)  # slope falling away on the + / - side
        i, j, kb = p
        for sign, want in ((1, s), (-1, s), (1, away[0]), (-1, away[1])):
            q = (i + sign * ax, j + sign * ay, kb)
            if g.free_unit(q, (want, c, f), p):
                g.take(p)
                g.take(q)
                lo = min(p, q)
                if s == 5:
                    groups[(s, kb, c, f, lo[1])].append(i)
                else:
                    groups[(s, kb, c, f, lo[0])].append(j)
                break
    for (s, kb, c, f, lo), along in groups.items():
        chunk_of = g.cxi if s == 5 else g.cyj
        for start, w in _split_runs(along, chunk_of, (2, 1)):
            tid = cat.id(RIDGE_NAMES[w])
            if s == 5:
                res.bricks.append((start, lo, kb, tid, 0, c, f))
            else:
                res.bricks.append((lo, start, kb, tid, 1, c, f))


def _depth_plan(m: int) -> list[int]:
    if m < 2:
        return []
    r = m % 3
    if r == 0:
        return [3] * (m // 3)
    if r == 1:
        return [3] * ((m - 4) // 3) + [2, 2]
    return [3] * ((m - 2) // 3) + [2]


def _slopes(g: _Grid, cat: Catalogue, res: SlopeResult) -> None:
    groups: dict[tuple, list[int]] = defaultdict(list)
    for p in sorted(g.units, key=lambda p: (p[2], p[1], p[0])):
        s, c, f = g.units[p]
        if s not in FWD or p in g.taken:
            continue
        fx, fy = FWD[s]
        i, j, kb = p
        if g.free_unit((i + fx, j + fy, kb), (s, c, f), p):
            continue  # not the front stack: handled from its front
        chain = [p]
        q = (i - fx, j - fy, kb)
        while g.free_unit(q, (s, c, f), p):
            chain.append(q)
            q = (q[0] - fx, q[1] - fy, kb)
        back = g.full_back(q[0], q[1], kb, c, f, p)
        plan = _depth_plan(len(chain) + int(back))
        if not plan:
            continue
        for u in chain:
            g.take(u)
        if back:
            g.used[q[0], q[1], kb : kb + STACK] = True
        idx = 0
        for d in plan:
            fi, fj, _ = chain[idx]
            idx += d
            if s in (1, 3):
                groups[(s, kb, c, f, d, fj)].append(fi)
            else:
                groups[(s, kb, c, f, d, fi)].append(fj)
    for (s, kb, c, f, d, front), along in groups.items():
        chunk_of = g.cxi if s in (1, 3) else g.cyj
        for start, w in _split_runs(along, chunk_of, WIDTHS[d]):
            tid = cat.id(SLOPE_NAMES[(d, w)])
            rot = ROT_OF_SLOPE[s]
            if s == 1:
                i0, j0 = start, front - d + 1
            elif s == 3:
                i0, j0 = start, front
            elif s == 2:
                i0, j0 = front - d + 1, start
            else:
                i0, j0 = front, start
            res.bricks.append((i0, j0, kb, tid, rot, c, f))


def layout_slopes(
    color: NDArray[np.uint8], feature: NDArray[np.uint32], shape: NDArray[np.uint8],
    emit: NDArray[np.bool_], cxi: NDArray[np.int64], cyj: NDArray[np.int64], cat: Catalogue,
) -> SlopeResult:
    """Place ridge then slope bricks; report consumed cells and plate-fallback cells."""
    g = _Grid(color, feature, shape, emit, cxi, cyj)
    _find_units(g)
    res = SlopeResult()
    _ridges(g, cat, res)
    _slopes(g, cat, res)
    for (i, j, kb) in g.units:
        if (i, j, kb) not in g.taken:
            g.fallback[i, j, kb : kb + STACK] = True
    res.used, res.fallback = g.used, g.fallback
    return res
