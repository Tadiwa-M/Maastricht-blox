"""Voxelise and lay out one island group with the world's own code (CONTRACT 5.1).

Nothing here re-implements a building. ``frame.local_world`` turns the group into an
axis-aligned copy in local "fake RD" coordinates, and then the normal pipeline runs on it:

1. ``plan_facades`` plans facade runs. The walls are now on the grid, so a run is one long
   straight wall instead of a staircase of 1-2 stud steps, and gets the full grammar.
2. ``build_layers`` + ``voxelise_tile`` fill 64 x 64 local sub-tiles (+1-cell rim) exactly
   like chunks, painting the facade pieces into them.
3. ``strip_ground`` removes the terrain (the world chunks draw the ground; under the island
   they are paved) and extends each building column two plates below the local ground: the
   plinth that hides the seam where a rotated wall meets sloping world ground.
4. ``layout_tile`` turns each sub-tile into bricks; hollow culling and ``hide_studs`` are
   therefore computed within the island.

Sub-tiles keep the chunk rules (no brick crosses a 64-stud line), so cutting the result into
256 x 256-stud islands never splits a brick: a group wider than 256 studs becomes several
islands with the same yaw and origins 128 m apart along the local axes.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Any, Callable

import numpy as np

from .. import geo
from ..geo import CellBox
from ..layout.records import RECORD_DTYPE, Records, concat_records
from ..voxelise.facade_runs import RunPlan, plan_facades
from ..voxelise.grid import FULL, VoxelTile
from ..voxelise.layers import NONE, Layers, build_layers
from ..voxelise.tile import tile_box_for_chunk, voxelise_tile
from ..voxelise.world import PreparedWorld
from .frame import IslandFrame, island_frame, local_world
from .group import IslandGroup
from .pose import IslandPose

ISLAND_STUDS = 256
PLINTH_BELOW = 2  # plates below the local ground (CONTRACT 5.1)
REGION_MARGIN = 16


@dataclass
class Island:
    """One ``.bxi`` worth of bricks: local ``I, J`` in [0, 256), global ``K``."""

    id: int
    pose: IslandPose
    cx: int
    cy: int
    records: Records
    fids: tuple[int, ...] = ()


@dataclass
class GroupResult:
    frame: IslandFrame
    islands: list[Island]                     # ids still 0: numbered by ``number_islands``
    facades: list[RunPlan] = field(default_factory=list)
    tiles: list[tuple[VoxelTile, Records]] = field(default_factory=list)  # with keep_tiles (tests)


def strip_ground(tile: VoxelTile, L: Layers) -> None:
    """Terrain out, plinth down: keep only cells that belong to a feature (buildings and
    their facade paint; the local world has no ground features), then fill the two plates
    under each building column with the colour of its first building cell."""
    tile.color[tile.feature == 0] = 0
    tile.shape[tile.color == 0] = 0
    g, t = L.ground_k.astype(np.int64), L.bld_top.astype(np.int64)
    ii, jj = np.nonzero((t != NONE) & (g != NONE) & (t > g) & (L.bld_feat > 0))
    ni, nj, nk = tile.dims
    for d in range(PLINTH_BELOW):
        k = g[ii, jj] - d - tile.k0
        first = g[ii, jj] + 1 - tile.k0
        ok = (k >= 0) & (k < nk) & (first < nk)
        a, b, kk, ff = ii[ok], jj[ok], k[ok], first[ok]
        col = tile.color[a, b, ff]
        col = np.where(col != 0, col, L.bld_wall[a, b])
        tile.color[a, b, kk] = col
        tile.feature[a, b, kk] = L.bld_feat[a, b]
        tile.shape[a, b, kk] = FULL


def _layout(tile: VoxelTile, layout: Callable[..., Any]) -> Records:
    from ..cli import call_layout, own_chunk

    if tile.dims[2] == 0 or not tile.color.any():
        return np.zeros(0, RECORD_DTYPE)
    cx, cy = (tile.I0 + 1) // geo.CHUNK_STUDS, (tile.J0 + 1) // geo.CHUNK_STUDS
    rec = call_layout(layout, tile)
    return own_chunk(rec, cx, cy) if rec is not None else np.zeros(0, RECORD_DTYPE)


def build_group(world: PreparedWorld, group: IslandGroup, layout: Callable[..., Any] | None = None,
                keep_tiles: bool = False) -> GroupResult:
    """Island(s) for one group. ``layout`` defaults to ``layout.layout_tile``; with
    ``keep_tiles`` the local sub-tiles and their records are kept for checking."""
    if layout is None:
        from ..layout import layout_tile as layout
    frame = island_frame(group)
    lw = local_world(world, group, frame)
    if world.config.facade_detail:
        lw.facades = plan_facades(lw)
    n = geo.CHUNK_STUDS
    box = CellBox(0, 0, -(-frame.ni // n) * n, -(-frame.nj // n) * n)  # whole 64-stud sub-tiles
    layers = build_layers(lw, box.grow(REGION_MARGIN))
    parts, tiles = [], []
    for cx, cy in box.chunks():
        tb = tile_box_for_chunk(cx, cy, 1)
        tile = voxelise_tile(lw, layers, tb)
        if tile.dims[2]:
            strip_ground(tile, layers.window(tb))
        parts.append(_layout(tile, layout))
        if keep_tiles:
            tiles.append((tile, parts[-1]))
    rec = concat_records(parts)
    return GroupResult(frame, split_tiles(rec, frame.pose, group.fids), lw.facades, tiles)


def split_tiles(rec: Records, pose: IslandPose, fids: tuple[int, ...]) -> list[Island]:
    """Cut a group's records into 256 x 256-stud islands (origins offset along local axes)."""
    out = []
    if len(rec) == 0:
        return out
    ti, tj = rec["I"] // ISLAND_STUDS, rec["J"] // ISLAND_STUDS
    for a, b in sorted(set(zip(ti.tolist(), tj.tolist()))):
        part = rec[(ti == a) & (tj == b)].copy()
        part["I"] -= a * ISLAND_STUDS
        part["J"] -= b * ISLAND_STUDS
        tile_pose = pose.offset(a * ISLAND_STUDS * geo.STUD_M, b * ISLAND_STUDS * geo.STUD_M)
        cx, cy = owning_chunk(part, tile_pose)
        out.append(Island(0, tile_pose, cx, cy, part, fids))
    return out


