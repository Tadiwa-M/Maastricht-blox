// Many copies of one brick model (CONTRACT 7.1) in a few draw calls.
//
// buildModel (src/models.js) makes one Group per copy: fine for a demo bus, too many draw
// calls for a crowd. InstancedModel splits the model into its bricks/studs once, groups them
// by (geometry, material) and draws every copy through one InstancedMesh per group. Each copy
// (slot) has a pose, part angles (rotation about the part pivot's local i axis, like
// models.js hinges) and its own colours (recolour by palette index). Slots >= count are not
// drawn, so the pool is just `count`.
import * as THREE from 'three';
import { BrickBatcher, brickColor, exposedStuds, glassEntry } from '../bricks.js';
import { typeExtent, cellKey, ROT_MASK, NO_VARIATION, HIDE_STUDS } from '../world.js';
import { gridToThree } from '../placement.js';

const CABIN_GLOW = new THREE.Color('#ffd49a').multiplyScalar(0.3);
const X = new THREE.Vector3(1, 0, 0);

function modelCells(model, types) {
  const cells = new Set();
  for (const b of model.bricks) {
    const t = types.get(b.type);
    if (!t) continue;
    const [ei, ej] = typeExtent(t, b.rot & ROT_MASK);
    for (let k = 0; k < t.h; k++) for (let dj = 0; dj < ej; dj++) for (let di = 0; di < ei; di++) cells.add(cellKey(b.i + di, b.j + dj, b.k + k));
  }
  return cells;
}

/**
 * Primitives of a model: [{ geometry, material, key, matrix (relative to the part hinge, or
 * the model pivot for the body), part, color (palette index), base (THREE.Color), glow }].
 */
export function modelPrimitives(model, { palette, types, mats, studM = 0.5, plateM = 0.2 }) {
  const cells = modelCells(model, types);
  const covered = (I, J, K) => cells.has(cellKey(I, J, K));
  const pivot = model.pivot || [0, 0, 0];
  const glass = glassEntry(palette);
  const out = [];
  const col = new THREE.Color();
  for (const b of model.bricks) {
    const t = types.get(b.type);
    if (!t) continue;
    const part = b.part && model.parts?.[b.part] ? b.part : '';
    const origin = part ? model.parts[part].pivot : pivot; // bricks are placed relative to this
    const batch = new BrickBatcher(mats, studM, plateM);
    batch.glassEntry = glass;
    const flags = b.rot || 0, rot = flags & ROT_MASK, exact = !!(flags & NO_VARIATION);
    const entry = palette.get(b.color);
    const lit = mats.classOf(entry) === 'glass' || ['window', 'door'].includes(t.kind);
    batch.addBrick({ I: b.i, J: b.j, K: b.k, t, rot, entry, exact, glow: lit ? CABIN_GLOW : null });
    if (!(flags & HIDE_STUDS)) {
      brickColor(entry, b.i, b.j, b.k, exact, col);
      for (const [x, y, z] of exposedStuds(t, rot, b.i, b.j, b.k, covered)) batch.addStud(x, y, z, entry, col);
    }
    const shift = new THREE.Matrix4().makeTranslation(gridToThree(-origin[0], -origin[1], -origin[2], studM, plateM));
    for (const bucket of batch.buckets.values()) {
      const pane = bucket.key.includes(':pane|');
      bucket.mats.forEach((m, q) => out.push({
        geometry: bucket.geometry, material: bucket.material, key: `${bucket.geometry.uuid}|${bucket.material.uuid}`,
        matrix: shift.clone().multiply(m), part, color: pane ? -1 : b.color, base: bucket.cols[q].clone(),
        glow: bucket.glow ? bucket.glow[q] : null,
      }));
    }
  }
  const hinges = {};
  for (const [name, p] of Object.entries(model.parts || {})) {
    hinges[name] = gridToThree(p.pivot[0] - pivot[0], p.pivot[1] - pivot[1], p.pivot[2] - pivot[2], studM, plateM);
  }
  return { prims: out, hinges };
}

