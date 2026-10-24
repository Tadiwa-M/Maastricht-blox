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
BAND, CARVING, IRON, BRONZE = "dark_grey", "mergel", "black", "dark_tan"
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
    """3 round arches on piers at row -5 (a low balustrade in each opening), the loggia
    behind (rows -4, -3), the full-width balustraded balcony on top, and the loggia's back
    wall (a door and two windows)."""
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
        place_or(p, "fence_1x4", x + 1, -5, G, STONE, fid, STONE)      # balustrade in the arch
        for xx in (x, x + 5):                                          # piers with impost blocks
            p.fill(xx, xx + 1, -6, -5, G, top, STONE, fid)
            p.fill(xx, xx + 1, -6, -5, top - 1, top + 1, WALL, fid)
        if q != 1:
            place_or(p, "window_1x2x4", x + 2, -2, G + 2, FRAME, fid, "glass")
        else:
            place_or(p, "door_1x2x4", x + 2, -2, G, FRAME, fid, "black")
            place_or(p, "window_1x2x2", x + 2, -2, G + 12, FRAME, fid, "glass")  # fanlight
        p.fill(x + 2, x + 4, -1, 0, G, G + 18, "black", fid)
        p.fill(x + 2, x + 4, -6, -5, top + 5, top + 7, STONE, fid)     # keystone
    F1 = G + STOREY + 1
    p.fill(xa - 1, xa + 23, -6, -4, F1 - 3, F1, STONE, fid)            # balcony slab and cornice
    p.fill(xa - 1, xa + 23, -7, -6, F1 - 1, F1, STONE, fid)
    for x in range(xa, xa + 22, 3):
        p.fill(x, x + 1, -7, -6, F1 - 3, F1 - 1, STONE, fid)           # consoles
    _balustrade(p, xa - 1, xa + 23, -6, F1, fid)


def _balustrade(p: Painter, x0: int, x1: int, y: int, k: int, fid: int, colour: str = STONE) -> None:
    """Posts, ``fence_1x4`` balusters between them and a top rail, along row ``y``."""
    x = x0
    p.fill(x0, x0 + 1, y, y + 1, k, k + 4, colour, fid)
    x = x0 + 1
    while x + 5 <= x1:
        place_or(p, "fence_1x4", x, y, k, colour, fid, colour)
        p.fill(x + 4, x + 5, y, y + 1, k, k + 4, colour, fid)
        x += 5
    if x < x1:
        p.fill(x, x1, y, y + 1, k, k + 4, colour, fid)
    p.fill(x0, x1, y, y + 1, k + 3, k + 4, colour, fid)


def _perron(p: Painter, xa: int, g: int, fid: int) -> None:
    """Landing in front of the arcade (rows -9..-6) with a balustrade, and the double stair:
    a flight down each side, its outer edge a stone parapet that steps down with it."""
    G = g + G_FLOOR
    p.fill(xa, xa + 22, -9, -5, g - 2, G, PLINTH, fid)
    p.fill(xa, xa + 22, -9, -5, G - 1, G, STONE, fid, TILE)
    _balustrade(p, xa, xa + 22, -9, G, fid)
    for s in range(1, G_FLOOR + 1):                # steps: one stud out, one plate down
        for x in (xa - s, xa + 21 + s):
            p.fill(x, x + 1, -9, -5, g - 2, G - 1 - s, PLINTH, fid)
            p.fill(x, x + 1, -9, -5, G - 1 - s, G - s, STONE, fid, TILE)
            p.fill(x, x + 1, -10, -9, g - 2, G + 3 - s, STONE, fid)     # parapet
    for x in (xa - G_FLOOR - 1, xa + 22 + G_FLOOR):                  # newel posts
        p.fill(x, x + 1, -10, -9, g - 2, g + 6, STONE, fid)
        p.place("round_tile_1x1", x, -10, g + 6, "N", STONE, fid) if fits(p, "round_tile_1x1", x, -10) else None


