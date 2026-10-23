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
