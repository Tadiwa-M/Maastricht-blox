"""Maastricht city bus: 5 x 24 studs (2.5 m x 12 m), 16 plates (3.2 m) tall.

Original design. Forward is +j, so the windscreen is at the high-j end and, driving on
the right, the passenger doors are on the +i side (their fronts face ``E``). Layers (k)::

    0..3    wheels (round bricks, parts wheel_*), dark chassis between them
    3..6    red skirt with headlights and a bumper
    6..12   window band: window_1x2x2 all round, red pillars between
    3..15   two doors on the +i side (door_1x2x4 is 12 plates tall)
    12..15  red upper band with a lit destination sign at the front
    15..16  white roof of tiles (no studs on a bus roof)

Recipe: place the special pieces first, then pour the red body around them with
``box`` (which only fills cells that are still empty). The cabin stays hollow.
"""

from __future__ import annotations

from .builder import ModelBuilder

W, L, H = 5, 24, 16
FRONT = L - 1
WHEELS = {"wheel_rl": (0, 4), "wheel_rr": (W - 1, 4), "wheel_fl": (0, 18), "wheel_fr": (W - 1, 18)}
DOORS_J = (8, 20)                                   # +i side: middle door, front door
LEFT_WINDOWS_J = range(2, 22, 2)
RIGHT_WINDOWS_J = (2, 4, 6, 10, 12, 14, 16)
BAND = (6, 12)                                      # window band k range


def build_bus() -> ModelBuilder:
    m = ModelBuilder("bus", (W, L, H), (W / 2, L / 2, 0.0))
    _wheels_and_chassis(m)
    _doors_windows_lights(m)
    m.box(0, W, 0, L, 3, BAND[0], "bus_red")                     # skirt
    for i in (0, W - 1):                                          # side pillars
        m.box(i, i + 1, 0, L, *BAND, "bus_red")
    for j in (0, FRONT):                                          # end pillars
        m.box(0, W, j, j + 1, *BAND, "bus_red")
    m.box(0, W, 0, L, BAND[1], H - 1, "bus_red")                  # upper band
    m.box(0, W, 0, L, H - 1, H, "white", top="tile")              # roof
    return m


def _wheels_and_chassis(m: ModelBuilder) -> None:
    for name, (i, j) in WHEELS.items():
        part = m.part(name, (i + 0.5, j + 0.5, 1.5))              # spins about its own i axis
        m.place("round_brick_1x1", i, j, 0, "N", "black", part)
    m.box(1, W - 1, 1, FRONT, 1, 3, "dark_grey")                  # floor pan
    m.box(0, W, 1, FRONT, 2, 3, "dark_grey")                      # sills between the wheels


def _doors_windows_lights(m: ModelBuilder) -> None:
    for j in DOORS_J:
        m.place("door_1x2x4", W - 1, j, 3, "E", "dark_grey")
    for j in LEFT_WINDOWS_J:
        m.place("window_1x2x2", 0, j, BAND[0], "W", "black")
    for j in RIGHT_WINDOWS_J:
        m.place("window_1x2x2", W - 1, j, BAND[0], "E", "black")
    m.place("window_1x2x2", 0, FRONT, BAND[0], "N", "black")      # split windscreen
    m.place("window_1x2x2", 3, FRONT, BAND[0], "N", "black")
    m.place("window_1x2x2", 1, 0, BAND[0], "S", "black")          # rear window
    m.box(1, W - 1, FRONT, L, 13, 14, "lamp_warm")                # destination sign
    for i in (0, W - 1):
        m.place("plate_1x1", i, FRONT, 4, "N", "lamp_warm")       # headlights
        m.place("plate_1x1", i, 0, 4, "S", "tower_red")           # tail lights
    m.box(0, W, FRONT, L, 3, 4, "dark_grey")                      # bumpers
    m.box(0, W, 0, 1, 3, 4, "dark_grey")
