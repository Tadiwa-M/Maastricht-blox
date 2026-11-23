// The player's Stand (the manga look; owner: our characters in that world, "with some stands").
// One of three original designs (player/standdesigns.js: IRON HYMN, VELVET ENCORE, LIVE WIRE),
// picked in the character creator. It is a body like the player's (the anime figure on the same
// rig), larger, floating behind the right shoulder in a soft flame aura: it crosses its arms and
// looms; when the player strikes a pose it strikes its own (figure/lookstyle.js STAND_POSES); E
// (or the gamepad's Y in a match) throws a rush: it steps in front and fires a blur of punches with
// afterimage fists, each punch a 'stand' shot through the room's rules, like the knife.
import * as THREE from 'three';
import { FigureCrowd } from '../figure/crowd.js';
import { makeVariant } from '../figure/variants.js';
import { MODE, IDLE, jointAngles, captureParts } from '../figure/rig.js';
import { resolveStand, auraTexture } from './standdesigns.js';

export const STAND = { behind: -0.45, side: 0.95, rise: 0.4, // beside the right shoulder, a little behind and above
  rushS: 1.1, punchEvery: 0.07, reachM: 3.2, fadeIn: 5, fadeOut: 2.5 };
const PART = { top: 'top:shirt' }; // design names for figure part keys

// the Stand's name when it is summoned: 「NAME」 in its aura colour, as the manga letters it
let card = null, cardTimer = 0;
function nameCard(name, colour) {
  if (typeof document === 'undefined' || document.body.classList.contains('shot')) return;
  if (!card) {
    document.head.append(Object.assign(document.createElement('style'), { textContent: `#stand-name { position: fixed; right: 7%; top: 30%; z-index: 5; pointer-events: none;
      font: 400 46px/1 'Anton', Impact, sans-serif; letter-spacing: .03em; -webkit-text-stroke: 2px #0a0410; text-shadow: 4px 4px 0 #0a0410;
      transform: skewX(-8deg) translateX(30px); opacity: 0; transition: opacity .25s, transform .35s cubic-bezier(.2,1.4,.4,1); }
      #stand-name.on { opacity: 1; transform: skewX(-8deg); } body.title #stand-name, body.bx-paused #stand-name { display: none; }` }));
    card = Object.assign(document.createElement('div'), { id: 'stand-name' }); document.body.append(card);
  }
  card.textContent = `「${name}」`; card.style.color = colour; card.classList.add('on');
  clearTimeout(cardTimer); cardTimer = setTimeout(() => card.classList.remove('on'), 2200);
}

