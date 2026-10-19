"""Street furniture that makes a square feel inhabited.

Round details (flower heads, bollard caps) are placed ``round_tile_1x1`` pieces; a round
tile has no front, so its facing is irrelevant and we just say ``N``.
"""

from __future__ import annotations

from .painter import Painter


def cafe_table(cv: Painter, i: int, j: int, g: int, canopy: str, fid: int = 0) -> None:
    """Parasol over a 3x3 table with four chairs; (i, j) is the pole cell."""
    cv.fill(i - 1, i + 2, j - 1, j + 2, g + 3, g + 4, "white", fid)            # table top
    for di, dj in ((-2, 0), (2, 0), (0, -2), (0, 2)):
        cv.fill(i + di, i + di + 1, j + dj, j + dj + 1, g, g + 2, "dark_tan", fid)  # chairs
    cv.fill(i, i + 1, j, j + 1, g, g + 13, "black", fid)                     # pole
    cv.fill(i - 2, i + 3, j - 2, j + 3, g + 12, g + 13, canopy, fid)          # canopy
    cv.fill(i - 1, i + 2, j - 1, j + 2, g + 13, g + 14, canopy, fid)
    cv.fill(i, i + 1, j, j + 1, g + 14, g + 15, "white", fid)


def planter(cv: Painter, i: int, j: int, g: int, flower: str, fid: int = 0) -> None:
    """2x2 stone planter with a flowering shrub."""
    cv.fill(i, i + 2, j, j + 2, g, g + 3, "mergel_dark", fid)
    cv.fill(i, i + 2, j, j + 2, g + 3, g + 6, "leaf", fid)
    cv.place("round_tile_1x1", i, j + 1, g + 6, "N", flower, fid)
    cv.place("round_tile_1x1", i + 1, j, g + 6, "N", flower, fid)


def bench(cv: Painter, i: int, j: int, g: int, length: int = 4, fid: int = 0) -> None:
    """Bench along +i with its back on the +j side."""
    cv.fill(i, i + 1, j, j + 1, g, g + 2, "black", fid)
    cv.fill(i + length - 1, i + length, j, j + 1, g, g + 2, "black", fid)
    cv.fill(i, i + length, j, j + 1, g + 2, g + 3, "brick_brown", fid)
    cv.fill(i, i + length, j + 1, j + 2, g + 2, g + 5, "brick_brown", fid)


def bollard(cv: Painter, i: int, j: int, g: int, fid: int = 0) -> None:
    cv.fill(i, i + 1, j, j + 1, g, g + 4, "dark_grey", fid)
    cv.place("round_tile_1x1", i, j, g + 4, "N", "gold", fid)


def street_lamp(cv: Painter, i: int, j: int, g: int, fid: int = 0) -> None:
    """Black post, warm lantern, black cap with a round tile on top."""
    cv.fill(i, i + 1, j, j + 1, g, g + 14, "black", fid)
    cv.fill(i, i + 1, j, j + 1, g + 14, g + 16, "lamp_warm", fid)
    cv.fill(i, i + 1, j, j + 1, g + 16, g + 17, "black", fid)
    cv.place("round_tile_1x1", i, j, g + 17, "N", "black", fid)
