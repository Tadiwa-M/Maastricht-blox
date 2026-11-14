// Drawing a capture-the-flag room: the other players as the city's toy figures (figure/crowd.js,
// their creator look, posed by the player's motion layer), a team-coloured gem over each head
// and their name above it, the two brick flags (at home, carried on a back, or dropped) and a
// ring of team-coloured tiles round each base. three.js + a DOM layer for the names; the
// smoothing is interp.js, the room's state model.js.
import * as THREE from 'three';
import { FigureCrowd } from '../figure/crowd.js';
import { makeVariant } from '../figure/variants.js';
import { customVariant, decodeChoices } from '../figure/custom.js';
import { MODE, captureParts } from '../figure/rig.js';
import { MotionState } from '../player/motion.js';
import { Scatter } from '../player/scatter.js';
import { Track } from './interp.js';
import { toThree, rdToUnity } from './protocol.js';
import { TEAM_HEX } from './model.js';

const LABEL_MAX_M = 90;
const v3 = new THREE.Vector3();

/** The figure for a look code (figure/custom.js), else one picked by the player's id. */
export function lookVariant(look, id) {
  const ch = decodeChoices(look);
  if (ch) return customVariant(ch);
  const v = makeVariant(1000 + id * 7, { kind: 'adult' });
  if (v.acc === 'bag' || v.acc === 'umbrella') v.acc = 'none';
  return v;
}

function brick(w, h, d, colour) {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: colour, roughness: 0.45 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  body.position.y = h / 2;
  g.add(body);
  const stud = new THREE.CylinderGeometry(0.075, 0.075, 0.06, 12);
  for (let x = -w / 2 + 0.125; x < w / 2; x += 0.25) for (let z = -d / 2 + 0.125; z < d / 2; z += 0.25) {
    const s = new THREE.Mesh(stud, mat);
    s.position.set(x, h + 0.03, z);
    g.add(s);
  }
  for (const m of g.children) { m.castShadow = true; m.receiveShadow = true; }
  return g;
}

/** A brick flag: a 2x2 base brick, a round pole, a studded banner. */
function makeFlag(team) {
  const g = new THREE.Group();
  g.name = `mp-flag-${team}`;
  const colour = TEAM_HEX[team];
  g.add(brick(0.5, 0.24, 0.5, colour));
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 2.6, 10), new THREE.MeshStandardMaterial({ color: '#d8d4cc', roughness: 0.4 }));
  pole.position.y = 1.54;
  g.add(pole);
  const cloth = new THREE.Group();
  const plate = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.62, 0.05), new THREE.MeshStandardMaterial({ color: colour, roughness: 0.5 }));
  plate.position.set(0.53, 0, 0);
  plate.castShadow = true;
  cloth.add(plate);
  const stud = new THREE.CylinderGeometry(0.06, 0.06, 0.05, 10);
  for (let x = 0.15; x < 1.0; x += 0.25) for (const y of [-0.16, 0.16]) for (const sz of [-1, 1]) {
    const s = new THREE.Mesh(stud, plate.material);
    s.rotation.x = Math.PI / 2;
    s.position.set(x + 0.03, y, sz * 0.05);
    cloth.add(s);
  }
  cloth.position.y = 2.5;
  g.add(cloth);
  g.userData.cloth = cloth;
  g.traverse((m) => { if (m.isMesh) m.castShadow = true; });
  return g;
}

/** A ring of flat team-coloured tiles round a base (the capture circle). */
function makeRing(team, r) {
  const n = Math.max(16, Math.round((2 * Math.PI * r) / 0.9));
  const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(0.5, 0.08, 0.5), new THREE.MeshStandardMaterial({ color: TEAM_HEX[team], roughness: 0.5 }), n);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    q.setFromAxisAngle(up, -a);
    m.compose(new THREE.Vector3(Math.cos(a) * r, 0.04, Math.sin(a) * r), q, new THREE.Vector3(1, 1, 1));
    mesh.setMatrixAt(i, m);
  }
  mesh.receiveShadow = true;
  mesh.name = `mp-base-${team}`;
  return mesh;
}

