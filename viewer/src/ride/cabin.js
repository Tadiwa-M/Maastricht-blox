// The passenger cabin drawn around the camera while riding. Seen from inside, the brick bus is a
// box with slit windows and a floor of studs; a real passenger mostly sees big windows. So the
// ridden vehicle is hidden (fleet hideId) and this light cabin follows its pose instead: floor,
// low side panels, wide window openings between thin pillars, a ceiling, seat backs ahead and a
// grab pole. Local space: x right, y up, -z forward (like the brick models in three.js).
import * as THREE from 'three';

export const CABINS = {
  bus: { width: 2.5, length: 12, floor: 1.15, sill: 1.5, top: 2.6, ceiling: 2.9, pillarEvery: 1.7, rows: 5, seatAhead: 0.9 },
  rail: { width: 2.9, length: 20, floor: 1.15, sill: 1.45, top: 2.65, ceiling: 3.0, pillarEvery: 2.2, rows: 6, seatAhead: 1.0 },
};

/** Box specs ([w, h, d, x, y, z, colour]) of a cabin, relative to the vehicle centre. Pure. */
export function cabinBoxes(kind = 'bus', seat = { forward: 2.2, right: -0.55 }) {
  const c = CABINS[kind] || CABINS.bus, W = c.width, L = c.length, hw = W / 2, out = [];
  const z0 = -L / 2, z1 = L / 2;
  out.push([W, 0.05, L, 0, c.floor - 0.025, 0, '#3b3f4a']); // floor
  out.push([W, 0.05, L, 0, c.ceiling + 0.025, 0, '#e8e6df']); // ceiling
  for (const s of [-1, 1]) {
    const x = s * (hw - 0.03);
    out.push([0.06, c.sill - c.floor, L, x, (c.floor + c.sill) / 2, 0, '#1d3f8f']); // panel under the windows
    out.push([0.06, c.ceiling - c.top, L, x, (c.top + c.ceiling) / 2, 0, '#1d3f8f']); // band above them
    for (let z = z0; z <= z1 + 1e-6; z += c.pillarEvery) out.push([0.08, c.top - c.sill, 0.1, x, (c.sill + c.top) / 2, z, '#2a2d36']);
  }
  out.push([W, c.ceiling - c.floor, 0.06, 0, (c.floor + c.ceiling) / 2, z1, '#2a2d36']); // rear wall
  // seat backs ahead of the passenger, two per side
  for (let r = 1; r <= c.rows; r++) {
    const z = -(seat.forward + r * c.seatAhead);
    if (z < z0 + 1) break;
    for (const x of [-hw + 0.55, hw - 0.55]) out.push([0.9, 0.45, 0.08, x, c.floor + 0.35, z, '#25356b']);
  }
  out.push([0.04, c.ceiling - c.floor, 0.04, seat.right + 0.7, (c.floor + c.ceiling) / 2, -(seat.forward + 1.6), '#F2A900']); // grab pole, in the aisle ahead
  return out;
}

export class Cabin {
  constructor(scene) {
    this.group = new THREE.Group();
    this.group.name = 'ride:cabin';
    this.group.visible = false;
    scene.add(this.group);
    this.kind = null;
    this.mats = new Map();
  }

  mat(colour) {
    if (!this.mats.has(colour)) this.mats.set(colour, new THREE.MeshStandardMaterial({ color: colour, roughness: 0.7, side: THREE.DoubleSide }));
    return this.mats.get(colour);
  }

  build(kind, seat) {
    for (const m of this.group.children) m.geometry.dispose();
    this.group.clear();
    for (const [w, h, d, x, y, z, col] of cabinBoxes(kind, seat)) {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), this.mat(col));
      mesh.position.set(x, y, z);
      this.group.add(mesh);
    }
    this.kind = kind;
  }

  /** Follow a vehicle pose (Unity metres, yaw clockwise from north); null hides the cabin. */
  place(pose, kind = 'bus', seat) {
    if (!pose) { this.group.visible = false; return; }
    if (this.kind !== kind) this.build(kind, seat);
    this.group.visible = true;
    this.group.position.set(pose.x, pose.y, -pose.z);
    this.group.rotation.set(0, (-pose.yaw * Math.PI) / 180, 0);
  }
}
