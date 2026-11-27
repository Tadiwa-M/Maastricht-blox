"""Stadium stands: a stepped seating rake on the pitch side of a stadium building.

A 3D BAG stadium is a ring around an open pitch. Voxelised like any other building, the side
facing the pitch would be a vertical wall with windows. Here it becomes the stands:

* **Detection** (``plan_stadiums``, once per world). A building is a stadium when its footprint
  has a hole of at least ``MIN_PITCH_M2`` (the pitch) *and* OSM says it is one: an OSM
  ``leisure=stadium`` area (``OsmData.stadiums``) or an OSM building tagged ``building=stadium``
  (or ``leisure=stadium``) covers at least ``TAG_COVER`` of the footprint. Both from data, no list
  of ids: a stadium OSM does not tag can be fixed with an ``osm_tags`` correction
  (``corrections/corrections.json``) that sets ``building=stadium`` on its OSM building.
  The hole becomes ``PreparedBuilding.pitch`` and the median ground in it ``pitch_z``; islands
  turn the pitch into their local frame with the footprint, so a turned stadium works the same.
* **Rake** (``paint_stands`` into the layers, ``fill_stands`` into the tile). Per building cell:
  ``d`` = distance to the pitch, ``s`` = position along the pitch outline. Rows are ``ROW_M``
  deep and rise ``RISE_PLATES``; the first tread is ``FRONT_PLATES`` above the pitch. The front
  half of a row is the tread (concrete), the back half the seat, ``SEAT_PLATES`` higher, in
  the club colours (red, white; a pattern per block). Every ``AISLE_EVERY_M`` along the
  outline an ``AISLE_W_M`` wide aisle has the same steps in paving colour, and blocks between
  aisles get their own seat pattern.
* **Roof.** Under a 3D BAG roof the column is: rake, open air, then a ``ROOF_PLATES`` slab (the
  roof stays where 3D BAG has it, open toward the pitch). Where the roof is too low for
  ``HEADROOM_PLATES`` above a row, the stand has ended: the rest of the column is the solid back
  block up to the roof. Where 3D BAG's roof is itself at or below the rake (an open stand) the
  rake is the top and nothing covers it. A "roof" more than ``MAX_CLEAR_PLATES`` above the
  rake is a floodlight mast or a tower: it stays a solid column.
* **Outside faces keep their facade**: cells closer than ``BACK_M`` to the outer wall stay
  solid, and ``facade_runs`` plans no facade run that faces the pitch.

Everything is voxels in the building's colour slots (no placed pieces), so chunk and island
formats are unchanged; rows are long strips of one colour, which the layout packs into long
plates and bricks.
"""

from __future__ import annotations

import logging

import numpy as np
import shapely
from numpy.typing import NDArray
from shapely import STRtree
from shapely.geometry import Polygon
from shapely.geometry.base import BaseGeometry
from shapely.ops import unary_union

from .. import geo
from ..sources.model import HeightGrid, OsmData
from . import palette
from .grid import FULL, SLOPE_STACK
from .raster import cover, sub
from .world import PreparedBuilding

log = logging.getLogger(__name__)

NONE = -1  # layers.NONE
MIN_PITCH_M2 = 2500.0  # smallest hole that counts as a pitch (a 60 x 40 m field)
TAG_COVER = 0.3        # share of the footprint an OSM stadium object must cover
ROW_M = 1.0            # row depth: 2 studs (tread + seat)
RISE_PLATES = 3        # one brick per row (about 31 degrees)
SEAT_PLATES = 2        # seat block above its row's tread
FRONT_PLATES = 5       # first tread 1 m above the pitch
HEADROOM_PLATES = 12   # 2.4 m clear above a seat, or the stand has ended
MAX_CLEAR_PLATES = 75  # roof more than 15 m above the rake: a mast or tower, kept solid
ROOF_PLATES = 4        # roof slab kept over the stands
OPEN_SLACK_PLATES = 3  # 3D BAG roof within this of the rake (or below): an open stand
BACK_M = 2.0           # outer wall zone that stays solid (the outside facade)
MAX_DEPTH_M = 40.0     # no stand cell farther from the pitch than this
AISLE_EVERY_M = 20.0
AISLE_W_M = 1.0
BODY, AISLE, ROOF_UNDER = "light_grey", "pavement", "light_grey"
SEAT_RED, SEAT_WHITE = "bus_red", "white"


