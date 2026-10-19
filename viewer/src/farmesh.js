// Far LOD: one merged, flat-shaded mesh per (chunk, material) with hidden faces removed.
//
// Every piece becomes a few plain polygons (src: farPiece): bricks, plates and tiles are
// their cell box (12 triangles, no bevel, no studs), slopes a 5-sided prism, windows and
// doors a box with a flat glass quad on the front, arches two posts and a lintel.
// A polygon that lies on the piece's bounding-box side is dropped when every cell on the
// other side hides it: a full opaque brick, interior air (src/exterior.js), the bottom of
// the world, or a see-through brick of the same kind (glass stacks read as one pane).
// In dense blocks this removes most faces.
import * as THREE from 'three';
import { brickMatrix } from './placement.js';
import { slopeProfile, ridgeProfile } from './geometry.js';
import { AIR_IN } from './exterior.js';

// cell codes in the occupancy grid (src/exterior.js: 0 = interior air, 1 = outside air)
export const OPAQUE = 2, TRANS = 3, WATER = 4, OTHER = 5;
const FULL_KINDS = new Set(['brick', 'plate', 'tile', 'jumper', 'tile_grille']);
const BAR = 0.06, GLASS_OUT = 0.004; // window frame bar; glass quad sits this far in front

/** codeOf(n) for occupancyGrid: what a cell of brick n hides. classOf(entry) as MaterialSet. */
export function cellCodeOf(world, classOf) {
  const byColor = new Map();
  const cls = (c) => {
    if (!byColor.has(c)) byColor.set(c, classOf(world.palette.get(c)));
    return byColor.get(c);
  };
  return (n) => {
    if (!FULL_KINDS.has(world.typeOf(n)?.kind)) return OTHER;
    const c = cls(world.color[n]);
    return c === 'trans' ? TRANS : c === 'water' ? WATER : OPAQUE;
  };
}

/** Does neighbour cell code `nb` hide a bounding-box face of a brick with code `own`? */
export function hides(nb, own) {
  return nb === AIR_IN || nb === OPAQUE || ((own === TRANS || own === WATER) && nb === own);
}

// ---- piece templates (local frame of src/shapes.js: front toward -z, y up) -------------

function orient(pts, nx, ny, nz) {
  // Newell normal; flip the winding if it disagrees with the wanted outward normal
  let a = 0, b = 0, c = 0;
  for (let q = 0; q < pts.length; q++) {
    const [x0, y0, z0] = pts[q], [x1, y1, z1] = pts[(q + 1) % pts.length];
    a += (y0 - y1) * (z0 + z1); b += (z0 - z1) * (x0 + x1); c += (x0 - x1) * (y0 + y1);
  }
  if (a * nx + b * ny + c * nz < 0) pts.reverse();
  const len = Math.hypot(a, b, c) || 1;
  const s = a * nx + b * ny + c * nz < 0 ? -1 : 1;
  return { pts, n: [(a / len) * s, (b / len) * s, (c / len) * s] };
}

function box(x0, x1, y0, y1, z0, z1, part = 'body') {
  const P = (x, y, z) => [x, y, z];
  return [
    orient([P(x1, y0, z0), P(x1, y1, z0), P(x1, y1, z1), P(x1, y0, z1)], 1, 0, 0),
    orient([P(x0, y0, z0), P(x0, y0, z1), P(x0, y1, z1), P(x0, y1, z0)], -1, 0, 0),
    orient([P(x0, y1, z0), P(x0, y1, z1), P(x1, y1, z1), P(x1, y1, z0)], 0, 1, 0),
    orient([P(x0, y0, z0), P(x1, y0, z0), P(x1, y0, z1), P(x0, y0, z1)], 0, -1, 0),
    orient([P(x0, y0, z1), P(x1, y0, z1), P(x1, y1, z1), P(x0, y1, z1)], 0, 0, 1),
    orient([P(x0, y0, z0), P(x0, y1, z0), P(x1, y1, z0), P(x1, y0, z0)], 0, 0, -1),
  ].map((f) => ({ ...f, part }));
}

