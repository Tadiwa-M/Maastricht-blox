"""Canopies (accuracy A3): the station's bus and platform roofs.

BGT ``overigbouwwerk`` objects of type ``overkapping`` are free-standing roofs; they are not
BAG buildings, so 3D BAG does not have them. Each becomes a thin roof slab (``SLAB_PLATES``)
whose top is the AHN surface height inside the outline (median of the DSM), with metal posts
every ``POST_SPACING_M`` that keep off the carriageways (bus lanes stay clear). Underneath stays
open: people, buses and the player pass below. Without a DSM the roof is ``DEFAULT_HEIGHT_M``
above the ground. Where a building stands, the building wins.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
from shapely.geometry import MultiPoint, Point
from shapely.geometry.base import BaseGeometry

from .. import geo
from ..sources.model import BgtData, HeightGrid
from . import palette
from .raster import cover

SLAB_PLATES = 2
POST_SPACING_M = 8.0
POST_INSET_M = 0.75
DEFAULT_HEIGHT_M = 4.5
MIN_HEIGHT_M, MAX_HEIGHT_M = 2.6, 15.0
MIN_AREA_M2 = 8.0
ROOF_COLOUR, POST_COLOUR = "light_grey", "metal"


@dataclass
class Canopy:
    geom: BaseGeometry
    top_z: float  # m NAP, top of the roof slab
    roof: int  # palette idx
    post: int
    posts: BaseGeometry | None  # post positions (points)
    wall: BaseGeometry | None = None  # cells under the roof filled from the ground up (a shelter's glass back)
    wall_colour: int = 0


def canopy_outlines(bgt: BgtData) -> list[BaseGeometry]:
    return [f.geom for f in bgt.layer("overigbouwwerk")
            if f.props.get("type") == "overkapping" and f.geom.geom_type in ("Polygon", "MultiPolygon")
            and f.geom.area >= MIN_AREA_M2]


def roof_height(geom: BaseGeometry, dtm: HeightGrid, dsm: HeightGrid | None) -> float | None:
    """Top of the roof (m NAP): the DSM median inside the outline, clamped to a sane height
    above the ground; None when the ground is unknown."""
    hit = cover(geom, dtm.box)
    if hit is None:
        return None
    win, mask = hit
    g = dtm.window(win)[mask]
    g = g[~np.isnan(g)]
    if not len(g):
        return None
    ground = float(np.median(g))
    top = ground + DEFAULT_HEIGHT_M
    if dsm is not None:
        s = dsm.window(win)[mask]
        s = s[~np.isnan(s)]
        if len(s):
            top = float(np.median(s))
    return float(np.clip(top, ground + MIN_HEIGHT_M, ground + MAX_HEIGHT_M))


def post_points(geom: BaseGeometry, keep_clear: BaseGeometry | None) -> BaseGeometry | None:
    """A grid of posts (``POST_SPACING_M``, aligned to the outline's bounds) inside the outline,
    ``POST_INSET_M`` from its edge, off ``keep_clear`` (carriageways)."""
    inner = geom.buffer(-POST_INSET_M)
    if inner.is_empty:
        inner = geom
    x0, y0, x1, y1 = inner.bounds
    nx = max(1, int((x1 - x0) // POST_SPACING_M))
    ny = max(1, int((y1 - y0) // POST_SPACING_M))
    xs = np.linspace(x0, x1, nx + 1) if x1 - x0 >= POST_SPACING_M else [(x0 + x1) / 2]
    ys = np.linspace(y0, y1, ny + 1) if y1 - y0 >= POST_SPACING_M else [(y0 + y1) / 2]
    pts = [Point(x, y) for x in xs for y in ys]
    clear = None
    if keep_clear is not None:  # only the part near this canopy: buffering the city's union is slow
        clear = keep_clear.intersection(geom.buffer(2.0)).buffer(0.5)
    pts = [p for p in pts if inner.covers(p) and (clear is None or not clear.contains(p))]
    return MultiPoint(pts) if pts else None


def plan_canopies(bgt: BgtData, dtm: HeightGrid, dsm: HeightGrid | None,
                  keep_clear: BaseGeometry | None = None) -> list[Canopy]:
    roof, post = palette.idx(ROOF_COLOUR), palette.idx(POST_COLOUR)
    out = []
    for g in canopy_outlines(bgt):
        top = roof_height(g, dtm, dsm)
        if top is None:
            continue
        out.append(Canopy(g, top, roof, post, post_points(g, keep_clear)))
    return out


def paint_canopy(c: Canopy, L) -> None:
    """Into the layers: roof top K and colour over the outline, post flags at the posts."""
    from .raster import sub

    hit = cover(c.geom, L.box)
    if hit is None:
        return
    win, mask = hit
    k = geo.z_to_k(c.top_z)
    cur = sub(L.canopy_k, L.box, win)
    take = mask & (k > cur)
    cur[take] = k
    sub(L.canopy_color, L.box, win)[take] = c.roof
    if c.wall is not None:
        wh = cover(c.wall, L.box)
        if wh is not None:
            ww, wm = wh
            col = sub(L.canopy_post, L.box, ww)
            col[wm & (sub(L.canopy_k, L.box, ww) == k)] = c.wall_colour
    if c.posts is None:
        return
    for p in getattr(c.posts, "geoms", [c.posts]):
        I, J = geo.rd_to_grid(p.x, p.y)
        i, j = I - L.box.i0, J - L.box.j0
        if 0 <= i < L.box.ni and 0 <= j < L.box.nj and L.canopy_k[i, j] == k:
            L.canopy_post[i, j] = c.post


__all__ = ["Canopy", "canopy_outlines", "paint_canopy", "plan_canopies", "post_points", "roof_height"]
