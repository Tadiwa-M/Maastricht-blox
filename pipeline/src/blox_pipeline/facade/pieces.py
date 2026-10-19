"""Small building blocks that put detail pieces (CONTRACT 2.1) into a house front.

Every helper here does the same three steps, so the rest of the grammar can stay short:

1. clear the voxel cells the piece will occupy (pieces need air),
2. ``place`` the piece with its front facing the street (``facing`` defaults to ``S``),
3. paint whatever belongs behind it (a dark room backdrop behind glass).

Bays are 2 studs wide (``bays.WINDOW_W``) and pieces are 1 stud deep, so for a street
front the piece box is ``x..x+2`` along i and the single row ``j`` along j.
"""

from __future__ import annotations

from ..catalogue import load_catalogue
from .bays import WINDOW_W
from .painter import Painter
from .spec import HouseSpec

# Rooms seen through glass: mostly dark, sometimes curtains, now and then a lit lamp
# shade, chosen by position so every house looks different but the result is stable.
BACKDROPS = ("black", "black", "dark_grey", "cream", "black", "dark_tan", "black", "sand_blue")


def piece_h(name: str) -> int:
    """Height of a catalogue piece in plates."""
    return load_catalogue()[name].h


def backdrop(x: int, k: int, fid: int) -> str:
    return BACKDROPS[(x * 7 + k * 3 + fid * 5) % len(BACKDROPS)]


def window(cv: Painter, h: HouseSpec, x: int, k: int, piece: str = "window_1x2x3") -> int:
    """Window piece in the wall plane at bay ``x``, bottom at ``k``; returns its top k."""
    top = k + piece_h(piece)
    cv.clear(x, x + WINDOW_W, h.wall_j, h.wall_j + 1, k, top)
    cv.place(piece, x, h.wall_j, k, "S", h.trim, h.fid)
    cv.fill(x, x + WINDOW_W, h.glass_j, h.glass_j + 1, k, top, backdrop(x, k, h.fid), h.fid)
    return top


def door(cv: Painter, h: HouseSpec, x: int, k: int) -> int:
    """Panelled door (accent colour) in the wall plane; returns its top k."""
    top = k + piece_h("door_1x2x4")
    cv.clear(x, x + WINDOW_W, h.wall_j, h.wall_j + 1, k, top)
    cv.place("door_1x2x4", x, h.wall_j, k, "S", h.accent, h.fid)
    cv.fill(x, x + WINDOW_W, h.glass_j, h.glass_j + 1, k, top, "dark_grey", h.fid)
    return top


def arch_over(cv: Painter, h: HouseSpec, x: int, k: int) -> int:
    """``arch_1x4`` centred over the 2-wide opening at ``x`` (it spans ``x-1..x+3``).

    The arch's hole looks into the house, so a light glass fanlight fills the row behind
    it. Returns the top k of the arch.
    """
    top = k + piece_h("arch_1x4")
    cv.clear(x - 1, x + WINDOW_W + 1, h.wall_j, h.wall_j + 1, k, top)
    cv.place("arch_1x4", x - 1, h.wall_j, k, "S", h.trim, h.fid)
    cv.fill(x, x + WINDOW_W, h.glass_j, h.glass_j + 1, k, top, "glass_light", h.fid)
    return top


def sloped_sill(cv: Painter, h: HouseSpec, x: int, k_window: int) -> None:
    """Two ``slope30_1x2`` under a window: high back in the wall plane, low lip at ``y0``."""
    k = k_window - piece_h("slope30_1x2")
    cv.clear(x, x + WINDOW_W, h.y0, h.wall_j + 1, k, k_window)
    for i in range(x, x + WINDOW_W):
        cv.place("slope30_1x2", i, h.y0, k, "S", h.trim, h.fid)


def flower_box(cv: Painter, h: HouseSpec, x: int, k_window: int, flowers: str) -> None:
    """Brown window box at ``y0`` with round-tile flowers between leaf plates."""
    cv.fill(x, x + WINDOW_W, h.y0, h.wall_j, k_window - 1, k_window + 1, "brick_brown", h.fid)
    for n, i in enumerate(range(x, x + WINDOW_W)):
        if n % 2:
            cv.place("round_tile_1x1", i, h.y0, k_window + 1, "S", flowers, h.fid)
        else:
            cv.fill(i, i + 1, h.y0, h.wall_j, k_window + 1, k_window + 2, "leaf", h.fid)


def fence_run(cv: Painter, i0: int, i1: int, j: int, k: int, colour: str, fid: int) -> None:
    """Balustrade from ``i0`` to ``i1`` along +i: a post at each end, as many ``fence_1x4``
    as fit in between, and left-over studs as extra posts between the fences."""
    h = piece_h("fence_1x4")
    inner = i1 - i0 - 2
    n = max(0, inner // 4)
    spare = inner - 4 * n
    between = [0] * max(0, n - 1)
    for g in range(min(spare, len(between))):
        between[g] += 1
    spare -= sum(between)
    i = i0
    posts = [1 + spare // 2] + between + [1 + spare - spare // 2]  # widths of the post runs
    for m, width in enumerate(posts):
        cv.fill(i, i + width, j, j + 1, k, k + h, colour, fid)
        i += width
        if m < n:
            cv.place("fence_1x4", i, j, k, "S", colour, fid)
            i += 4