export class Stand {
  /** spec: a preset id (figure/custom.js STANDS) or a designer spec (customVariant v.standSpec). */
  constructor(scene, spec = 'iron') {
    const D = this.D = resolveStand(spec);
    this.key = D.key; this.name = D.name; this.ability = D.ability;
    this.group = new THREE.Group(); this.group.name = 'stand'; this.group.visible = false;
    // the body: one anime figure in the design's painted skin (no hair; Velvet Encore has no shins)
    this.crowd = new FigureCrowd(1, { lod: false, twos: false, shadows: false });
    this.crowd.contact.visible = false; // (it floats)
    this.group.add(this.crowd.group);
    const v = makeVariant(77, { kind: 'adult' });
    Object.assign(v, { hair: 'short', top: 'shirt', acc: 'none', scale: D.scale, width: D.width, stoop: 0 });
    v.colours = Object.fromEntries(Object.keys(v.colours).map((k) => [k, '#ffffff'])); delete v._c;
    this.v = v;
    this.skin = D.skin();
    this.hidden = new RegExp(D.ribbons ? '^(hair:|shin$|shoe$)' : '^hair:');
    for (const { mesh } of this.crowd.meshes.values()) mesh.material = this.skin;
    // the head and armour, fixed to the body's parts each frame
    this.holders = [];
    D.build((key, n, obj) => {
      const holder = new THREE.Group(); holder.matrixAutoUpdate = false; holder.add(obj);
      this.group.add(holder); this.holders.push({ key: PART[key] || key, n, holder });
    });
    // the aura: a flickering flame behind it; Live Wire throws sparks
    this.aura = new THREE.Sprite(new THREE.SpriteMaterial({ map: auraTexture(D.aura), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
    this.group.add(this.aura);
    this.sparks = D.sparks ? Array.from({ length: 6 }, () => {
      const l = new THREE.Line(new THREE.BufferGeometry().setFromPoints(Array.from({ length: 5 }, () => new THREE.Vector3())),
        new THREE.LineBasicMaterial({ color: new THREE.Color(D.sparks).multiplyScalar(3), toneMapped: false, transparent: true }));
      this.group.add(l); return l;
    }) : [];
    // afterimage fists for the rush, in the design's accent
    const fistGeo = new THREE.BoxGeometry(0.13, 0.11, 0.17); // a fist, knuckles forward; each afterimage fades on its own
    this.fists = Array.from({ length: 10 }, () => {
      const m = new THREE.Mesh(fistGeo, new THREE.MeshBasicMaterial({ color: new THREE.Color(D.accent).multiplyScalar(1.6), transparent: true, depthWrite: false, toneMapped: false }));
      m.visible = false; this.group.add(m); return { m, t: 0 };
    });
    this.mats = [];
    this.group.traverse((o) => {
      if (!(o.isMesh || o.isLine || o.isSprite)) return;
      o.frustumCulled = false; o.castShadow = false;
      if (!o.material.isShaderMaterial && !this.mats.includes(o.material)) this.mats.push(o.material); // (not the shared ink outline)
    });
    scene.add(this.group);
    this.fistMats = new Set(this.fists.map((f) => f.m.material));
    this.pos = new THREE.Vector3(); this.placed = false;
    this.k = 0; this.t = 0; this.rushT = 0; this.punchT = 0; this.sparkT = 0; this.pose = -1; this.guardT = 0;
  }

  /** The pose the user strikes (STAND_POSES index), or -1: the Stand strikes one of its own. */
  setPose(k) { this.pose = k; }

  /** Throw a rush (if out of one). -> true when it started. */
  rush() { if (this.rushT > 0) return false; this.rushT = STAND.rushS; this.punchT = 0; return true; }
  get rushing() { return this.rushT > 0; }

  /** Guard (IRON HYMN's ability): for s seconds it stands in front with its arms crossed and its aura flares. */
  guard(s = 2) { this.guardT = s; }
  /** A flash of the aura (an ability used). */
  flare() { this.flareT = 0.6; }

  /** The joints for this frame: arms crossed and looming, its own pose, or a blur of punches. */
  joints(pose) {
    const J = jointAngles(this.v, pose);
    if (this.rushT > 0) {
      for (let q = 0; q < 2; q++) {
        const ext = 0.5 + 0.5 * Math.sin(this.t * 38 + q * Math.PI);
        J.sh[q] = 1.45; J.abd[q] = 0.12; J.elbow[q] = 1.7 * (1 - ext) + 0.05; J.armTwist[q] = 0.3;
      }
      J.lean += 0.25; J.headPitch -= 0.1;
    } else if (this.pose < 0) {
      for (let q = 0; q < 2; q++) { J.sh[q] = 0.32; J.abd[q] = 0.12; J.armTwist[q] = 1.25; J.elbow[q] = 1.75; }
      J.sh[0] = 0.4; J.elbow[0] = 1.85; J.headPitch -= 0.12; J.lean -= 0.08; // arms crossed, looking down at you
      for (let q = 0; q < 2; q++) { J.hip[q] = 0.12; J.knee[q] = -0.3; J.ankle[q] = 0.5; } // legs trailing (it floats)
    }
    return J;
  }

  /**
   * Per frame: dt, feet (three.js), yaw (compass, facing), want (should it show), onPunch(pos) for
   * each punch of a rush (pos: where the fist lands, three.js).
   */
  update(dt, feet, yaw, want, onPunch) {
    this.t += dt;
    const show = want || this.rushT > 0 || this.guardT > 0 || (this.flareT || 0) > 0;
    if (show && this.k < 0.05) nameCard(this.name, this.D.aura); // summoned: its name, as the manga letters it
    this.k += ((show ? 1 : 0) - this.k) * Math.min(1, dt * (show ? STAND.fadeIn : STAND.fadeOut));
    this.group.visible = this.k > 0.02;
    if (!this.group.visible) { this.placed = false; return; }
    const fx = Math.sin(yaw), fz = -Math.cos(yaw), rx = Math.cos(yaw), rz = Math.sin(yaw);
    const rushing = this.rushT > 0;
    // behind the right shoulder; in front of the player during a rush
    const guarding = this.guardT > 0 && !rushing;
    if (this.guardT > 0) this.guardT -= dt; if (this.flareT > 0) this.flareT -= dt;
    const back = rushing ? -1.3 : guarding ? -0.9 : STAND.behind, side = rushing || guarding ? 0 : STAND.side;
    const bob = Math.sin(this.t * 1.6) * 0.06;
    const tx = feet[0] - fx * back + rx * side, tz = feet[2] - fz * back + rz * side, ty = feet[1] + STAND.rise * this.k + bob - (1 - this.k) * 0.6;
    if (!this.placed) { this.pos.set(tx, ty, tz); this.placed = true; }
    const e = Math.min(1, dt * 10);
    this.pos.x += (tx - this.pos.x) * e; this.pos.y += (ty - this.pos.y) * e; this.pos.z += (tz - this.pos.z) * e;
    // the body: posed like a figure (its own pose answers the user's)
    const pose = { x: this.pos.x, y: this.pos.y, z: this.pos.z, rotY: -yaw, mode: MODE.IDLE, t: this.t,
      ...(this.pose >= 0 && !rushing && !guarding ? { idle: IDLE.POSE, idleK: 1, poseKind: this.pose + 3 } : {}) };
    const posing = this.pose; if (guarding) this.pose = -1; // guarding: arms crossed in front
    const J = this.joints(pose);
    this.pose = posing;
    this.crowd.begin(); this.crowd.add(this.v, pose, J); this.crowd.end();
    const solid = this.k > 0.97;
    for (const [key, { mesh, outline }] of this.crowd.meshes) {
      if (this.hidden.test(key)) { mesh.count = 0; if (outline) outline.count = 0; }
      if (outline) outline.visible = solid && mesh.count > 0;
    }
    const parts = captureParts(this.v, pose, J), seen = {};
    for (const p of parts) { const n = seen[p.key] = (seen[p.key] ?? -1) + 1; p.n = n; }
    for (const h of this.holders) {
      const p = parts.find((q) => q.key === h.key && q.n === h.n);
      if (p) { h.holder.matrix.fromArray(p.mat); h.holder.matrixWorldNeedsUpdate = true; }
    }
    for (const m of this.mats) if (!this.fistMats.has(m)) m.opacity = this.k;
    // the aura flickers like a flame and pulses
    const D = this.D;
    this.aura.position.set(this.pos.x, this.pos.y + 1.45 * D.scale, this.pos.z);
    this.aura.scale.set((2.4 + 0.12 * Math.sin(this.t * 9)) * D.scale / 1.4, (3.8 + 0.15 * Math.sin(this.t * 6)) * D.scale / 1.4, 1);
    const flare = guarding || this.flareT > 0 ? 1.6 : 1;
    this.aura.scale.multiplyScalar(flare > 1 ? 1.25 : 1);
    this.aura.material.opacity = Math.min(1, (0.75 + 0.15 * Math.sin(this.t * 7) + 0.1 * Math.sin(this.t * 23)) * this.k * flare);
    if (this.sparks.length && (this.sparkT -= dt) <= 0) { // new sparks jump off it
      this.sparkT = 0.09;
      for (const l of this.sparks) {
        const a = l.geometry.attributes.position; let x = this.pos.x + (Math.random() - 0.5) * 1.0, y = this.pos.y + 0.6 + Math.random() * 1.8, z = this.pos.z + (Math.random() - 0.5) * 0.5;
        for (let i = 0; i < a.count; i++) { a.setXYZ(i, x, y, z); x += (Math.random() - 0.5) * 0.18; y += (Math.random() - 0.5) * 0.18; z += (Math.random() - 0.5) * 0.1; }
        a.needsUpdate = true; l.visible = Math.random() < 0.6;
      }
    }
    if (rushing) {
      this.rushT -= dt; this.punchT -= dt;
      if (this.punchT <= 0) {
        this.punchT = STAND.punchEvery;
        const f = this.fists.find((q) => q.t <= 0) || this.fists[0];
        const spread = (Math.random() - 0.5) * 0.9, up = 1.2 + Math.random() * 0.8, out = 1.6 + Math.random() * 0.8;
        f.m.position.set(feet[0] + fx * out + rx * spread, feet[1] + up, feet[2] + fz * out + rz * spread);
        f.t = 0.16; f.m.visible = true; f.m.rotation.y = -yaw;
        onPunch?.([feet[0] + fx * 2.2, feet[1] + 1.2, feet[2] + fz * 2.2]);
      }
    }
    for (const f of this.fists) if (f.t > 0) { f.t -= dt; f.m.scale.set(1, 1, 1 + (0.16 - f.t) * 10); f.m.material.opacity = Math.max(0, f.t / 0.16) * 0.8 * this.k; f.m.visible = f.t > 0; } // stretched along the punch, fading
  }

  dispose() {
    this.group.removeFromParent();
    this.group.traverse((o) => { if ((o.isMesh || o.isLine) && !o.isInstancedMesh) o.geometry.dispose(); });
    for (const m of this.mats) { m.map?.dispose?.(); m.dispose(); }
  }
}