/** Side profile (s from back to front, y) extruded across W: caps + one quad per edge. */
function prism(profile, W, D) {
  const z = (s) => D / 2 - s;
  const cx = profile.reduce((a, p) => a + p[0], 0) / profile.length;
  const cy = profile.reduce((a, p) => a + p[1], 0) / profile.length;
  const polys = [
    orient(profile.map(([s, y]) => [W / 2, y, z(s)]), 1, 0, 0),
    orient(profile.map(([s, y]) => [-W / 2, y, z(s)]), -1, 0, 0),
  ];
  for (let q = 0; q < profile.length; q++) {
    const [s0, y0] = profile[q], [s1, y1] = profile[(q + 1) % profile.length];
    if (Math.hypot(s1 - s0, y1 - y0) < 1e-6) continue;
    // outward = edge normal pointing away from the profile centroid, in (z, y)
    let ns = y1 - y0, ny = -(s1 - s0);
    if (ns * ((s0 + s1) / 2 - cx) + ny * ((y0 + y1) / 2 - cy) < 0) { ns = -ns; ny = -ny; }
    polys.push(orient([[-W / 2, y0, z(s0)], [W / 2, y0, z(s0)], [W / 2, y1, z(s1)], [-W / 2, y1, z(s1)]], 0, ny, -ns));
  }
  return polys.map((f) => ({ ...f, part: 'body' }));
}

/** Flat glass quad just in front of the front face (normal -z). */
function frontGlass(x0, x1, y0, y1, D) {
  const z = -D / 2 - GLASS_OUT;
  return { ...orient([[x0, y0, z], [x1, y0, z], [x1, y1, z], [x0, y1, z]], 0, 0, -1), part: 'glass' };
}

const templates = new Map();

/** Cheap polygons of catalogue type t: [{ pts: [[x, y, z]...], n: [x, y, z], part }]. */
export function farPiece(t, S, P) {
  if (templates.has(t.id)) return templates.get(t.id);
  const W = t.w * S, D = t.d * S, H = t.h * P;
  let polys;
  switch (t.kind) {
    case 'slope': polys = prism(slopeProfile(t, S, P), W, D); break;
    case 'slope_double': polys = prism(ridgeProfile(t, S, P), W, D); break;
    case 'window':
      polys = [...box(-W / 2, W / 2, 0, H, -D / 2, D / 2), frontGlass(-W / 2 + BAR, W / 2 - BAR, BAR, H - BAR, D)];
      break;
    case 'door':
      polys = [...box(-W / 2, W / 2, 0, H, -D / 2, D / 2), frontGlass(-W / 2 + BAR, W / 2 - BAR, H - 2 * P + BAR, H - BAR, D)];
      break;
    case 'arch': {
      const rx = ((t.w - 2) * S) / 2, crown = H - Math.max(0.1, H / 6), ry = Math.min(rx, crown / 2);
      const top = crown - ry * 0.25; // a square opening a little lower than the round one
      polys = [...box(-W / 2, -rx, 0, H, -D / 2, D / 2), ...box(rx, W / 2, 0, H, -D / 2, D / 2),
        ...box(-rx, rx, top, H, -D / 2, D / 2)];
      break;
    }
    default: polys = box(-W / 2, W / 2, 0, H, -D / 2, D / 2);
  }
  templates.set(t.id, polys);
  return polys;
}

// ---- builder ---------------------------------------------------------------------------

class Buffers {
  constructor(withGlow) {
    Object.assign(this, { pos: [], nrm: [], col: [], glow: withGlow ? [] : null, idx: [], verts: 0 });
  }
  poly(pts, n, color, glow) {
    const base = this.verts;
    for (const p of pts) {
      this.pos.push(p.x, p.y, p.z);
      this.nrm.push(Math.round(n.x * 127), Math.round(n.y * 127), Math.round(n.z * 127));
      this.col.push(Math.round(Math.min(1, color.r) * 65535), Math.round(Math.min(1, color.g) * 65535), Math.round(Math.min(1, color.b) * 65535));
      if (this.glow) this.glow.push(glow ? glow.r : 0, glow ? glow.g : 0, glow ? glow.b : 0);
    }
    for (let q = 1; q + 1 < pts.length; q++) this.idx.push(base, base + q, base + q + 1);
    this.verts += pts.length;
  }
  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(new Int8Array(this.nrm), 3, true));
    g.setAttribute('color', new THREE.BufferAttribute(new Uint16Array(this.col), 3, true));
    if (this.glow) g.setAttribute('aGlow', new THREE.Float32BufferAttribute(this.glow, 3));
    g.setIndex(this.verts > 65535 ? new THREE.Uint32BufferAttribute(this.idx, 1) : new THREE.Uint16BufferAttribute(this.idx, 1));
    g.computeBoundingBox();
    g.computeBoundingSphere();
    return g;
  }
}

const EPS = 1e-4;

/**
 * Far-LOD geometry for bricks `list` (brick numbers) of a World. `list` may also be an array
 * of lists (one per chunk of a cluster): each key's index buffer then holds them in order and
 * `ranges` gives every list's { start, count } in it, for drawing a subset (geometry groups).
 *   code(I, J, K):  occupancy-grid cell code (src/exterior.js occupancyGrid().code)
 *   codeOf(n):      the code brick n writes into the grid
 *   style(n, part): { key, color, glow? } material key + linear colour for a body/glass part
 * Returns { geometries: Map key -> BufferGeometry, ranges: Map key -> [{ start, count }],
 *           triangles, faces, culled, segmentTriangles: [per list] }.
 */
