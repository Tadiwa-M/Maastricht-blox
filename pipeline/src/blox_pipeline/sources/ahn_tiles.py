"""AHN fallback: user-downloaded 0.5 m GeoTIFF tiles (AHN dataroom / basisdata.nl AHN5/AHN6
sheets, or PDOK AHN4 ATOM tiles) dropped into ``<data>/ahn/tiles/<dtm|dsm>/``.

docs/DATA_SOURCES.md reports that the PDOK WCS route may no longer serve AHN; the current
distribution is large GeoTIFF sheets (an AHN5 sheet is 5 x 6.25 km). Those are read with
windowed reads, so only the part over the slice is loaded into memory.
"""

from __future__ import annotations

from pathlib import Path

import numpy as np
import rasterio
from rasterio.windows import Window, from_bounds

from .. import geo
from ..geo import RDBox
from . import config
from .model import HeightGrid

TILE_SUFFIXES = (".tif", ".tiff", ".TIF", ".TIFF")


def tiles_dir(kind: str, root: Path | None = None) -> Path:
    return (root or config.data_dir()) / "ahn" / "tiles" / kind


def local_tiles(kind: str, root: Path | None = None) -> list[Path]:
    d = tiles_dir(kind, root)
    if not d.is_dir():
        return []
    return sorted(p for p in d.iterdir() if p.suffix in TILE_SUFFIXES and p.is_file())


def _overlaps(bounds, bbox: RDBox) -> bool:
    return bounds.left < bbox.xmax and bounds.right > bbox.xmin and bounds.bottom < bbox.ymax and bounds.top > bbox.ymin


def mosaic_tiles(paths: list[Path], bbox: RDBox) -> tuple[HeightGrid, float]:
    """Windowed mosaic of arbitrary-size 0.5 m RD tiles onto the stud grid over ``bbox``.

    Returns the grid (NaN where no tile has data) and the covered fraction of ``bbox``.
    """
    box = geo.rd_box_to_cells(bbox)
    out = np.full((box.ni, box.nj), np.nan, dtype=np.float32)
    for path in paths:
        with rasterio.open(path) as src:
            t = src.transform
            if abs(t.a - geo.STUD_M) > 1e-6 or abs(t.e + geo.STUD_M) > 1e-6:
                raise ValueError(f"{path}: expected 0.5 m north-up pixels, got {t}")
            if not _overlaps(src.bounds, bbox):
                continue
            win = from_bounds(max(bbox.xmin, src.bounds.left), max(bbox.ymin, src.bounds.bottom),
                              min(bbox.xmax, src.bounds.right), min(bbox.ymax, src.bounds.top), t)
            win = Window(int(round(win.col_off)), int(round(win.row_off)), int(round(win.width)), int(round(win.height)))
            if win.width <= 0 or win.height <= 0:
                continue
            arr = src.read(1, window=win).astype(np.float32)
            nodata = src.nodata
            wt = src.window_transform(win)
        if nodata is not None:
            arr[arr == np.float32(nodata)] = np.nan
        arr[np.abs(arr) > 1e6] = np.nan
        i_first, j_top = geo.rd_to_grid(wt.c + 0.25, wt.f - 0.25)
        cells = arr.T[:, ::-1]
        j_first = j_top - (cells.shape[1] - 1)
        a0, b0 = max(box.i0, i_first), max(box.j0, j_first)
        a1, b1 = min(box.i1, i_first + cells.shape[0]), min(box.j1, j_first + cells.shape[1])
        if a0 >= a1 or b0 >= b1:
            continue
        s = cells[a0 - i_first : a1 - i_first, b0 - j_first : b1 - j_first]
        dst = out[a0 - box.i0 : a1 - box.i0, b0 - box.j0 : b1 - box.j0]
        take = ~np.isnan(s) & np.isnan(dst)
        dst[take] = s[take]
    covered = covered_fraction(paths, bbox)
    return HeightGrid(box.i0, box.j0, out), covered


def covered_fraction(paths: list[Path], bbox: RDBox) -> float:
    """Fraction of ``bbox`` inside at least one tile's extent (data holes not counted)."""
    box = geo.rd_box_to_cells(bbox)
    m = np.zeros((box.ni, box.nj), bool)
    for path in paths:
        with rasterio.open(path) as src:
            b = src.bounds
        x0, y0 = max(b.left, bbox.xmin), max(b.bottom, bbox.ymin)
        x1, y1 = min(b.right, bbox.xmax), min(b.top, bbox.ymax)
        if x0 >= x1 or y0 >= y1:
            continue
        i0, j0 = geo.rd_to_grid(x0, y0)
        i1, j1 = geo.rd_to_grid(x1 - 1e-6, y1 - 1e-6)
        m[max(i0 - box.i0, 0) : i1 - box.i0 + 1, max(j0 - box.j0, 0) : j1 - box.j0 + 1] = True
    return float(m.mean()) if m.size else 0.0
