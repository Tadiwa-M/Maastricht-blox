"""River cruise boat: 7 x 30 studs (3.5 m x 15 m), 27 plates tall. Original design.

Forward is +j (bow at high j). The model's pivot sits on the waterline (k = 3), so a
mover that puts the pivot on the water surface floats the boat at the right depth.
Layers (k)::

    0..3    dark blue lower hull (below the waterline)
    3..9    white hull with a dark blue stripe at k 6; the bow narrows in two steps
    9       wooden deck (tiles)
    10..19  glass cabin: window_1x2x3 all round, white posts at the corners
    19      white cabin roof; a small wheelhouse (k 20..27) sits on its front end
    10..13  fences along the open aft and fore decks, and across the stern
"""

from __future__ import annotations

from .builder import ModelBuilder

W, L, H = 7, 30, 27
WATERLINE, STRIPE, DECK = 3, 6, 9
# Hull plan: (j0, j1, i0, i1) runs; the bow narrows in two steps.
HULL = ((0, 26, 0, W), (26, 28, 1, W - 1), (28, L, 2, W - 2))
CABIN = (1, 6, 6, 22)          # i0, i1, j0, j1 of the passenger cabin
CABIN_K = DECK + 1
CABIN_TOP = CABIN_K + 9        # window_1x2x3 is 9 plates


def build_boat() -> ModelBuilder:
    m = ModelBuilder("boat", (W, L, H), (W / 2, L / 2, float(WATERLINE)))
    _cabin(m)
    _wheelhouse(m)
    _rails(m)
    for j0, j1, i0, i1 in HULL:
        m.box(i0, i1, j0, j1, 0, WATERLINE, "dark_blue")
        m.box(i0, i1, j0, j1, STRIPE, STRIPE + 1, "dark_blue")
        m.box(i0, i1, j0, j1, WATERLINE, DECK, "white")
        m.box(i0, i1, j0, j1, DECK, DECK + 1, "dark_tan", top="tile")
    return m


def _cabin(m: ModelBuilder) -> None:
    i0, i1, j0, j1 = CABIN
    for j in range(j0 + 1, j1 - 2, 2):
        m.place("window_1x2x3", i0, j, CABIN_K, "W", "white")
        m.place("window_1x2x3", i1 - 1, j, CABIN_K, "E", "white")
    m.place("window_1x2x3", i0 + 1, j1 - 1, CABIN_K, "N", "white")   # front
    m.place("window_1x2x3", i0 + 1, j0, CABIN_K, "S", "white")       # back
    for j in (j0, j1 - 1):                                            # posts in the end walls
        for i in (i0, i0 + 3, i1 - 1):
            m.box(i, i + 1, j, j + 1, CABIN_K, CABIN_TOP, "white")
    m.box(i0, i1, j0, j1, CABIN_TOP, CABIN_TOP + 1, "white")          # roof


def _wheelhouse(m: ModelBuilder) -> None:
    j0, j1, k = CABIN[3] - 4, CABIN[3], CABIN_TOP + 1
    m.place("window_1x2x2", 2, j1 - 1, k, "N", "white")
    m.box(2, 5, j0, j1, k, k + 6, "white")
    m.box(2, 5, j0, j1, k + 6, k + 7, "dark_blue", top="tile")


def _rails(m: ModelBuilder) -> None:
    for j in (1, 22):                     # aft deck j 1..5, fore deck j 22..26
        m.place("fence_1x4", 0, j, CABIN_K, "W", "white")
        m.place("fence_1x4", W - 1, j, CABIN_K, "E", "white")
    m.place("fence_1x4", 1, 0, CABIN_K, "S", "white")              # stern rail