export class RoomView {
  /** scene: three.js scene; ground(x, zThree) -> metres | null; origin: the world's originRD. */
  constructor(scene, ground, origin) {
    this.ground = ground; this.origin = origin;
    this.group = new THREE.Group();
    this.group.name = 'multiplayer';
    scene.add(this.group);
    this.crowd = new FigureCrowd(8, { lod: false });
    this.group.add(this.crowd.group);
    this.flags = { blue: makeFlag('blue'), yellow: makeFlag('yellow') };
    this.rings = {};
    this.gems = new Map();
    this.others = new Map(); // id -> { track, motion, variant, look, pose, prev, scatter, label }
    for (const f of Object.values(this.flags)) { f.visible = false; this.group.add(f); }
    this.labels = Object.assign(document.createElement('div'), { id: 'mp-names' });
    document.body.append(this.labels);
    this.t = 0;
  }

  /** A position message from another player (wire RD metres). */
  push(id, p, yaw, speed, now) {
    const o = this.other(id);
    const [x, y, z] = toThree(p, this.origin);
    o.track.push(now, x, y, z, yaw, speed);
  }

  other(id) {
    let o = this.others.get(id);
    if (!o) {
      const label = Object.assign(document.createElement('div'), { className: 'mp-name' });
      this.labels.append(label);
      o = { track: new Track(), motion: new MotionState(), variant: null, look: null, prev: null, scatter: null, label,
        pose: { x: 0, y: 0, z: 0, rotY: 0, mode: MODE.IDLE, phase: 0, speed: 0, t: 0 } };
      this.others.set(id, o);
    }
    return o;
  }

  /** A remote player was knocked down: their figure pops apart (as the player's own does). */
  scatter(id, byPos) {
    const o = this.others.get(id);
    if (!o?.variant || !o.prev) return;
    const d = byPos ? [o.pose.x - byPos[0], o.pose.z - byPos[2]] : [0, 1];
    const L = Math.hypot(...d) || 1;
    o.scatter = new Scatter(captureParts(o.variant, o.pose), [(d[0] / L) * 4, 3, (d[1] / L) * 4], (x, z) => this.ground(x, z));
  }

  /** Where another player is drawn now (three.js feet), or null. */
  posOf(id) { const o = this.others.get(id); return o?.prev ? [o.pose.x, o.pose.y, o.pose.z] : null; }

  setBases(config) {
    for (const t of ['blue', 'yellow']) {
      if (this.rings[t]) continue;
      this.rings[t] = makeRing(t, config.baseR);
      this.rings[t].visible = false;
      this.group.add(this.rings[t]);
    }
    this.config = config;
  }

  /** Per frame. model: MatchModel; me: { pos, yaw } of the local player (three.js) or null. */
  update(dt, now, camera, model, me) {
    this.t += dt;
    const present = new Set();
    this.crowd.begin(camera.position);
    for (const p of model.players) {
      if (p.id === model.me || !p.on) continue;
      const o = this.others.get(p.id);
      const s = o?.track.sample(now);
      if (!s) continue;
      present.add(p.id);
      if (o.look !== p.look || !o.variant) { o.look = p.look; o.variant = lookVariant(p.look, p.id); }
      const travelled = o.prev ? Math.hypot(s.x - o.prev.x, s.z - o.prev.z) : 0;
      // the sender's own speed (steadier than this frame's step), 0 once it stops moving here
      const speed = travelled > 1e-4 && s.speed > 0.05 ? Math.min(8, s.speed) : 0;
      o.prev = s;
      const m = o.motion.update(dt, { speed, travelled, angVel: 0, accel: 0, steer: 0, grounded: true, vy: 0 }, o.variant.scale);
      Object.assign(o.pose, { x: s.x, y: s.y, z: s.z, rotY: -s.yaw }, m, { aim: model.phase === 'play' ? 1 : 0, aimPitch: 0 }); // in a match everyone holds their gun
      if (o.scatter) {
        const stand = o.scatter.gathering ? captureParts(o.variant, { ...o.pose, mode: MODE.IDLE, t: 0 }) : null;
        this.crowd.addParts(o.variant, o.scatter.update(dt, stand));
        if (o.scatter.done) o.scatter = null;
      } else this.crowd.add(o.variant, o.pose);
      this.gem(p.id, p.team, s.x, s.y + 2.2 * o.variant.scale, s.z);
      o.head = [s.x, s.y + 2.55 * o.variant.scale, s.z];
      o.info = p;
    }
    this.crowd.end();
    for (const [id, o] of this.others) {
      if (present.has(id)) continue;
      o.head = null;
      o.label.style.display = 'none';
      const g = this.gems.get(id); if (g) g.visible = false;
      if (!model.player(id)) { o.label.remove(); this.others.delete(id); }
    }
    this.drawFlags(model, me);
  }

