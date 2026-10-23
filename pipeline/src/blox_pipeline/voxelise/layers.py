"""2.5D per-column layers for a region: terrain, water, bridge decks and buildings.

All ``*_k`` arrays hold global K levels; ``-1`` means "nothing" for that layer.
"""

from __future__ import annotations

from dataclasses import dataclass, fields

import numpy as np
from numpy.typing import NDArray
from shapely import box as shp_box

from .. import geo
from ..geo import CellBox
from . import palette
from .grid import FULL, RIDGE_I, RIDGE_J, SLOPE_E, SLOPE_N, SLOPE_S, SLOPE_W, SLOPE_STACK
from .prepare_buildings import roof_pitch_ok
from .raster import cover, sub
from .world import PreparedBuilding, PreparedWorld, SurfacePatch

NONE = -1
GROUND_CANDIDATES = ["grass", "grass_dark", "pavement", "soil", "asphalt", "cobble_grey", "dark_grey"]


@dataclass
class Layers:
    box: CellBox
    ground_k: NDArray[np.int32]
    ground_color: NDArray[np.uint8]
    ground_shape: NDArray[np.uint8]
    ground_feat: NDArray[np.uint32]
    water_k: NDArray[np.int32]
    water_color: NDArray[np.uint8]
    water_feat: NDArray[np.uint32]
    deck_k: NDArray[np.int32]
    deck_top: NDArray[np.uint8]
    deck_body: NDArray[np.uint8]
    deck_feat: NDArray[np.uint32]
    bld_top: NDArray[np.int32]
    bld_feat: NDArray[np.uint32]
    bld_wall: NDArray[np.uint8]
    bld_roof: NDArray[np.uint8]
    roof_shape: NDArray[np.uint8]
    win_period: NDArray[np.uint8]
    win_offset: NDArray[np.uint8]
    island_k: NDArray[np.int32]  # top K of an island building over this column (occupancy only)

    @classmethod
    def empty(cls, box: CellBox) -> "Layers":
        shp = (box.ni, box.nj)
        kw: dict = {}
        for f in fields(cls):
            if f.name == "box":
                continue
            if f.name.endswith("_k") or f.name == "bld_top":
                kw[f.name] = np.full(shp, NONE, np.int32)
            elif f.name.endswith("_feat"):
                kw[f.name] = np.zeros(shp, np.uint32)
            else:
                kw[f.name] = np.zeros(shp, np.uint8)
        return cls(box=box, **kw)

    def window(self, box: CellBox) -> "Layers":
        """View of a sub-box (must lie inside ``self.box``)."""
        if box.i0 < self.box.i0 or box.j0 < self.box.j0 or box.i1 > self.box.i1 or box.j1 > self.box.j1:
            raise ValueError(f"{box} outside layers {self.box}")
        kw = {f.name: sub(getattr(self, f.name), self.box, box) for f in fields(self) if f.name != "box"}
        return Layers(box=box, **kw)


def build_layers(world: PreparedWorld, box: CellBox) -> Layers:
    L = Layers.empty(box)
    area = shp_box(*box.to_rd().as_tuple())
    _terrain(world, L)
    _water(world, L, area)  # first, so bridge decks compare against the lowered river bed
    for p in world.patches_in(area):
        _patch(p, L)
    for b in world.buildings_in(area):
        _building(world, b, L)
    _islands(world, L, area)
    _ridges(L)
    return L


def _terrain(world: PreparedWorld, L: Layers) -> None:
    z = world.dtm.window(L.box)
    ok = ~np.isnan(z)
    L.ground_k[ok] = geo.z_to_k_np(z[ok])
    L.ground_color[:] = palette.idx("grass")
    rgb = world.ground_rgb
    if rgb is not None:
        src_box = CellBox(rgb.I0, rgb.J0, rgb.I0 + rgb.rgb.shape[0], rgb.J0 + rgb.rgb.shape[1])
        a0, b0 = max(L.box.i0, src_box.i0), max(L.box.j0, src_box.j0)
        a1, b1 = min(L.box.i1, src_box.i1), min(L.box.j1, src_box.j1)
        if a0 < a1 and b0 < b1:
            win = CellBox(a0, b0, a1, b1)
            px = sub(rgb.rgb, src_box, win)
            valid = px.any(axis=-1)
            q = palette.nearest(px, GROUND_CANDIDATES)
            sub(L.ground_color, L.box, win)[valid] = q[valid]


