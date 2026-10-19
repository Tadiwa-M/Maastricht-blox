// Brick geometry cache. Every geometry is built in a local frame centred on the unrotated
// footprint: +x = +i (east), -z = +j (north, the slope's low-edge side), y from 0 upward.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

export const INSET = 0.003; // per side, so seams between bricks read
export const RADIUS = 0.02; // edge bevel
export const STUD_R = 0.15; // 0.6 of the 0.5 m pitch
export const STUD_H = 0.09;

const cache = new Map();

function cached(key, make) {
  if (!cache.has(key)) cache.set(key, make());
  return cache.get(key);
}

function box(W, H, D) {
  const w = W - 2 * INSET, h = H - 2 * INSET, d = D - 2 * INSET;
  const g = new RoundedBoxGeometry(w, h, d, 2, Math.min(RADIUS, h / 2 - 1e-4));
  g.translate(0, INSET + h / 2, 0);
  return g;
}

/** Lathe profile with a soft top edge; tiny flat step keeps the cap flat-shaded. */
function latheRound(r, h, bevel, segments, withBottom) {
  const pts = [];
  if (withBottom) {
    pts.push(new THREE.Vector2(0, 0), new THREE.Vector2(r - bevel - 0.002, 0));
    for (let s = 0; s <= 3; s++) {
      const a = Math.PI * 1.5 + (s / 3) * Math.PI * 0.5;
      pts.push(new THREE.Vector2(r - bevel + Math.cos(a) * bevel, bevel + Math.sin(a) * bevel));
    }
  } else {
    pts.push(new THREE.Vector2(r, -0.004));
  }
  for (let s = 0; s <= 3; s++) {
    const a = (s / 3) * Math.PI * 0.5;
    pts.push(new THREE.Vector2(r - bevel + Math.cos(a) * bevel, h - bevel + Math.sin(a) * bevel));
  }
  pts.push(new THREE.Vector2(r - bevel - 0.002, h), new THREE.Vector2(0, h));
  return new THREE.LatheGeometry(pts, segments);
}

/** Inward offset of a convex polygon (counter-clockwise points) by m. */
function offsetConvex(pts, m) {
  const n = pts.length;
  const lines = [];
  for (let q = 0; q < n; q++) {
    const a = pts[q], b = pts[(q + 1) % n];
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const len = Math.hypot(dx, dy);
    const nx = -dy / len, ny = dx / len; // left normal = inward for CCW
    lines.push({ px: a[0] + nx * m, py: a[1] + ny * m, dx, dy });
  }
  const out = [];
  for (let q = 0; q < n; q++) {
    const l1 = lines[(q + n - 1) % n], l2 = lines[q];
    const den = l1.dx * l2.dy - l1.dy * l2.dx;
    const t = ((l2.px - l1.px) * l2.dy - (l2.py - l1.py) * l2.dx) / den;
    out.push(new THREE.Vector2(l1.px + l1.dx * t, l1.py + l1.dy * t));
  }
  return out;
}

const BEVEL = 0.014;

/** Extrude a side profile (s = toward the low edge / +j, y up) across the width. */
function extrudeProfile(profile, W, D) {
  const m = INSET + BEVEL;
  const shape = new THREE.Shape(offsetConvex(profile, m));
  const depth = W - 2 * m;
  const g = new THREE.ExtrudeGeometry(shape, {
    depth, bevelEnabled: true, bevelThickness: BEVEL, bevelSize: BEVEL, bevelSegments: 2, curveSegments: 1,
  });
  // (s, y, e) -> (x = e - depth/2, y, z = D/2 - s): a proper rotation about y
  const mtx = new THREE.Matrix4().set(0, 0, 1, -depth / 2, 0, 1, 0, 0, -1, 0, 0, D / 2, 0, 0, 0, 1);
  g.applyMatrix4(mtx);
  return g;
}

function slopeProfile(t, P) {
  const D = t.d * P.studM, H = t.h * P.plateM, lip = P.plateM;
  const back = (t.studRows || 1) * P.studM;
  return [[0, 0], [D, 0], [D, lip], [back, H], [0, H]];
}

function ridgeProfile(t, P) {
  const D = t.d * P.studM, H = t.h * P.plateM, lip = P.plateM, e = 0.02;
  return [[0, 0], [D, 0], [D, lip], [D / 2 + e, H], [D / 2 - e, H], [0, lip]];
}

/** Body geometry for a catalogue type (unrotated, local frame). */
export function bodyGeometry(t, P) {
  return cached(`body:${t.id}`, () => {
    const W = t.w * P.studM, D = t.d * P.studM, H = t.h * P.plateM;
    switch (t.kind) {
      case 'slope': return extrudeProfile(slopeProfile(t, P), W, D);
      case 'slope_double': return extrudeProfile(ridgeProfile(t, P), W, D);
      case 'round': return latheRound(Math.min(W, D) / 2 - 0.012, H - INSET, 0.02, 24, true);
      default: return box(W, H, D);
    }
  });
}

export function studGeometry() {
  return cached('stud', () => latheRound(STUD_R, STUD_H, 0.018, 20, false));
}