# ---------------------------------------------------------------------------- detection
def pitch_ring(fp: BaseGeometry, min_area: float = MIN_PITCH_M2) -> Polygon | None:
    """The footprint's largest hole as a polygon when it is at least ``min_area``."""
    holes = [Polygon(r) for p in getattr(fp, "geoms", [fp]) if isinstance(p, Polygon) for r in p.interiors]
    holes = [h for h in holes if h.is_valid and h.area >= min_area]
    return max(holes, key=lambda h: h.area) if holes else None


def stadium_objects(osm: OsmData) -> list[BaseGeometry]:
    """OSM geometries that say "stadium": leisure=stadium areas and stadium buildings."""
    out = [f.geom for f in osm.stadiums]
    out += [f.geom for f in osm.buildings
            if f.tags.get("building") == "stadium" or f.tags.get("leisure") == "stadium"]
    return [g for g in out if g.geom_type in ("Polygon", "MultiPolygon") and not g.is_empty]


def tagged_stadium(fp: BaseGeometry, objects: list[BaseGeometry], tree: STRtree | None = None) -> bool:
    cand = [objects[int(i)] for i in tree.query(fp)] if tree is not None else objects
    return any(g.intersection(fp).area >= TAG_COVER * fp.area for g in cand)


def pitch_height(pitch: BaseGeometry, dtm: HeightGrid) -> float | None:
    """Median ground (m NAP) inside the pitch, None without DTM there."""
    hit = cover(pitch, dtm.box)
    if hit is None:
        return None
    win, mask = hit
    z = dtm.window(win)[mask]
    z = z[~np.isnan(z)]
    return float(np.median(z)) if len(z) else None


def plan_stadiums(buildings: list[PreparedBuilding], osm: OsmData, dtm: HeightGrid) -> list[PreparedBuilding]:
    """Mark every stadium in ``buildings`` (sets ``pitch`` and ``pitch_z``); returns them."""
    objects = stadium_objects(osm)
    if not objects:
        return []
    tree = STRtree(objects)
    out = []
    for b in buildings:
        if b.hero is not None:
            continue
        pitch = pitch_ring(b.footprint)
        if pitch is None or not tagged_stadium(b.footprint, objects, tree):
            continue
        z = pitch_height(pitch, dtm)
        if z is None:
            continue
        b.pitch, b.pitch_z = pitch, z
        out.append(b)
    if out:
        log.info("stadiums: %d with stands (%s)", len(out), ", ".join(b.bag_id for b in out))
    return out


# ---------------------------------------------------------------------------- rake profile
def seat_colour(block: NDArray[np.int64], row: NDArray[np.int64]) -> NDArray[np.uint8]:
    """Seat colour per block (between two aisles) and row: plain red, red with white rows,
    plain red, red with a white band, repeating along the stand."""
    p = np.mod(block, 4)
    white = ((p == 1) & (np.mod(row, 2) == 0)) | ((p == 3) & (row >= 3) & (row <= 6))
    return np.where(white, palette.idx(SEAT_WHITE), palette.idx(SEAT_RED)).astype(np.uint8)


def rake(d: NDArray[np.float64], s: NDArray[np.float64], front_k: int
         ) -> tuple[NDArray[np.int64], NDArray[np.int64], NDArray[np.uint8], NDArray[np.int64]]:
    """Rake at distance ``d`` from the pitch and ``s`` along its outline (metres).

    Returns ``(top, cap, colour, tread)``: the top K of the stand, how many cells at the top
    have ``colour`` (the rest is concrete), and the row's tread K."""
    row = np.floor(d / ROW_M).astype(np.int64)
    back = (d - row * ROW_M) >= ROW_M / 2
    tread = front_k + RISE_PLATES * row
    top = tread + np.where(back, SEAT_PLATES, 0)
    cap = np.where(back, SEAT_PLATES, 1)
    aisle = np.mod(s, AISLE_EVERY_M) < AISLE_W_M
    block = np.floor(s / AISLE_EVERY_M).astype(np.int64)
    seats = seat_colour(block, row)
    colour = np.where(aisle, palette.idx(AISLE), np.where(back, seats, palette.idx(BODY))).astype(np.uint8)
    return top, cap, colour, tread


