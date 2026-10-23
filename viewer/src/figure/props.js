// Static street props for city life, smooth toy style like the figures: cafe tables, chairs,
// parasols, market stalls (striped awnings, crates of produce) and bike racks. One
// InstancedMesh per prop part; rebuilt only when the set of props changes (begin/add/end).
// Origins: ground; front = -z (a chair's sitter faces -z; a stall's customers stand at -z).
import * as THREE from 'three';
import { rbox, sphere, cyl, tube, place, merge, tint } from './geom.js';
import { figureMaterial } from './parts.js';
import { rng } from './variants.js';

export const STALL = { w: 3.0, d: 2.0 };
export const AWNINGS = [[0.78, 0.1, 0.12], [0.18, 0.45, 0.25], [0.15, 0.3, 0.6], [0.9, 0.62, 0.12]]; // stripe colours (linear-ish)

function table() {
  return merge([place(cyl(0.36, 0.36, 0.03, 1, 22), { at: [0, 0.74, 0] }), place(cyl(0.025, 0.025, 0.72, 0.6, 8), { at: [0, 0.37, 0] }),
    place(cyl(0.2, 0.22, 0.03, 0.6, 16), { at: [0, 0.015, 0] }),
    place(cyl(0.035, 0.03, 0.09, [0.95, 0.95, 1], 10), { at: [0.12, 0.8, -0.05] }), // a glass
    place(cyl(0.05, 0.045, 0.06, [1, 1, 1], 10), { at: [-0.1, 0.785, 0.08] })]); // a cup
}

function chair() {
  const leg = (x, z) => tube([x, 0, z], [x, 0.45, z], 0.014, 0.55, 6);
  return merge([place(rbox(0.42, 0.04, 0.4, 0.015, 1, 1), { at: [0, 0.46, 0] }), place(rbox(0.42, 0.34, 0.035, 0.015, 1, 1), { at: [0, 0.68, 0.19], rot: [-0.08, 0, 0] }),
    leg(-0.18, -0.17), leg(0.18, -0.17), leg(-0.18, 0.17), leg(0.18, 0.17)]);
}

function parasol() {
  const canopy = new THREE.ConeGeometry(1.35, 0.42, 12, 1, false); // closed: the flat underside shows from below
  return merge([place(tint(canopy, 1), { at: [0, 2.35, 0] }),
    place(cyl(0.025, 0.025, 2.5, 0.85, 8), { at: [0, 1.25, 0] }), place(sphere(0.04, 0.85, 8, 6), { at: [0, 2.58, 0] })]);
}

/** Stall frame + counter + crates; goods baked with vertex colours (instance colour = white). */
function stallBase() {
  const { w, d } = STALL, parts = [];
  for (const x of [-w / 2 + 0.05, w / 2 - 0.05]) for (const z of [-d / 2 + 0.05, d / 2 - 0.05]) parts.push(tube([x, 0, z], [x, 2.25, z], 0.03, 0.7, 6));
  parts.push(place(rbox(w, 0.06, d * 0.55, 0.02, [0.62, 0.45, 0.28], 1), { at: [0, 0.82, -d * 0.2] })); // counter (wood)
  parts.push(place(rbox(w - 0.1, 0.7, 0.04, 0.01, [0.9, 0.9, 0.88], 1), { at: [0, 0.45, -d / 2 + 0.06] })); // front cloth
  const r = rng(11);
  const goods = [[0.85, 0.12, 0.08], [0.95, 0.55, 0.08], [0.95, 0.85, 0.15], [0.35, 0.65, 0.15], [0.55, 0.2, 0.45], [0.95, 0.9, 0.7]];
  for (let q = 0; q < 5; q++) {
    const x = -w / 2 + 0.35 + q * ((w - 0.7) / 4), z = -d * 0.2;
    parts.push(place(rbox(0.5, 0.14, 0.4, 0.02, [0.55, 0.38, 0.22], 1), { at: [x, 0.92, z] })); // crate
    const c = goods[Math.floor(r() * goods.length)];
    for (let k = 0; k < 6; k++) parts.push(place(sphere(0.07, c, 6, 4), { at: [x + (k % 3 - 1) * 0.14, 1.02, z + (k < 3 ? -0.08 : 0.08)] }));
  }
  parts.push(place(rbox(w * 0.9, 0.5, 0.5, 0.05, [0.6, 0.6, 0.62], 1), { at: [0, 0.25, d / 2 - 0.4] })); // boxes at the back
  return merge(parts);
}

