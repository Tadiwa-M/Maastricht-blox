"""Facade grammar: detailed, modular-building-style houses painted into a voxel tile.

Works on axis-aligned rectangular buildings whose street front faces -j. Used by the
look-test scene now; the real-data voxeliser can adopt it per facade later.
"""

from .roofs import paint_roof
from .spec import GroundFloor, HouseSpec, RoofKind
from .walls import paint_house

__all__ = ["GroundFloor", "HouseSpec", "RoofKind", "paint_house", "paint_roof"]
