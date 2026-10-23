"""Rotated building islands (CONTRACT 5.1): buildings on their own grid, turned to their wall.

``group`` picks the buildings and terraces, ``orient`` measures their direction, ``frame``
builds the local axis-aligned copy, ``build`` voxelises it with the world's own code, and
``pose`` is the one local <-> world transform every renderer shares.
"""

from .build import Island, build_group, build_islands
from .group import IslandGroup, plan_islands
from .pose import IslandPose, island_local_to_world, island_world_to_local

__all__ = ["Island", "IslandGroup", "IslandPose", "build_group", "build_islands", "island_local_to_world",
           "island_world_to_local", "plan_islands"]
