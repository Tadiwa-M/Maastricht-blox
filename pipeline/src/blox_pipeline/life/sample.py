"""Synthetic ``life/`` export for a sample world without OSM/GTFS (look development, screenshots).

``python -m blox_pipeline.life.sample samples/markt_v3 <out world dir>`` copies nothing: it
writes ``<out>/life/`` from the sample's own bricks:

* transit: two fake Arriva bus routes along streets of the sample (through the real ``blox
  life`` GTFS reader, so the format is exactly the export's);
* walkways: the paved ground cells (cobbles, pavement), 2 m lattice, 8-connected, not under
  buildings (on-grid or rotated islands); the Markt busiest;
* streets: roads + cycle graph along the bus streets, cafe terraces at facades facing open
  paving round the Markt, bike spots (facades and rows between the trees), and the market square.

The street lines are picked by hand on the sample's top-colour map (image pixels, x right,
y down; 1 px = 1 stud), so this only fits ``samples/markt_v3``; other worlds get walkways and
facade terraces but no streets.
"""

from __future__ import annotations

import csv
import io
import json
import math
import sys
import zipfile
from pathlib import Path

import numpy as np

from .. import geo
from ..io.chunk_reader import read_world_records
from ..io.island_reader import read_world_islands
from .export import dump
from .streets import MARKET, ROAD_CLASSES

PAVED = {22, 24}  # cobble_grey, pavement
ROUTES = {  # short -> (colour, headsign, px polyline)
    "1": ("E30613", "Station", [[325, 0], [285, 50], [245, 100], [222, 140], [195, 200], [150, 262], [132, 320], [125, 450]]),
    "10": ("00A0E0", "Malberg", [[0, 336], [85, 330], [175, 248], [230, 226], [300, 212], [450, 214]]),
}
EXTRA_ROADS = [[[240, 140], [330, 80], [450, 20]], [[125, 450], [210, 410], [330, 385], [450, 380]]]
MARKET_PX = [[228, 145], [318, 145], [318, 198], [235, 212], [206, 214], [214, 178]]  # north of bus line 10, east of line 1


def world_maps(world: Path) -> dict:
    """Top height/colour per stud column of the chunks, plus a building mask (chunks + islands)."""
    man = json.loads((world / "manifest.json").read_text())
    cat = {t["id"]: t for t in json.loads((world / man.get("catalogue", "brick_catalogue.json")).read_text())["types"]}
    R = np.concatenate([c.records for _, c in read_world_records(world, check_sha1=False)])
    I0, J0 = int(R["I"].min()), int(R["J"].min())
    I1, J1 = int(R["I"].max()) + 8, int(R["J"].max()) + 8
    top = np.full((I1 - I0, J1 - J0), -1, int)
    col = np.zeros_like(top)
    for r in R:
        t = cat[int(r["type"])]
        w, d = (t["w"], t["d"]) if int(r["rot"]) % 2 == 0 else (t["d"], t["w"])
        k = int(r["K"]) + t["h"]
        sl = (slice(int(r["I"]) - I0, int(r["I"]) - I0 + w), slice(int(r["J"]) - J0, int(r["J"]) - J0 + d))
        m = top[sl] < k
        top[sl][m] = k
        col[sl][m] = int(r["color"])
    ground = int(np.bincount(top[top > 0]).argmax())
    building = (top > ground + 10) & ~np.isin(col, [26, 27, 28, 29, 30])  # not trees
    S = man.get("studM", 0.5)
    for _, isl in read_world_islands(world, check_sha1=False):
        rec = isl.records
        tall = rec[rec["K"] > ground + 4]
        if not len(tall):
            continue
        a = math.radians(isl.yaw_deg)
        c, s = math.cos(a), math.sin(a)
        for di in (0.25, 0.75):
            for dj in (0.25, 0.75):
                li, lj = (tall["I"] + di) * S, (tall["J"] + dj) * S
                x = isl.origin[0] + li * c + lj * s
                z = isl.origin[1] - li * s + lj * c
                gi, gj = np.floor(x / S).astype(int) - I0, np.floor(z / S).astype(int) - J0
                ok = (gi >= 0) & (gi < top.shape[0]) & (gj >= 0) & (gj < top.shape[1])
                building[gi[ok], gj[ok]] = True
    return {"top": top, "col": col, "I0": I0, "J0": J0, "ground": ground, "building": building, "S": S}


