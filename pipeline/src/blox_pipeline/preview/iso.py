"""Isometric (oblique, from the south-west) preview of one chunk for quick visual checks."""

from __future__ import annotations

from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

from ..catalogue import Catalogue, load_catalogue
from ..io.chunk_reader import read_chunk
from ..layout.records import Records
from ..palette import load_palette
from .cells import footprint_cells

PLATE_RATIO = 0.2 / 0.5  # plate height / stud pitch
FACE_SHADE = {"top": 1.0, "west": 0.78, "south": 0.62}


def _voxels(rec: Records, cat: Catalogue):
    """Dense ``[i, j, k]`` colour / slope / stud-top grids over the records' bounding box."""
    c = footprint_cells(rec, cat)
    i0, j0, k0 = int(c.I.min()), int(c.J.min()), int(c.K.min())
    dims = (int(c.I.max()) - i0 + 1, int(c.J.max()) - j0 + 1, int(c.top.max()) - k0)
    col = np.zeros(dims, np.uint8)
    slope = np.zeros(dims, bool)
    stud = np.zeros(dims, bool)
    h = c.top - c.K
    for dk in range(int(h.max())):
        m = dk < h
        idx = (c.I[m] - i0, c.J[m] - j0, c.K[m] - k0 + dk)
        col[idx] = c.color[m]
        slope[idx] = c.slope[m]
        last = m & (dk == h - 1)
        stud[c.I[last] - i0, c.J[last] - j0, c.top[last] - 1 - k0] = c.stud[last]
    return col, slope, stud


def render_chunk_iso(src: Path | str | Records, out_png: Path | str, *, scale: int = 6,
                     catalogue: Catalogue | None = None) -> Path:
    """Draw a chunk file (or a record array) as visible voxel faces, painter's order."""
    cat = catalogue or load_catalogue()
    rec = src if isinstance(src, np.ndarray) else read_chunk(src).records
    out = Path(out_png)
    if len(rec) == 0:
        Image.new("RGB", (64, 64), (24, 27, 32)).save(out)
        return out
    rgb = load_palette().rgb_table().astype(np.float32)
    see = load_palette().material_mask("trans", "glass")
    col, slope, stud = _voxels(rec, cat)
    ni, nj, nk = col.shape
    a, b, c = float(scale), scale / 2.0, scale * PLATE_RATIO * 1.2
    solid = col != 0
    pad = np.pad(solid, 1)
    open_top = ~pad[1:-1, 1:-1, 2:]
    open_w = ~pad[:-2, 1:-1, 1:-1]
    open_s = ~pad[1:-1, :-2, 1:-1]
    vis = solid & (open_top | open_w | open_s)
    ii, jj, kk = np.nonzero(vis)
    order = np.argsort(-(ii + jj - kk * PLATE_RATIO), kind="stable")
    W = int((ni + nj) * a) + 8
    H = int((ni + nj) * b + nk * c) + 8
    ox, oy = nj * a + 4, (ni + nj) * b + nk * c + 4

    def P(x: float, y: float, z: float) -> tuple[float, float]:
        return (ox + (x - y) * a, oy - (x + y) * b - z * c)

    img = Image.new("RGB", (W, H), (24, 27, 32))
    d = ImageDraw.Draw(img)
    for n in order:
        i, j, k = int(ii[n]), int(jj[n]), int(kk[n])
        base = rgb[col[i, j, k]]
        alpha = 0.7 if see[col[i, j, k]] else 1.0

        def fill(face: str) -> tuple[int, int, int]:
            v = base * FACE_SHADE[face] * (0.85 if slope[i, j, k] and face == "top" else 1.0)
            v = v * alpha + np.array([24, 27, 32]) * (1 - alpha)
            return tuple(int(x) for x in np.clip(v, 0, 255))

        if open_w[i, j, k]:
            d.polygon([P(i, j, k), P(i, j + 1, k), P(i, j + 1, k + 1), P(i, j, k + 1)], fill=fill("west"))
        if open_s[i, j, k]:
            d.polygon([P(i, j, k), P(i + 1, j, k), P(i + 1, j, k + 1), P(i, j, k + 1)], fill=fill("south"))
        if open_top[i, j, k]:
            top = fill("top")
            d.polygon([P(i, j, k + 1), P(i + 1, j, k + 1), P(i + 1, j + 1, k + 1), P(i, j + 1, k + 1)], fill=top)
            if stud[i, j, k] and scale >= 5:
                cx, cy = P(i + 0.5, j + 0.5, k + 1)
                r = scale * 0.3
                lite = tuple(min(255, int(v * 1.2 + 12)) for v in top)
                d.ellipse([cx - r, cy - r * 0.55 - c * 0.35, cx + r, cy + r * 0.55 - c * 0.35], fill=lite)
    img.save(out)
    return out


__all__ = ["render_chunk_iso"]