/** Striped awning: sloping roof (front low) with stripes of colour c and white. */
function awning(c) {
  const { w, d } = STALL, n = 8, parts = [];
  for (let q = 0; q < n; q++) {
    const x = -w / 2 + (q + 0.5) * (w / n);
    const s = place(rbox(w / n + 0.002, 0.04, d + 0.3, 0.01, q % 2 ? [0.95, 0.95, 0.93] : c, 1), { at: [x, 2.35, 0], rot: [-0.22, 0, 0] });
    parts.push(s);
    parts.push(place(rbox(w / n + 0.002, 0.22, 0.03, 0.01, q % 2 ? [0.95, 0.95, 0.93] : c, 1), { at: [x, 2.09, -d / 2 - 0.2] })); // valance
  }
  return merge(parts);
}

function rack() { // a row of low hoops for 6 bikes, 0.7 m apart along x
  const parts = [];
  for (let q = 0; q < 6; q++) {
    const x = (q - 2.5) * 0.7;
    parts.push(tube([x, 0, -0.3], [x, 0.55, -0.3], 0.02, 1, 6), tube([x, 0.55, -0.3], [x, 0.55, 0.3], 0.02, 1, 6), tube([x, 0, 0.3], [x, 0.55, 0.3], 0.02, 1, 6));
  }
  parts.push(tube([-2.1, 0.02, 0], [2.1, 0.02, 0], 0.03, 0.8, 6));
  return merge(parts);
}

let geoCache = null;
export function PROP_GEOS() {
  if (geoCache) return geoCache;
  geoCache = { table: table(), chair: chair(), parasol: parasol(), 'stall:base': stallBase(), rack: rack() };
  AWNINGS.forEach((c, q) => { geoCache[`stall:awning:${q}`] = awning(c); });
  return geoCache;
}

const DEFAULT_COL = { table: '#5C6062', chair: '#5C6062', parasol: '#F2F0EA', rack: '#8C9196', 'stall:base': '#ffffff' };

export class PropSet {
  constructor({ caps = {}, clippingPlanes = null, shadows = true, material = null } = {}) {
    this.material = material || figureMaterial({ clippingPlanes });
    this.group = new THREE.Group();
    this.group.name = 'props';
    this.meshes = new Map();
    const G = PROP_GEOS();
    const base = { table: 300, chair: 1200, parasol: 200, 'stall:base': 80, rack: 120 };
    for (const [key, geo] of Object.entries(G)) {
      const cap = caps[key] ?? base[key] ?? 80;
      const mesh = new THREE.InstancedMesh(geo, this.material, cap);
      mesh.name = `prop:${key}`;
      mesh.count = 0; mesh.frustumCulled = false; mesh.castShadow = shadows; mesh.receiveShadow = true;
      mesh.setColorAt(0, new THREE.Color(1, 1, 1));
      this.group.add(mesh);
      this.meshes.set(key, { mesh, n: 0, cap });
    }
    this._m = new THREE.Matrix4(); this._q = new THREE.Quaternion(); this._v = new THREE.Vector3(); this._s = new THREE.Vector3(1, 1, 1);
    this._up = new THREE.Vector3(0, 1, 0); this._c = new THREE.Color();
  }

  begin() { for (const e of this.meshes.values()) e.n = 0; }

  /** kind: table | chair | parasol | stall | rack; three.js position; opts.colour (hex; for a stall: awning index). */
  add(kind, x, y, z, rotY, { colour } = {}) {
    if (kind === 'stall') {
      this.add('stall:base', x, y, z, rotY);
      return this.add(`stall:awning:${(colour ?? 0) % AWNINGS.length}`, x, y, z, rotY, { colour: '#ffffff' });
    }
    const e = this.meshes.get(kind);
    if (!e || e.n >= e.cap) return false;
    this._m.compose(this._v.set(x, y, z), this._q.setFromAxisAngle(this._up, rotY), this._s);
    e.mesh.setMatrixAt(e.n, this._m);
    e.mesh.setColorAt(e.n, this._c.set(colour || DEFAULT_COL[kind] || '#ffffff'));
    e.n++;
    return true;
  }

  end() {
    for (const { mesh, n } of this.meshes.values()) {
      mesh.count = n; mesh.visible = n > 0;
      mesh.instanceMatrix.needsUpdate = true; if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
  }

  drawCalls() { let k = 0; for (const { mesh } of this.meshes.values()) if (mesh.visible && mesh.count > 0) k++; return k; }
}
