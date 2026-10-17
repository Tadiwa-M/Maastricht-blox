"""Hand-authored "look test" chunk: a corner of the Markt by the Maas.

South -> north: the Maas with a stone quay, a road with pavements and lamp posts, the
cobbled square with three trees, a row of five narrow gabled townhouses and a tall
tower with a stepped spire. Everything is painted into a voxel tile following
CONTRACT section 7 (slopes as 3-cell stacks, tiles for paving, shape 8 for water).
"""

from __future__ import annotations

from dataclasses import dataclass

from ..layout.records import CHUNK
from .canvas import Canvas

CX, CY = 22, 47  # chunk holding the Markt (RD 176430, 318007 -> I 1460, J 3014)
GROUND_K = 90  # 48.0 m NAP
K0 = GROUND_K - 9
NZ = 150
STOREY = 15
FULL, N, E, S, W, RIDGE_J, TILE, WATER = 0, 1, 2, 3, 4, 6, 7, 8

F_MARKT, F_MAAS, F_KADE, F_TOWER = 1, 2, 3, 20


@dataclass(frozen=True)
class House:
    x0: int
    width: int
    storeys: int
    wall: str
    roof: str
    plinth: str
    fid: int


HOUSES = [
    House(1, 8, 3, "mergel", "roof_tile_red", "mergel_dark", 10),
    House(9, 6, 4, "brick_red", "slate", "dark_grey", 11),
    House(15, 8, 3, "white", "roof_tile_red", "light_grey", 12),
    House(23, 6, 4, "mergel_light", "slate", "mergel_dark", 13),
    House(29, 8, 3, "brick_dark_red", "roof_tile_dark", "dark_grey", 14),
]
HOUSE_J0, HOUSE_DEPTH = 46, 16
TOWER = (45, 48, 11, 90)  # x0, y0, size, wall height in plates
TREES = [(8, 33), (22, 38), (36, 31)]
LAMPS_I = [6, 22, 38, 54]


def _ground(cv: Canvas) -> None:
    g = GROUND_K
    cv.fill(0, CHUNK, 0, 9, K0, g - 6, "soil")  # river bed
    cv.fill(0, CHUNK, 0, 9, g - 6, g - 5, "water", F_MAAS, WATER)
    cv.fill(0, CHUNK, 9, 11, K0, g + 1, "mergel_dark", F_KADE)  # quay wall
    cv.fill(0, CHUNK, 9, 11, g, g + 1, "light_grey", F_KADE)  # coping
    cv.fill(0, CHUNK, 11, CHUNK, K0, g - 1, "soil")
    cv.fill(0, CHUNK, 11, 13, g - 1, g, "pavement", F_KADE, TILE)
    cv.fill(0, CHUNK, 13, 21, g - 1, g, "asphalt", F_KADE, TILE)
    for i in range(0, CHUNK, 8):
        cv.fill(i, i + 4, 16, 18, g - 1, g, "white", F_KADE, TILE)
    cv.fill(0, CHUNK, 21, 23, g - 1, g, "pavement", F_KADE, TILE)
    cv.fill(0, CHUNK, 23, CHUNK, g - 1, g, "cobble_grey", F_MARKT, TILE)
    for i in range(CHUNK):
        for j in range(23, CHUNK):
            if (i * 3 + j * 5) % 11 == 0:
                cv.cell(i, j, g - 1, "light_grey", F_MARKT, TILE)
            elif (i * 7 + j * 2) % 13 == 0:
                cv.cell(i, j, g - 1, "dark_grey", F_MARKT, TILE)


def _windows(width: int) -> list[int]:
    return [1, 2, 5, 6] if width == 8 else [1, 4]


