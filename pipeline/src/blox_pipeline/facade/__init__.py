"""Facade grammar: modular-building-style facades painted into a voxel tile.

The unit is a **facade run** (``run``): one straight wall with one outward normal, painted
in a run frame (x along the wall, y inward, pieces face ``S``) as corner pilasters, upper
storeys (``windows``), ground floor (``ground``: house, shop, arcade or plain) and eave
cornice. ``frame.FramePainter`` turns the frame to face N/E/S/W. Walls, plinths, bands and
roofs are voxels (the layout turns them into bricks); windows, doors, arches, fences and
small details are *placed* catalogue pieces (CONTRACT 2.1), always by facing.

Callers: test-scene houses (``spec.HouseSpec`` -> ``walls.paint_house``: shell, front run,
side windows, ``roofs``) and real buildings (``voxelise.facade_runs`` / ``facade_paint``).
``pieces`` holds the small "clear, place, backdrop" helpers; ``props`` street furniture.
"""

from .frame import Frame, FramePainter
from .roofs import paint_roof
from .run import FacadeRun, paint_run
from .spec import GroundFloor, HouseSpec, RoofKind
from .walls import paint_house

__all__ = ["FacadeRun", "Frame", "FramePainter", "GroundFloor", "HouseSpec", "RoofKind", "paint_house",
           "paint_roof", "paint_run"]