export class InstancedModel {
  /** opts: { palette, types, mats, studM, plateM }. cap: maximum copies. */
  constructor(model, opts, cap, { shadows = true } = {}) {
    const { prims, hinges } = modelPrimitives(model, opts);
    this.model = model; this.cap = cap; this.count = 0; this.palette = opts.palette;
    this.hinges = hinges;
    this.group = new THREE.Group();
    this.group.name = `instanced:${model.name}`;
    const byKey = new Map();
    for (const p of prims) { if (!byKey.has(p.key)) byKey.set(p.key, []); byKey.get(p.key).push(p); }
    this.batches = [];
    for (const list of byKey.values()) {
      const n = list.length * cap;
      let geometry = list[0].geometry;
      if (list.some((p) => p.glow)) {
        geometry = geometry.clone();
        geometry.userData.owned = true;
        const a = new Float32Array(n * 3);
        for (let s = 0; s < cap; s++) list.forEach((p, q) => (p.glow || new THREE.Color(0, 0, 0)).toArray(a, (s * list.length + q) * 3));
        geometry.setAttribute('aGlow', new THREE.InstancedBufferAttribute(a, 3));
      }
      const mesh = new THREE.InstancedMesh(geometry, list[0].material, n);
      mesh.count = 0;
      mesh.frustumCulled = false; // instances move anywhere; the batch is small
      mesh.castShadow = shadows && !list[0].material.transparent;
      mesh.receiveShadow = true;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      for (let s = 0; s < cap; s++) list.forEach((p, q) => mesh.setColorAt(s * list.length + q, p.base));
      this.group.add(mesh);
      this.batches.push({ mesh, list });
    }
    this._m = new THREE.Matrix4(); this._pose = new THREE.Matrix4(); this._part = new Map();
    this._q = new THREE.Quaternion(); this._v = new THREE.Vector3(); this._s = new THREE.Vector3(1, 1, 1);
  }

  /** Number of copies drawn (slots 0..n-1). */
  setCount(n) {
    this.count = Math.min(n, this.cap);
    for (const { mesh, list } of this.batches) mesh.count = this.count * list.length;
  }

  /**
   * Recolour copy `slot`: map palette index -> palette index (or THREE.Color). Bricks whose
   * colour is not in the map keep the model colour.
   */
  setColors(slot, map) {
    const c = new THREE.Color();
    for (const { mesh, list } of this.batches) {
      list.forEach((p, q) => {
        const to = map?.[p.color];
        if (to === undefined || p.color < 0) c.copy(p.base);
        else if (to instanceof THREE.Color) c.copy(to);
        else brickColor(this.palette.get(to), slot, q, 0, false, c);
        mesh.setColorAt(slot * list.length + q, c);
      });
      mesh.instanceColor.needsUpdate = true;
    }
  }

  /**
   * Pose copy `slot`: three.js position (x, y, z), rotation about +y (radians, three.js
   * convention) and part angles { name: radians about the part's local i axis }.
   */
  setPose(slot, x, y, z, rotY, angles = null) {
    this._q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rotY);
    this._pose.compose(this._v.set(x, y, z), this._q, this._s);
    this._part.clear();
    for (const [name, h] of Object.entries(this.hinges)) {
      const a = angles?.[name] || 0;
      const m = new THREE.Matrix4().makeTranslation(h.x, h.y, h.z);
      if (a) m.multiply(new THREE.Matrix4().makeRotationAxis(X, a));
      this._part.set(name, this._pose.clone().multiply(m));
    }
    for (const { mesh, list } of this.batches) {
      list.forEach((p, q) => {
        const base = p.part ? this._part.get(p.part) : this._pose;
        mesh.setMatrixAt(slot * list.length + q, this._m.multiplyMatrices(base, p.matrix));
      });
    }
  }

  /** Call once per frame after setPose calls. */
  commit() {
    for (const { mesh } of this.batches) mesh.instanceMatrix.needsUpdate = true;
  }

  dispose() {
    for (const { mesh } of this.batches) { if (mesh.geometry.userData.owned) mesh.geometry.dispose(); mesh.dispose(); }
  }
}