def _house(cv: Canvas, h: House) -> None:
    g = GROUND_K
    x0, x1, y0, y1 = h.x0, h.x0 + h.width, HOUSE_J0, HOUSE_J0 + HOUSE_DEPTH
    top = g + 3 + h.storeys * STOREY
    cv.fill(x0, x1, y0, y1, g, top, h.wall, h.fid)
    cv.clear(x0 + 1, x1 - 1, y0 + 1, y1 - 1, g, top)
    cv.fill(x0, x1, y0, y1, g, g + 3, h.plinth, h.fid)
    cv.clear(x0 + 1, x1 - 1, y0 + 1, y1 - 1, g, g + 3)
    cv.fill(x0, x1, y0, y0 + 1, top - 1, top, "white" if h.wall != "white" else "light_grey", h.fid)
    for s in range(h.storeys):
        kb = g + 3 + s * STOREY + 4
        for o in _windows(h.width):
            for j in (y0, y1 - 1):
                cv.fill(x0 + o, x0 + o + 1, j, j + 1, kb, kb + 9, "glass", h.fid)
    door = x0 + h.width // 2 - 1
    cv.fill(door, door + 2, y0, y0 + 1, g, g + 12, "dark_blue" if h.fid % 2 else "brick_brown", h.fid)
    _gable_roof(cv, h, x0, x1, y0, y1, top)


def _gable_roof(cv: Canvas, h: House, x0: int, x1: int, y0: int, y1: int, top: int) -> None:
    t = 0
    while x1 - x0 - 2 * t >= 2:
        a, b, kb = x0 + t, x1 - 1 - t, top + 3 * t
        if b - a + 1 == 2:
            cv.fill(a, b + 1, y0, y1, kb, kb + 3, h.roof, h.fid, RIDGE_J)
            break
        cv.fill(a + 1, b, y0, y0 + 1, kb, kb + 3, h.wall, h.fid)  # gable ends
        cv.fill(a + 1, b, y1 - 1, y1, kb, kb + 3, h.wall, h.fid)
        cv.fill(a, a + 1, y0, y1, kb, kb + 3, h.roof, h.fid, W)
        cv.fill(b, b + 1, y0, y1, kb, kb + 3, h.roof, h.fid, E)
        cv.fill(a + 1, a + 2, y0, y1, kb, kb + 3, h.roof, h.fid)
        cv.fill(b - 1, b, y0, y1, kb, kb + 3, h.roof, h.fid)
        t += 1


def _tower(cv: Canvas) -> None:
    g = GROUND_K
    x0, y0, n, hgt = TOWER
    x1, y1, top = x0 + n, y0 + n, g + hgt
    cv.fill(x0, x1, y0, y1, g, top, "tower_red", F_TOWER)
    cv.clear(x0 + 1, x1 - 1, y0 + 1, y1 - 1, g, top)
    cv.fill(x0, x1, y0, y1, g, g + 6, "mergel", F_TOWER)
    cv.clear(x0 + 1, x1 - 1, y0 + 1, y1 - 1, g, g + 6)
    cv.fill(x0, x1, y0, y1, top - 3, top, "mergel", F_TOWER)  # cornice band
    cv.clear(x0 + 1, x1 - 1, y0 + 1, y1 - 1, top - 3, top)
    mid = n // 2
    for kb in range(g + 18, g + 64, 15):
        for i, j in ((x0 + mid, y0), (x0 + mid, y1 - 1), (x0, y0 + mid), (x1 - 1, y0 + mid)):
            cv.fill(i, i + 1, j, j + 1, kb, kb + 9, "glass", F_TOWER)
    for i0, i1, j0, j1 in ((x0 + mid - 1, x0 + mid + 2, y0, y0 + 1), (x0 + mid - 1, x0 + mid + 2, y1 - 1, y1),
                           (x0, x0 + 1, y0 + mid - 1, y0 + mid + 2), (x1 - 1, x1, y0 + mid - 1, y0 + mid + 2)):
        cv.fill(i0, i1, j0, j1, g + 66, g + 78, "glass_light", F_TOWER)  # belfry openings
    cv.fill(x0 + mid - 1, x0 + mid + 2, y0, y0 + 1, g + 79, g + 86, "white", F_TOWER)  # clock
    cv.fill(x0 + mid, x0 + mid + 1, y0, y0 + 1, g + 81, g + 84, "gold", F_TOWER)
    _spire(cv, x0, y0, n, top)


