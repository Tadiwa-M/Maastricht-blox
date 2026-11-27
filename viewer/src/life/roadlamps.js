// Street lights along every road (the city at night is lit, not dark): a post with an arm out over
// the carriageway every LIGHT.step metres, alternating sides, the lamp head glowing and a warm
// pool of light under it (render/lamps.js LampLights draws pools and glows). Planned once from the
// cars' road graph (roadLampPlan, pure, tested); the nearest are drawn around the camera.
import * as THREE from 'three';
import { roadHalf } from './signals.js';
import { LampLights } from '../render/lamps.js';
import { crownFrame, crownBulbs, bulbColour } from '../render/festive.js';
import { poolSources } from '../render/pools.js';

export const LIGHT = { step: 30, edgeIn: 6, kerb: 0.7, height: 6.2, arm: 1.3, near: 220, cap: 200, repick: 20,
  skip: new Set(['service']) }; // (car parks and drives stay dark)

/**
 * Where the street lights stand: g: RoadGraph (Unity metres). -> [{ x, z, hx, hz }] post foot (x, z)
 * and lamp head (hx, hz, over the road edge). A two-way road is planned once.
 */
export function roadLampPlan(g, o = LIGHT) {
  const out = [];
  for (let e = 0; e < g.count; e++) {
    const a = g.from[e], b = g.to[e];
    if (o.skip.has(g.cls[e]) || (g.twoWay[e] && a > b)) continue;
    const L = g.len[e];
    if (L < o.edgeIn * 2) continue;
    const ux = (g.x[b] - g.x[a]) / L, uz = (g.z[b] - g.z[a]) / L, rx = uz, rz = -ux; // right of travel
    const off = roadHalf(g, e) + o.kerb;
    let side = (e % 2) ? 1 : -1;
    for (let s = o.edgeIn; s <= L - o.edgeIn + 1e-6; s += o.step, side = -side) {
      const cx = g.x[a] + ux * s, cz = g.z[a] + uz * s;
      out.push({ x: cx + rx * off * side, z: cz + rz * off * side, hx: cx + rx * (off - o.arm) * side, hz: cz + rz * (off - o.arm) * side });
    }
  }
  return out;
}

