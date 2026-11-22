// The player's Stand (the manga look; owner: our characters in that world, "with some stands"). An
// original design, not one from the series: a tall spirit of translucent armoured blocks in the
// player's own outfit colours, gold trim, a glowing visor and a soft aura, floating behind the
// player's right shoulder. It fades in when the player strikes a pose, aims, or presses E, and
// in a match E (or the gamepad's Y) throws a rush: a burst of punches with afterimages in front
// of the player that hits whoever is within reach (each punch a 'stand' shot through the room's
// rules, like the knife). Built from boxes in one group; a few draw calls.
import * as THREE from 'three';
import { outlineMaterial, OUTLINE_ON } from '../render/outline.js';

export const STAND = { height: 2.4, behind: -0.35, side: 0.95, rise: 0.25, // beside the right shoulder, a little ahead (the camera is behind)
  rushS: 1.1, punchEvery: 0.07, reachM: 3.2, fadeIn: 5, fadeOut: 2.5 };

function armourMat(colour, glow = 0) {
  return new THREE.MeshStandardMaterial({ color: colour, roughness: 0.3, metalness: 0.5, transparent: true, opacity: 0.95,
    emissive: colour, emissiveIntensity: glow, depthWrite: false });
}

export class Stand {
  /** colours: { top, bottom } (hex): the Stand wears the user's colours. */
  constructor(scene, colours = { top: '#5a3d8c', bottom: '#2b2f4a' }) {
    this.group = new THREE.Group(); this.group.name = 'stand'; this.group.visible = false;
    const main = armourMat(colours.top, 0.25), dark = armourMat(colours.bottom, 0.15), gold = armourMat('#f2c14e', 0.5);
    const visor = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.5, 2.2, 2.0), toneMapped: false, transparent: true });
    const box = (w, h, d, m, x, y, z) => { const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); b.position.set(x, y, z); return b; };
    const H = STAND.height;
    this.body = new THREE.Group();
    // a V-shaped torso of plates, a waist band, a helmet with a visor slit and a crest
    this.body.add(box(0.95, 0.55, 0.45, main, 0, H * 0.72, 0), box(0.62, 0.35, 0.38, dark, 0, H * 0.55, 0), box(0.7, 0.08, 0.42, gold, 0, H * 0.47, 0));
    this.body.add(box(0.42, 0.4, 0.42, main, 0, H * 0.92, 0), box(0.34, 0.06, 0.02, visor, 0, H * 0.93, -0.215), box(0.05, 0.22, 0.3, gold, 0, H * 1.03, 0.02));
    for (const s of [-1, 1]) this.body.add(box(0.36, 0.2, 0.46, gold, s * 0.6, H * 0.84, 0)); // shoulder plates
    // the legs fade into a trail of plates (a Stand floats)
    for (let k = 0; k < 4; k++) this.body.add(box(0.5 - k * 0.1, 0.2, 0.32 - k * 0.05, dark, 0, H * 0.4 - k * 0.22, 0));
    // arms: shoulder pivots, so the rush can punch
    this.arms = [-1, 1].map((s) => {
      const pivot = new THREE.Group(); pivot.position.set(s * 0.62, H * 0.8, 0);
      pivot.add(box(0.26, 0.5, 0.26, main, 0, -0.25, 0), box(0.3, 0.42, 0.3, dark, 0, -0.66, 0), box(0.34, 0.24, 0.34, gold, 0, -0.95, 0));
      this.body.add(pivot); return pivot;
    });
    // the aura: a soft glowing shell
    this.aura = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 14), new THREE.MeshBasicMaterial({ color: colours.top, transparent: true, opacity: 0.12, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
    this.aura.scale.set(0.8, H * 0.55, 0.6); this.aura.position.y = H * 0.65;
    this.body.add(this.aura);
    // afterimage fists for the rush
    this.fists = Array.from({ length: 10 }, () => { const f = box(0.32, 0.26, 0.3, gold, 0, 0, 0); f.visible = false; this.group.add(f); return { m: f, t: 0 }; });
    this.group.add(this.body);
    this.group.traverse((o) => { if (o.isMesh) { o.frustumCulled = false; o.castShadow = false; } });
    // an ink line round the armour, as round every figure in this look (render/outline.js)
    if (OUTLINE_ON) {
      const plates = [];
      this.body.traverse((o) => { if (o.isMesh && o !== this.aura && o.material !== visor) plates.push(o); });
      for (const o of plates) { const l = new THREE.Mesh(o.geometry, outlineMaterial()); l.frustumCulled = false; o.add(l); this.lines = (this.lines || []).concat(l); }
    }
    scene.add(this.group);
    this.k = 0; this.t = 0; this.rushT = 0; this.punchT = 0; this.mats = [main, dark, gold, visor];
  }

  /** Throw a rush (if out of one). -> true when it started. */
  rush() { if (this.rushT > 0) return false; this.rushT = STAND.rushS; this.punchT = 0; return true; }
  get rushing() { return this.rushT > 0; }

  /**
   * Per frame: dt, feet (three.js), yaw (compass, facing), want (should it show), onPunch(pos) for
   * each punch of a rush (pos: where the fist lands, three.js).
   */
  update(dt, feet, yaw, want, onPunch) {
    this.t += dt;
    const show = want || this.rushT > 0;
    this.k += ((show ? 1 : 0) - this.k) * Math.min(1, dt * (show ? STAND.fadeIn : STAND.fadeOut));
    this.group.visible = this.k > 0.02;
    if (!this.group.visible) return;
    const fx = Math.sin(yaw), fz = -Math.cos(yaw), rx = Math.cos(yaw), rz = Math.sin(yaw);
    const rushing = this.rushT > 0;
    // behind the right shoulder; forward in front of the player during a rush
    const back = rushing ? -1.3 : STAND.behind, side = rushing ? 0 : STAND.side;
    const bob = Math.sin(this.t * 1.6) * 0.06;
    const tx = feet[0] - fx * back + rx * side, tz = feet[2] - fz * back + rz * side, ty = feet[1] + STAND.rise * this.k + bob - (1 - this.k) * 0.6;
    const p = this.body.position;
    p.x += (tx - p.x) * Math.min(1, dt * 10); p.y += (ty - p.y) * Math.min(1, dt * 10); p.z += (tz - p.z) * Math.min(1, dt * 10);
    this.body.rotation.y = -yaw;
    const solid = this.k > 0.97;
    for (const m of this.mats) { m.opacity = this.k; if (m.transparent === solid) { m.transparent = !solid; m.depthWrite = solid; m.needsUpdate = true; } }
    for (const l of this.lines || []) l.visible = solid;
    this.aura.material.opacity = (0.1 + 0.05 * Math.sin(this.t * 5)) * this.k;
    // arms: at rest folded, in a rush a blur of punches
    this.arms.forEach((a, i) => { a.rotation.x = rushing ? -1.4 + Math.sin(this.t * 38 + i * Math.PI) * 0.5 : -0.3; a.rotation.z = (i ? -1 : 1) * (rushing ? 0.1 : 0.35); });
    if (rushing) {
      this.rushT -= dt; this.punchT -= dt;
      if (this.punchT <= 0) {
        this.punchT = STAND.punchEvery;
        const f = this.fists.find((q) => q.t <= 0) || this.fists[0];
        const spread = (Math.random() - 0.5) * 0.9, up = 1.2 + Math.random() * 0.8, out = 1.6 + Math.random() * 0.8;
        f.m.position.set(feet[0] + fx * out + rx * spread, feet[1] + up, feet[2] + fz * out + rz * spread);
        f.m.rotation.y = -yaw; f.t = 0.16; f.m.visible = true;
        onPunch?.([feet[0] + fx * 2.2, feet[1] + 1.2, feet[2] + fz * 2.2]);
      }
    }
    for (const f of this.fists) if (f.t > 0) { f.t -= dt; f.m.scale.setScalar(1 + (0.16 - f.t) * 3); f.m.visible = f.t > 0; }
  }

  dispose() { this.group.removeFromParent(); this.group.traverse((o) => { if (o.isMesh) { o.geometry.dispose(); o.material.dispose(); } }); }
}