def _patch(p: SurfacePatch, L: Layers) -> None:
    hit = cover(p.geom, L.box)
    if hit is None:
        return
    win, mask = hit
    if p.deck is not None:
        x, y = geo.cell_centres_rd(win.i0, win.j0, win.ni, win.nj)
        dk = np.full(mask.shape, NONE, np.int64)
        dk[mask] = geo.z_to_k_np(p.deck.z_at(x[mask], y[mask]))
        gk = sub(L.ground_k, L.box, win)
        bridge = mask & (dk > gk + 1)
        sub(L.deck_k, L.box, win)[bridge] = dk[bridge]
        sub(L.deck_top, L.box, win)[bridge] = p.colour
        sub(L.deck_body, L.box, win)[bridge] = p.deck.body
        sub(L.deck_feat, L.box, win)[bridge] = p.feature_id
        mask = mask & ~bridge
    mask = mask & (sub(L.water_k, L.box, win) == NONE)  # no road/grass paint under water
    sub(L.ground_color, L.box, win)[mask] = p.colour
    sub(L.ground_shape, L.box, win)[mask] = p.shape
    sub(L.ground_feat, L.box, win)[mask] = p.feature_id


def _water(world: PreparedWorld, L: Layers, area) -> None:
    depth = max(1, round(world.config.water_depth_m / geo.PLATE_M))
    soil = palette.idx("soil")
    for w in world.water_in(area):
        hit = cover(w.geom, L.box)
        if hit is None:
            continue
        win, mask = hit
        wk = geo.z_to_k(w.level_m)
        gk = sub(L.ground_k, L.box, win)
        mask = mask & (gk != NONE)
        sub(L.water_k, L.box, win)[mask] = wk
        sub(L.water_color, L.box, win)[mask] = w.colour
        sub(L.water_feat, L.box, win)[mask] = w.feature_id
        gk[mask] = np.minimum(gk[mask], wk - depth)
        sub(L.ground_color, L.box, win)[mask] = soil
        sub(L.ground_shape, L.box, win)[mask] = FULL
        sub(L.ground_feat, L.box, win)[mask] = 0


def _islands(world: PreparedWorld, L: Layers, area) -> None:
    """Island buildings are not voxelised here, but neighbours must know the space is taken:
    no facade or glass windows on a party wall against an island, no trees inside it."""
    for g in world.islands:
        for b in g.members:
            if not b.footprint.intersects(area):
                continue
            hit = cover(b.footprint, L.box)
            if hit is None:
                continue
            win, mask = hit
            cur = sub(L.island_k, L.box, win)
            cur[mask] = np.maximum(cur[mask], g.top_k(b))


def slope_shape(nx: float, ny: float) -> int:
    """Shape code for a roof plane whose upward normal has horizontal part (nx, ny):
    the surface descends towards the normal's horizontal direction."""
    if abs(ny) >= abs(nx):
        return SLOPE_N if ny > 0 else SLOPE_S
    return SLOPE_E if nx > 0 else SLOPE_W


