// Exploration rules, pure (no DOM, no three.js): what is near, what is touched, what is
// saved, how the walked-area map and the postcard are laid out. Tested in
// test/explore.test.mjs. Coordinates: Unity metres (x east, z north) unless a name says
// three.js (z = -north).

export const PLAQUE_RADIUS = 8; // m: the plaque card shows within this distance
export const PLAQUE_LEAVE = 11; // m: and hides again beyond this one
export const STUD_RADIUS = 1.1; // m: touching a stud (horizontal)
export const STUD_HEIGHT = 2.2; // m: feet may be this far below/above the stud's ground
export const CELL_M = 16; // walked-area map cell
export const LIGHT_M = 22; // cells whose centre is this close to the walker light up
export const STORE_KEY = 'blox.explore.v1';
const CELL_OFF = 2048; // cell index offset (cells -2048..2047 on each axis = +-32 km)
const CELL_SPAN = 4096;

/** Items with Unity positions moved from the data's origin to a world's own originRD. */
export function shiftTo(items, dataOrigin, originRD) {
  const dx = originRD ? dataOrigin[0] - originRD[0] : 0, dz = originRD ? dataOrigin[1] - originRD[1] : 0;
  return items.map((it) => ({ ...it, at: [it.at[0] + dx, it.at[1] + dz],
    ...(it.anchor ? { anchor: [it.anchor[0] + dx, it.anchor[1] + dz] } : {}) }));
}

/** An empty explore state. */
export function emptyState() {
  return { places: {}, studs: {}, cells: new Set() };
}

/** Cell key for Unity metres. */
export function cellKey(x, z) {
  const i = Math.floor(x / CELL_M) + CELL_OFF, j = Math.floor(z / CELL_M) + CELL_OFF;
  if (i < 0 || j < 0 || i >= CELL_SPAN || j >= CELL_SPAN) return -1;
  return i * CELL_SPAN + j;
}

/** Centre (Unity metres) of a cell key. */
export function cellCentre(key) {
  const i = Math.floor(key / CELL_SPAN) - CELL_OFF, j = (key % CELL_SPAN) - CELL_OFF;
  return [(i + 0.5) * CELL_M, (j + 0.5) * CELL_M];
}

/** Light the cells around a walker at (x, z). Returns how many were new. */
export function visit(state, x, z, r = LIGHT_M) {
  let added = 0;
  const n = Math.ceil(r / CELL_M);
  const ci = Math.floor(x / CELL_M), cj = Math.floor(z / CELL_M);
  for (let a = -n; a <= n; a++) {
    for (let b = -n; b <= n; b++) {
      const cx = (ci + a + 0.5) * CELL_M, cz = (cj + b + 0.5) * CELL_M;
      if (Math.hypot(cx - x, cz - z) > r) continue;
      const k = cellKey(cx, cz);
      if (k >= 0 && !state.cells.has(k)) { state.cells.add(k); added++; }
    }
  }
  return added;
}

/** Cell keys -> compact text: sorted, delta-coded, base 36, comma separated. */
export function encodeCells(cells) {
  const ks = [...cells].sort((a, b) => a - b);
  let prev = 0;
  return ks.map((k) => { const d = k - prev; prev = k; return d.toString(36); }).join(',');
}

/** Inverse of encodeCells (bad input -> what could be read). */
export function decodeCells(text) {
  const out = new Set();
  if (typeof text !== 'string' || !text) return out;
  let k = 0;
  for (const part of text.split(',')) {
    const d = parseInt(part, 36);
    if (!Number.isFinite(d) || d < 0) break;
    k += d;
    out.add(k);
  }
  return out;
}

/** State -> JSON text for storage. */
export function serialize(state) {
  return JSON.stringify({ v: 1, places: state.places, studs: state.studs, cells: encodeCells(state.cells) });
}

/** Stored text -> state (anything unreadable -> empty). knownPlaces / knownStuds: valid ids. */
export function deserialize(text, knownPlaces = null, knownStuds = null) {
  const s = emptyState();
  let o;
  try { o = JSON.parse(text); } catch { return s; }
  if (!o || o.v !== 1) return s;
  const keep = (src, known) => {
    const out = {};
    for (const [id, t] of Object.entries(src && typeof src === 'object' ? src : {})) {
      if ((!known || known.has(id)) && Number.isFinite(t)) out[id] = t;
    }
    return out;
  };
  s.places = keep(o.places, knownPlaces);
  s.studs = keep(o.studs, knownStuds);
  s.cells = decodeCells(o.cells);
  return s;
}

/** Load from a Storage-like object (localStorage may throw: private windows). */
export function loadState(store, knownPlaces, knownStuds) {
  try { const t = store?.getItem(STORE_KEY); return t ? deserialize(t, knownPlaces, knownStuds) : emptyState(); } catch { return emptyState(); }
}