export class RoadLamps {
  /** g: RoadGraph; ground(x, z) -> y (Unity); solid(x, y, z) -> bool (Unity), to keep posts out of buildings. */
  /** festive(x, z): a light crown beside this lamp (the old town while render/season.js says festive). */
  constructor(g, ground, solid = () => false, festive = null) {
    Object.assign(this, { ground, solid, festive });
    this.plan = roadLampPlan(g);
    this.light = new LampLights();
    const mat = new THREE.MeshStandardMaterial({ color: '#4a4f57', roughness: 0.5, metalness: 0.3 });
    this.posts = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.07, 0.09, 1, 8).translate(0, 0.5, 0), mat, LIGHT.cap);
    this.arms = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 0.08, 0.1).translate(0.5, 0, 0), mat, LIGHT.cap);
    this.heads = new THREE.InstancedMesh(new THREE.BoxGeometry(0.45, 0.12, 0.22), new THREE.MeshStandardMaterial({ color: '#2a2d33', emissive: '#ffd9a0', emissiveIntensity: 0 }), LIGHT.cap);
    for (const m of [this.posts, this.arms, this.heads]) { m.count = 0; m.frustumCulled = false; m.castShadow = m !== this.heads; }
    this.group = new THREE.Group();
    this.group.name = 'street lights';
    this.group.add(this.posts, this.arms, this.heads, this.light.group);
    if (festive) { // light crowns (render/festive.js), one beside each old-town lamp
      this.crowns = new THREE.InstancedMesh(crownFrame(), new THREE.MeshStandardMaterial({ color: '#f2f2ee', roughness: 0.4, metalness: 0.4 }), LIGHT.cap);
      this.bulbs = new THREE.InstancedMesh(crownBulbs(), new THREE.MeshBasicMaterial({ color: bulbColour(0), toneMapped: false }), LIGHT.cap);
      for (const m of [this.crowns, this.bulbs]) { m.count = 0; m.frustumCulled = false; m.castShadow = m === this.crowns; this.group.add(m); }
      this.crownSpots = [];
      poolSources.add({ lights: () => (this.night > 0.15 ? this.crownSpots : []) }); // a soft warm glow round each crown
    }
    this.at = null;
    this._m = new THREE.Matrix4(); this._q = new THREE.Quaternion(); this._p = new THREE.Vector3(); this._s = new THREE.Vector3(); this._up = new THREE.Vector3(0, 1, 0);
  }

  /** at: [x, z] Unity (the player or the map focus); camera; night 0..1. */
  update(at, camera, night) {
    this.since = (this.since || 0) + 1;
    // re-pick on a move, and every ~3 s (the ground under far posts streams in later)
    if (!this.at || this.since > 180 || Math.hypot(at[0] - this.at[0], at[1] - this.at[1]) > LIGHT.repick) { this.since = 0; this.place(at); }
    this.heads.material.emissiveIntensity = night * 2.2;
    this.night = night;
    if (this.bulbs) bulbColour(night, this.bulbs.material.color);
    this.light.update(camera, night);
  }

  place(at) {
    this.at = at.slice();
    const near = [];
    for (const l of this.plan) {
      const d = (l.x - at[0]) ** 2 + (l.z - at[1]) ** 2;
      if (d < LIGHT.near * LIGHT.near) near.push([d, l]);
    }
    near.sort((a, b) => a[0] - b[0]);
    const lamps = [];
    let i = 0;
    for (const [, l] of near) {
      if (i >= LIGHT.cap) break;
      const y = this.ground(l.x, l.z);
      if (!Number.isFinite(y) || this.solid(l.x, y + 1.5, l.z) || this.solid(l.hx, y + LIGHT.height - 0.3, l.hz)) continue; // not streamed yet, or in a wall
      const top = y + LIGHT.height, yaw = Math.atan2(l.hz - l.z, l.hx - l.x); // the arm points from the post to the head (three.js: z = -north)
      this.posts.setMatrixAt(i, this._m.compose(this._p.set(l.x, y, -l.z), this._q.identity(), this._s.set(1, LIGHT.height, 1)));
      this._q.setFromAxisAngle(this._up, yaw);
      this.arms.setMatrixAt(i, this._m.compose(this._p.set(l.x, top, -l.z), this._q, this._s.set(LIGHT.arm, 1, 1)));
      this.heads.setMatrixAt(i, this._m.compose(this._p.set(l.hx, top - 0.06, -l.hz), this._q, this._s.set(1, 1, 1)));
      lamps.push({ base: [l.hx, y, -l.hz], heads: [[l.hx, top - 0.2, -l.hz]] });
      i++;
    }
    for (const m of [this.posts, this.arms, this.heads]) { m.count = i; m.instanceMatrix.needsUpdate = true; }
    if (this.crowns) { // beside each old-town lamp, 1.6 m along the kerb
      let c = 0;
      this.crownSpots = [];
      for (const [, l] of near) {
        if (c >= LIGHT.cap) break;
        if (!this.festive(l.x, l.z)) continue;
        const ax = l.hx - l.x, az = l.hz - l.z, L = Math.hypot(ax, az) || 1;
        const x = l.x - (az / L) * 1.6, z = l.z + (ax / L) * 1.6, y = this.ground(x, z);
        if (!Number.isFinite(y) || this.solid(x, y + 1.5, z) || this.solid(x, y + 4.5, z)) continue;
        this._m.compose(this._p.set(x, y, -z), this._q.setFromAxisAngle(this._up, (c * 0.7) % 6.28), this._s.set(1, 1, 1));
        this.crowns.setMatrixAt(c, this._m); this.bulbs.setMatrixAt(c, this._m);
        if (this.crownSpots.length < 16) this.crownSpots.push({ p: [x, y + 4.4, -z], r: 4.5, c: [0.55, 0.38, 0.2] });
        c++;
      }
      for (const m of [this.crowns, this.bulbs]) { m.count = c; m.instanceMatrix.needsUpdate = true; }
    }
    this.light.add('roads', lamps);
  }
}
