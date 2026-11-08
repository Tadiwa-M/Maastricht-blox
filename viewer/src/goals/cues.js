// Navigation cues, kept quiet: a faint golden light beam standing on the destination (seen over
// the roofs, fading as you get close), a small glint at the screen edge when the destination is
// off screen, a tiny label on the tall towers when you look toward them from far away, and a "?"
// over the tourist who asks. three.js + DOM; the maths is screen.js.
import * as THREE from 'three';
import { edgeArrow, beamOpacity, towerAlpha, angleOff } from './screen.js';

const BEAM_H = 160;
const GOLD = new THREE.Color('#ffb341');

const VERT = `
varying float vH; varying vec3 vN; varying vec3 vV;
void main() {
  vH = uv.y;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vN = normalize(normalMatrix * normal);
  vV = normalize(-mv.xyz);
  gl_Position = projectionMatrix * mv;
}`;
const FRAG = `
uniform vec3 uColor; uniform float uOpacity; uniform float uTime;
varying float vH; varying vec3 vN; varying vec3 vV;
void main() {
  float core = pow(abs(dot(vN, vV)), 2.0);
  float fall = smoothstep(0.0, 0.03, vH) * pow(1.0 - vH, 1.7);
  float shimmer = 0.85 + 0.15 * sin(uTime * 1.6 - vH * 10.0);
  float a = uOpacity * core * fall * shimmer;
  gl_FragColor = vec4(uColor * a, a);
}`;

/** The destination beam. set(x, zUnity, y) shows it there; set(null) hides it. */
export class Beam {
  constructor(scene, strength = 0.7) {
    const g = new THREE.CylinderGeometry(1, 1, BEAM_H, 20, 1, true);
    g.translate(0, BEAM_H / 2, 0);
    this.mat = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide, toneMapped: false, fog: false,
      uniforms: { uColor: { value: GOLD.clone() }, uOpacity: { value: 0 }, uTime: { value: 0 } },
    });
    this.mesh = new THREE.Mesh(g, this.mat);
    this.mesh.name = 'goals:beam';
    this.mesh.visible = false;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 6;
    scene.add(this.mesh);
    this.strength = strength;
    this.fade = 0;
    this.on = false;
  }

  set(x, zUnity, y = 0) {
    if (x === null || x === undefined) { this.on = false; return; }
    this.on = true;
    this.mesh.position.set(x, Number.isFinite(y) ? y : 0, -zUnity);
  }

  /** viewer: [x, zUnity] of the player (or the map's centre); camera: for the width far away. */
  update(dt, viewer, camera) {
    this.fade = Math.min(1, Math.max(0, this.fade + (this.on ? dt : -dt) * 1.5));
    const p = this.mesh.position;
    const d = viewer ? Math.hypot(viewer[0] - p.x, viewer[1] + p.z) : 1e3;
    const camD = camera ? Math.hypot(camera.position.x - p.x, camera.position.z - p.z) : d;
    const r = Math.max(1.4, camD * 0.0045); // a few pixels wide however far away
    this.mesh.scale.set(r, 1, r);
    this.mat.uniforms.uOpacity.value = this.strength * this.fade * beamOpacity(d);
    this.mat.uniforms.uTime.value += dt;
    this.mesh.visible = this.mat.uniforms.uOpacity.value > 0.003;
  }

  get target() { return this.on ? this.mesh.position : null; }
}

const v = new THREE.Vector3(), n = new THREE.Vector3(), fv = new THREE.Vector3();
/** Camera-space position and NDC of a world point. */
function project(camera, p) {
  v.copy(p).applyMatrix4(camera.matrixWorldInverse);
  n.copy(p).project(camera);
  return { view: { x: v.x, y: v.y, z: v.z }, ndc: { x: n.x, y: n.y } };
}

const el = (tag, cls, html = '') => Object.assign(document.createElement(tag), { className: cls, innerHTML: html });

/** The glint at the screen edge pointing toward an off-screen target. */
export class EdgeGlint {
  constructor(parent) {
    this.el = el('div', 'gl-glint', '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M8 4l9 8-9 8" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>');
    this.el.hidden = true;
    parent.append(this.el);
  }

  /** target: THREE.Vector3 (world) or null. */
  update(camera, target, w, h) {
    const pr = target ? project(camera, target) : null;
    const a = pr ? edgeArrow(pr.view, pr.ndc, w, h, 34, 120) : null; // clear of the bottom hint bar
    this.el.hidden = !a;
    if (a) this.el.style.transform = `translate(${(a.x - 13).toFixed(1)}px, ${(a.y - 13).toFixed(1)}px) rotate(${a.angle.toFixed(3)}rad)`;
  }
}

/** A small DOM tag pinned to a world point (the tourist's "?", tower names). */
class Pin {
  constructor(parent, cls, text) {
    this.el = el('div', cls);
    this.el.textContent = text;
    this.el.hidden = true;
    parent.append(this.el);
  }

  place(camera, p, w, h, alpha = 1) {
    const { view, ndc } = project(camera, p);
    const on = view.z < 0 && Math.abs(ndc.x) < 1.05 && Math.abs(ndc.y) < 1.05 && alpha > 0.02;
    this.el.hidden = !on;
    if (!on) return;
    this.el.style.opacity = alpha.toFixed(2);
    this.el.style.transform = `translate(${((ndc.x + 1) / 2 * w).toFixed(1)}px, ${((1 - ndc.y) / 2 * h).toFixed(1)}px) translate(-50%, -100%)`;
  }

  hide() { this.el.hidden = true; }
  remove() { this.el.remove(); }
}

/** "?" over the tourist who asks. */
export class AskPin extends Pin {
  constructor(parent) { super(parent, 'gl-ask', '?'); this.p = new THREE.Vector3(); }
  /** at: { x, y, z } Unity metres (y up) of the person, or null. */
  update(camera, at, w, h) {
    if (!at) { this.hide(); return; }
    this.p.set(at.x, (at.y || 0) + 2.3, -at.z);
    this.place(camera, this.p, w, h, 1);
  }
}

/** Tiny tower names, only when looking toward a tower from far away. towers: [{ name, x, z, h }]. */
export class TowerLabels {
  constructor(parent, towers, groundAt) {
    this.items = towers.map((t) => ({ ...t, pin: new Pin(parent, 'gl-tower', t.name), top: new THREE.Vector3() }));
    this.groundAt = groundAt;
  }

  /** enabled: walk mode, nothing else on screen. */
  update(camera, enabled, w, h) {
    const c = camera.position;
    const fwd = camera.getWorldDirection(fv);
    const yaw = Math.atan2(fwd.x, -fwd.z);
    for (const t of this.items) {
      if (!enabled) { t.pin.hide(); continue; }
      const d = Math.hypot(t.x - c.x, -t.z - c.z);
      const off = angleOff(Math.atan2(t.x - c.x, t.z + c.z), yaw);
      const a = towerAlpha(off, d) * 0.85;
      if (a <= 0.02) { t.pin.hide(); continue; }
      const g = this.groundAt(t.x, -t.z);
      t.top.set(t.x, (Number.isFinite(g) ? g : 0) + t.h + 4, -t.z);
      t.pin.place(camera, t.top, w, h, a);
    }
  }
}
