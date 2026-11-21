// The Christmas market on the Vrijthof (Magisch Maastricht; owner's photos of 21 November): a
// white Ferris wheel on the south side in front of the Generaalshuis, rows of wooden chalets with
// red and brown roofs, a carousel with a striped tent roof, and while it is being built a fence of
// printed banner panels round it all. Up the week before it opens (render/season.js market:
// 'building' fenced off, 'open' lit at night, the wheel turning) until a few days after.
// Placed on the ground once it has streamed in; spots inside buildings are skipped.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { poolSources } from '../render/pools.js';

export const XMAS = {
  centre: [176185, 317717], // Vrijthof, RD metres
  wheel: { at: [-6, -38], r: 15, axle: 17, gondolas: 24, yaw: 0.6, turn: 0.035 }, // offsets east/north of the centre (m)
  carousel: { at: [-30, -14], r: 6 },
  chalet: { w: 3.2, d: 2.4, h: 2.3 },
};

/** Chalet spots (pure): two double rows down the square plus a row along the north, [{ x, z, yaw }] east/north offsets. */
export function chaletLayout() {
  const out = [];
  for (const row of [-16, -11, 11, 16]) for (let k = -5; k <= 5; k++) out.push({ x: row, z: k * 3.6 + 6, yaw: row < 0 ? Math.PI / 2 : -Math.PI / 2 });
  for (let k = -4; k <= 4; k++) out.push({ x: k * 3.6, z: 32, yaw: Math.PI });
  return out;
}

function wheelFrame(o) {
  const parts = [], white = (g) => g.toNonIndexed();
  for (const dz of [-0.7, 0.7]) {
    parts.push(white(new THREE.TorusGeometry(o.r, 0.18, 6, 64).translate(0, 0, dz)));
    parts.push(white(new THREE.TorusGeometry(o.r * 0.82, 0.08, 4, 48).translate(0, 0, dz)));
    for (let k = 0; k < 32; k++) {
      const a = (k / 32) * Math.PI * 2;
      parts.push(white(new THREE.BoxGeometry(o.r, 0.06, 0.06).translate(o.r / 2, 0, 0).rotateZ(a).translate(0, 0, dz)));
    }
  }
  parts.push(white(new THREE.CylinderGeometry(0.9, 0.9, 2.2, 16).rotateX(Math.PI / 2))); // hub
  return mergeGeometries(parts);
}

function wheelStand(o) { // two A-frames and the axle, origin on the ground under the axle
  const parts = [];
  for (const dz of [-1.6, 1.6]) for (const dx of [-1, 1]) {
    const leg = new THREE.BoxGeometry(0.5, Math.hypot(o.axle, 6), 0.5);
    leg.rotateZ(dx * Math.atan2(6, o.axle)).translate(-dx * 3, o.axle / 2, dz);
    parts.push(leg.toNonIndexed());
  }
  parts.push(new THREE.CylinderGeometry(0.35, 0.35, 3.6, 10).rotateX(Math.PI / 2).translate(0, o.axle, 0).toNonIndexed());
  parts.push(new THREE.BoxGeometry(9, 1.2, 5).translate(0, 0.6, 0).toNonIndexed()); // the boarding platform
  return mergeGeometries(parts);
}

function chaletGeometry(o, roofOnly = false) {
  if (roofOnly) { // a gable roof as two slabs
    const a = 0.5, half = o.w / 2 + 0.25, slab = half / Math.cos(a);
    return mergeGeometries([-1, 1].map((s) => new THREE.BoxGeometry(slab, 0.08, o.d + 0.5).translate(s * slab / 2, 0, 0).rotateZ(-s * a).translate(0, o.h + 0.05, 0).toNonIndexed()));
  }
  const body = new THREE.BoxGeometry(o.w, o.h, o.d).translate(0, o.h / 2, 0).toNonIndexed();
  body.deleteAttribute('uv'); // (merged with the gables, which have none)
  const gable = new THREE.BufferGeometry();
  const t = Math.tan(0.5) * o.w / 2, y = o.h, hw = o.w / 2, hd = o.d / 2;
  gable.setAttribute('position', new THREE.Float32BufferAttribute([-hw, y, hd, hw, y, hd, 0, y + t, hd, hw, y, -hd, -hw, y, -hd, 0, y + t, -hd], 3));
  gable.computeVertexNormals();
  return mergeGeometries([body, gable]);
}

/** A front shutter opened as a counter (lit at night): a panel on the customers' side. */
const counterGeometry = (o) => new THREE.PlaneGeometry(o.w * 0.8, o.h * 0.5).translate(0, o.h * 0.55, o.d / 2 + 0.02);

