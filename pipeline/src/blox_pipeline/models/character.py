"""A townsperson: our own blocky figure, 4 x 1 studs (arms included), 10 plates tall.

Deliberately *not* a toy minifigure: no cylinder head with a stud, no C-shaped hands,
no trapezoid torso. It is built from ordinary bricks: square-cornered brick legs, a
plain rectangular body, straight block arms with a skin-coloured hand plate, a box head
and a flat hair plate. Front faces +j. Layers (k)::

    0..3    legs: one 1x1 brick each (parts leg_l / leg_r, hip pivot at k 3)
    2..6    arms: hand plate (k 2) under a 1x1 sleeve brick (parts arm_l / arm_r,
            shoulder pivot at k 6); arms hang beside the 2-stud body
    3..6    body: a 1x2 brick turned to lie across i
    6..9    head: a 1x2 brick, skin colour
    9..10   hair (or hat) plate

Walk cycle: rotate leg_l and arm_r one way, leg_r and arm_l the other, about each
part's pivot along the local i axis (CONTRACT 7.1).
"""

from __future__ import annotations

from dataclasses import dataclass

from .builder import ModelBuilder

W, L, H = 4, 1, 10


@dataclass(frozen=True)
class Outfit:
    shirt: str = "medium_blue"
    trousers: str = "dark_blue"
    skin: str = "tan"
    hair: str = "brick_brown"


def build_character(outfit: Outfit | None = None, name: str = "character") -> ModelBuilder:
    outfit = outfit or Outfit()
    m = ModelBuilder(name, (W, L, H), (W / 2, L / 2, 0.0))
    for side, i in (("l", 1), ("r", 2)):
        leg = m.part(f"leg_{side}", (i + 0.5, 0.5, 3.0))
        m.place("brick_1x1", i, 0, 0, "N", outfit.trousers, leg)
    for side, i in (("l", 0), ("r", 3)):
        arm = m.part(f"arm_{side}", (i + 0.5, 0.5, 6.0))
        m.place("plate_1x1", i, 0, 2, "N", outfit.skin, arm)
        m.place("brick_1x1", i, 0, 3, "N", outfit.shirt, arm)
    # A 1x2 brick facing E lies across i (its 2-stud length along +i), centred on i 1..2.
    m.place("brick_1x2", 1, 0, 3, "E", outfit.shirt)
    m.place("brick_1x2", 1, 0, 6, "E", outfit.skin)
    m.place("plate_1x2", 1, 0, 9, "E", outfit.hair)
    return m
