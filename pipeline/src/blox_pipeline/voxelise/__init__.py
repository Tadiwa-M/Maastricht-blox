"""Sources -> pipeline-internal voxel tiles (CONTRACT.md section 7) + features."""

from __future__ import annotations

from typing import Iterator

from .. import geo
from ..geo import CellBox
from .features import FeatureRegistry, build_features
from .grid import VoxelTile
from .layers import Layers, build_layers
from .prepare import prepare_world
from .tile import tile_box_for_chunk, voxelise_tile
from .world import PreparedWorld, VoxelConfig

__all__ = [
    "FeatureRegistry", "Layers", "PreparedWorld", "VoxelConfig", "VoxelTile",
    "build_features", "build_layers", "iter_chunk_tiles", "prepare_world", "voxelise_tile",
]

REGION_CHUNKS = 8  # layers are built for 8x8 chunks (256 m) at a time
REGION_MARGIN = 16  # cells: tile border + neighbour checks + tree crowns


def iter_chunk_tiles(world: PreparedWorld, cells: CellBox, border: int = 1) -> Iterator[tuple[int, int, VoxelTile]]:
    """Yield ``(cx, cy, tile)`` for every chunk overlapping ``cells``; each tile is the
    chunk plus a ``border``-cell rim of neighbouring world cells."""
    chunks = sorted(cells.chunks(), key=lambda c: (c[1] // REGION_CHUNKS, c[0] // REGION_CHUNKS, c[1], c[0]))
    groups: dict[tuple[int, int], list[tuple[int, int]]] = {}
    for cx, cy in chunks:
        groups.setdefault((cx // REGION_CHUNKS, cy // REGION_CHUNKS), []).append((cx, cy))
    n = geo.CHUNK_STUDS * REGION_CHUNKS
    for (rx, ry), members in groups.items():
        region = CellBox(rx * n, ry * n, (rx + 1) * n, (ry + 1) * n).grow(REGION_MARGIN)
        layers = build_layers(world, region)
        for cx, cy in members:
            yield cx, cy, voxelise_tile(world, layers, tile_box_for_chunk(cx, cy, border))
