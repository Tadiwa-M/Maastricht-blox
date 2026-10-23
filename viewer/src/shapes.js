// Low-level shape builders shared by the brick geometries (src/geometry.js, src/details.js).
//
// Local frame for every piece: centred on its UNROTATED footprint, +x = +i (east),
// -z = +j (north = the piece's FRONT), y = 0 at the bottom. src/placement.js turns and
// moves this frame onto a record.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export const INSET = 0.003; // per side, so seams between bricks read
export const RADIUS = 0.02; // edge bevel of ordinary bricks

/** Merge geometries of mixed kinds (indexed or not) into one non-indexed geometry. */
export function merge(list) {
  const flat = list.map((g) => {
    const n = g.index ? g.toNonIndexed() : g;
    for (const name of Object.keys(n.attributes)) if (!['position', 'normal', 'uv'].includes(name)) n.deleteAttribute(name);
    if (!n.attributes.uv) n.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n.attributes.position.count * 2), 2));
    return n;
  });
  return mergeGeometries(flat, false);
}

let bevelSegments = 2; // per rounded quarter; 1 = 108 instead of 300 triangles per box

/** Build geometry with `n` bevel segments (lite near LOD: 1) instead of 2. */
export function withBevelSegments(n, make) {
  const old = bevelSegments;
  bevelSegments = n;
  try { return make(); } finally { bevelSegments = old; }
}

/** Axis-aligned box from min to max corner, optionally with rounded edges (radius r). */
export function slab(x0, x1, y0, y1, z0, z1, r = 0, segments = bevelSegments) {
  const w = x1 - x0, h = y1 - y0, d = z1 - z0;
  const rr = Math.min(r, w / 2 - 1e-4, h / 2 - 1e-4, d / 2 - 1e-4);
  const g = rr > 0.002 ? new RoundedBoxGeometry(w, h, d, segments, rr) : new THREE.BoxGeometry(w, h, d);
  g.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
  return g;
}

/** A W x H x D brick body with the seam inset and bevel. */
export function brickBox(W, H, D, r = RADIUS) {
  return slab(-W / 2 + INSET, W / 2 - INSET, INSET, H - INSET, -D / 2 + INSET, D / 2 - INSET, r);
}

/** Plain box filling the whole cell volume: no seam, no bevel (glass, water). */
export function seamlessBox(W, H, D) {
  return slab(-W / 2, W / 2, 0, H, -D / 2, D / 2, 0);
}

/** Lathe profile with a soft top edge; a tiny flat step keeps the cap flat-shaded. */
export function latheRound(r, h, bevel, segments, withBottom) {
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
    lines.push({ px: a[0] - (dy / len) * m, py: a[1] + (dx / len) * m, dx, dy });
  }
  return lines.map((l2, q) => {
    const l1 = lines[(q + n - 1) % n];
    const den = l1.dx * l2.dy - l1.dy * l2.dx;
    const t = ((l2.px - l1.px) * l2.dy - (l2.py - l1.py) * l2.dx) / den;
    return new THREE.Vector2(l1.px + l1.dx * t, l1.py + l1.dy * t);
  });
}

const BEVEL = 0.012;

/**
 * Extrude a convex side profile across the width W. Profile points are (s, y) with s
 * measured from the back (+z side) toward the FRONT (-z side); D is the depth.
 */
export function extrudeProfile(profile, W, D) {
  const m = INSET + BEVEL;
  const shape = new THREE.Shape(offsetConvex(profile, m));
  const depth = W - 2 * m;
  const g = new THREE.ExtrudeGeometry(shape, {
    depth, bevelEnabled: true, bevelThickness: BEVEL, bevelSize: BEVEL, bevelSegments: 2, curveSegments: 1,
  });
  // (s, y, e) -> (x = e - depth/2, y, z = D/2 - s): a proper rotation about y
  g.applyMatrix4(new THREE.Matrix4().set(0, 0, 1, -depth / 2, 0, 1, 0, 0, -1, 0, 0, D / 2, 0, 0, 0, 1));
  return g;
}

/**
 * Extrude a front-view outline (x, y points, any simple polygon) through the depth,
 * from z0 to z1. No bevel: used for arches, whose outline is concave.
 */
export function extrudeFront(points, z0, z1) {
  const shape = new THREE.Shape(points.map(([x, y]) => new THREE.Vector2(x, y)));
  const g = new THREE.ExtrudeGeometry(shape, { depth: z1 - z0, bevelEnabled: false, curveSegments: 1 });
  g.translate(0, 0, z0);
  return g;
}

/** Vertical round post (cylinder) from y0 to y1 at (x, z). */
export function post(x, z, r, y0, y1, segments = 10) {
  const g = new THREE.CylinderGeometry(r, r, y1 - y0, segments);
  g.translate(x, (y0 + y1) / 2, z);
  return g;
}
