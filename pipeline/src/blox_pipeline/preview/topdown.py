"""Top-down orthographic world preview: one pixel per stud, hillshaded, studs hinted."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import numpy as np
from numpy.typing import NDArray
from PIL import Image

from ..catalogue import Catalogue, load_catalogue
from ..io.chunk_reader import read_manifest, read_world_records
from ..io.island_reader import read_world_islands
from ..layout.records import CHUNK, Records
from ..palette import load_palette
from .cells import footprint_cells

BACKGROUND = np.array([24, 27, 32], np.float32)
STUD_M, PLATE_M = 0.5, 0.2


@dataclass
class Tops:
    top: NDArray[np.int64]  # [J, I] exclusive top K, -1 = empty
    color: NDArray[np.uint8]
    stud: NDArray[np.bool_]


def column_tops(rec: Records, I0: int, J0: int, ni: int, nj: int, cat: Catalogue | None = None,
                into: Tops | None = None) -> Tops:
    """Topmost brick per stud column over the window ``[I0, I0+ni) x [J0, J0+nj)``."""
    cat = cat or load_catalogue()
    out = into or Tops(np.full((nj, ni), -1, np.int64), np.zeros((nj, ni), np.uint8), np.zeros((nj, ni), bool))
    if len(rec) == 0:
        return out
    c = footprint_cells(rec, cat)
    return _merge(out, c.I - I0, c.J - J0, c.top, c.color, c.stud, ni, nj)


def island_column_tops(rec: Records, origin: tuple[float, float], yaw_deg: float, I0: int, J0: int,
                       ni: int, nj: int, cat: Catalogue | None = None, into: Tops | None = None) -> Tops:
    """Like :func:`column_tops` for an island: each local footprint cell is turned into the
    world by the island pose (CONTRACT 5.1) and drawn into the world columns it covers.
    A turned cell is sampled at 4 points (its quarter centres) so the rotated grid leaves no
    holes in the world raster."""
    from ..islands.pose import island_local_to_world

    cat = cat or load_catalogue()
    out = into or Tops(np.full((nj, ni), -1, np.int64), np.zeros((nj, ni), np.uint8), np.zeros((nj, ni), bool))
    if len(rec) == 0:
        return out
    c = footprint_cells(rec, cat)
    xs, ys = [], []
    for du, dv in ((0.25, 0.25), (0.75, 0.25), (0.25, 0.75), (0.75, 0.75)):
        x, z = island_local_to_world(origin, yaw_deg, (c.I + du) * STUD_M, (c.J + dv) * STUD_M)
        xs.append(np.floor(np.asarray(x) / STUD_M).astype(np.int64) - I0)
        ys.append(np.floor(np.asarray(z) / STUD_M).astype(np.int64) - J0)
    rep = lambda a: np.concatenate([a] * 4)  # noqa: E731
    return _merge(out, np.concatenate(xs), np.concatenate(ys), rep(c.top), rep(c.color), rep(c.stud), ni, nj)


def _merge(out: Tops, x: NDArray[np.int64], y: NDArray[np.int64], top: NDArray[np.int64], col: NDArray[np.uint8],
           stud: NDArray[np.bool_], ni: int, nj: int) -> Tops:
    """Keep the highest top per column of ``out`` (window-relative ``x, y``)."""
    ok = (x >= 0) & (x < ni) & (y >= 0) & (y < nj)
    x, y, top, col, stud = x[ok], y[ok], top[ok], col[ok], stud[ok]
    flat = y * ni + x
    order = np.lexsort((top, flat))
    flat, top, col, stud = flat[order], top[order], col[order], stud[order]
    last = np.r_[flat[1:] != flat[:-1], True]
    flat, top, col, stud = flat[last], top[last], col[last], stud[last]
    cur = out.top.reshape(-1)
    better = top > cur[flat]
    cur[flat[better]] = top[better]
    out.color.reshape(-1)[flat[better]] = col[better]
    out.stud.reshape(-1)[flat[better]] = stud[better]
    return out


def hillshade(top: NDArray[np.int64], azimuth_deg: float = 315.0, altitude_deg: float = 45.0) -> NDArray[np.float32]:
    """Lambert shade in [0, 1] of the height field (rows = north at index 0 already flipped)."""
    filled = top >= 0
    floor = top[filled].min() if filled.any() else 0
    z = np.where(filled, top, floor).astype(np.float32) * PLATE_M
    gy, gx = np.gradient(z, STUD_M)
    az, alt = np.radians(azimuth_deg), np.radians(altitude_deg)
    # image rows run north -> south, so the row gradient points south
    lx, ly, lz = np.sin(az) * np.cos(alt), np.cos(az) * np.cos(alt), np.sin(alt)
    nx, ny, nz = -gx, gy, np.ones_like(z)
    norm = np.sqrt(nx * nx + ny * ny + nz * nz)
    return np.clip((nx * lx + ny * ly + nz * lz) / norm, 0.0, 1.0).astype(np.float32)


def tops_to_image(t: Tops, rgb_table: NDArray[np.uint8], px_per_stud: int) -> Image.Image:
    """North-up RGB image of the column tops."""
    top, col, stud = t.top[::-1], t.color[::-1], t.stud[::-1]
    shade = hillshade(top)
    base = rgb_table[col].astype(np.float32) * (0.45 + 0.75 * shade)[..., None]
    img = np.where((top >= 0)[..., None], base, BACKGROUND)
    if px_per_stud > 1:
        img = np.repeat(np.repeat(img, px_per_stud, 0), px_per_stud, 1)
        if px_per_stud >= 3:
            p = px_per_stud
            yy, xx = np.mgrid[0:p, 0:p]
            r = (p - 1) / 2.0
            dot = ((yy - r) ** 2 + (xx - r) ** 2) <= (0.32 * p) ** 2
            mask = np.tile(dot, stud.shape) & np.repeat(np.repeat(stud & (top >= 0), p, 0), p, 1)
            img = np.where(mask[..., None], np.minimum(img * 1.18 + 10, 255), img)
            edge = np.zeros((p, p), bool)
            edge[-1, :] = edge[:, -1] = True
            img = np.where(np.tile(edge, stud.shape)[..., None], img * 0.88, img)
    return Image.fromarray(np.clip(img, 0, 255).astype(np.uint8), "RGB")


def render_preview(out_dir: Path | str, *, out_name: str = "preview.png", max_px: int = 4096,
                   px_per_stud: int | None = None) -> Path:
    """Render ``preview.png`` of a world dir (cropped to the chunks present), islands
    (CONTRACT 5.1) drawn turned into place on top of the chunks.

    ``px_per_stud``: default 4 (with stud hints) for small worlds, else 1; the image is
    box-downscaled when its longer side exceeds ``max_px``.
    """
    world = Path(out_dir)
    cat = load_catalogue()
    rgb = load_palette().rgb_table()
    chunks = read_manifest(world)["chunks"] + read_manifest(world).get("islands", [])
    path = world / out_name
    if not chunks:
        Image.new("RGB", (64, 64), tuple(int(v) for v in BACKGROUND)).save(path)
        return path
    cx0, cx1 = min(c["cx"] for c in chunks), max(c["cx"] for c in chunks)
    cy0, cy1 = min(c["cy"] for c in chunks), max(c["cy"] for c in chunks)
    ni, nj = (cx1 - cx0 + 1) * CHUNK, (cy1 - cy0 + 1) * CHUNK
    tops = Tops(np.full((nj, ni), -1, np.int64), np.zeros((nj, ni), np.uint8), np.zeros((nj, ni), bool))
    for _, data in read_world_records(world):
        column_tops(data.records, cx0 * CHUNK, cy0 * CHUNK, ni, nj, cat, into=tops)
    for _, isl in read_world_islands(world):
        island_column_tops(isl.records, isl.origin, isl.yaw_deg, cx0 * CHUNK, cy0 * CHUNK, ni, nj, cat, into=tops)
    pps = px_per_stud or (4 if max(ni, nj) <= 512 else 1)
    img = tops_to_image(tops, rgb, pps)
    if max(img.size) > max_px:
        f = max_px / max(img.size)
        img = img.resize((max(1, round(img.size[0] * f)), max(1, round(img.size[1] * f))), Image.Resampling.BOX)
    img.save(path)
    return path