  gem(id, team, x, y, z) {
    let g = this.gems.get(id);
    if (!g || g.userData.team !== team) {
      if (g) this.group.remove(g);
      g = new THREE.Mesh(new THREE.OctahedronGeometry(0.16), new THREE.MeshStandardMaterial({ color: TEAM_HEX[team], emissive: TEAM_HEX[team], emissiveIntensity: 0.35, roughness: 0.3 }));
      g.scale.y = 1.5;
      g.userData.team = team;
      this.gems.set(id, g);
      this.group.add(g);
    }
    g.visible = true;
    g.position.set(x, y + Math.sin(this.t * 3 + id) * 0.05, z);
    g.rotation.y = this.t * 2;
  }

  /** Names over heads, after the frame is drawn (the camera has moved by then). */
  placeLabels(camera, model) {
    for (const o of this.others.values()) if (o.head && o.info) this.label(o.label, o.info, model, camera, ...o.head);
  }

  label(el, p, model, camera, x, y, z) {
    v3.set(x, y, z);
    const far = camera.position.distanceTo(v3) > LABEL_MAX_M;
    v3.project(camera);
    if (far || v3.z > 1 || Math.abs(v3.x) > 1.1 || Math.abs(v3.y) > 1.1) { el.style.display = 'none'; return; }
    const carrying = model.carrying(p.id);
    const text = `${carrying ? '⚑ ' : ''}${p.name}`;
    if (el.textContent !== text) el.textContent = text;
    el.style.borderColor = TEAM_HEX[p.team];
    el.style.display = '';
    el.style.transform = `translate(${((v3.x + 1) / 2) * innerWidth}px, ${((1 - v3.y) / 2) * innerHeight}px) translate(-50%, -100%)`;
  }

  drawFlags(model, me) {
    const room = model.room, cfg = this.config;
    const playing = model.phase === 'play';
    for (const t of ['blue', 'yellow']) {
      const flag = this.flags[t], ring = this.rings[t];
      const f = room?.flags?.[t];
      if (ring && cfg) {
        const [bx, bz] = rdToUnity(cfg.bases[t].at, this.origin);
        const g = this.ground(bx, -bz);
        ring.visible = g !== null;
        if (g !== null) ring.position.set(bx, g, -bz);
      }
      if (!f || !cfg) { flag.visible = false; continue; }
      let at = null, carriedBy = null;
      if (f.st === 'carried' && playing) {
        carriedBy = f.by === model.me ? me : (() => { const o = this.others.get(f.by); return o?.prev ? { pos: [o.pose.x, o.pose.y, o.pose.z], yaw: -o.pose.rotY } : null; })();
        if (!carriedBy) { flag.visible = false; continue; }
      } else {
        const [x, z] = rdToUnity(f.st === 'dropped' && playing ? f.at : cfg.bases[t].at, this.origin);
        const g = this.ground(x, -z);
        if (g === null) { flag.visible = false; continue; }
        at = [x, g, -z];
      }
      flag.visible = true;
      if (carriedBy) { // on the carrier's back, smaller, leaning back a little
        const { pos, yaw } = carriedBy;
        flag.scale.setScalar(0.55);
        flag.position.set(pos[0] - Math.sin(yaw) * 0.28, pos[1] + 0.75, pos[2] + Math.cos(yaw) * 0.28);
        flag.rotation.set(0, -yaw - Math.PI / 2, 0); // the banner (local +x) trails behind
        flag.rotateZ(-0.18);
      } else {
        flag.scale.setScalar(1);
        flag.position.set(...at);
        flag.rotation.set(0, f.st === 'dropped' ? 0.6 : 0, f.st === 'dropped' && playing ? 1.35 : 0); // dropped: lying down
      }
      flag.userData.cloth.rotation.y = Math.sin(this.t * 2.3 + (t === 'blue' ? 0 : 1.7)) * 0.18;
    }
  }

  dispose() {
    this.group.removeFromParent();
    this.labels.remove();
  }
}
