"""The Stadhuis on the Markt (owner's photo 80121e52, ``docs/reference/markt.md``) as a
hand-authored brick model, painted with the facade ``Painter`` API.

Model frame (like a run frame): ``x`` along the main front (``0 .. W``), ``y`` inward
(``0 .. D``), the front faces ``S``; ``g`` is the ground line. Inside the footprint, row 0
is the proud row (pilasters, bands, cornice), row 1 the wall plane, row 2 the room
backdrop; the central avant-corps, its 3-arch arcade and the perron with the double stair
stand in front of it (``y < 0``, up to ``FRONT_REACH`` rows out on the square).

Bottom to top: a limestone podium (raised ground floor at ``g + 9``) with cellar vents; two
tall storeys of white many-paned windows (``window_1x2x4`` under a ``window_1x2x2`` top
light) between limestone pilasters on all four sides; the avant-corps with the arcade
(three ``arch_1x6``), loggia, a balustrade balcony (``fence_1x4``) and a stepped pediment;
a projecting cornice; a hipped slate roof to a flat deck; on it the octagonal, lead-grey
bell tower: an oculus stage, a tall open arcaded stage, a gallery with a balustrade, the
clock stage with gold dials, an open bell lantern, a small dome, lantern, gold ball and vane.

Pieces that would straddle a chunk border (CONTRACT 4) are drawn as voxels instead
(``place_or``), so the model works at any position on the world grid or on an island.
"""

from __future__ import annotations

import math

from ..catalogue import load_catalogue
from ..rotation import Facing, rotated_extent
from .frame import Frame, FramePainter
from .painter import SLOPE_E, SLOPE_N, SLOPE_S, SLOPE_W, TILE, Painter

FRONT_REACH = 10      # rows the model reaches out in front of the footprint
MIN_W, MIN_D = 44, 36  # smallest footprint (studs) the model fits
WALL, STONE, PLINTH = "limestone_dark", "limestone", "dark_grey"
FRAME, ROOF, LEAD, GOLD = "white", "slate", "lead_grey", "gold"
G_FLOOR = 9            # raised ground floor above the ground line (plates)
STOREY = 28            # plates per storey (5.6 m)
CHUNK = 64


def _global_box(p: Painter, x0: int, x1: int, y0: int, y1: int) -> tuple[int, int, int, int]:
    while isinstance(p, FramePainter):
        x0, x1, y0, y1 = p.frame.box(x0, x1, y0, y1)
        p = p.inner
    return x0, x1, y0, y1


def fits(p: Painter, piece: str, x: int, y: int, facing: str = "S") -> bool:
    """The piece's box lies inside one chunk (in the innermost painter's coordinates)."""
    t = load_catalogue()[piece]
    ex, ey = rotated_extent(t.w, t.d, Facing.parse(facing).value)
    i0, i1, j0, j1 = _global_box(p, x, x + ex, y, y + ey)
    return i0 // CHUNK == (i1 - 1) // CHUNK and j0 // CHUNK == (j1 - 1) // CHUNK


def place_or(p: Painter, piece: str, x: int, y: int, k: int, colour: str, fid: int, stand_in: str | None,
             facing: str = "S") -> None:
    """Clear and place ``piece``; where it would straddle a chunk border paint ``stand_in``
    voxels instead (None leaves air)."""
    t = load_catalogue()[piece]
    ex, ey = rotated_extent(t.w, t.d, Facing.parse(facing).value)
    p.clear(x, x + ex, y, y + ey, k, k + t.h)
    if fits(p, piece, x, y, facing):
        p.place(piece, x, y, k, facing, colour, fid)
    elif stand_in is not None:
        p.fill(x, x + ex, y, y + ey, k, k + t.h, stand_in, fid)


def bays(x0: int, x1: int, step: int = 5) -> list[int]:
    """Window bay starts (2 wide) every ``step`` studs, centred in ``[x0, x1)``."""
    if x1 - x0 < 2:
        return []
    n = (x1 - x0 - 2) // step + 1
    start = x0 + (x1 - x0 - ((n - 1) * step + 2)) // 2
    return [start + q * step for q in range(n)]


def _window_stack(p: Painter, x: int, k: int, fid: int) -> int:
    """Tall window with a top light above it, in the wall plane (row 1); returns the top."""
    place_or(p, "window_1x2x4", x, 1, k, FRAME, fid, "glass")
    place_or(p, "window_1x2x2", x, 1, k + 12, FRAME, fid, "glass")
    p.fill(x, x + 2, 2, 3, k, k + 18, "black", fid)                       # rooms behind
    p.fill(x, x + 2, 0, 1, k - 1, k, STONE, fid)                          # sill
    p.fill(x - 1, x + 3, 0, 1, k + 18, k + 19, STONE, fid)                # lintel
    return k + 18


