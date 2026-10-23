"""Rotation and facing: the one place that knows how a piece turns (CONTRACT section 2).

Why this module exists
----------------------
Every brick type is described unrotated: ``w`` studs along +i (east) and ``d`` studs along
+j (north). A placed brick stores ``rot`` in 0..3, meaning "turned rot x 90 degrees
clockwise, seen from above". Getting this maths right in five places is how bugs happen,
so the whole pipeline asks *this* module instead.

The rule to remember: **a piece's front faces +j (north) at rot 0.** Callers should say
which way the front should face (:class:`Facing`) and let :func:`facing_to_rot` pick the
``rot``. Facing S (the usual street front of a house) is rot 2.

A record's position is the *minimum corner* of the rotated bounding box, so the helpers
below return offsets that are always >= 0 from that corner.

The same helpers exist in C# and JavaScript; all of them pass
``contract/test_vectors/rotation.json``.
"""

from __future__ import annotations

from collections.abc import Iterator
from enum import Enum


class Facing(Enum):
    """Compass direction a piece's front faces. The value is the matching ``rot``."""

    N = 0  # front faces +j
    E = 1  # front faces +i
    S = 2  # front faces -j
    W = 3  # front faces -i

    @classmethod
    def parse(cls, value: "Facing | str | int") -> "Facing":
        """Accept a Facing, its letter (``"S"``) or a rot number (``2``)."""
        if isinstance(value, Facing):
            return value
        if isinstance(value, str):
            return cls[value.upper()]
        return cls(check_rot(value))


# Unit step (di, dj) in the direction the front faces, by rot.
FRONT_DIR: dict[int, tuple[int, int]] = {0: (0, 1), 1: (1, 0), 2: (0, -1), 3: (-1, 0)}


def check_rot(rot: int) -> int:
    if rot not in (0, 1, 2, 3):
        raise ValueError(f"rot must be 0..3, got {rot}")
    return rot


def facing_to_rot(facing: Facing | str | int) -> int:
    """``N -> 0, E -> 1, S -> 2, W -> 3``."""
    return Facing.parse(facing).value


def rot_to_facing(rot: int) -> Facing:
    return Facing(check_rot(rot))


def front_dir(rot: int) -> tuple[int, int]:
    """Unit step ``(di, dj)`` the front of a piece at ``rot`` points along."""
    return FRONT_DIR[check_rot(rot)]


def rotated_extent(w: int, d: int, rot: int) -> tuple[int, int]:
    """Size of the rotated footprint along ``(i, j)``: rot 0/2 -> ``(w, d)``, 1/3 -> ``(d, w)``."""
    return (w, d) if check_rot(rot) % 2 == 0 else (d, w)


def footprint_cell(w: int, d: int, rot: int, a: int, b: int) -> tuple[int, int]:
    """Where unrotated footprint cell ``(a, b)`` lands, as an offset from the record position.

    ``a`` runs along ``w`` (0..w-1), ``b`` along ``d`` (0..d-1). Turning clockwise by 90
    degrees maps "east" to "south", hence the ``w-1-a`` / ``d-1-b`` flips.
    """
    if not (0 <= a < w and 0 <= b < d):
        raise ValueError(f"cell ({a}, {b}) outside a {w}x{d} footprint")
    rot = check_rot(rot)
    if rot == 0:
        return a, b
    if rot == 1:
        return b, w - 1 - a
    if rot == 2:
        return w - 1 - a, d - 1 - b
    return d - 1 - b, a


def footprint_cells(w: int, d: int, rot: int) -> Iterator[tuple[int, int, int, int]]:
    """Yield ``(a, b, di, dj)`` for every cell of the footprint."""
    for a in range(w):
        for b in range(d):
            yield (a, b, *footprint_cell(w, d, rot, a, b))
