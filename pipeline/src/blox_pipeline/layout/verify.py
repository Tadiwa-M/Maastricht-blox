"""Independent checker: rasterise records back into cells and compare with the input.

Voxel-derived records must reproduce the grid exactly. Placed pieces (``placed=``) are
checked separately: present unchanged in the output, on air cells, inside the emit
region, not overlapping anything. The ``hide_studs`` bit is recomputed from the raster.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
from numpy.typing import NDArray

from ..catalogue import Catalogue, load_catalogue
from ..palette import Palette, load_palette
from ..rotation import front_dir
from .placed import as_records, placed_problems
from .records import CHUNK, FLAG_HIDE_STUDS, Records
from .studs import hidden_studs
from .tile import TILE, WATER, auto_border, emit_mask, keep_mask, water_colours

KIND_CODE = {"brick": 1, "plate": 1, "round": 1, "tile": 2, "slope": 3, "slope_double": 4}
DETAIL_CODE = 5  # any v2 detail kind (arch, window, ...): only valid as a placed piece
FRONT_SHAPE = {0: 1, 1: 2, 2: 3, 3: 4}  # slope rot -> shape code of its sloped cells
MATCH_FIELDS = ("I", "J", "K", "type", "rot", "color", "featureId")


@dataclass
class Raster:
    color: NDArray[np.uint8]
    feature: NDArray[np.uint32]
    count: NDArray[np.uint16]  # bricks covering each cell (must be <= 1)
    kind: NDArray[np.uint8]  # KIND_CODE of the covering brick, 0 = empty
    index: NDArray[np.int32]  # covering record index, -1 = empty
    outside: list[int]  # records (partly) outside the raster window


def rasterise_records(
    rec: Records, I0: int, J0: int, k0: int, dims: tuple[int, int, int],
    catalogue: Catalogue | None = None,
) -> Raster:
    """Fill each record's rotated box into a window ``[I0.., J0.., k0..]`` of ``dims``."""
    cat = catalogue or load_catalogue()
    ei, ej, eh = cat.extent_tables()
    kinds = np.zeros(256, np.uint8)
    for t in cat.types:
        kinds[t.id] = KIND_CODE.get(t.kind, DETAIL_CODE)
    r = Raster(np.zeros(dims, np.uint8), np.zeros(dims, np.uint32), np.zeros(dims, np.uint16),
               np.zeros(dims, np.uint8), np.full(dims, -1, np.int32), [])
    for n, x in enumerate(rec):
        t, rot = int(x["type"]), int(x["rot"]) & 3
        a, b, c = int(x["I"]) - I0, int(x["J"]) - J0, int(x["K"]) - k0
        sa, sb, sc = ei[t, rot], ej[t, rot], eh[t]
        if sa == 0 or a < 0 or b < 0 or c < 0 or a + sa > dims[0] or b + sb > dims[1] or c + sc > dims[2]:
            r.outside.append(n)
            continue
        box = (slice(a, a + sa), slice(b, b + sb), slice(c, c + sc))
        r.count[box] += 1
        r.color[box] = x["color"]
        r.feature[box] = x["featureId"]
        r.kind[box] = kinds[t]
        r.index[box] = n
    return r