def _spire(cv: Canvas, x0: int, y0: int, n: int, top: int) -> None:
    """Stepped pyramid: per step one full brick layer, then a layer of slopes."""
    for t in range(n // 2 + 1):
        a, b, kb = x0 + t, x0 + n - 1 - t, top + 6 * t
        if a == b:
            cv.fill(a, a + 1, a - x0 + y0, a - x0 + y0 + 1, kb, kb + 6, "slate", F_TOWER)
            cv.fill(a, a + 1, a - x0 + y0, a - x0 + y0 + 1, kb + 6, kb + 12, "gold", F_TOWER)
            return
        ya, yb = y0 + t, y0 + n - 1 - t
        cv.fill(a, b + 1, ya, yb + 1, kb, kb + 3, "slate", F_TOWER)
        cv.clear(a + 2, b - 1, ya + 2, yb - 1, kb, kb + 3)
        cv.fill(a, b + 1, ya, yb + 1, kb + 3, kb + 6, "slate", F_TOWER)
        cv.clear(a + 2, b - 1, ya + 2, yb - 1, kb + 3, kb + 6)
        k = kb + 3
        cv.fill(a, a + 1, ya + 1, yb, k, k + 3, "slate", F_TOWER, W)
        cv.fill(b, b + 1, ya + 1, yb, k, k + 3, "slate", F_TOWER, E)
        cv.fill(a + 1, b, ya, ya + 1, k, k + 3, "slate", F_TOWER, S)
        cv.fill(a + 1, b, yb, yb + 1, k, k + 3, "slate", F_TOWER, N)


def _tree(cv: Canvas, x: int, y: int) -> None:
    g = GROUND_K
    cv.fill(x, x + 1, y, y + 1, g, g + 12, "trunk")
    cz, r, rz = g + 16, 3.6, 9.0
    for i in range(x - 4, x + 5):
        for j in range(y - 4, y + 5):
            for k in range(cz - 9, cz + 10):
                d = ((i - x) / r) ** 2 + ((j - y) / r) ** 2 + ((k - cz) / rz) ** 2
                if d <= 1.0:
                    leaf = "leaf_light" if (i * 7 + j * 13 + k * 3) % 5 == 0 else "leaf"
                    cv.cell(i, j, k, leaf)


def _lamp(cv: Canvas, x: int, y: int) -> None:
    g = GROUND_K
    cv.fill(x, x + 1, y, y + 1, g, g + 14, "black")
    cv.fill(x, x + 1, y, y + 1, g + 14, g + 16, "lamp_warm")
    cv.fill(x, x + 1, y, y + 1, g + 16, g + 17, "black")


def make_scene() -> Canvas:
    cv = Canvas(CX, CY, K0, NZ)
    _ground(cv)
    for h in HOUSES:
        _house(cv, h)
    _tower(cv)
    for x, y in TREES:
        _tree(cv, x, y)
    for x in LAMPS_I:
        _lamp(cv, x, 12)
        _lamp(cv, x + 8, 21)
    return cv


def scene_features() -> list[dict]:
    I0, J0 = CX * CHUNK, CY * CHUNK

    def box(kind: str, fid: int, name: str, i0: int, j0: int, i1: int, j1: int, height_m: float) -> dict:
        return {"id": fid, "kind": kind, "name": name,
                "centroid": [I0 + (i0 + i1) // 2, J0 + (j0 + j1) // 2],
                "bboxIJ": [I0 + i0, J0 + j0, I0 + i1, J0 + j1], "heightM": height_m,
                "tags": {"source": "look-test"}}

    feats = [
        box("street", F_MARKT, "Markt (look test)", 0, 23, 63, 63, 0.0),
        box("water", F_MAAS, "Maas (look test)", 0, 0, 63, 8, 0.0),
        box("street", F_KADE, "Maaskade (look test)", 0, 9, 63, 22, 0.0),
    ]
    for n, h in enumerate(HOUSES):
        storeys_m = (3 + h.storeys * STOREY) * 0.2
        feats.append(box("building", h.fid, f"Townhouse {chr(65 + n)} (look test)", h.x0, HOUSE_J0,
                         h.x0 + h.width - 1, HOUSE_J0 + HOUSE_DEPTH - 1, storeys_m))
    x0, y0, n, hgt = TOWER
    feats.append(box("landmark", F_TOWER, "Tower (look test)", x0, y0, x0 + n - 1, y0 + n - 1,
                     round((hgt + 6 * (n // 2) + 12) * 0.2, 1)))
    return feats