def _building(world: PreparedWorld, b: PreparedBuilding, L: Layers) -> None:
    cfg = world.config
    hit = cover(b.footprint, L.box)
    if hit is None:
        return
    win, _ = hit
    x, y = geo.cell_centres_rd(win.i0, win.j0, win.ni, win.nj)
    top_z = np.full((win.ni, win.nj), -np.inf)
    face = np.full((win.ni, win.nj), -1, np.int32)
    for fi, plane in enumerate(b.roofs):
        ph = cover(plane.poly, win)
        if ph is None:
            continue
        pw, pm = ph
        zs = np.full(pm.shape, -np.inf)
        zs[pm] = plane.z_at(sub(x, win, pw)[pm], sub(y, win, pw)[pm])
        tz, fc = sub(top_z, win, pw), sub(face, win, pw)
        better = zs > tz
        tz[better] = zs[better]
        fc[better] = fi
    has = face >= 0
    if not has.any():
        return
    top_k = np.full(face.shape, NONE, np.int64)
    top_k[has] = geo.z_to_k_np(top_z[has])
    shape = np.zeros(face.shape, np.uint8)
    for fi, plane in enumerate(b.roofs):
        m = face == fi
        if not m.any() or not roof_pitch_ok(plane, cfg.flat_pitch_deg, cfg.steep_pitch_deg):
            continue
        eave = geo.z_to_k(plane.eave_z)
        top_k[m] = eave + SLOPE_STACK * np.round((top_k[m] - eave) / SLOPE_STACK).astype(np.int64)
        shape[m] = slope_shape(plane.normal[0], plane.normal[1])
    gk = sub(L.ground_k, L.box, win)
    cur = sub(L.bld_top, L.box, win)
    take = has & (top_k > gk) & (top_k > cur) & (gk != NONE)
    wall = np.full(face.shape, b.wall, np.uint8)
    roof = np.where(shape > 0, b.roof_pitched, b.roof_flat).astype(np.uint8)
    if b.accent is not None:
        a = b.accent
        near = (x - a.centre[0]) ** 2 + (y - a.centre[1]) ** 2 <= a.radius_m**2
        wall[near], roof[near] = a.wall, a.roof
    cur[take] = top_k[take]
    sub(L.bld_feat, L.box, win)[take] = b.feature_id
    sub(L.bld_wall, L.box, win)[take] = wall[take]
    sub(L.bld_roof, L.box, win)[take] = roof[take]
    sub(L.roof_shape, L.box, win)[take] = shape[take]
    sub(L.win_period, L.box, win)[take] = b.window_period
    sub(L.win_offset, L.box, win)[take] = b.window_offset


def shifted(a: NDArray, di: int, dj: int, fill) -> NDArray:
    """``out[i, j] = a[i + di, j + dj]`` (``fill`` outside)."""
    out = np.full_like(a, fill)
    ni, nj = a.shape
    si0, si1 = max(0, di), min(ni, ni + di)
    sj0, sj1 = max(0, dj), min(nj, nj + dj)
    out[si0 - di : si1 - di, sj0 - dj : sj1 - dj] = a[si0:si1, sj0:sj1]
    return out


def _ridges(L: Layers) -> None:
    s, t, f = L.roof_shape, L.bld_top, L.bld_feat
    sloped = (s >= SLOPE_N) & (s <= SLOPE_W)

    def ridge(lo: int, hi: int, di: int, dj: int) -> NDArray[np.bool_]:
        s_lo, s_hi = shifted(s, -di, -dj, 0), shifted(s, di, dj, 0)
        f_lo, f_hi = shifted(f, -di, -dj, 0), shifted(f, di, dj, 0)
        t_lo, t_hi = shifted(t, -di, -dj, NONE), shifted(t, di, dj, NONE)
        down_lo = (s == lo) | ((s_lo == lo) & (f_lo == f))
        down_hi = (s == hi) | ((s_hi == hi) & (f_hi == f))
        return sloped & down_lo & down_hi & (t >= t_lo) & (t >= t_hi)

    along_i = ridge(SLOPE_S, SLOPE_N, 0, 1)  # slopes fall to -j and +j: ridge runs along i
    along_j = ridge(SLOPE_W, SLOPE_E, 1, 0)
    s[along_j] = RIDGE_J
    s[along_i] = RIDGE_I
