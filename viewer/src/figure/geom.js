// Small geometry helpers for the smooth toy figure and its props: every piece gets a vertex
// colour (multiplied by the instance colour in the shader, so a part can carry fixed dark
// details such as eyes or tyres while the instance colour picks the clothing colour) and
// pieces are merged into one BufferGeometry per part.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/** Shade a geometry with one vertex colour (number grey level or [r, g, b] 0..1). */
export function tint(geo, c = 1) {
  const g = geo;
  const [r, gg, b] = Array.isArray(c) ? c : [c, c, c];
  const n = g.attributes.position.count, a = new Float32Array(n * 3);
  for (let q = 0; q < n; q++) { a[3 * q] = r; a[3 * q + 1] = gg; a[3 * q + 2] = b; }
  g.setAttribute('color', new THREE.BufferAttribute(a, 3));
  if (g.attributes.uv) g.deleteAttribute('uv');
  if (g.attributes.uv1) g.deleteAttribute('uv1');
  return g;
}

/**
 * An absolute vertex colour: components >= 2 mean "this colour (minus 2), whatever the part is
 * painted" (render/vehiclesurface.js paints it over the body: chrome, a cream roof, stickers).
 */
export const decal = (r, g, b) => [r + 2, g + 2, b + 2];
export const CHROME = decal(0.86, 0.88, 0.92), CREAM = decal(0.95, 0.92, 0.84);

/** Translate/rotate/scale helper: geo -> geo (in place). */
export function place(geo, { at = [0, 0, 0], rot = [0, 0, 0], scale = null } = {}) {
  if (scale) geo.scale(...(Array.isArray(scale) ? scale : [scale, scale, scale]));
  if (rot[0]) geo.rotateX(rot[0]);
  if (rot[1]) geo.rotateY(rot[1]);
  if (rot[2]) geo.rotateZ(rot[2]);
  geo.translate(...at);
  return geo;
}

export const rbox = (w, h, d, r, c = 1, seg = 2) => tint(new RoundedBoxGeometry(w, h, d, seg, Math.min(r, w / 2, h / 2, d / 2) * 0.999), c);
/** A plain box (12 triangles): for small details where rounded edges cannot be seen but cost hundreds of triangles. */
export const box = (w, h, d, c = 1) => tint(new THREE.BoxGeometry(w, h, d), c);
export const sphere = (r, c = 1, ws = 9, hs = 6) => tint(new THREE.SphereGeometry(r, ws, hs), c);
export const capsule = (r, len, c = 1, seg = 2, rad = 8) => tint(new THREE.CapsuleGeometry(r, len, seg, rad), c);
export const cyl = (rt, rb, h, c = 1, seg = 12) => tint(new THREE.CylinderGeometry(rt, rb, h, seg), c);
export const torus = (R, r, c = 1, arc = Math.PI * 2, rs = 6, ts = 16) => tint(new THREE.TorusGeometry(R, r, rs, ts, arc), c);

/** Lathe around +y from [radius, y] points, then squashed in depth by `depth` (ellipse). */
export function lathe(points, { depth = 1, width = 1, c = 1, seg = 18 } = {}) {
  const g = new THREE.LatheGeometry(points.map(([r, y]) => new THREE.Vector2(r, y)), seg);
  g.scale(width, 1, depth);
  return tint(g, c);
}

/** Tube (cylinder) between two points a, b ([x, y, z]) with radius r. */
export function tube(a, b, r, c = 1, seg = 6) {
  const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b);
  const L = A.distanceTo(B);
  const g = new THREE.CylinderGeometry(r, r, L, seg, 1);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), B.clone().sub(A).normalize());
  g.applyQuaternion(q);
  g.translate((A.x + B.x) / 2, (A.y + B.y) / 2, (A.z + B.z) / 2);
  return tint(g, c);
}

/** Merge pieces (all indexed after toIndexed) into one geometry with position/normal/color. */
export function merge(list) {
  const norm = list.map((h) => {
    for (const k of Object.keys(h.attributes)) if (!['position', 'normal', 'color'].includes(k)) h.deleteAttribute(k);
    if (!h.attributes.color) tint(h, 1);
    return h.index ? h : h.setIndex([...Array(h.attributes.position.count).keys()]);
  });
  const g = mergeGeometries(norm, false);
  g.computeBoundingSphere();
  return g;
}

/**
 * A torso in two for a bending spine (the painted looks' figures): { upper, belly } split at
 * height y. A small triangle across the cut goes in both; a long piece across it (a coat's
 * front) goes whole to the side of its middle; the filler (e.g. a squashed sphere at the cut)
 * joins the belly and hides the gap when the chest bends. Both keep the torso's coordinates.
 */
export function splitTorso(geo, y, filler) {
  const pos = geo.attributes.position, nor = geo.attributes.normal, col = geo.attributes.color, idx = geo.index;
  const tri = idx ? idx.count / 3 : pos.count / 3, at = (k) => (idx ? idx.getX(k) : k);
  const parts = [[], []];
  for (let t = 0; t < tri; t++) {
    const v = [at(3 * t), at(3 * t + 1), at(3 * t + 2)], ys = v.map((i) => pos.getY(i));
    const lo = Math.min(...ys), hi = Math.max(...ys), mid = (ys[0] + ys[1] + ys[2]) / 3;
    if (hi - lo > 0.12) parts[mid > y ? 0 : 1].push(...v);
    else { if (hi > y - 0.01) parts[0].push(...v); if (lo < y + 0.01) parts[1].push(...v); }
  }
  const build = (list) => {
    const g = new THREE.BufferGeometry(), P = new Float32Array(list.length * 3), N = new Float32Array(list.length * 3), C = new Float32Array(list.length * 3);
    list.forEach((i, k) => { P.set([pos.getX(i), pos.getY(i), pos.getZ(i)], 3 * k); N.set([nor.getX(i), nor.getY(i), nor.getZ(i)], 3 * k); C.set([col.getX(i), col.getY(i), col.getZ(i)], 3 * k); });
    g.setAttribute('position', new THREE.BufferAttribute(P, 3)); g.setAttribute('normal', new THREE.BufferAttribute(N, 3)); g.setAttribute('color', new THREE.BufferAttribute(C, 3));
    return g;
  };
  return { upper: merge([build(parts[0])]), belly: merge([build(parts[1]), filler]) };
}

/**
 * A top for a bendy figure: the chest (top), the belly it bends over, and for a long top (a coat,
 * a dress) the hem that swings on its own (tail). Cut at `spineAt` and `hemAt` (parts.js BODY);
 * each filler (e.g. a squashed sphere at the cut) hides the gap when that joint bends.
 */
export function splitTop(geo, { spineAt, hemAt, waist, hem = null }) {
  const { upper, belly } = splitTorso(geo, spineAt, waist);
  if (!hem) return { top: upper, belly };
  const h = splitTorso(belly, hemAt, hem);
  return { top: upper, belly: h.upper, tail: h.belly };
}

/** Split every top style of a figure (top(style) -> geometry) into parts.top/belly/tail. */
export function splitTops(styles, top, fillers) {
  const out = { top: {}, belly: {}, tail: {} };
  for (const st of styles) {
    const p = splitTop(top(st), fillers(st));
    out.top[st] = p.top; out.belly[st] = p.belly;
    if (p.tail) out.tail[st] = p.tail;
  }
  return out;
}
