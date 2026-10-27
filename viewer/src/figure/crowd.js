// A crowd of toy figures drawn with one InstancedMesh per part geometry (head, each hair
// style, each top style, limbs, shoes, accessories), in two levels of detail: figures within
// hiDist of the eye (camera; up to hiCap) get the detailed parts (~4.5k triangles), the rest
// the far parts (~1.5k, 12 meshes). Draw calls stay ~25-36 for any number of people.
// Every frame: begin(), add(variant, pose) per visible figure, end(). Instances are packed in
// the order added, so a mesh only draws as many copies as figures use that part.
import * as THREE from 'three';
import { FIGURE_PARTS, figureMaterial, HAIR_STYLES, TOP_STYLES, ACCESSORIES } from './parts.js';
import { poseFigure, jointAngles } from './rig.js';

const LIMBS = { hips: 1, upperArm: 2, foreArm: 2, hand: 2, thigh: 2, shin: 2, shoe: 2, head: 1, 'lo:upperArm': 2, 'lo:foreArm': 2, 'lo:thigh': 2, 'lo:shin': 2 };

/** Linear colours of a variant, cached on it. */
export function variantColours(v) {
  if (v._c) return v._c;
  v._c = {};
  for (const [k, hex] of Object.entries(v.colours)) v._c[k] = new THREE.Color(hex);
  return v._c;
}

export class FigureCrowd {
  /** cap: maximum figures. material: optional shared material. */
  constructor(cap, { clippingPlanes = null, shadows = true, material = null, lod = true, hiDist = 32, hiCap = 160 } = {}) {
    this.cap = cap;
    this.material = material || figureMaterial({ clippingPlanes });
    this.group = new THREE.Group();
    this.group.name = 'figures';
    const P = FIGURE_PARTS();
    const geos = { ...Object.fromEntries(Object.keys(LIMBS).map((k) => [k, P[k]])) };
    for (const s of HAIR_STYLES) geos[`hair:${s}`] = P.hair[s];
    for (const s of TOP_STYLES) geos[`top:${s}`] = P.top[s];
    for (const a of ACCESSORIES) if (a !== 'none') geos[`acc:${a}`] = P.acc[a];
    if (lod) {
      for (const k of ['head', 'hips', 'upperArm', 'foreArm', 'thigh', 'shin', 'backpack']) geos[`lo:${k}`] = P.lo[k];
      for (const [k, g] of Object.entries(P.lo.hair)) geos[`lo:hair:${k}`] = g;
      for (const [k, g] of Object.entries(P.lo.top)) geos[`lo:top:${k}`] = g;
    }
    this.meshes = new Map();
    for (const [key, geo] of Object.entries(geos)) {
      const n = (key.startsWith('lo:') || key === 'acc:umbrella' || !lod ? cap : Math.min(cap, hiCap)) * (LIMBS[key] || 1);
      const mesh = new THREE.InstancedMesh(geo, this.material, n);
      mesh.name = `figure:${key}`;
      mesh.count = 0;
      mesh.frustumCulled = false;
      mesh.castShadow = shadows; mesh.receiveShadow = true;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.setColorAt(0, new THREE.Color(1, 1, 1));
      mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
      this.group.add(mesh);
      this.meshes.set(key, { mesh, n: 0, cap: n, m: mesh.instanceMatrix.array, c: mesh.instanceColor.array });
    }
    this.count = 0;
    this.lod = lod; this.hiDist2 = hiDist * hiDist; this.hiCap = hiCap; this.hi = 0;
    this.cullDist2 = 0; // > 0: figures farther than this from the eye are not drawn (life/index.js sets it)
    this.eye = null; // camera position (three.js); near figures get the detailed parts
    this._J = {};
    this._cols = null;
    this._emit = (key, mat, colourKey) => {
      const e = this.meshes.get(key);
      if (!e || e.n >= e.cap) return;
      const i = e.n++;
      e.m.set(mat, i * 16);
      const c = this._cols[colourKey] || this._cols.top;
      e.c[i * 3] = c.r; e.c[i * 3 + 1] = c.g; e.c[i * 3 + 2] = c.b;
    };
  }

  begin(eye = this.eye) { for (const e of this.meshes.values()) e.n = 0; this.count = 0; this.hi = 0; this.eye = eye; }

  /** Add one figure. pose: { x, y, z (three.js metres, feet), rotY, mode, phase, speed, t, look }. */
  add(v, pose) {
    if (this.count >= this.cap) return false;
    const e0 = this.eye;
    if (e0 && this.cullDist2 && (pose.x - e0.x) ** 2 + (pose.y - e0.y) ** 2 + (pose.z - e0.z) ** 2 > this.cullDist2) return false; // too small to see
    this.count++;
    this._cols = variantColours(v);
    let lo = false;
    if (this.lod) {
      const e = this.eye;
      const d2 = e ? (pose.x - e.x) ** 2 + (pose.y - e.y) ** 2 + (pose.z - e.z) ** 2 : 0;
      lo = d2 > this.hiDist2 || this.hi >= this.hiCap;
      if (!lo) this.hi++;
    }
    poseFigure(v, pose, this._emit, jointAngles(v, pose, this._J), lo);
    return true;
  }

  end() {
    for (const { mesh, n } of this.meshes.values()) {
      mesh.count = n;
      mesh.visible = n > 0;
      mesh.instanceMatrix.needsUpdate = true;
      mesh.instanceColor.needsUpdate = true;
    }
  }

  /** Meshes that draw (= draw calls of the crowd in the main pass). */
  drawCalls() { let k = 0; for (const { mesh } of this.meshes.values()) if (mesh.visible && mesh.count > 0) k++; return k; }

  dispose() { for (const { mesh } of this.meshes.values()) mesh.dispose(); this.material.dispose(); }
}