def _px(m: dict, p: list[int]) -> tuple[float, float]:
    """Image pixel (x right, y down) -> Unity metres (x east, z north)."""
    H = m["top"].shape[1]
    return (m["I0"] + p[0] + 0.5) * m["S"], (m["J0"] + (H - 1 - p[1]) + 0.5) * m["S"]


def _gtfs(m: dict, path: Path) -> None:
    rows: dict[str, list] = {k: [] for k in ("stops", "routes", "trips", "st", "shapes")}

    def ll(p):
        lon, lat = geo.rd_to_wgs84(p[0] + geo.X0, p[1] + geo.Y0)
        return round(float(lat), 7), round(float(lon), 7)

    for short, (colour, head, px) in ROUTES.items():
        rows["routes"].append([f"r{short}", "ARR", short, f"Synthetic {short}", 3, colour])
        pts = [_px(m, p) for p in px]
        (ax, az), (bx, bz) = pts[0], pts[1]
        L = math.hypot(bx - ax, bz - az)
        pts.insert(0, (ax - (bx - ax) / L * 150, az - (bz - az) / L * 150))  # drive in from outside
        (cx, cz), (ex, ez) = pts[-2], pts[-1]
        L = math.hypot(ex - cx, ez - cz)
        pts.append((ex + (ex - cx) / L * 150, ez + (ez - cz) / L * 150))
        for direction, line in (("a", pts), ("b", pts[::-1])):
            sid = f"sh{short}{direction}"
            rows["shapes"] += [[sid, *ll(p), n] for n, p in enumerate(line)]
            cum = np.concatenate([[0], np.cumsum([math.dist(a, b) for a, b in zip(line, line[1:])])])
            stops = [(f"{sid}_0", line[0], 0.0), (f"{sid}_m", line[len(line) // 2], cum[len(line) // 2]), (f"{sid}_1", line[-1], cum[-1])]
            for st_id, p, _ in stops:
                rows["stops"].append([st_id, f"Stop {st_id}", *ll(p), "0"])
            offset = 0 if direction == "a" else 90
            for n, start in enumerate(range(5 * 3600 + 1800 + offset, 24 * 3600 + 1800, 120)):  # every 2 min (busy look)
                tid = f"t{sid}_{n}"
                rows["trips"].append([f"r{short}", "all", tid, head if direction == "a" else "Centrum", sid])
                for k, (st_id, _p, dist) in enumerate(stops):
                    t = start + (int(dist / 5.5) + (40 if k == 2 else 0) if k else 0)
                    rows["st"].append([tid, _hms(t), _hms(t + (40 if k == 1 else 0)), st_id, k + 1])

    def text(header, body):
        b = io.StringIO()
        w = csv.writer(b, lineterminator="\n")
        w.writerow(header)
        w.writerows(body)
        return b.getvalue()

    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("stops.txt", text(["stop_id", "stop_name", "stop_lat", "stop_lon", "location_type"], rows["stops"]))
        z.writestr("routes.txt", text(["route_id", "agency_id", "route_short_name", "route_long_name", "route_type", "route_color"], rows["routes"]))
        z.writestr("trips.txt", text(["route_id", "service_id", "trip_id", "trip_headsign", "shape_id"], rows["trips"]))
        z.writestr("stop_times.txt", text(["trip_id", "arrival_time", "departure_time", "stop_id", "stop_sequence"], rows["st"]))
        z.writestr("shapes.txt", text(["shape_id", "shape_pt_lat", "shape_pt_lon", "shape_pt_sequence"], rows["shapes"]))
        z.writestr("calendar.txt", text(["service_id", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday", "start_date", "end_date"],
                                        [["all", 1, 1, 1, 1, 1, 1, 1, "20260101", "20271231"]]))


def _hms(s: int) -> str:
    return f"{s // 3600:02d}:{s // 60 % 60:02d}:{s % 60:02d}"


def _walkable(m: dict) -> np.ndarray:
    return np.isin(m["col"], list(PAVED)) & (np.abs(m["top"] - m["ground"]) <= 3) & ~m["building"]


def walkways(m: dict, market: list[float]) -> dict:
    ok = _walkable(m)
    nodes: list[float] = []
    weights: list[int] = []
    ids: dict[tuple[int, int], int] = {}
    edges: list[int] = []
    for i in range(2, ok.shape[0], 4):
        for j in range(2, ok.shape[1], 4):
            if ok[i, j]:
                x, z = (m["I0"] + i + 0.5) * m["S"], (m["J0"] + j + 0.5) * m["S"]
                ids[(i, j)] = len(weights)
                nodes += [round(x, 1), round(z, 1)]
                weights.append(8 if _in_poly(market, x, z) else 3 if m["col"][i, j] == 22 else 2)
    for (i, j), a in ids.items():
        for di, dj in ((4, 0), (0, 4), (4, 4), (4, -4)):
            b = ids.get((i + di, j + dj))
            if b is not None and (not (di and dj) or ((i + di, j) in ids and (i, j + dj) in ids)):
                edges += [a, b]
    return {"version": 1, "kind": "walkways", "meta": {"source": "synthetic: paved cells"}, "nodes": nodes, "weights": weights, "edges": edges}


def _in_poly(poly: list[float], x: float, z: float) -> bool:
    inside, n = False, len(poly) // 2
    j = n - 1
    for i in range(n):
        xi, zi, xj, zj = poly[2 * i], poly[2 * i + 1], poly[2 * j], poly[2 * j + 1]
        if (zi > z) != (zj > z) and x < (xj - xi) * (z - zi) / (zj - zi) + xi:
            inside = not inside
        j = i
    return inside


def _graph(lines: list[list[tuple[float, float]]], step: float = 15.0) -> tuple[list[float], list[int]]:
    nodes: list[float] = []
    index: dict[tuple[int, int], int] = {}
    edges: list[int] = []

    def node(x: float, z: float) -> int:
        k = (round(x * 2), round(z * 2))
        if k not in index:
            index[k] = len(nodes) // 2
            nodes.extend([round(x, 1), round(z, 1)])
        return index[k]

    for line in lines:
        prev = None
        for (ax, az), (bx, bz) in zip(line, line[1:]):
            n = max(1, math.ceil(math.hypot(bx - ax, bz - az) / step))
            for q in range(n + 1):
                cur = node(ax + (bx - ax) * q / n, az + (bz - az) * q / n)
                if prev is not None and prev != cur:
                    edges += [prev, cur]
                prev = cur
    return nodes, edges


def facades(m: dict, centre: tuple[float, float], radius: float, spacing: float, rng: np.random.Generator) -> list[tuple[float, float, float, float]]:
    """Points on walkable paving right in front of a building, with the unit normal away from it."""
    ok, bld, S = _walkable(m), m["building"], m["S"]
    cand = []
    for i in range(4, ok.shape[0] - 4, 2):
        for j in range(4, ok.shape[1] - 4, 2):
            if not ok[i, j]:
                continue
            for di, dj in ((3, 0), (-3, 0), (0, 3), (0, -3)):
                if bld[i + di, j + dj] and ok[i - di, j - dj] and ok[i - 2 * di, j - 2 * dj]:
                    x, z = (m["I0"] + i + 0.5) * S, (m["J0"] + j + 0.5) * S
                    if math.hypot(x - centre[0], z - centre[1]) <= radius:
                        cand.append((x, z, -di / 3, -dj / 3))
                    break
    rng.shuffle(cand)
    out: list[tuple[float, float, float, float]] = []
    for c in cand:
        if all(math.hypot(c[0] - o[0], c[1] - o[1]) >= spacing for o in out):
            out.append(c)
    return out


def tree_centres(m: dict) -> list[tuple[float, float]]:
    """Centres of tree crowns (leaf-coloured tops above the ground), by flood fill on a 1 m grid."""
    leaf = np.isin(m["col"], [28, 29]) & (m["top"] > m["ground"] + 6)
    g = leaf[::2, ::2]
    seen = np.zeros_like(g)
    out = []
    for i0, j0 in zip(*np.nonzero(g)):
        if seen[i0, j0]:
            continue
        stack, cells = [(i0, j0)], []
        seen[i0, j0] = True
        while stack:
            i, j = stack.pop()
            cells.append((i, j))
            for a, b in ((i + 1, j), (i - 1, j), (i, j + 1), (i, j - 1)):
                if 0 <= a < g.shape[0] and 0 <= b < g.shape[1] and g[a, b] and not seen[a, b]:
                    seen[a, b] = True
                    stack.append((a, b))
        if len(cells) >= 6:
            ci = sum(c[0] for c in cells) / len(cells) * 2 + 1
            cj = sum(c[1] for c in cells) / len(cells) * 2 + 1
            out.append(((m["I0"] + ci) * m["S"], (m["J0"] + cj) * m["S"]))
    return out


def tree_rows(trees: list[tuple[float, float]], centre: tuple[float, float], radius: float, gap: float = 16.0) -> list[list[float]]:
    """Bike rows between neighbouring trees (same layout as streets.tree_row_bikes)."""
    out, seen = [], set()
    for i, (x, z) in enumerate(trees):
        if math.hypot(x - centre[0], z - centre[1]) > radius:
            continue
        d = [math.hypot(x - u, z - w) if k != i else math.inf for k, (u, w) in enumerate(trees)]
        j = int(np.argmin(d))
        if d[j] > gap or (min(i, j), max(i, j)) in seen:
            continue
        seen.add((min(i, j), max(i, j)))
        u, w = trees[j]
        out.append([round((x + u) / 2, 1), round((z + w) / 2, 1), round((u - x) / d[j], 3), round((w - z) / d[j], 3), round(d[j] - 2.5, 1)])
    return out


def write_sample_life(world: Path, out: Path) -> dict:
    from ..cli import main as blox

    m = world_maps(world)
    life = out / "life"
    life.mkdir(parents=True, exist_ok=True)
    zp = life / "synthetic-gtfs.zip"
    _gtfs(m, zp)
    x0, z0 = _px(m, [0, m["top"].shape[1] - 1])
    x1, z1 = _px(m, [m["top"].shape[0] - 1, 0])
    bbox = f"{x0 + geo.X0 - 0.25},{z0 + geo.Y0 - 0.25},{x1 + geo.X0 + 0.25},{z1 + geo.Y0 + 0.25}"
    assert blox(["life", "--out", str(out), "--gtfs", str(zp), "--no-walkways", "--bbox", bbox, "--date", "2026-10-26"]) == 0
    zp.unlink()
    market = [v for p in MARKET_PX for v in _px(m, p)]
    walk = walkways(m, market)
    lines = [[_px(m, p) for p in px] for _c, _h, px in ROUTES.values()] + [[_px(m, p) for p in r] for r in EXTRA_ROADS]
    rn, re = _graph(lines, 20.0)
    cls = ROAD_CLASSES.index("tertiary") << 1
    cn, ce = _graph(lines, 12.0)
    rng = np.random.default_rng(4)
    centre = ((market[0] + market[4]) / 2, (market[1] + market[5]) / 2)
    pois = [{"kind": ["cafe", "bar", "restaurant"][q % 3], "name": f"Terras {q}", "x": round(x - f0 * 1.5, 1), "z": round(z - f1 * 1.5, 1),
             "f": [round(f0, 3), round(f1, 3)], "d": 10.0} for q, (x, z, f0, f1) in enumerate(facades(m, centre, 130, 14, rng)[:22])]
    bikes = [[round(x + f0 * 3, 1), round(z + f1 * 3, 1), round(-f1, 3), round(f0, 3)] for x, z, f0, f1 in facades(m, centre, 160, 40, rng)[:7]]
    bikes += tree_rows(tree_centres(m), centre, 200)
    streets = {"version": 1, "kind": "streets", "meta": {"source": "synthetic"},
               "cycle": {"version": 1, "kind": "cycle", "nodes": cn, "weights": [2] * (len(cn) // 2), "edges": ce},
               "roads": {"nodes": rn, "edges": re, "flags": [cls] * (len(re) // 2), "classes": ROAD_CLASSES},
               "pois": pois, "bikes": bikes,
               "market": {"name": "Markt", "poly": [round(v, 1) for v in market], "days": MARKET["days"], "open": MARKET["open"], "close": MARKET["close"]}}
    idx = json.loads((life / "index.json").read_text())
    idx["files"]["walkways"] = "walkways.json"
    idx["bytes"]["walkways"] = dump(walk, life / "walkways.json")
    idx["files"]["streets"] = "streets.json"
    idx["bytes"]["streets"] = dump(streets, life / "streets.json")
    idx["sources"].append({"name": "synthetic (blox_pipeline.life.sample)", "licence": "-", "attribution": "-"})
    dump(idx, life / "index.json")
    return idx


if __name__ == "__main__":
    if len(sys.argv) != 3:
        sys.exit("usage: python -m blox_pipeline.life.sample <sample world> <out world dir>")
    print(json.dumps(write_sample_life(Path(sys.argv[1]), Path(sys.argv[2]))["bytes"]))
