// What the pause-menu map draws and what a tap on it picks. Pure (no DOM), Unity metres
// (x east, z north): bus stops merged by name, walkway segments bucketed into tiles (only the
// tiles in view are drawn), a grid of walkway nodes for "snap a tap to the nearest street".

/** Timetable stops ({ name, x, y }: y = north) -> one marker per name and place: { name, x, z, n }.
 * Platforms of one stop (same name within mergeM) become one; `inside(x, z)` filters (built city). */
export function mergeStops(stops, inside = () => true, mergeM = 80) {
  const out = [], byName = new Map();
  for (const s of stops || []) {
    if (!s?.name || !Number.isFinite(s.x) || !Number.isFinite(s.y) || !inside(s.x, s.y)) continue;
    const list = byName.get(s.name) || [];
    let m = list.find((o) => Math.hypot(o.x - s.x, o.z - s.y) <= mergeM);
    if (m) {
      m.x = (m.x * m.n + s.x) / (m.n + 1); m.z = (m.z * m.n + s.y) / (m.n + 1); m.n += 1;
    } else {
      m = { kind: 'stop', name: s.name, x: s.x, z: s.y, n: 1 };
      list.push(m); out.push(m);
    }
    byName.set(s.name, list);
  }
  return out;
}

/** Walkways ({ nodes: [x, z, ...], edges: [a, b, ...] }) -> Map 'tx,tz' -> Float32Array [x0, z0, x1, z1, ...]
 * (a segment goes in the tile of its first end). */
export function segmentTiles(doc, tileM = 256) {
  const tmp = new Map();
  const n = doc?.nodes || [], e = doc?.edges || [];
  for (let q = 0; q + 1 < e.length; q += 2) {
    const a = e[q] * 2, b = e[q + 1] * 2;
    if (a + 1 >= n.length || b + 1 >= n.length) continue;
    const key = `${Math.floor(n[a] / tileM)},${Math.floor(n[a + 1] / tileM)}`;
    let arr = tmp.get(key);
    if (!arr) tmp.set(key, (arr = []));
    arr.push(n[a], n[a + 1], n[b], n[b + 1]);
  }
  const out = new Map();
  for (const [k, v] of tmp) out.set(k, Float32Array.from(v));
  return out;
}

/** Tile keys covering the world box [minX, minZ, maxX, maxZ] (one tile of margin: segments run out of their tile). */
export function tilesIn(box, tileM = 256) {
  const keys = [];
  const x0 = Math.floor(box[0] / tileM) - 1, x1 = Math.floor(box[2] / tileM);
  const z0 = Math.floor(box[1] / tileM) - 1, z1 = Math.floor(box[3] / tileM);
  for (let tx = x0; tx <= x1; tx++) for (let tz = z0; tz <= z1; tz++) keys.push(`${tx},${tz}`);
  return keys;
}

/** Nearest-point lookup over flat [x, z, ...] pairs. */
export class PointGrid {
  constructor(flat, cell = 32) {
    this.flat = flat || []; this.cell = cell; this.cells = new Map();
    for (let q = 0; q + 1 < this.flat.length; q += 2) {
      const k = this.key(Math.floor(this.flat[q] / cell), Math.floor(this.flat[q + 1] / cell));
      let list = this.cells.get(k);
      if (!list) this.cells.set(k, (list = []));
      list.push(q >> 1);
    }
  }

  key(i, j) { return i * 100003 + j; }

  /** -> { i, x, z, d } of the nearest point within maxD metres, or null. */
  nearest(x, z, maxD) {
    const c = this.cell, r = Math.ceil(maxD / c), ci = Math.floor(x / c), cj = Math.floor(z / c);
    let best = null;
    for (let i = ci - r; i <= ci + r; i++) {
      for (let j = cj - r; j <= cj + r; j++) {
        for (const p of this.cells.get(this.key(i, j)) || []) {
          const px = this.flat[2 * p], pz = this.flat[2 * p + 1], d = Math.hypot(px - x, pz - z);
          if (d <= maxD && (!best || d < best.d)) best = { i: p, x: px, z: pz, d };
        }
      }
    }
    return best;
  }
}

/** The marker nearest to screen point (sx, sy) within rPx pixels: items { x, z }, view: MapView. */
export function pickMarker(items, sx, sy, view, rPx = 22) {
  let best = null, bd = rPx;
  for (const it of items) {
    const [px, py] = view.toScreen(it.x, it.z);
    const d = Math.hypot(px - sx, py - sy);
    if (d <= bd) { bd = d; best = it; }
  }
  return best;
}

/** Which labels to draw at this zoom (pixels per metre): landmarks from city scale, stops closer in. */
export function labelLevel(scale) {
  return { landmarks: scale >= 0.35, stops: scale >= 1.1 };
}

/** Compass yaw (0 = north, + clockwise, radians) from a three.js camera looking at a target. */
export function headingFrom(camPos, target) {
  return Math.atan2(target.x - camPos.x, camPos.z - target.z);
}
