// Traffic lights and zebra crossings near the camera (positions: signals.js CrossingMap), in
// five instanced draw calls: dark grey brick posts with a stud on top, black lamp heads (three
// round lamps facing each approach, a two-lamp pedestrian head facing across the road where a
// footway crosses), the lamps themselves (unlit material: the lit one shows its colour at full
// strength, so it glows at night; the others are dark), and white zebra plates. Only the
// nearest poles and stripes are placed (caps by quality tier), re-picked when the camera moves.
import * as THREE from 'three';
import { signalState } from './traffic.js';
import { pedSignal } from './signals.js';

export const SIGNAL_CAPS = { high: { r: 320, poles: 120, stripes: 1200 }, medium: { r: 220, poles: 70, stripes: 700 },
  low: { r: 130, poles: 30, stripes: 300 }, lite: { r: 60, poles: 12, stripes: 120 } };
// toy scale: a little bigger than life, so a light reads from across a square
const POST_H = 3.7, HEAD_Y = 3.1, PED_Y = 2.0; // m above the pavement
const LAMP = { red: new THREE.Color('#ff3324'), amber: new THREE.Color('#ffb11a'), green: new THREE.Color('#2fe36a') };
const DIM = 0.025; // an unlit lamp keeps this share of its colour (linear: ~15 % on screen)
const CAR_LAMPS = [['red', 0.4], ['amber', 0], ['green', -0.4]]; // y offsets on the head
const PED_LAMPS = [['red', 0.2], ['green', -0.2]];

/** Nearest `cap` items to (x, z) within r: [item]. */
function nearest(items, x, z, r, cap) {
  const r2 = r * r, d = [];
  for (const it of items) { const q = (it.x - x) ** 2 + (it.z - z) ** 2; if (q <= r2) d.push([q, it]); }
  d.sort((a, b) => a[0] - b[0]);
  return d.slice(0, cap).map((p) => p[1]);
}