def _fence(p: Painter, x0: int, x1: int, y: int, g: int, fid: int) -> None:
    """Wrought-iron railing (black ``fence_1x4`` under a rail, on a stone kerb) with gilt
    post tips, and a gate between two tall stone piers in the middle."""
    p.fill(x0, x1, y, y + 1, g - 2, g, PLINTH, fid)
    n = (x1 - x0 - 1) // 5
    gate = n // 2
    for q in range(n):
        x = x0 + 5 * q
        if q in (gate, gate + 1):
            p.fill(x, x + 1, y, y + 1, g, g + 9, STONE, fid)                # gate pier
            p.fill(x, x + 1, y, y + 1, g + 9, g + 10, PLINTH, fid)
        else:
            p.fill(x, x + 1, y, y + 1, g, g + 5, IRON, fid)
            if fits(p, "round_tile_1x1", x, y):
                p.place("round_tile_1x1", x, y, g + 5, "N", GOLD, fid)
        place_or(p, "fence_1x4", x + 1, y, g, IRON, fid, None)
        p.fill(x + 1, x + 5, y, y + 1, g + 3, g + 4, IRON, fid)               # top rail
        if q == gate:
            p.fill(x + 1, x + 5, y, y + 1, g + 5, g + 6, IRON, fid)           # gate overthrow
    x = x0 + 5 * n
    p.fill(x, x + 1, y, y + 1, g, g + 9 if n in (gate, gate + 1) else g + 5, STONE if n == gate + 1 else IRON, fid)


def _avant_corps(p: Painter, xa: int, g: int, fid: int) -> None:
    """The risalit above the arcade: first floor with three tall windows behind the balcony,
    an attic storey that rises above the wings' cornice, a pediment with a carved relief
    and carved ornaments on its corners."""
    G = g + G_FLOOR
    F1, C = G + STOREY + 1, G + 2 * STOREY + 1
    A = C + 4                                      # attic floor
    T = A + 20                                     # attic cornice
    p.fill(xa, xa + 22, -2, 6, F1, T, WALL, fid)
    for q in range(3):
        x = xa + 4 + 6 * q
        place_or(p, "window_1x2x4", x, -2, F1 + 4, FRAME, fid, "glass")
        place_or(p, "window_1x2x2", x, -2, F1 + 16, FRAME, fid, "glass")
        p.fill(x, x + 2, -1, 0, F1 + 4, F1 + 22, "black", fid)
        p.fill(x - 1, x + 3, -3, -2, F1 + 22, F1 + 23, STONE, fid)
        place_or(p, "pediment_1x4", x - 1, -3, F1 + 23, STONE, fid, STONE)  # window pediments
        place_or(p, "window_1x2x3", x, -2, A + 5, FRAME, fid, "glass")      # attic windows
        p.fill(x, x + 2, -1, 0, A + 5, A + 14, "black", fid)
        p.fill(x - 1, x + 3, -3, -2, A + 4, A + 5, STONE, fid)
    for x in (xa, xa + 7, xa + 8, xa + 13, xa + 14, xa + 21):
        p.fill(x, x + 1, -3, -2, F1, T, STONE, fid)                    # paired giant pilasters
    for k in range(F1, T, 6):                                          # rusticated quoins
        p.fill(xa - 1, xa, -2, 0, k, k + 3, STONE, fid)
        p.fill(xa + 22, xa + 23, -2, 0, k, k + 3, STONE, fid)
    _cornice(p, xa, xa + 22, -3, C, fid)                               # band at the wings' eaves
    _cornice(p, xa, xa + 22, -3, T, fid)
    p.fill(xa - 1, xa + 23, -2, 6, T + 3, T + 4, ROOF, fid, TILE)      # roof behind the pediment
    top = T + 4
    for s in range(13):                               # pediment, 1 plate per stud
        a, b = xa - 1 + s, xa + 23 - s
        if b - a < 2:
            break
        p.fill(a, b, -4, -2, top + s, top + s + 1, STONE if s == 0 else WALL, fid)
        p.fill(a, a + 1, -5, -4, top + s, top + s + 1, STONE, fid)    # raking cornice
        p.fill(b - 1, b, -5, -4, top + s, top + s + 1, STONE, fid)
    for dx, dk, w, h in ((-6, 2, 3, 2), (3, 2, 3, 2), (-3, 2, 6, 3), (-2, 5, 4, 2), (-1, 7, 2, 2)):
        p.fill(xa + 11 + dx, xa + 11 + dx + w, -5, -4, top + dk, top + dk + h, CARVING, fid)  # relief
    for x in (xa - 1, xa + 21):                        # carved corner ornaments (cartouches)
        p.fill(x, x + 2, -4, -2, top, top + 7, CARVING, fid)
        p.fill(x, x + 2, -5, -4, top + 2, top + 5, CARVING, fid)
        p.place("round_tile_1x1", x, -4, top + 7, "N", CARVING, fid) if fits(p, "round_tile_1x1", x, -4) else None