/** Save; false when storage is unavailable or full. */
export function saveState(state, store) {
  try { store?.setItem(STORE_KEY, serialize(state)); return !!store; } catch { return false; }
}

/** The nearest landmark within r of (x, z) (Unity metres), with its distance, or null. */
export function nearest(landmarks, x, z, r = Infinity) {
  let best = null, bd = r;
  for (const l of landmarks) {
    const d = Math.hypot(l.at[0] - x, l.at[1] - z);
    if (d <= bd) { bd = d; best = l; }
  }
  return best ? { item: best, dist: bd } : null;
}

/**
 * Plaque card logic with hysteresis: shown = id currently shown (or null). Returns the id to
 * show now: the nearest within PLAQUE_RADIUS, or the shown one while within PLAQUE_LEAVE.
 */
export function plaqueAt(landmarks, x, z, shown = null, dy = () => 0) {
  if (shown) {
    const l = landmarks.find((it) => it.id === shown);
    if (l && Math.hypot(l.at[0] - x, l.at[1] - z) <= PLAQUE_LEAVE && Math.abs(dy(l)) < 8) return shown;
  }
  const n = nearest(landmarks.filter((l) => Math.abs(dy(l)) < 6), x, z, PLAQUE_RADIUS);
  return n ? n.item.id : null;
}

/** Studs touched by feet at (x, y, z) (Unity x/z, y up): ids not yet in `got`. yOf(stud) = its ground. */
export function touched(studs, got, x, y, z, yOf = (s) => s.y) {
  const out = [];
  for (const s of studs) {
    if (got[s.id]) continue;
    if (Math.hypot(s.at[0] - x, s.at[1] - z) > STUD_RADIUS) continue;
    if (Math.abs(y - yOf(s)) > STUD_HEIGHT) continue;
    out.push(s.id);
  }
  return out;
}

/** Unlocks reached with `count` studs. */
export function unlocked(unlocks, count) {
  return unlocks.filter((u) => count >= u.studs);
}

/** Unlocks newly reached going from `before` to `after` studs. */
export function newUnlocks(unlocks, before, after) {
  return unlocks.filter((u) => before < u.studs && after >= u.studs);
}

/** The next unlock still to reach, or null. */
export function nextUnlock(unlocks, count) {
  return [...unlocks].sort((a, b) => a.studs - b.studs).find((u) => count < u.studs) || null;
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
/** "7 November 2026" (fixed English, independent of the browser's locale). */
export function formatDate(d) {
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

/** The postcard's place line: a landmark within 120 m, else the street, else the city. */
export function placeName(landmarks, x, z, street = '') {
  const n = nearest(landmarks, x, z, 120);
  if (n) return n.item.name;
  return street ? `${street}, Maastricht` : 'Maastricht';
}

/**
 * Postcard layout for a w x h photo: the photo is scaled to at most maxW wide, inside a
 * paper border with a caption band underneath. Returns pixel boxes for drawing.
 */
export function postcardLayout(w, h, maxW = 1600) {
  const s = Math.min(1, maxW / Math.max(1, w));
  const pw = Math.max(1, Math.round(w * s)), ph = Math.max(1, Math.round(h * s));
  const pad = Math.max(8, Math.round(Math.min(pw, ph) * 0.035));
  const band = Math.max(36, Math.round(Math.min(pw, ph) * 0.11));
  const W = pw + 2 * pad, H = ph + 2 * pad + band;
  const title = Math.max(14, Math.round(band * 0.42)), small = Math.max(10, Math.round(band * 0.24));
  return { W, H, pad, photo: { x: pad, y: pad, w: pw, h: ph },
    caption: { x: pad, y: pad + ph, w: pw, h: band + pad }, title, small };
}

/**
 * The square map window (Unity metres): the walked cells and discovered places plus a
 * minimum box around the old town, padded. Returns { x0, z0, size } (x0, z0 = south-west).
 */
export function mapWindow(cells, points = [], base = [1000, 2900, 2800, 4300], pad = 60) {
  let [x0, z0, x1, z1] = base;
  for (const k of cells) {
    const [x, z] = cellCentre(k);
    x0 = Math.min(x0, x); z0 = Math.min(z0, z); x1 = Math.max(x1, x); z1 = Math.max(z1, z);
  }
  for (const [x, z] of points) { x0 = Math.min(x0, x); z0 = Math.min(z0, z); x1 = Math.max(x1, x); z1 = Math.max(z1, z); }
  const size = Math.max(x1 - x0, z1 - z0) + 2 * pad;
  const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
  return { x0: cx - size / 2, z0: cz - size / 2, size };
}

/** Unity point -> map pixel (north up) for a window and a px-wide square canvas. */
export function toMap(win, px, x, z) {
  return [((x - win.x0) / win.size) * px, (1 - (z - win.z0) / win.size) * px];
}
