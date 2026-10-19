"""Facade grammar: detailed, modular-building-style houses painted into a voxel tile.

Works on axis-aligned rectangular buildings whose street front faces -j. Walls, plinths
and roofs are painted as voxels (the layout turns them into bricks); windows, doors,
arches, fences and small details are *placed* catalogue pieces (CONTRACT 2.1), always
by facing: ``S`` for the street front, ``W`` for a west side wall.

Module map: ``spec`` (what a house is) -> ``walls`` (build order, shell) -> ``windows``
(upper storeys, balcony, side wall) / ``ground`` (door, shop, arcade) -> ``roofs``;
``pieces`` holds the small "clear, place, backdrop" helpers; ``props`` street furniture.
"""

from .roofs import paint_roof
from .spec import GroundFloor, HouseSpec, RoofKind
from .walls import paint_house

__all__ = ["GroundFloor", "HouseSpec", "RoofKind", "paint_house", "paint_roof"]
