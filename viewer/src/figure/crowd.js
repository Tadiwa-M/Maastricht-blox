// A crowd of toy figures drawn with one InstancedMesh per part geometry (head, each hair
// style, each top style, limbs, shoes, accessories), in two levels of detail: figures within
// hiDist of the eye (camera; up to hiCap) get the detailed parts (~4.5k triangles), the rest
// the far parts (~1.5k, 12 meshes). Draw calls stay ~25-36 for any number of people.
// Every frame: begin(), add(variant, pose) per visible figure, end(). Instances are packed in
// the order added, so a mesh only draws as many copies as figures use that part.
import * as THREE from 'three';
import { FIGURE_PARTS, figureMaterial, HAIR_STYLES, TOP_STYLES, ACCESSORIES } from './parts.js';
import { poseFigure, jointAngles, MODE } from './rig.js';
import { FIGURE_LOOK, figureKindOf, figureMaterialFor } from '../render/figuresurface.js';

const LIMBS = { hips: 1, upperArm: 2, foreArm: 2, hand: 2, thigh: 2, shin: 2, shoe: 2, head: 1, 'lo:upperArm': 2, 'lo:foreArm': 2, 'lo:thigh': 2, 'lo:shin': 2 };

/** Linear colours of a variant, cached on it. */
export function variantColours(v) {
  if (v._c) return v._c;
  v._c = {};
  for (const [k, hex] of Object.entries(v.colours)) v._c[k] = new THREE.Color(hex);
  return v._c;
}

export const CONTACT = { r: 0.45, dark: 0.4 }; // radius (m), the ground's brightness right under the feet

const contactGeometry = () => new THREE.CircleGeometry(1, 20).rotateX(-Math.PI / 2);
let contactTex = null;
function contactTexture() { // a soft round falloff (alpha map: green channel)
  if (contactTex) return contactTex;
  const n = 32, data = new Uint8Array(n * n * 4);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const r = Math.min(1, Math.hypot(x + 0.5 - n / 2, y + 0.5 - n / 2) / (n / 2)), a = Math.round(255 * (1 - r) ** 1.6);
    data.set([a, a, a, 255], (y * n + x) * 4);
  }
  contactTex = new THREE.DataTexture(data, n, n); contactTex.needsUpdate = true;
  return contactTex;
}

export class FigureCrowd {
  /** cap: maximum figures. material: optional shared material. */
  /** twos: animate on twos in the painted looks (crowds); false for figures something is attached to (the player's gun). */
  constructor(cap, { clippingPlanes = null, shadows = true, material = null, lod = true, hiDist = 32, hiCap = 160, twos = true } = {}) {
    this.twos = twos;
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
      const mesh = new THREE.InstancedMesh(geo, this.materialFor(key), n);
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
    // contact shadows: a soft darkening of the ground under each figure's feet (multiplied in), so
    // people stand on the street instead of floating over it (the AO pass is off at street level)
    this.contact = new THREE.InstancedMesh(contactGeometry(), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true,
      opacity: 1 - CONTACT.dark, alphaMap: contactTexture(), depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }), cap);
    this.contact.name = 'figure:contact'; this.contact.count = 0; this.contact.frustumCulled = false; this.contact.renderOrder = 1;
    this.contact.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.group.add(this.contact);
    this.nContact = 0;
    this._cm = new THREE.Matrix4();
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

  /** The material of a part: the shared toy material, or in the comic look one per kind of stuff. */
  materialFor(key) {
    if (!FIGURE_LOOK) return this.material;
    const kind = figureKindOf(key);
    if (!kind) return this.material;
    this.kindMats ||= new Map();
    if (!this.kindMats.has(kind)) this.kindMats.set(kind, figureMaterialFor(this.material, kind));
    return this.kindMats.get(kind);
  }

  begin(eye = this.eye) {
    // animation on twos (the comic look, render/verse.js): a new pose only 12 times a second;
    // between ticks the figures keep their last pose (add/end do nothing)
    if (globalThis.__bloxTwos && this.twos) {
      const tick = Math.floor(performance.now() / (1000 / 12));
      this.hold = tick === this.lastTick;
      this.lastTick = tick;
      if (this.hold) return;
    } else this.hold = false;
    for (const e of this.meshes.values()) e.n = 0; this.count = 0; this.hi = 0; this.eye = eye; this.nContact = 0;
  }

  /** Add one figure. pose: { x, y, z (three.js metres, feet), rotY, mode, phase, speed, t, look }. */
  add(v, pose) {
    if (this.hold) return true;
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
    if (pose.mode !== MODE.SIT && pose.mode !== MODE.CYCLE) { // (riders and sitters are off their feet)
      this._cm.makeScale(CONTACT.r, 1, CONTACT.r).setPosition(pose.x, pose.y + 0.015, pose.z);
      this.contact.setMatrixAt(this.nContact++, this._cm);
    }
    return true;
  }

  /** Add loose parts of a figure (scattered pieces): parts = [{ key, mat: Float32Array(16), colourKey }]. */
  addParts(v, parts) {
    if (this.hold) return;
    this._cols = variantColours(v);
    for (const p of parts) this._emit(p.key, p.mat, p.colourKey);
  }

  end() {
    if (this.hold) return;
    this.contact.count = this.nContact;
    this.contact.instanceMatrix.needsUpdate = true;
    for (const { mesh, n } of this.meshes.values()) {
      mesh.count = n;
      mesh.visible = n > 0;
      mesh.instanceMatrix.needsUpdate = true;
      mesh.instanceColor.needsUpdate = true;
    }
  }

  /** Meshes that draw (= draw calls of the crowd in the main pass). */
  drawCalls() { let k = 0; for (const { mesh } of this.meshes.values()) if (mesh.visible && mesh.count > 0) k++; return k; }

  dispose() { this.contact.dispose(); for (const { mesh } of this.meshes.values()) mesh.dispose(); this.material.dispose(); for (const m of this.kindMats?.values() || []) m.dispose(); }
}