def stand_column(top: NDArray[np.int64], tread: NDArray[np.int64], bld_top: NDArray[np.int64],
                 ground: NDArray[np.int64], slab: NDArray[np.int64]
                 ) -> tuple[NDArray[np.bool_], NDArray[np.int64], NDArray[np.int64]]:
    """Which columns are stand and how: ``(is_stand, top, roof_k)``. ``roof_k`` is the first
    roof cell above the open air (``bld_top + 1``: nothing covers this rake)."""
    under = bld_top - slab + 1
    covered = (tread + SEAT_PLATES + HEADROOM_PLATES < under) & (under - top <= MAX_CLEAR_PLATES)
    open_ = bld_top <= top + OPEN_SLACK_PLATES
    top = np.maximum(np.where(open_ & ~covered, np.minimum(top, bld_top), top), ground + 1)
    roof_k = np.where(covered, under, bld_top + 1)
    return covered | open_, top, roof_k


def _shell(fp: BaseGeometry) -> BaseGeometry:
    """Footprint without its holes: distance to its boundary = distance to the outer wall."""
    return unary_union([Polygon(p.exterior) for p in getattr(fp, "geoms", [fp]) if isinstance(p, Polygon)])


def paint_stands(b: PreparedBuilding, L) -> None:
    """Into the layers (after all buildings): ``stand_k``, ``stand_roof_k``, ``stand_color``,
    ``stand_cap`` of ``b``'s cells that become stands."""
    if b.pitch is None or b.pitch_z is None:
        return
    hit = cover(b.footprint, L.box)
    if hit is None:
        return
    win, mask = hit
    t = sub(L.bld_top, L.box, win).astype(np.int64)
    own = mask & (sub(L.bld_feat, L.box, win) == b.feature_id) & (t != NONE)
    if not own.any():
        return
    x, y = geo.cell_centres_rd(win.i0, win.j0, win.ni, win.nj)
    pts = shapely.points(x[own], y[own])
    d = shapely.distance(b.pitch, pts)
    near = (d <= MAX_DEPTH_M) & (shapely.distance(_shell(b.footprint).boundary, pts) >= BACK_M)
    s = shapely.line_locate_point(b.pitch.exterior, pts)
    top, cap, colour, tread = rake(d, s, geo.z_to_k(b.pitch_z) + FRONT_PLATES)
    g = sub(L.ground_k, L.box, win).astype(np.int64)[own]
    slab = np.maximum(ROOF_PLATES, np.where(sub(L.roof_shape, L.box, win)[own] > 0, 2 * SLOPE_STACK, 1))
    stand, top, roof_k = stand_column(top, tread, t[own], g, slab)
    stand &= near
    for name, val in (("stand_k", top), ("stand_roof_k", roof_k), ("stand_color", colour), ("stand_cap", cap)):
        view = sub(getattr(L, name), L.box, win)
        cur = view[own]
        cur[stand] = val[stand]
        view[own] = cur


def fill_stands(tile, L, kk: NDArray, band: NDArray) -> None:
    """Carve the stands into a filled tile: concrete body up to ``stand_k`` (its top
    ``stand_cap`` cells in ``stand_color``), air up to ``stand_roof_k``, then the roof slab in
    the underside colour down from the roof ``band`` (the building fill keeps the roof)."""
    s = L.stand_k[..., None]
    has = s != NONE
    if not has.any():
        return
    g, t = L.ground_k[..., None], L.bld_top[..., None]
    r = L.stand_roof_k[..., None]
    feat = np.broadcast_to(L.bld_feat[..., None], tile.color.shape)
    body = has & (kk > g) & (kk <= s)
    cap = body & (kk > s - L.stand_cap[..., None].astype(np.int32))
    air = has & (kk > s) & (kk < r)
    slab = has & (kk >= r) & (kk <= t - band[..., None])
    tile.color[body] = palette.idx(BODY)
    tile.color[cap] = np.broadcast_to(L.stand_color[..., None], cap.shape)[cap]
    tile.color[slab] = palette.idx(ROOF_UNDER)
    solid = body | slab
    tile.shape[solid] = FULL
    tile.feature[solid] = feat[solid]
    tile.color[air] = 0
    tile.shape[air] = 0
    tile.feature[air] = 0


__all__ = ["fill_stands", "paint_stands", "pitch_height", "pitch_ring", "plan_stadiums", "rake",
           "seat_colour", "stadium_objects", "stand_column", "tagged_stadium"]