export function buildFarGeometry(world, list, { code, codeOf, style, glowKeys = new Set() }) {
  const lists = list.length && typeof list[0] !== 'number' ? list : [list];
  const S = world.studM, Pm = world.plateM, K0 = world.bounds.K0;
  const bufs = new Map();
  const m4 = new THREE.Matrix4(), nv = new THREE.Vector3();
  const pts = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(),
    new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  let faces = 0, culled = 0;
  const starts = []; // per list: Map key -> index count before it
  const mark = () => starts.push(new Map([...bufs].map(([k, b]) => [k, b.idx.length])));
  for (const one of lists) { mark(); for (const n of one) {
    const t = world.typeOf(n);
    if (!t) continue;
    const I = world.I[n], J = world.J[n], K = world.K[n], rot = world.rot(n);
    const [ei, ej] = world.extentOf(n);
    const own = codeOf(n);
    const sideCache = new Int8Array(6).fill(-1);
    // side: 0 +x, 1 -x, 2 +y, 3 -y, 4 +z (= -j), 5 -z (= +j)
    const sideHidden = (side) => {
      if (sideCache[side] >= 0) return sideCache[side] === 1;
      let hidden = true;
      if (side === 3 && K <= K0) hidden = true; // bottom of the world: on the ground plane
      else if (side <= 1) {
        const Ix = side === 0 ? I + ei : I - 1;
        for (let k = 0; k < t.h && hidden; k++) for (let dj = 0; dj < ej && hidden; dj++) hidden = hides(code(Ix, J + dj, K + k), own);
      } else if (side <= 3) {
        const Kx = side === 2 ? K + t.h : K - 1;
        for (let dj = 0; dj < ej && hidden; dj++) for (let di = 0; di < ei && hidden; di++) hidden = hides(code(I + di, J + dj, Kx), own);
      } else {
        const Jx = side === 4 ? J - 1 : J + ej;
        for (let k = 0; k < t.h && hidden; k++) for (let di = 0; di < ei && hidden; di++) hidden = hides(code(I + di, Jx, K + k), own);
      }
      sideCache[side] = hidden ? 1 : 0;
      return hidden;
    };
    const x0 = I * S, x1 = (I + ei) * S, y0 = K * Pm, y1 = (K + t.h) * Pm, z0 = -(J + ej) * S, z1 = -J * S;
    brickMatrix(I, J, K, t.w, t.d, rot, S, Pm, m4);
    const looks = {};
    for (const f of farPiece(t, S, Pm)) {
      const p = f.pts.length <= pts.length ? pts.slice(0, f.pts.length) : f.pts.map(() => new THREE.Vector3());
      f.pts.forEach((q, i) => p[i].set(q[0], q[1], q[2]).applyMatrix4(m4));
      nv.set(f.n[0], f.n[1], f.n[2]).transformDirection(m4);
      faces++;
      let side = -1;
      const onPlane = (axis, val) => p.every((q) => Math.abs(q.getComponent(axis) - val) < EPS);
      if (nv.x > 0.999 && onPlane(0, x1)) side = 0;
      else if (nv.x < -0.999 && onPlane(0, x0)) side = 1;
      else if (nv.y > 0.999 && onPlane(1, y1)) side = 2;
      else if (nv.y < -0.999 && onPlane(1, y0)) side = 3;
      else if (nv.z > 0.999 && onPlane(2, z1)) side = 4;
      else if (nv.z < -0.999 && onPlane(2, z0)) side = 5;
      if (side >= 0 && sideHidden(side)) { culled++; continue; }
      const st = (looks[f.part] ||= style(n, f.part));
      if (!bufs.has(st.key)) bufs.set(st.key, new Buffers(glowKeys.has(st.key)));
      bufs.get(st.key).poly(p, nv, st.color, st.glow);
    }
  } }
  mark();
  const geometries = new Map(), ranges = new Map();
  let triangles = 0;
  for (const [key, b] of bufs) {
    geometries.set(key, b.geometry());
    triangles += b.idx.length / 3;
    const at = (s) => starts[s].get(key) ?? 0;
    ranges.set(key, lists.map((_, s) => ({ start: at(s), count: at(s + 1) - at(s) })));
  }
  const segmentTriangles = lists.map((_, s) => [...bufs.keys()].reduce((a, k) => a + ((starts[s + 1].get(k) ?? 0) - (starts[s].get(k) ?? 0)) / 3, 0));
  return { geometries, ranges, triangles, faces, culled, segmentTriangles };
}
