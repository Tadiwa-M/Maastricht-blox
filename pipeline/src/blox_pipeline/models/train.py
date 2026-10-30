"""Regional train (one long car): 6 x 52 studs (3 m x 26 m), 18 plates (3.6 m) tall.

Original design for the Maastricht <-> Maastricht Randwyck line. Forward is +j (cab with
windscreen and headlights at the high-j end). Same recipe as the bus: special pieces first, then
the body poured around them with ``box``; the saloon stays hollow so a passenger camera fits.
The body colour is ``bus_red`` on purpose: the viewer recolours it per operator (life/livery.js).

    0..3    bogie wheels (round bricks, parts wheel_*), dark underframe
    3..6    body skirt
    6..12   window band, windows on both sides, doors on both sides
    12..17  upper band with a lit destination sign at both ends
    17..18  grey roof of tiles
"""

from __future__ import annotations

from .builder import ModelBuilder

W, L, H = 6, 52, 18
FRONT = L - 1
WHEELS = {"wheel_rl": (0, 6), "wheel_rr": (W - 1, 6), "wheel_fl": (0, L - 7), "wheel_fr": (W - 1, L - 7)}
DOORS_J = (12, 25, 38)                                # both sides
BAND = (6, 12)


def _windows_j() -> list[int]:
    doors = {d + k for d in DOORS_J for k in (0, 1)}
    return [j for j in range(3, L - 4, 2) if j not in doors and j + 1 not in doors]


def build_train() -> ModelBuilder:
    m = ModelBuilder("train", (W, L, H), (W / 2, L / 2, 0.0))
    for name, (i, j) in WHEELS.items():
        part = m.part(name, (i + 0.5, j + 0.5, 1.5))
        m.place("round_brick_1x1", i, j, 0, "N", "black", part)
    m.box(1, W - 1, 2, L - 2, 1, 3, "dark_grey")                    # underframe
    for j in DOORS_J:
        m.place("door_1x2x4", W - 1, j, 3, "E", "dark_grey")
        m.place("door_1x2x4", 0, j, 3, "W", "dark_grey")
    for j in _windows_j():
        m.place("window_1x2x2", 0, j, BAND[0], "W", "black")
        m.place("window_1x2x2", W - 1, j, BAND[0], "E", "black")
    for i in (1, 3):                                                # windscreens, both ends
        m.place("window_1x2x2", i, FRONT, BAND[0], "N", "black")
        m.place("window_1x2x2", i, 0, BAND[0], "S", "black")
    m.box(1, W - 1, FRONT, L, 13, 14, "lamp_warm")                  # destination signs
    m.box(1, W - 1, 0, 1, 13, 14, "lamp_warm")
    for i in (0, W - 1):
        m.place("plate_1x1", i, FRONT, 4, "N", "lamp_warm")         # headlights
        m.place("plate_1x1", i, 0, 4, "S", "tower_red")             # tail lights
    m.box(0, W, 2, L - 2, 3, BAND[0], "bus_red")                    # skirt
    m.box(0, W, 0, L, 3, BAND[0], "bus_red")
    for i in (0, W - 1):
        m.box(i, i + 1, 0, L, *BAND, "bus_red")                     # side pillars
    for j in (0, FRONT):
        m.box(0, W, j, j + 1, *BAND, "bus_red")                     # cab ends
    m.box(0, W, 0, L, BAND[1], H - 1, "bus_red")                    # upper band
    m.box(0, W, 0, L, H - 1, H, "light_grey", top="tile")           # roof
    return m