def owning_chunk(rec: Records, pose: IslandPose) -> tuple[int, int]:
    """Chunk holding the centre of the island's brick extent (CONTRACT 5.1 ``cx, cy``)."""
    u = (int(rec["I"].min()) + int(rec["I"].max()) + 1) / 2 * geo.STUD_M
    v = (int(rec["J"].min()) + int(rec["J"].max()) + 1) / 2 * geo.STUD_M
    x, z = pose.to_world(u, v)
    n = geo.CHUNK_STUDS * geo.STUD_M
    return min(max(math.floor(x / n), 0), geo.CHUNKS_X - 1), min(max(math.floor(z / n), 0), geo.CHUNKS_Y - 1)


def number_islands(results: list[GroupResult]) -> list[Island]:
    """Ids 1, 2, ... in group order (groups are sorted by their smallest feature id)."""
    out = []
    for r in results:
        for isl in r.islands:
            isl.id = len(out) + 1
            out.append(isl)
    return out


def build_islands(world: PreparedWorld, chunks: set[tuple[int, int]] | None = None,
                  layout: Callable[..., Any] | None = None) -> tuple[list[Island], list[RunPlan]]:
    """Every island of ``world`` (only those owned by ``chunks`` when given) and the facade
    runs planned on them (for the detail statistics)."""
    results = [build_group(world, g, layout) for g in world.islands if chunks is None or _near(g, chunks)]
    islands = number_islands(results)
    keep = {i.id for i in islands if chunks is None or (i.cx, i.cy) in chunks}
    plans = [p for r in results if any(i.id in keep for i in r.islands) for p in r.facades]
    return [i for i in islands if i.id in keep], plans


def _near(group: IslandGroup, chunks: set[tuple[int, int]]) -> bool:
    """Cheap pre-filter: a member footprint lies in (or next to) one of ``chunks``."""
    n = geo.CHUNK_STUDS * geo.STUD_M
    for b in group.members:
        xmin, ymin, xmax, ymax = b.footprint.bounds
        for cx in range(math.floor((xmin - geo.X0) / n) - 1, math.floor((xmax - geo.X0) / n) + 2):
            for cy in range(math.floor((ymin - geo.Y0) / n) - 1, math.floor((ymax - geo.Y0) / n) + 2):
                if (cx, cy) in chunks:
                    return True
    return False


__all__ = ["Island", "GroupResult", "build_group", "build_islands", "split_tiles", "strip_ground",
           "ISLAND_STUDS"]
