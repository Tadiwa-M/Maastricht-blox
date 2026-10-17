"""Shared synthetic voxel tiles for the layout tests (no tests in here)."""

from __future__ import annotations

import numpy as np

from blox_pipeline.palette import load_palette

PAL = load_palette()
SOLIDS = [PAL.idx(n) for n in ("mergel", "brick_red", "white", "slate", "lamp_warm")]
SEE = [PAL.idx("glass"), PAL.idx("water")]


def empty(nx: int, ny: int, nz: int):
    return (np.zeros((nx, ny, nz), np.uint8), np.zeros((nx, ny, nz), np.uint32),
            np.zeros((nx, ny, nz), np.uint8))


def random_tile(seed: int, nx: int = 24, ny: int = 22, nz: int = 18):
    """Noise: random colours, features and every shape code, including broken slope runs."""
    rng = np.random.default_rng(seed)
    c = rng.choice([0, 0, 0] + SOLIDS + SEE, size=(nx, ny, nz)).astype(np.uint8)
    f = rng.choice([0, 0, 7, 70000], size=c.shape).astype(np.uint32)
    s = rng.choice(np.arange(9), size=c.shape, p=[0.6] + [0.05] * 8).astype(np.uint8)
    # some proper 3-high slope stacks with full back cells
    for _ in range(40):
        i, j = rng.integers(1, nx - 1), rng.integers(1, ny - 1)
        k = int(rng.integers(0, nz // 3)) * 3
        sh = int(rng.integers(1, 7))
        col, fid = rng.choice(SOLIDS), rng.choice([0, 7])
        c[i, j, k : k + 3], f[i, j, k : k + 3], s[i, j, k : k + 3] = col, fid, sh
    s[c == 0] = 0
    f[c == 0] = 0
    return c, f, s


def gable_house(c, f, s, x0, x1, y0, y1, k_wall, top, wall, roof, fid, ridge_axis="j", k_ground=0):
    """Hollow box house with a stepped gable roof (slopes + 2-thick roof + ridge)."""
    c[x0:x1, y0:y1, k_ground:top] = wall
    f[x0:x1, y0:y1, k_ground:top] = fid
    c[x0 + 1 : x1 - 1, y0 + 1 : y1 - 1, k_ground + 1 : top] = 0
    f[x0 + 1 : x1 - 1, y0 + 1 : y1 - 1, k_ground + 1 : top] = 0
    lo, hi = (x0, x1) if ridge_axis == "j" else (y0, y1)
    t = 0
    while hi - lo - 2 * t >= 1:
        a, b, kb = lo + t, hi - 1 - t, top + 3 * t
        ks = slice(kb, kb + 3)

        def put(p0, p1, shape, colour=roof):
            if ridge_axis == "j":
                sl = (slice(p0, p1), slice(y0, y1), ks)
            else:
                sl = (slice(x0, x1), slice(p0, p1), ks)
            c[sl], f[sl], s[sl] = colour, fid, shape

        if b - a + 1 <= 2:
            put(a, b + 1, 6 if ridge_axis == "j" else 5)
            break
        put(a, a + 1, 4 if ridge_axis == "j" else 3)
        put(b, b + 1, 2 if ridge_axis == "j" else 1)
        put(a + 1, a + 2, 0)
        put(b - 1, b, 0)
        t += 1
    return c, f, s