export class SignalProps {
  /** map: CrossingMap. ground(x, z) -> three y. clip: clipping planes or null. */
  constructor({ map, ground, clip = null }) {
    Object.assign(this, { map, ground });
    this.heads = map.heads();
    this.stripes = map.zebras();
    this.group = new THREE.Group();
    this.group.name = 'life:signals';
    const capP = SIGNAL_CAPS.high.poles, capS = SIGNAL_CAPS.high.stripes;
    const std = (color) => new THREE.MeshStandardMaterial({ color, roughness: 0.55, clippingPlanes: clip });
    const mesh = (geo, mat, n) => { const m = new THREE.InstancedMesh(geo, mat, n); m.count = 0; m.frustumCulled = false; this.group.add(m); return m; };
    // a 0.16 m square post with a stud cap (one merged box + cylinder would need BufferGeometryUtils: two meshes instead)
    this.posts = mesh(new THREE.BoxGeometry(0.22, POST_H, 0.22).translate(0, POST_H / 2, 0), std('#9aa0a6'), capP);
    this.posts.castShadow = true;
    this.studs = mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.06, 10).translate(0, POST_H + 0.03, 0), std('#9aa0a6'), capP);
    this.boxes = mesh(new THREE.BoxGeometry(0.42, 1.25, 0.24), std('#1b1c1e'), capP * 2); // car heads; ped heads scaled down
    this.lamps = mesh(new THREE.CylinderGeometry(0.14, 0.14, 0.06, 14).rotateX(Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: '#ffffff', toneMapped: false, clippingPlanes: clip }), capP * 5);
    this.zebra = mesh(new THREE.BoxGeometry(1, 0.05, 1), new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.6, emissive: '#ffffff', emissiveIntensity: 0.12,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, clippingPlanes: clip }), capS);
    this.zebra.receiveShadow = true;
    this.lamps.setColorAt(0, LAMP.red); // (creates instanceColor)
    this.shown = []; // [{ h, y, lamps: [[slot, colour, kind]] }]
    this.at = null;
    this.tier = null;
    this.frames = 0;
    this._m = new THREE.Matrix4(); this._q = new THREE.Quaternion(); this._p = new THREE.Vector3(); this._s = new THREE.Vector3();
    this._c = new THREE.Color();
    this.up = new THREE.Vector3(0, 1, 0);
  }

  set(mesh, i, x, y, z, yaw, sx = 1, sy = 1, sz = 1) {
    this._q.setFromAxisAngle(this.up, (-yaw * Math.PI) / 180);
    mesh.setMatrixAt(i, this._m.compose(this._p.set(x, y, -z), this._q, this._s.set(sx, sy, sz)));
  }

  /** Re-pick the poles and stripes near (x, z) (Unity metres). */
  place(x, z, caps) {
    // ground not streamed in yet (the lookup answers Infinity): leave it out and look again soon
    this.missing = false;
    const known = (list) => list.filter((q) => { q.y = this.ground(q.x, q.z); if (Number.isFinite(q.y)) return true; this.missing = true; return false; });
    const heads = known(nearest(this.heads, x, z, caps.r, caps.poles));
    let b = 0, l = 0;
    this.shown = [];
    heads.forEach((h, i) => {
      const y = h.y;
      this.set(this.posts, i, h.x, y, h.z, h.yaw);
      this.set(this.studs, i, h.x, y, h.z, h.yaw);
      const r = (h.yaw * Math.PI) / 180, fx = Math.sin(r), fz = Math.cos(r); // the way the lamps face
      const lamps = [];
      const head = (yaw, hy, fx2, fz2, sy, list, kind) => {
        const cx = h.x + fx2 * 0.2, cz = h.z + fz2 * 0.2;
        this.set(this.boxes, b++, cx, y + hy, cz, yaw, 1, sy, 1);
        for (const [colour, dy] of list) {
          this.set(this.lamps, l, cx + fx2 * 0.13, y + hy + dy, cz + fz2 * 0.13, yaw);
          lamps.push([l++, colour, kind]);
        }
      };
      head(h.yaw, HEAD_Y, fx, fz, 1, CAR_LAMPS, 'car');
      if (h.ped) head((h.yaw + 90) % 360, PED_Y, fz, -fx, 0.55, PED_LAMPS, 'ped'); // facing across the road (to the left of the traffic)
      this.shown.push({ h, lamps });
    });
    this.posts.count = this.studs.count = heads.length;
    this.boxes.count = b; this.lamps.count = l;
    for (const m of [this.posts, this.studs, this.boxes, this.lamps]) m.instanceMatrix.needsUpdate = true;
    const stripes = known(nearest(this.stripes, x, z, caps.r, caps.stripes));
    stripes.forEach((s, i) => this.set(this.zebra, i, s.x, s.y + 0.026, s.z, s.yaw, s.w, 1, s.len));
    this.zebra.count = stripes.length;
    this.zebra.instanceMatrix.needsUpdate = true;
  }

  /** at: [x, z] Unity metres (the player, or where the map camera looks); t: light clock (s); tier: quality tier. */
  update(at, t, tier = 'medium') {
    const caps = SIGNAL_CAPS[tier] || SIGNAL_CAPS.medium;
    // re-pick on a move, and now and then (the ground under a pole streams in later)
    if (!this.at || tier !== this.tier || Math.hypot(at[0] - this.at[0], at[1] - this.at[1]) > 12 || ++this.frames > (this.missing ? 20 : 90)) {
      this.at = at.slice(); this.tier = tier; this.frames = 0;
      this.place(at[0], at[1], caps);
    }
    const g = this.map.g;
    for (const { h, lamps } of this.shown) {
      const car = signalState(g, h.e, t), ped = pedSignal(g.bearing(h.e) + 90, t);
      for (const [slot, colour, kind] of lamps) {
        const on = (kind === 'car' ? car : ped) === colour;
        this.lamps.setColorAt(slot, on ? LAMP[colour] : this._c.copy(LAMP[colour]).multiplyScalar(DIM));
      }
    }
    if (this.lamps.instanceColor) this.lamps.instanceColor.needsUpdate = true;
  }

  drawCalls() { return [this.posts, this.studs, this.boxes, this.lamps, this.zebra].filter((m) => m.count > 0).length; }
}
