// Street lamps that light the street at night: every double-lantern lamp post in the near
// zone (catalogue piece `lamp_double_1x3`) gets a warm pool of light on the ground under it and a
// soft glow round each of its two lanterns. Light shapes drawn additively (no light sources: two
// instanced meshes for every lamp in view), fading in at dusk. lampsFromRecords() is pure (tested).
import * as THREE from 'three';
import { poolSources, lampPool } from './pools.js';


export const LAMP = { type: 'lamp_double_1x3', poolR: 5.5, glowR: 0.9, cap: 240, from: 0.12, full: 0.45 };
const WARM = [1.0, 0.72, 0.38];

/**
 * Lamp posts in a streamed item's raw records (no World needed: cheap enough for every chunk in
 * the stream radius, not only the full-detail ones): [{ base: [x, y, z], heads: [[x, y, z] x2] }]
 * in the item's own three.js frame (islands: local; the caller applies the pose). records: { i, j, k, type, rotFlags };
 * I0, J0: the item's grid offset (a chunk's cx * 64; islands 0); lamp: the catalogue entry.
 */
export function lampsFromRecords(records, I0, J0, lamp, studM = 0.5, plateM = 0.2) {
  const out = [];
  if (!lamp) return out;
  const n = records.type.length;
  for (let q = 0; q < n; q++) {
    if (records.type[q] !== lamp.id) continue;
    const odd = (records.rotFlags[q] & 3) % 2 === 1; // turned a quarter: width and depth swap
    const ei = odd ? lamp.d : lamp.w, ej = odd ? lamp.w : lamp.d;
    const I = I0 + records.i[q], J = J0 + records.j[q], K = records.k[q];
    const cx = (I + ei / 2) * studM, cz = -(J + ej / 2) * studM, y0 = K * plateM, yTop = (K + lamp.h) * plateM - 0.45;
    const along = ei >= ej ? [1, 0] : [0, -1], half = (Math.max(ei, ej) / 2 - 0.5) * studM;
    out.push({ base: [cx, y0, cz], heads: [[cx - along[0] * half, yTop, cz - along[1] * half], [cx + along[0] * half, yTop, cz + along[1] * half]] });
  }
  return out;
}

function poolGeometry() { // a disc, bright in the middle, gone at the rim (vertex colours)
  const g = new THREE.CircleGeometry(1, 32, 0, Math.PI * 2).rotateX(-Math.PI / 2);
  const pos = g.attributes.position, col = new Float32Array(pos.count * 3);
  for (let q = 0; q < pos.count; q++) {
    const r = Math.hypot(pos.getX(q), pos.getZ(q)), k = 0.32 * (1 - r) ** 1.8;
    col.set([WARM[0] * k, WARM[1] * k, WARM[2] * k], q * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}

function glowGeometry() { // a camera-facing quad with a soft round glow
  const g = new THREE.CircleGeometry(1, 24);
  const pos = g.attributes.position, col = new Float32Array(pos.count * 3);
  for (let q = 0; q < pos.count; q++) {
    const r = Math.hypot(pos.getX(q), pos.getY(q)), k = 0.9 * (1 - r) ** 2.2;
    col.set([WARM[0] * k, WARM[1] * k * 1.05, WARM[2] * k * 1.2], q * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}

export class LampLights {
  constructor() {
    const mat = () => new THREE.MeshBasicMaterial({ vertexColors: true, blending: THREE.AdditiveBlending, transparent: true,
      depthWrite: false, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
    this.pools = new THREE.InstancedMesh(poolGeometry(), mat(), LAMP.cap);
    this.glows = new THREE.InstancedMesh(glowGeometry(), mat(), LAMP.cap * 2);
    for (const m of [this.pools, this.glows]) { m.count = 0; m.frustumCulled = false; m.renderOrder = 2; }
    this.group = new THREE.Group();
    this.group.name = 'lamp light';
    this.group.add(this.pools, this.glows);
    this.byKey = new Map(); // chunk/island key -> lamps in world space
    this.dirty = true;
    this._m = new THREE.Matrix4(); this._v = new THREE.Vector3(); this._s = new THREE.Vector3(); this._q = new THREE.Quaternion();
    this._qi = new THREE.Quaternion();
    this.pools.visible = false; poolSources.add(this); // lamps light the ground for real (render/pools.js); the discs stay for scenes without it
  }

  /** Pool light sources (render/pools.js): one per lamp head in the near zone. */
  lights() {
    const out = [];
    for (const ls of this.byKey.values()) for (const l of ls) for (const h of l.heads) out.push(lampPool(h));
    return out;
  }

  /** The lamps of a near chunk (frame: the Object3D its meshes hang from, for islands' poses). */
  add(key, lamps, frame = null) {
    if (!lamps.length) { this.remove(key); return; }
    frame?.updateWorldMatrix(true, false);
    const tf = (p) => (frame ? this._v.fromArray(p).applyMatrix4(frame.matrixWorld).toArray() : p.slice());
    this.byKey.set(key, lamps.map((l) => ({ base: tf(l.base), heads: l.heads.map(tf) })));
    this.dirty = true;
  }

  remove(key) { if (this.byKey.delete(key)) this.dirty = true; }

  /** Per frame: night 0..1 (scene.js), camera (glows face it; the nearest lamps win the cap). */
  update(camera, night) {
    const k = Math.max(0, Math.min(1, (night - LAMP.from) / (LAMP.full - LAMP.from)));
    this.group.visible = k > 0;
    if (!this.group.visible) return;
    for (const m of [this.pools, this.glows]) m.material.opacity = k; // (additive: opacity scales the light)
    const eye = camera.position;
    if (this.dirty || !this.lastEye || this.lastEye.distanceToSquared(eye) > 100) {
      this.dirty = false; this.lastEye = eye.clone();
      const all = [];
      for (const ls of this.byKey.values()) for (const l of ls) all.push(l);
      all.sort((a, b) => (a.base[0] - eye.x) ** 2 + (a.base[2] - eye.z) ** 2 - ((b.base[0] - eye.x) ** 2 + (b.base[2] - eye.z) ** 2));
      this.shown = all.slice(0, LAMP.cap);
      this.shown.forEach((l, i) => {
        this._m.compose(this._v.set(l.base[0], l.base[1] + 0.05, l.base[2]), this._qi, this._s.set(LAMP.poolR, 1, LAMP.poolR));
        this.pools.setMatrixAt(i, this._m);
      });
      this.pools.count = this.shown.length;
      this.pools.instanceMatrix.needsUpdate = true;
    }
    // glows turn to the camera every frame
    let g = 0;
    for (const l of this.shown || []) for (const h of l.heads) {
      this._m.compose(this._v.fromArray(h), camera.quaternion, this._s.setScalar(LAMP.glowR));
      this.glows.setMatrixAt(g++, this._m);
    }
    this.glows.count = g;
    this.glows.instanceMatrix.needsUpdate = true;
  }
}