def side(p: Painter, length: int, g: int, fid: int, skip: tuple[int, int] = (0, 0)) -> None:
    """Details of one side (frame: x along it, row 0 proud, row 1 wall plane): plinth with
    vents, pilasters between bays, two storeys of windows, bands. ``skip`` leaves an
    ``[a, b)`` stretch (the avant-corps) alone."""
    G, C = g + G_FLOOR, g + G_FLOOR + 2 * STOREY + 1
    xs = [x for x in bays(3, length - 3) if not (skip[0] - 2 < x + 2 and x < skip[1] + 2)]
    for a, b in ((1, min(skip[0], length - 1)), (max(skip[1], 1), length - 1)):
        p.clear(a, b, 0, 1, G, C)                                        # proud row: air
    piers = {0, length - 1} | {x - 2 for x in xs} | ({xs[-1] + 3} if xs else set())
    for x in sorted(piers):
        if 0 <= x < length and not skip[0] <= x < skip[1]:
            p.fill(x, x + 1, 0, 1, G, C, STONE, fid)                     # pilasters
    for x in xs:
        p.clear(x, x + 2, 0, 1, g + 3, g + 5)
        place_or(p, "vent_1x2", x, 0, g + 3, "black", fid, "black")
        for k in (G + 5, G + STOREY + 6):
            _window_stack(p, x, k, fid)
    for a, b in ((0, skip[0]), (skip[1], length)):
        if b > a:
            p.fill(a, b, 0, 1, G + STOREY - 1, G + STOREY + 1, STONE, fid)  # storey band
            p.fill(a, b, -1, 0, G + STOREY, G + STOREY + 1, STONE, fid)


def _arcade(p: Painter, xa: int, g: int, fid: int) -> None:
    """3 arches over 4-stud openings at row -5, the loggia behind (rows -4, -3), the
    balcony on top with a balustrade, and the loggia's back wall (door, two windows)."""
    G = g + G_FLOOR
    top = G + 15                                       # springing of the arches
    p.fill(xa, xa + 22, -5, 0, g - 2, G, PLINTH, fid)    # podium under the arcade
    p.fill(xa, xa + 22, -5, 0, G, top + 14, WALL, fid)   # arcade block up to the balcony floor
    p.clear(xa + 1, xa + 21, -4, -2, G, top + 6)        # loggia
    for q in range(3):
        x = xa + 2 + 6 * q
        p.clear(x + 1, x + 5, -5, -4, G, top)           # opening
        place_or(p, "arch_1x6", x, -5, top, STONE, fid, None)
        if not fits(p, "arch_1x6", x, -5):              # voxel arch: stepped round head
            p.fill(x, x + 6, -5, -4, top, top + 6, STONE, fid)
            p.clear(x + 1, x + 5, -5, -4, top, top + 3)
            p.clear(x + 2, x + 4, -5, -4, top + 3, top + 5)
        place_or(p, "window_1x2x4", x + 2, -2, G + 2, FRAME, fid, "glass") if q != 1 else \
            place_or(p, "door_1x2x4", x + 2, -2, G, FRAME, fid, "black")
        p.fill(x + 2, x + 4, -1, 0, G, G + 14, "black", fid)
    F1 = G + STOREY + 1
    p.fill(xa, xa + 22, -5, -4, F1 - 2, F1, STONE, fid)                 # balcony cornice
    p.fill(xa, xa + 22, -6, -5, F1 - 1, F1, STONE, fid)
    for x in (xa, xa + 21):
        p.fill(x, x + 1, -5, -4, F1, F1 + 4, STONE, fid)                # balustrade posts
    for x in range(xa + 1, xa + 21 - 3, 5):
        place_or(p, "fence_1x4", x, -5, F1, STONE, fid, STONE)
        if x + 4 < xa + 21:
            p.fill(x + 4, x + 5, -5, -4, F1, F1 + 4, STONE, fid)
    p.fill(xa, xa + 22, -5, -4, F1 + 3, F1 + 4, STONE, fid)             # top rail