def _side_pediment(p: Painter, length: int, C: int, fid: int) -> None:
    """A low pediment over the middle of a side front (side frame, row 0 proud)."""
    w = min(30, length - 12)
    a0 = (length - w) // 2
    for s in range(w // 2):
        a, b = a0 + s, a0 + w - s
        if b - a < 2:
            break
        p.fill(a, b, 0, 3, C + 4 + s, C + 5 + s, STONE if s == 0 else WALL, fid)
        p.fill(a, a + 1, -1, 0, C + 4 + s, C + 5 + s, STONE, fid)
        p.fill(b - 1, b, -1, 0, C + 4 + s, C + 5 + s, STONE, fid)
    m = length // 2
    p.fill(m - 3, m + 3, -1, 0, C + 6, C + 8, CARVING, fid)
    p.fill(m - 1, m + 1, -1, 0, C + 8, C + 10, CARVING, fid)


def _cornice(p: Painter, x0: int, x1: int, y: int, C: int, fid: int) -> None:
    p.fill(x0 - 1, x1 + 1, y, y + 1, C, C + 4, STONE, fid)
    p.fill(x0 - 1, x1 + 1, y - 1, y, C + 2, C + 4, STONE, fid)
    for x in range(x0, x1, 3):
        p.fill(x, x + 1, y - 1, y, C + 1, C + 2, STONE, fid)


def _hip_roof(p: Painter, W: int, D: int, k0: int, levels: int, fid: int) -> int:
    """Hipped slate roof: per level a ring of slope stacks with a full ring behind, lead on
    the hips; returns the k of the flat deck on top."""
    for t in range(levels):
        a0, a1, b0, b1, k = t, W - t, t, D - t, k0 + 3 * t
        p.fill(a0, a1, b0 + 1, b1 - 1, k, k + 3, ROOF, fid)
        p.clear(a0 + 2, a1 - 2, b0 + 2, b1 - 2, k, k + 3)
        p.fill(a0, a1, b0, b0 + 1, k, k + 3, ROOF, fid, SLOPE_S)
        p.fill(a0, a1, b1 - 1, b1, k, k + 3, ROOF, fid, SLOPE_N)
        p.fill(a0, a0 + 1, b0 + 1, b1 - 1, k, k + 3, ROOF, fid, SLOPE_W)
        p.fill(a1 - 1, a1, b0 + 1, b1 - 1, k, k + 3, ROOF, fid, SLOPE_E)
        for x, y, sh in ((a0, b0, SLOPE_S), (a1 - 1, b0, SLOPE_S), (a0, b1 - 1, SLOPE_N), (a1 - 1, b1 - 1, SLOPE_N)):
            p.fill(x, x + 1, y, y + 1, k, k + 3, LEAD, fid, sh)          # lead-covered hips
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


def _faces(n: int):
    """Cell of each cardinal face of an octagon (outer row ``n``) at offset ``t`` along it."""
    return [lambda t: (t, -n), lambda t: (t, n - 1), lambda t: (-n, t), lambda t: (n - 1, t)]


def _diagonal_windows(p: Painter, cx: int, cy: int, r: float, k: int, fid: int, h: int = 3) -> None:
    """Small round windows (glass with a white rim) on the four diagonal faces."""
    d = int(r * 0.7)
    for sx, sy in ((-1, -1), (1, -1), (-1, 1), (1, 1)):
        x, y = cx + (d if sx > 0 else -d - 1), cy + (d if sy > 0 else -d - 1)
        p.fill(x, x + 1, y, y + 1, k - 1, k + h + 1, FRAME, fid)
        p.fill(x, x + 1, y, y + 1, k, k + h, "glass", fid)


def _arched_stage(p: Painter, cx: int, cy: int, r: float, k0: int, h: int, fid: int, glazed: bool,
                  bells: bool = False) -> None:
    """Octagonal stage with a tall round-headed arch in each cardinal face, white columns at
    the jambs and a white arch band; ``glazed`` fills the arches with a window (glass and
    a white mullion), else they are open on a dark room (with bronze bells)."""
    _ring(p, cx, cy, r, k0, k0 + h, LEAD, fid, inner=r - 1)
    _ring(p, cx, cy, r - 3, k0, k0 + h, "dark_grey", fid)
    n = int(math.ceil(r))
    w = max(1, int(r * 0.3))
    for face in _faces(n):
        for t in range(-w, w):
            ax, ay = face(t)
            c = (cx + ax, cx + ax + 1, cy + ay, cy + ay + 1)
            p.clear(*c, k0 + 2, k0 + h - 3)
            if glazed:
                p.fill(*c, k0 + 2, k0 + h - 3, FRAME if t == 0 else "glass", fid)
            if t in (-w, w - 1):  # round head: the outer columns close lower
                p.fill(*c, k0 + h - 6, k0 + h - 3, FRAME, fid)
        for t in (-w - 1, w):     # white columns either side of the arch
            ax, ay = face(t)
            p.fill(cx + ax, cx + ax + 1, cy + ay, cy + ay + 1, k0 + 2, k0 + h - 3, FRAME, fid)
        for t in range(-w - 1, w + 1):
            ax, ay = face(t)
            p.fill(cx + ax, cx + ax + 1, cy + ay, cy + ay + 1, k0 + h - 3, k0 + h - 2, FRAME, fid)
            p.fill(cx + ax, cx + ax + 1, cy + ay, cy + ay + 1, k0, k0 + 2, FRAME, fid)  # sill band
    if bells:
        m = int(math.ceil(r - 3))
        for face in _faces(m):
            ax, ay = face(-1)
            bx, by = face(0)
            p.fill(min(cx + ax, cx + bx), max(cx + ax, cx + bx) + 1, min(cy + ay, cy + by),
                   max(cy + ay, cy + by) + 1, k0 + h // 2 - 2, k0 + h // 2 + 3, BRONZE, fid)
    _diagonal_windows(p, cx, cy, r, k0 + h // 2, fid)


def _square_base(p: Painter, cx: int, cy: int, r: int, k: int, h: int, fid: int) -> None:
    """Square lead-grey plinth stage on the roof with a dormer facing the front."""
    p.fill(cx - r, cx + r, cy - r, cy + r, k, k + h, LEAD, fid)
    p.fill(cx - r - 1, cx + r + 1, cy - r - 1, cy + r + 1, k + h - 1, k + h, FRAME, fid)
    x, y = cx - 2, cy - r - 2
    p.fill(x - 1, x + 5, y, y + 3, k, k + 8, LEAD, fid)                     # dormer
    place_or(p, "window_1x2x2", x + 1, y, k + 1, FRAME, fid, "glass")
    p.fill(x + 1, x + 3, y + 1, y + 2, k + 1, k + 7, "black", fid)
    p.fill(x - 1, x, y - 1, y + 3, k + 8, k + 11, LEAD, fid, SLOPE_W)
    p.fill(x + 4, x + 5, y - 1, y + 3, k + 8, k + 11, LEAD, fid, SLOPE_E)
    p.fill(x, x + 4, y - 1, y + 3, k + 8, k + 11, LEAD, fid)
    p.fill(x + 1, x + 3, y - 1, y + 3, k + 11, k + 14, LEAD, fid)


# tower stages, bottom to top: (kind, radius, plates), as in the owner's close photo
TOWER = (("base", 11, 12), ("oculi", 9.5, 6), ("windows", 9.5, 28), ("trim", 9.5, 1), ("clock", 8.5, 16),
         ("gallery", 10.5, 2), ("belfry", 7.5, 20), ("trim", 7.5, 1), ("dome", 0, 16), ("lantern", 2.0, 7),
         ("vane", 0, 14))


def tower_height() -> int:
    return sum(h for _, _, h in TOWER)  # the gallery parapet stands within the belfry's foot


def tower(p: Painter, cx: int, cy: int, k: int, fid: int) -> int:
    """The lead-grey bell tower standing on the roof deck at ``k``; returns its top: a square
    base with a dormer, a row of oval oculi, an octagon of tall arched windows, the clock
    stage (gold dials, round windows), a projecting balustraded gallery with flags, the open
    belfry with its bells, a bell-shaped dome, a lantern, a gilded orb and the vane."""
    for kind, r, h in TOWER:
        n = int(math.ceil(r))
        if kind == "base":
            _square_base(p, cx, cy, int(r), k, h, fid)
        elif kind == "oculi":
            _ring(p, cx, cy, r, k, k + h, FRAME, fid)
            for dx, dy in _octagon(r):
                if (dx, dy) not in set(_octagon(r - 1)) and (dx + dy) % 3 == 0:
                    p.fill(cx + dx, cx + dx + 1, cy + dy, cy + dy + 1, k + 2, k + 4, "glass", fid)
        elif kind == "windows":
            _arched_stage(p, cx, cy, r, k, h, fid, glazed=True)
        elif kind == "trim":
            _ring(p, cx, cy, r + 0.5, k, k + h, FRAME, fid)
        elif kind == "clock":
            _ring(p, cx, cy, r, k, k + h, LEAD, fid)
            for ax, ay, wx, wy in ((cx - 2, cy - n, 4, 1), (cx - 2, cy + n - 1, 4, 1),
                                   (cx - n, cy - 2, 1, 4), (cx + n - 1, cy - 2, 1, 4)):
                p.fill(ax, ax + wx, ay, ay + wy, k + 3, k + 13, "black", fid)      # dial ring
                if wx > 1:
                    p.fill(ax + 1, ax + 3, ay, ay + 1, k + 4, k + 12, GOLD, fid)
                    p.fill(ax, ax + 4, ay, ay + 1, k + 6, k + 10, GOLD, fid)
                    p.fill(ax + 2, ax + 3, ay, ay + 1, k + 7, k + 11, "black", fid)  # hands
                    p.fill(ax + 1, ax + 3, ay, ay + 1, k + 7, k + 8, "black", fid)
                else:
                    p.fill(ax, ax + 1, ay + 1, ay + 3, k + 4, k + 12, GOLD, fid)
                    p.fill(ax, ax + 1, ay, ay + 4, k + 6, k + 10, GOLD, fid)
                    p.fill(ax, ax + 1, ay + 2, ay + 3, k + 7, k + 11, "black", fid)
                    p.fill(ax, ax + 1, ay + 1, ay + 3, k + 7, k + 8, "black", fid)
            _diagonal_windows(p, cx, cy, r, k + 6, fid)
        elif kind == "gallery":
            _ring(p, cx, cy, r, k, k + h, FRAME, fid)
            _ring(p, cx, cy, r, k + h, k + h + 3, LEAD, fid, inner=r - 1)   # parapet
            for x0, y0, face in ((cx - 2, cy - n, "S"), (cx - 2, cy + n - 1, "N")):
                p.clear(x0, x0 + 4, y0, y0 + 1, k + h, k + h + 3)
                place_or(p, "fence_1x4", x0, y0, k + h, LEAD, fid, LEAD, face)
            for x0, y0, face in ((cx - n, cy - 2, "W"), (cx + n - 1, cy - 2, "E")):
                p.clear(x0, x0 + 1, y0, y0 + 4, k + h, k + h + 3)
                place_or(p, "fence_1x4", x0, y0, k + h, LEAD, fid, LEAD, face)
            for fx, fy, flag in ((cx - 5, cy - n + 2, ("bus_red", "white", "dark_blue")),
                                 (cx + 4, cy - n + 2, ("dark_blue", "dark_blue", "signal_yellow"))):
                p.fill(fx, fx + 1, fy, fy + 1, k + h + 3, k + h + 15, "black", fid)  # flag pole
                for q, c in enumerate(flag):                                       # the flag
                    p.fill(fx, fx + 1, fy - 3, fy, k + h + 14 - 2 * q, k + h + 15 - 2 * q + 1, c, fid)
        elif kind == "belfry":
            _arched_stage(p, cx, cy, r, k + 3, h - 3, fid, glazed=False, bells=True)
            _ring(p, cx, cy, r, k, k + 3, LEAD, fid)
        elif kind == "dome":
            kk = k
            for rr, hh in ((8.5, 2), (8.0, 2), (7.0, 3), (6.0, 3), (4.5, 2), (3.0, 2), (2.0, 2)):
                _ring(p, cx, cy, rr, kk, kk + hh, LEAD, fid)                    # bell-shaped dome
                kk += hh
        elif kind == "lantern":
            _ring(p, cx, cy, r, k, k + h, LEAD, fid)
            for face in _faces(2):
                ax, ay = face(0)
                p.fill(cx + ax, cx + ax + 1, cy + ay, cy + ay + 1, k + 2, k + 5, "dark_grey", fid)
            _ring(p, cx, cy, r + 0.5, k + h - 1, k + h, LEAD, fid)
        elif kind == "vane":
            p.fill(cx - 1, cx + 1, cy - 1, cy + 1, k, k + 4, GOLD, fid)     # gilded orb
            p.fill(cx, cx + 1, cy - 1, cy, k + 4, k + h, IRON, fid)         # rod
            p.fill(cx - 1, cx + 2, cy - 1, cy, k + h - 7, k + h - 6, IRON, fid)  # cross arms
            p.fill(cx, cx + 3, cy - 1, cy, k + h - 4, k + h - 2, GOLD, fid)  # the vane
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
    for k in range(G + 4, C, 6):                                   # darker stone courses
        p.fill(0, W, 0, D, k, k + 2, BAND, fid)
    p.clear(3, W - 3, 3, D - 3, g, C)
    for x, y in ((0, 0), (W - 1, 0), (0, D - 1), (W - 1, D - 1)):  # quoins
        for k in range(G, C, 6):
            p.fill(x, x + 1, y, y + 1, k, k + 3, STONE, fid)
    p.fill(0, W, 0, 1, low, G, PLINTH, fid)                       # podium courses (all sides)
    p.fill(0, W, D - 1, D, low, G, PLINTH, fid)
    p.fill(0, 1, 0, D, low, G, PLINTH, fid)
    p.fill(W - 1, W, 0, D, low, G, PLINTH, fid)
    xa = W // 2 - 11
    side(p, W, g, fid, skip=(xa - 1, xa + 23))
    sides = ((Frame("E", W - 1, 0), D), (Frame("N", W - 1, D - 1), W), (Frame("W", 0, D - 1), D))
    for frame, length in sides:
        side(FramePainter(p, frame), length, g, fid)
    _arcade(p, xa, g, fid)
    _perron(p, xa, g, fid)
    for x0, x1 in ((3, xa - G_FLOOR - 3), (xa + 22 + G_FLOOR + 3, W - 3)):
        if x1 - x0 >= 10:
            _fence(p, x0, x1, -7, g, fid)                          # railings and gates
    for frame, length in ((Frame("S", 0, 0), W), *sides):
        fp = FramePainter(p, frame)
        if frame.normal == "S":
            _cornice(fp, 0, xa - 1, 0, C, fid)
            _cornice(fp, xa + 23, W, 0, C, fid)
        else:
            _cornice(fp, 0, length, 0, C, fid)
    deck = _hip_roof(p, W, D, C + 4, roof_levels(W, D), fid)
    for frame, length in sides[0::2]:                               # side pediments (E, W)
        _side_pediment(FramePainter(p, frame), length, C, fid)
    _avant_corps(p, xa, g, fid)
    return tower(p, W // 2, D // 2, deck, fid)


def roof_levels(W: int, D: int) -> int:
    return max(4, min(13, min(W, D) // 2 - 10))


def model_height(W: int, D: int) -> int:
    """Plates from the ground line to the top of the vane (for tile height and occupancy)."""
    return G_FLOOR + 2 * STOREY + 1 + 4 + 3 * roof_levels(W, D) + 1 + tower_height()
