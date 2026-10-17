"""AHN 0.5 m DTM/DSM via the PDOK WCS: download blocks, mosaic onto the stud grid.

Fallback: GeoTIFF tiles downloaded by hand into ``<data>/ahn/tiles/<kind>/`` (see
:mod:`.ahn_tiles`). When such tiles cover the bbox, the WCS is not contacted at all.
"""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Iterable, Literal

import numpy as np
import rasterio
from rasterio.fill import fillnodata

from .. import geo
from ..geo import RDBox
from . import ahn_tiles, config
from .http import TIFF_MAGIC, download, expect_magic, make_session
from .model import HeightGrid

log = logging.getLogger(__name__)

Kind = Literal["dtm", "dsm"]


def block_path(kind: Kind, block: RDBox, root: Path | None = None) -> Path:
    base = (root or config.data_dir()) / "ahn" / config.AHN_COVERAGE[kind]
    return base / f"{int(block.xmin)}_{int(block.ymin)}_{int(block.xmax - block.xmin)}.tif"


def wcs_params(kind: Kind, block: RDBox) -> list[tuple[str, str]]:
    ax, ay = config.AHN_SUBSET_AXES
    return [
        ("SERVICE", "WCS"),
        ("VERSION", "2.0.1"),
        ("REQUEST", "GetCoverage"),
        ("COVERAGEID", config.AHN_COVERAGE[kind]),
        ("FORMAT", "image/tiff"),
        ("SUBSET", f"{ax}({block.xmin:.1f},{block.xmax:.1f})"),
        ("SUBSET", f"{ay}({block.ymin:.1f},{block.ymax:.1f})"),
    ]


def fetch_ahn(kind: Kind, bbox: RDBox, root: Path | None = None) -> list[Path]:
    """Download all WCS blocks covering ``bbox`` (cached, idempotent). Skipped when local
    tiles in ``ahn/tiles/<kind>/`` already cover the whole bbox."""
    tiles = ahn_tiles.local_tiles(kind, root)
    if tiles and ahn_tiles.covered_fraction(tiles, bbox) >= 0.999:
        log.info("AHN %s: using %d local tiles in %s", kind, len(tiles), ahn_tiles.tiles_dir(kind, root))
        return tiles
    sess = make_session()
    paths = []
    for block in geo.iter_blocks(bbox, config.AHN_BLOCK_M):
        dest = block_path(kind, block, root)
        if not dest.exists():
            log.info("AHN %s block %s", kind, block.as_tuple())
        download(config.AHN_WCS_URL, dest, params=wcs_params(kind, block), session=sess,
                 validate=expect_magic(*TIFF_MAGIC))
        paths.append(dest)
    return paths


def mosaic(paths: Iterable[Path], bbox: RDBox) -> HeightGrid:
    """Read GeoTIFFs (0.5 m pixels aligned to the RD half-metre grid) into a HeightGrid
    covering ``bbox``. Missing/no-data cells are NaN."""
    box = geo.rd_box_to_cells(bbox)
    out = np.full((box.ni, box.nj), np.nan, dtype=np.float32)
    for path in paths:
        with rasterio.open(path) as src:
            t = src.transform
            if abs(t.a - geo.STUD_M) > 1e-6 or abs(t.e + geo.STUD_M) > 1e-6:
                raise ValueError(f"{path}: expected 0.5 m north-up pixels, got {t}")
            arr = src.read(1, masked=False).astype(np.float32)
            nodata = src.nodata
        if nodata is not None:
            arr[arr == np.float32(nodata)] = np.nan
        arr[np.abs(arr) > 1e6] = np.nan
        # pixel (r, c) centre -> cell (I, J)
        i_first, j_top = geo.rd_to_grid(t.c + 0.25, t.f - 0.25)
        cells = arr.T[:, ::-1]  # -> [i, j] with j increasing northwards
        j_first = j_top - (cells.shape[1] - 1)
        _paste(out, box, cells, i_first, j_first)
    return HeightGrid(box.i0, box.j0, out)


def _paste(out: np.ndarray, box: geo.CellBox, cells: np.ndarray, i_first: int, j_first: int) -> None:
    a0, b0 = max(box.i0, i_first), max(box.j0, j_first)
    a1 = min(box.i1, i_first + cells.shape[0])
    b1 = min(box.j1, j_first + cells.shape[1])
    if a0 >= a1 or b0 >= b1:
        return
    src = cells[a0 - i_first : a1 - i_first, b0 - j_first : b1 - j_first]
    dst = out[a0 - box.i0 : a1 - box.i0, b0 - box.j0 : b1 - box.j0]
    take = ~np.isnan(src)
    dst[take] = src[take]


def fill_gaps(grid: HeightGrid, max_search_cells: int = 600) -> HeightGrid:
    """Inverse-distance fill of NaN holes (DTM is empty under buildings and water)."""
    vals = grid.values
    valid = ~np.isnan(vals)
    if valid.all() or not valid.any():
        return grid
    filled = fillnodata(np.where(valid, vals, 0).astype(np.float32), mask=valid.astype(np.uint8),
                        max_search_distance=float(max_search_cells), smoothing_iterations=0)
    filled = np.where(valid, vals, filled).astype(np.float32)
    still = ~valid & (filled == 0)
    if still.any():  # beyond search distance: use the median of valid data
        filled[still] = float(np.nanmedian(vals))
    return HeightGrid(grid.I0, grid.J0, filled)


def load_ahn(kind: Kind, bbox: RDBox, root: Path | None = None, fill: bool = True) -> HeightGrid:
    """Mosaic cached WCS blocks for ``bbox`` (run :func:`fetch_ahn` first), else local tiles."""
    paths = [block_path(kind, b, root) for b in geo.iter_blocks(bbox, config.AHN_BLOCK_M)]
    missing = [p for p in paths if not p.exists()]
    if not missing:
        grid = mosaic(paths, bbox)
        return fill_gaps(grid) if fill else grid
    tiles = ahn_tiles.local_tiles(kind, root)
    if not tiles:
        raise FileNotFoundError(
            f"{len(missing)} AHN {kind} blocks missing (e.g. {missing[0]}): run 'blox fetch', or put "
            f"0.5 m AHN GeoTIFF tiles in {ahn_tiles.tiles_dir(kind, root)}")
    grid, covered = ahn_tiles.mosaic_tiles(tiles, bbox)
    if covered < 0.999:
        raise FileNotFoundError(f"local AHN {kind} tiles in {ahn_tiles.tiles_dir(kind, root)} cover only "
                                f"{covered:.0%} of the bbox")
    return fill_gaps(grid) if fill else grid