def _perron(p: Painter, xa: int, g: int, fid: int) -> None:
    """Landing in front of the arcade (rows -9..-6) with a balustrade, and a flight of steps
    down each side (the double stair)."""
    G = g + G_FLOOR
    p.fill(xa, xa + 22, -9, -5, g - 2, G, PLINTH, fid)
    p.fill(xa, xa + 22, -9, -5, G - 1, G, STONE, fid, TILE)
    for x in range(xa + 1, xa + 21 - 3, 5):
        place_or(p, "fence_1x4", x, -9, G, STONE, fid, STONE)
    for x in range(xa, xa + 22, 5):
        p.fill(x, x + 1, -9, -8, G, G + 4, STONE, fid)
    for s in range(1, G_FLOOR + 1):                # steps: one stud out, one plate down
        for x in (xa - s, xa + 21 + s):
            p.fill(x, x + 1, -9, -5, g - 2, G - 1 - s, PLINTH, fid)
            p.fill(x, x + 1, -9, -5, G - 1 - s, G - s, STONE, fid, TILE)


def _avant_corps(p: Painter, xa: int, g: int, fid: int) -> None:
    G = g + G_FLOOR
    F1, C = G + STOREY + 1, G + 2 * STOREY + 1
    p.fill(xa, xa + 22, -2, 1, F1, C, WALL, fid)
    for q in range(3):
        x = xa + 4 + 6 * q
        p.clear(x, x + 2, -2, -1, F1 + 4, F1 + 22)
        place_or(p, "window_1x2x4", x, -2, F1 + 4, FRAME, fid, "glass")
        place_or(p, "window_1x2x2", x, -2, F1 + 16, FRAME, fid, "glass")
        p.fill(x, x + 2, -1, 0, F1 + 4, F1 + 22, "black", fid)
        p.fill(x - 1, x + 3, -3, -2, F1 + 22, F1 + 23, STONE, fid)
    for x in (xa + 1, xa + 7, xa + 8, xa + 13, xa + 14, xa + 20):
        p.fill(x, x + 1, -3, -2, F1 + 4, C, STONE, fid)                # paired pilasters
    _cornice(p, xa, xa + 22, -3, C, fid)
    for s in range(12):                               # stepped pediment, 1 plate per 2 studs
        a, b = xa - 1 + s * 2, xa + 23 - s * 2
        if b - a < 2:
            break
        p.fill(a, b, -4, 1, C + 4 + s, C + 5 + s, STONE if s == 0 else WALL, fid)
    p.fill(xa + 7, xa + 15, -4, -3, C + 6, C + 9, PLINTH, fid)            # carved tympanum
    p.fill(xa + 10, xa + 12, -4, -3, C + 9, C + 11, PLINTH, fid)


def _cornice(p: Painter, x0: int, x1: int, y: int, C: int, fid: int) -> None:
    p.fill(x0 - 1, x1 + 1, y, y + 1, C, C + 4, STONE, fid)
    p.fill(x0 - 1, x1 + 1, y - 1, y, C + 2, C + 4, STONE, fid)
    for x in range(x0, x1, 3):
        p.fill(x, x + 1, y - 1, y, C + 1, C + 2, STONE, fid)


def _hip_roof(p: Painter, W: int, D: int, k0: int, levels: int, fid: int) -> int:
    """Hipped slate roof: per level a ring of slope stacks with a full ring behind; returns
    the k of the flat deck on top."""
    for t in range(levels):
        a0, a1, b0, b1, k = t, W - t, t, D - t, k0 + 3 * t
        p.fill(a0, a1, b0 + 1, b1 - 1, k, k + 3, ROOF, fid)
        p.clear(a0 + 2, a1 - 2, b0 + 2, b1 - 2, k, k + 3)
        p.fill(a0, a1, b0, b0 + 1, k, k + 3, ROOF, fid, SLOPE_S)
        p.fill(a0, a1, b1 - 1, b1, k, k + 3, ROOF, fid, SLOPE_N)
        p.fill(a0, a0 + 1, b0 + 1, b1 - 1, k, k + 3, ROOF, fid, SLOPE_W)
        p.fill(a1 - 1, a1, b0 + 1, b1 - 1, k, k + 3, ROOF, fid, SLOPE_E)
    t = levels
    deck = k0 + 3 * t
    p.fill(t, W - t, t, D - t, deck, deck + 1, LEAD, fid, TILE)
    return deck + 1


def _octagon(r: float) -> list[tuple[int, int]]:
    """Cells (dx, dy) of an octagon of radius ``r`` round the centre point (0, 0) of a
    cell corner (so the tower is symmetric)."""
    out = []
    n = int(math.ceil(r))
    for dx in range(-n, n):
        for dy in range(-n, n):
            cx, cy = dx + 0.5, dy + 0.5
            if abs(cx) <= r and abs(cy) <= r and abs(cx) + abs(cy) <= r * 1.42:
                out.append((dx, dy))
    return out