def _crosses_chunk(rec: Records, cat: Catalogue) -> NDArray[np.bool_]:
    ei, ej, _ = cat.extent_tables()
    t, rot = rec["type"].astype(np.int64), rec["rot"].astype(np.int64) & 3
    i0, j0 = rec["I"].astype(np.int64), rec["J"].astype(np.int64)
    return (i0 // CHUNK != (i0 + ei[t, rot] - 1) // CHUNK) | (j0 // CHUNK != (j0 + ej[t, rot] - 1) // CHUNK)


def _edge(box: NDArray, step: tuple[int, int]) -> NDArray:
    """The row of a ``[i, j, k]`` box on the side ``step`` points to."""
    di, dj = step
    if di:
        return box[-1] if di > 0 else box[0]
    return box[:, -1] if dj > 0 else box[:, 0]


def split_placed(rec: Records, placed: Records) -> tuple[Records, Records, int]:
    """``(voxel records, placed records found, number of placed pieces missing)``."""
    if len(placed) == 0:
        return rec, rec[:0], 0
    want = {tuple(int(p[f]) for f in MATCH_FIELDS) for p in placed}
    hit = np.array([tuple(int(x[f]) for f in MATCH_FIELDS) in want for x in rec], bool)
    return rec[~hit], rec[hit], len(want) - int(hit.sum())


def _slope_fronts_ok(rec: Records, r: Raster, shape, I0: int, J0: int, k0: int, cat: Catalogue) -> list[str]:
    errs = []
    ei, ej, eh = cat.extent_tables()
    for n in np.flatnonzero(np.isin(rec["type"], [t.id for t in cat.of_kind("slope")])):
        x = rec[n]
        t, rot = int(x["type"]), int(x["rot"])
        a, b, c = int(x["I"]) - I0, int(x["J"]) - J0, int(x["K"]) - k0
        box = shape[a : a + ei[t, rot], b : b + ej[t, rot], c : c + eh[t]]
        front, back = _edge(box, front_dir(rot)), _edge(box, front_dir((rot + 2) % 4))
        if not np.all(front == FRONT_SHAPE[rot]):
            errs.append(f"slope record {n} front row is not shape {FRONT_SHAPE[rot]}")
        if not np.all((back == FRONT_SHAPE[rot]) | (back == 0)):
            errs.append(f"slope record {n} back row covers foreign shapes")
    return errs


def verify_layout(
    color, feature, shape, rec: Records, k0: int, I0: int, J0: int, *,
    border: int | None = None, catalogue: Catalogue | None = None, palette: Palette | None = None,
    placed: Records | list[Records] | None = None,
) -> list[str]:
    """Return a list of problems (empty = the layout reproduces the tile exactly)."""
    cat = catalogue or load_catalogue()
    pal = palette or load_palette()
    dims = color.shape
    b = auto_border(dims, I0, J0) if border is None else border
    emit = emit_mask(dims, k0, I0, J0, b)
    keep = keep_mask(color, shape, emit, pal)
    errs: list[str] = []
    all_rec = rec
    rec, found, missing = split_placed(rec, as_records(placed))
    if missing:
        errs.append(f"{missing} placed pieces missing from the output")
    p_errs, p_occ = placed_problems(found, color, emit, I0, J0, k0, cat)
    errs += p_errs
    r = rasterise_records(rec, I0, J0, k0, dims, cat)
    if (p_occ & (r.count > 0)).any():
        errs.append(f"{int((p_occ & (r.count > 0)).sum())} placed cells also covered by voxel bricks")
    if (r.kind == DETAIL_CODE).any():
        errs.append("detail pieces in the output that were not placed")
    if r.outside:
        errs.append(f"{len(r.outside)} records outside the tile, e.g. #{r.outside[0]}")
    if (crossing := _crosses_chunk(rec, cat)).any():
        errs.append(f"{int(crossing.sum())} records cross a chunk border")
    if (r.count > 1).any():
        errs.append(f"{int((r.count > 1).sum())} cells covered more than once")
    cov = r.count > 0
    if (cov & ~emit).any():
        errs.append(f"{int((cov & ~emit).sum())} covered cells outside the emit region")
    if (cov & (color == 0)).any():
        errs.append(f"{int((cov & (color == 0)).sum())} covered cells are air in the input")
    want_c = np.where(shape == WATER, water_colours(color, pal), color)
    bad_c = cov & (r.color != want_c)
    if bad_c.any():
        errs.append(f"{int(bad_c.sum())} cells with wrong colour")
    if (bad_f := cov & (r.feature != feature)).any():
        errs.append(f"{int(bad_f.sum())} cells with wrong featureId")
    if (gaps := keep & ~cov).any():
        errs.append(f"{int(gaps.sum())} exposed cells not covered (first {np.argwhere(gaps)[0].tolist()})")
    extra = cov & ~keep & (r.kind != 3)
    if extra.any():
        errs.append(f"{int(extra.sum())} hidden cells covered by non-slope bricks")
    tiles_in = (shape == TILE) | (shape == WATER)
    if (cov & (r.kind == 2) & ~tiles_in).any() or (cov & tiles_in & (r.kind != 2)).any():
        errs.append("tile records and tile/water cells do not match")
    ridge_in = cov & (r.kind == 4)
    if (ridge_in & ((shape < 1) | (shape > 6))).any():
        errs.append("ridge records cover non-sloped cells")
    errs += _slope_fronts_ok(rec, r, shape, I0, J0, k0, cat)
    interior = (color != 0) & (r.count == 0)
    want_hide = hidden_studs(all_rec, interior, I0, J0, k0, cat)
    has_hide = (all_rec["flags"] & FLAG_HIDE_STUDS) != 0
    if (want_hide != has_hide).any():
        errs.append(f"{int((want_hide != has_hide).sum())} records with a wrong hide_studs flag")
    return errs