function bannerTexture() {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas'); c.width = 256; c.height = 64;
  const g = c.getContext('2d');
  const scenes = [['#1b2a4a', '#f2c46a'], ['#2a1a14', '#ffb24a'], ['#5d7fa8', '#e8eef5'], ['#3a0d0d', '#e2332b']];
  for (let k = 0; k < 4; k++) {
    const [bg, fg] = scenes[k];
    g.fillStyle = bg; g.fillRect(k * 64, 0, 64, 64);
    for (let q = 0; q < 26; q++) { g.fillStyle = fg; g.globalAlpha = 0.25 + 0.6 * Math.random(); g.beginPath(); g.arc(k * 64 + Math.random() * 64, Math.random() * 64, 1 + Math.random() * 4, 0, 7); g.fill(); }
    g.globalAlpha = 1;
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = THREE.RepeatWrapping;
  return t;
}

export class XmasMarket {
  /** origin: the world's originRD; ground(x, z) Unity -> y; solid(x, y, z) Unity -> bool; state 'building' | 'open'. */
  constructor({ origin, ground, solid = () => false, state = 'open' }) {
    Object.assign(this, { origin, ground, solid, state });
    this.group = new THREE.Group(); this.group.name = 'christmas market';
    this.placed = false; this.t = 0; this.lights = [];
    const W = XMAS.wheel, white = new THREE.MeshStandardMaterial({ color: '#f4f4f0', roughness: 0.45, metalness: 0.2 });
    this.wheelRot = new THREE.Group();
    this.wheelRot.add(new THREE.Mesh(wheelFrame(W), white));
    // gondolas hang level: positioned each frame round the rim
    this.gondolas = new THREE.InstancedMesh(new THREE.BoxGeometry(1.5, 1.8, 1.5).translate(0, -1.0, 0), new THREE.MeshStandardMaterial({ color: '#eef2f6', roughness: 0.3, metalness: 0.3 }), W.gondolas);
    this.rimBulbs = new THREE.InstancedMesh(new THREE.OctahedronGeometry(0.16), new THREE.MeshBasicMaterial({ color: '#ffd28a', toneMapped: false }), 64);
    this.wheel = new THREE.Group();
    this.wheel.add(this.wheelRot, new THREE.Mesh(wheelStand(W), white), this.gondolas);
    this.wheelRot.add(this.rimBulbs);
    for (let k = 0; k < 64; k++) { const a = (k / 64) * Math.PI * 2; this.rimBulbs.setMatrixAt(k, new THREE.Matrix4().makeTranslation(Math.cos(a) * (W.r + 0.25), Math.sin(a) * (W.r + 0.25), 0)); }
    this.rimBulbs.instanceMatrix.needsUpdate = true;
    const C = XMAS.chalet, spots = chaletLayout();
    this.spots = spots;
    const wood = new THREE.MeshStandardMaterial({ color: '#7a5634', roughness: 0.85 });
    this.chalets = new THREE.InstancedMesh(chaletGeometry(C), wood, spots.length);
    this.roofs = new THREE.InstancedMesh(chaletGeometry(C, true), new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.7 }), spots.length);
    this.counters = new THREE.InstancedMesh(counterGeometry(C), new THREE.MeshBasicMaterial({ color: '#3a2a1c', toneMapped: false }), spots.length);
    // the carousel: green round wall, painted panels, a striped cone roof
    const K = XMAS.carousel;
    this.carousel = new THREE.Group();
    this.carousel.add(new THREE.Mesh(new THREE.CylinderGeometry(K.r, K.r, 2.6, 24, 1, true).translate(0, 1.3, 0), new THREE.MeshStandardMaterial({ color: '#1f5a3a', roughness: 0.6, side: THREE.DoubleSide })));
    const roof = new THREE.ConeGeometry(K.r + 0.4, 3, 24).translate(0, 5.6, 0);
    const col = new Float32Array(roof.attributes.position.count * 3);
    for (let q = 0; q < roof.attributes.position.count; q++) {
      const a = Math.atan2(roof.attributes.position.getZ(q), roof.attributes.position.getX(q)), red = Math.floor(((a + Math.PI) / (Math.PI * 2)) * 24) % 2;
      col.set(red ? [0.75, 0.2, 0.2] : [0.95, 0.92, 0.85], q * 3);
    }
    roof.setAttribute('color', new THREE.BufferAttribute(col, 3));
    this.carousel.add(new THREE.Mesh(roof, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6 })));
    this.carousel.add(new THREE.Mesh(new THREE.CylinderGeometry(K.r + 0.1, K.r + 0.1, 1.2, 24, 1, true).translate(0, 3.5, 0), new THREE.MeshStandardMaterial({ color: '#d9b45a', roughness: 0.5, side: THREE.DoubleSide })));
    // the building-site fence of banner panels
    const tex = bannerTexture();
    this.fence = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.8, side: THREE.DoubleSide }));
    this.group.add(this.wheel, this.chalets, this.roofs, this.counters, this.carousel, this.fence);
    for (const o of [this.chalets, this.roofs, this.gondolas]) o.castShadow = true;
    this.group.traverse((o) => { if (o.isMesh) { o.receiveShadow = true; o.frustumCulled = false; } });
    poolSources.add({ lights: () => (this.night > 0.15 && this.state === 'open' ? this.lights : []) });
  }

  /** RD offset (east, north of the centre) -> Unity [x, z]. */
  at(dx, dz) { return [XMAS.centre[0] + dx - this.origin[0], XMAS.centre[1] + dz - this.origin[1]]; }

  /** Stand everything on the ground (once it has streamed in). -> true when done. */
  place() {
    const [cx, cz] = this.at(0, 0), g0 = this.ground(cx, cz);
    if (!Number.isFinite(g0)) return false;
    const gy = (x, z) => { const y = this.ground(x, z); return Number.isFinite(y) && Math.abs(y - g0) < 3 ? y : g0; };
    const ok = (x, z, h = 1.5) => { const y = this.ground(x, z); return Number.isFinite(y) && Math.abs(y - g0) < 1.2 && !this.solid(x, y + h, z) ? y : null; };
    const W = XMAS.wheel, [wx, wz] = this.at(...W.at), wy = gy(wx, wz);
    this.wheel.position.set(wx, wy, -wz); this.wheel.rotation.y = W.yaw;
    this.wheelRot.position.y = W.axle;
    const K = XMAS.carousel, [kx, kz] = this.at(...K.at);
    this.carousel.position.set(kx, gy(kx, kz), -kz);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), s = new THREE.Vector3(1, 1, 1), p = new THREE.Vector3();
    const roofCol = [new THREE.Color('#9c2b2b'), new THREE.Color('#5a3b2a'), new THREE.Color('#b8b2a8')];
    let n = 0;
    this.lights = [];
    for (const [k, c] of this.spots.entries()) {
      const [x, z] = this.at(c.x, c.z), y = ok(x, z);
      if (y === null) continue;
      m.compose(p.set(x, y, -z), q.setFromAxisAngle(up, c.yaw), s);
      this.chalets.setMatrixAt(n, m); this.roofs.setMatrixAt(n, m); this.counters.setMatrixAt(n, m);
      this.roofs.setColorAt(n, roofCol[k % 5 === 0 ? 2 : k % 2]);
      if (k % 3 === 0 && this.lights.length < 12) this.lights.push({ p: [x + Math.sin(c.yaw) * 2, y + 1.6, -z + Math.cos(c.yaw) * 2], r: 6, c: [1.3, 0.85, 0.45] });
      n++;
    }
    for (const o of [this.chalets, this.roofs, this.counters]) { o.count = n; o.instanceMatrix.needsUpdate = true; }
    this.roofs.instanceColor && (this.roofs.instanceColor.needsUpdate = true);
    this.lights.push({ p: [wx, wy + 3, -wz], r: 12, c: [1.2, 1.0, 0.8] });
    // the fence: round the chalet area (while building)
    const pts = [[-20, -26], [20, -26], [20, 38], [-20, 38], [-20, -26]].map(([a, b]) => this.at(a, b));
    const pos = [], uv = [];
    for (let k = 0; k < 4; k++) {
      const [ax, az] = pts[k], [bx, bz] = pts[k + 1], L = Math.hypot(bx - ax, bz - az), ya = gy(ax, az), yb = gy(bx, bz);
      pos.push(ax, ya, -az, bx, yb, -bz, bx, yb + 2, -bz, ax, ya, -az, bx, yb + 2, -bz, ax, ya + 2, -az);
      const u = L / 3.5;
      uv.push(0, 0, u, 0, u, 1, 0, 0, u, 1, 0, 1);
    }
    this.fence.geometry.dispose();
    this.fence.geometry = new THREE.BufferGeometry();
    this.fence.geometry.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    this.fence.geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    this.fence.geometry.computeVertexNormals();
    this.fence.visible = this.state === 'building';
    this.placed = true;
    return true;
  }

  /** Per frame: dt (s), night 0..1. */
  update(dt, night) {
    this.night = night;
    if (!this.placed && !this.place()) return;
    const W = XMAS.wheel, open = this.state === 'open';
    if (open) this.t += dt * W.turn;
    this.wheelRot.rotation.z = this.t;
    const m = new THREE.Matrix4();
    for (let k = 0; k < W.gondolas; k++) {
      const a = this.t + (k / W.gondolas) * Math.PI * 2;
      this.gondolas.setMatrixAt(k, m.makeTranslation(Math.cos(a) * W.r, W.axle + Math.sin(a) * W.r, 0));
    }
    this.gondolas.instanceMatrix.needsUpdate = true;
    const lit = open ? night : 0;
    this.rimBulbs.visible = lit > 0.05;
    this.rimBulbs.material.color.setRGB(1.0 * (0.6 + 3 * lit), 0.78 * (0.6 + 3 * lit), 0.45 * (0.6 + 3 * lit));
    this.counters.material.color.setRGB(0.23 + 1.6 * lit, 0.16 + 1.1 * lit, 0.11 + 0.55 * lit); // the shutters open onto warm light
  }
}