def _ring(p: Painter, cx: int, cy: int, r: float, k0: int, k1: int, colour: str, fid: int,
          inner: float | None = None) -> None:
    hole = set(_octagon(inner)) if inner else set()
    for dx, dy in _octagon(r):
        if (dx, dy) not in hole:
            p.fill(cx + dx, cx + dx + 1, cy + dy, cy + dy + 1, k0, k1, colour, fid)


def _open_stage(p: Painter, cx: int, cy: int, r: float, k0: int, h: int, fid: int) -> None:
    """Octagonal stage with an arched opening in each cardinal face (white jambs and round
    heads) and a round window in each diagonal face, a dark core so the openings read deep."""
    _ring(p, cx, cy, r, k0, k0 + h, LEAD, fid, inner=r - 1)
    _ring(p, cx, cy, r - 3, k0, k0 + h, "dark_grey", fid)   # the bells' room, in shadow
    n = int(math.ceil(r))
    w = max(1, int(r * 0.3))
    faces = [lambda t: (t, -n), lambda t: (t, n - 1), lambda t: (-n, t), lambda t: (n - 1, t)]
    for face in faces:
        for t in range(-w, w):
            ax, ay = face(t)
            p.clear(cx + ax, cx + ax + 1, cy + ay, cy + ay + 1, k0 + 2, k0 + h - 3)
            if t in (-w, w - 1):  # round head: the outer columns close lower
                p.fill(cx + ax, cx + ax + 1, cy + ay, cy + ay + 1, k0 + h - 6, k0 + h - 3, FRAME, fid)
        for t in (-w - 1, w):     # white jambs either side of the opening
            ax, ay = face(t)
            p.fill(cx + ax, cx + ax + 1, cy + ay, cy + ay + 1, k0 + 2, k0 + h - 3, FRAME, fid)
        for t in range(-w - 1, w + 1):
            ax, ay = face(t)
            p.fill(cx + ax, cx + ax + 1, cy + ay, cy + ay + 1, k0 + h - 3, k0 + h - 2, FRAME, fid)
    d = int(r * 0.7)
    for sx, sy in ((-1, -1), (1, -1), (-1, 1), (1, 1)):
        x, y = cx + (d if sx > 0 else -d - 1), cy + (d if sy > 0 else -d - 1)
        p.fill(x, x + 1, y, y + 1, k0 + h // 2 - 2, k0 + h // 2 + 2, FRAME, fid)


# tower stages, bottom to top: (kind, radius, plates)
TOWER = (("base", 10.5, 12), ("trim", 10.5, 1), ("open", 9.5, 30), ("gallery", 10.5, 2),
         ("clock", 8.5, 16), ("trim", 8.5, 1), ("open", 7.5, 18), ("dome", 0, 15), ("lantern", 1.5, 6),
         ("vane", 0, 12))


def tower_height() -> int:
    return sum(h for _, _, h in TOWER)


def tower(p: Painter, cx: int, cy: int, k: int, fid: int) -> int:
    """The octagonal, lead-grey bell tower standing on the roof deck at ``k``; returns its top."""
    for kind, r, h in TOWER:
        n = int(math.ceil(r))
        if kind == "base":
            _ring(p, cx, cy, r, k, k + h, LEAD, fid)
            for ax, ay, wx, wy in ((cx - 1, cy - n, 2, 1), (cx - 1, cy + n - 1, 2, 1),
                                   (cx - n, cy - 1, 1, 2), (cx + n - 1, cy - 1, 1, 2)):
                p.fill(ax, ax + wx, ay, ay + wy, k + 4, k + 8, FRAME, fid)        # oculi
                p.fill(ax + (wx > 1) * 0, ax + wx, ay, ay + wy, k + 5, k + 7, "glass", fid)
        elif kind == "trim":
            _ring(p, cx, cy, r, k, k + h, FRAME, fid)
        elif kind == "open":
            _open_stage(p, cx, cy, r, k, h, fid)
        elif kind == "gallery":
            _ring(p, cx, cy, r, k, k + h, FRAME, fid)
            _ring(p, cx, cy, r, k + h, k + h + 3, LEAD, fid, inner=r - 1)   # parapet
            for x0, y0, face in ((cx - 2, cy - n, "S"), (cx - 2, cy + n - 1, "N")):
                p.clear(x0, x0 + 4, y0, y0 + 1, k + h, k + h + 3)
                place_or(p, "fence_1x4", x0, y0, k + h, FRAME, fid, FRAME, face)
            for x0, y0, face in ((cx - n, cy - 2, "W"), (cx + n - 1, cy - 2, "E")):
                p.clear(x0, x0 + 1, y0, y0 + 4, k + h, k + h + 3)
                place_or(p, "fence_1x4", x0, y0, k + h, FRAME, fid, FRAME, face)
        elif kind == "clock":
            _ring(p, cx, cy, r, k, k + h, LEAD, fid)
            for ax, ay, wx, wy in ((cx - 2, cy - n, 4, 1), (cx - 2, cy + n - 1, 4, 1),
                                   (cx - n, cy - 2, 1, 4), (cx + n - 1, cy - 2, 1, 4)):
                p.fill(ax, ax + wx, ay, ay + wy, k + 4, k + 12, GOLD, fid)        # gold dials
                if wx > 1:
                    p.fill(ax + 1, ax + 3, ay, ay + 1, k + 7, k + 9, "black", fid)  # hands
                else:
                    p.fill(ax, ax + 1, ay + 1, ay + 3, k + 7, k + 9, "black", fid)
        elif kind == "dome":
            kk = k
            for rr, hh in ((8.0, 2), (7.0, 3), (6.0, 3), (4.5, 3), (3.0, 2), (2.0, 2)):
                _ring(p, cx, cy, rr, kk, kk + hh, LEAD, fid)
                kk += hh
        elif kind == "lantern":
            _ring(p, cx, cy, r, k, k + h, LEAD, fid)
        elif kind == "vane":
            p.fill(cx - 1, cx + 1, cy - 1, cy + 1, k, k + 3, GOLD, fid)     # ball
            p.fill(cx, cx + 1, cy - 1, cy, k + 3, k + h, GOLD, fid)         # rod
            p.fill(cx, cx + 2, cy - 1, cy, k + h - 3, k + h - 2, GOLD, fid)  # vane
        k += h
    return k


def paint_stadhuis(p: Painter, W: int, D: int, g: int, fid: int, ground_low: int | None = None) -> int:
    """Paint the whole model into ``[0, W) x [0, D)`` (plus the front reach) with ground line
    ``g``; ``ground_low`` (lowest ground under the footprint) extends the podium down.
    Returns the top k (the vane)."""
    low = min(g, ground_low if ground_low is not None else g) - 2
    G = g + G_FLOOR
    C = G + 2 * STOREY + 1
    p.fill(0, W, 0, D, low, C, WALL, fid)                         # shell
    p.clear(3, W - 3, 3, D - 3, g, C)
    p.fill(0, W, 0, 1, low, G, PLINTH, fid)                       # podium courses (all sides)
    p.fill(0, W, D - 1, D, low, G, PLINTH, fid)
    p.fill(0, 1, 0, D, low, G, PLINTH, fid)
    p.fill(W - 1, W, 0, D, low, G, PLINTH, fid)
    xa = W // 2 - 11
    side(p, W, g, fid, skip=(xa - 1, xa + 23))
    for frame, length in ((Frame("E", W - 1, 0), D), (Frame("N", W - 1, D - 1), W), (Frame("W", 0, D - 1), D)):
        side(FramePainter(p, frame), length, g, fid)
    _arcade(p, xa, g, fid)
    _perron(p, xa, g, fid)
    _avant_corps(p, xa, g, fid)
    for frame, length in ((Frame("S", 0, 0), W), (Frame("E", W - 1, 0), D), (Frame("N", W - 1, D - 1), W),
                          (Frame("W", 0, D - 1), D)):
        fp = FramePainter(p, frame)
        if frame.normal == "S":
            _cornice(fp, 0, xa - 1, 0, C, fid)
            _cornice(fp, xa + 23, W, 0, C, fid)
        else:
            _cornice(fp, 0, length, 0, C, fid)
    deck = _hip_roof(p, W, D, C + 4, roof_levels(W, D), fid)
    return tower(p, W // 2, D // 2, deck, fid)


def roof_levels(W: int, D: int) -> int:
    return max(4, min(13, min(W, D) // 2 - 10))


def model_height(W: int, D: int) -> int:
    """Plates from the ground line to the top of the vane (for tile height and occupancy)."""
    return G_FLOOR + 2 * STOREY + 1 + 4 + 3 * roof_levels(W, D) + 1 + tower_height()
