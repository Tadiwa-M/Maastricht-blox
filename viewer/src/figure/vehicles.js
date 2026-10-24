// Smooth toy vehicles for city life: a Dutch step-through bicycle and three car bodies
// (hatchback, saloon, van), each drawn through a few InstancedMeshes (frame, wheels; body,
// glass + lights, wheels): 9 draw calls for every bike and car in view.
// Origins: ground. Bike: under the saddle (the rider's root, see rig.js SADDLE); car: centre.
// Front = -z. Wheels spin about their axle (local x).
import * as THREE from 'three';
import { rbox, sphere, cyl, torus, tube as tubeN, place, merge } from './geom.js';
import { figureMaterial } from './parts.js';

export const BIKE = { wheelR: 0.34, rear: 0.25, front: -0.84, bb: -0.17 };
const HUB_Y = BIKE.wheelR;

function bikeFrame() {
  const tube = (a, b, r, c = 1) => tubeN(a, b, r, c, 4); // thin: 4 sides are enough
  const BB = [0, 0.3, BIKE.bb], seatTop = [0, 0.86, 0.02], head0 = [0, 0.6, -0.71], head1 = [0, 0.9, -0.66];
  const rearAx = [0, HUB_Y, BIKE.rear], frontAx = [0, HUB_Y, BIKE.front], r = 0.02;
  const D = 0.08;
  const parts = [
    tube(BB, seatTop, r), tube(BB, [0, 0.4, -0.5], r), tube([0, 0.4, -0.5], head0, r), // step-through
    tube(head0, head1, r * 1.3), tube([0.05, head0[1], head0[2]], [0.05, HUB_Y, BIKE.front], 0.013), tube([-0.05, head0[1], head0[2]], [-0.05, HUB_Y, BIKE.front], 0.013),
    tube([0.05, 0.3, BIKE.bb], [0.05, HUB_Y, BIKE.rear], 0.012), tube([-0.05, 0.3, BIKE.bb], [-0.05, HUB_Y, BIKE.rear], 0.012),
    tube([0.04, 0.82, 0.02], [0.05, HUB_Y, BIKE.rear], 0.011), tube([-0.04, 0.82, 0.02], [-0.05, HUB_Y, BIKE.rear], 0.011),
    tube(head1, [0, 1.0, -0.6], 0.016, 0.7), tube([-0.27, 1.02, -0.58], [0.27, 1.02, -0.58], 0.013, 0.7), // stem, bar
    place(cyl(0.022, 0.022, 0.1, D, 8), { at: [-0.26, 1.02, -0.58], rot: [0, 0, Math.PI / 2] }),
    place(cyl(0.022, 0.022, 0.1, D, 8), { at: [0.26, 1.02, -0.58], rot: [0, 0, Math.PI / 2] }), // grips
    tube([0, 0.86, 0.02], [0, 0.92, 0.03], 0.012, 0.7), place(rbox(0.15, 0.06, 0.25, 0.03, D), { at: [0, 0.94, 0.02] }), // saddle
    place(rbox(0.17, 0.02, 0.38, 0.008, 0.55), { at: [0, 0.76, 0.32] }), tube([0.07, 0.75, 0.48], [0.05, HUB_Y, BIKE.rear], 0.007, 0.55),
    tube([-0.07, 0.75, 0.48], [-0.05, HUB_Y, BIKE.rear], 0.007, 0.55), // rear rack
    place(torus(BIKE.wheelR + 0.04, 0.018, 1, Math.PI * 0.75, 4, 14), { at: rearAx, rot: [0, Math.PI / 2, Math.PI * 0.15] }), // mudguards
    place(torus(BIKE.wheelR + 0.04, 0.018, 1, Math.PI * 0.6, 4, 12), { at: frontAx, rot: [0, Math.PI / 2, Math.PI * 0.2] }),
    place(rbox(0.02, 0.13, 0.5, 0.01, 0.3), { at: [0.075, 0.33, 0.04] }), // chain guard
    place(cyl(0.05, 0.05, 0.03, 0.55, 12), { at: [0.06, 0.3, BIKE.bb], rot: [0, 0, Math.PI / 2] }), // chainring
    place(sphere(0.035, [1.6, 1.5, 1.2], 8, 6), { at: [0, 0.8, -0.74] }), // lamp
  ];
  return merge(parts);
}

function bikeWheel() {
  const R = BIKE.wheelR;
  const parts = [
    place(torus(R - 0.025, 0.026, 0.13, Math.PI * 2, 4, 16), { rot: [0, Math.PI / 2, 0] }),
    place(torus(R - 0.055, 0.009, 0.85, Math.PI * 2, 3, 14), { rot: [0, Math.PI / 2, 0] }),
    place(cyl(0.03, 0.03, 0.08, 0.7, 10), { rot: [0, 0, Math.PI / 2] }),
  ];
  for (let q = 0; q < 6; q++) {
    const a = (q / 6) * Math.PI * 2;
    parts.push(tubeN([0, 0, 0], [0, Math.cos(a) * (R - 0.06), Math.sin(a) * (R - 0.06)], 0.004, 0.75, 3));
  }
  return merge(parts);
}

// Car bodies: [L, W, lower body height, cabin [w, h, l, z], glass band, van?]
export const CAR_TYPES = {
  hatch: { L: 3.9, W: 1.74, H: 1.48, cabin: [1.58, 0.62, 2.1, 0.35] },
  saloon: { L: 4.55, W: 1.8, H: 1.44, cabin: [1.62, 0.58, 2.3, 0.2] },
  van: { L: 5.0, W: 1.96, H: 2.15, cabin: [1.9, 1.15, 3.75, 0.56], van: true },
};
const WHEEL_R = 0.32;

function carBody(t) {
  const { L, W, cabin: [cw, ch, cl, cz] } = t;
  const low = t.van ? 0.85 : 0.6, y0 = 0.22;
  const parts = [
    place(rbox(W, low, L, 0.2, 1, 2), { at: [0, y0 + low / 2, 0] }),
    place(rbox(cw, ch, cl, t.van ? 0.18 : 0.24, 1, 2), { at: [0, y0 + low + ch / 2 - 0.06, cz] }),
    place(rbox(W + 0.03, 0.12, 0.2, 0.05, 0.25), { at: [0, y0 + 0.12, -L / 2 + 0.06] }), // bumpers
    place(rbox(W + 0.03, 0.12, 0.2, 0.05, 0.25), { at: [0, y0 + 0.12, L / 2 - 0.06] }),
  ];
  if (!t.van) parts.push(place(rbox(W * 0.5, 0.05, 0.28, 0.02, 0.85), { at: [0, y0 + low + 0.01, -L / 2 + 0.55] })); // bonnet line
  return merge(parts);
}

function carGlass(t) {
  const { L, W, cabin: [cw, ch, cl, cz] } = t;
  const low = t.van ? 0.85 : 0.6, y0 = 0.22, G = [0.05, 0.07, 0.09];
  const gh = t.van ? 0.5 : ch * 0.66, gy = t.van ? y0 + low + 0.32 : y0 + low + ch / 2 - 0.06;
  const glass = t.van
    ? place(rbox(cw + 0.025, gh, 1.1, 0.12, G), { at: [0, gy, cz - cl / 2 + 0.5] })
    : place(rbox(cw + 0.025, gh, cl + 0.03, 0.14, G), { at: [0, gy, cz] });
  const lamp = (x, z, c) => place(rbox(0.32, 0.12, 0.06, 0.03, c), { at: [x, y0 + low - 0.16, z] });
  return merge([glass,
    lamp(-W / 2 + 0.3, -L / 2 - 0.005, [1.4, 1.35, 1.2]), lamp(W / 2 - 0.3, -L / 2 - 0.005, [1.4, 1.35, 1.2]),
    lamp(-W / 2 + 0.25, L / 2 + 0.005, [0.9, 0.08, 0.06]), lamp(W / 2 - 0.25, L / 2 + 0.005, [0.9, 0.08, 0.06]),
    place(rbox(0.5, 0.14, 0.03, 0.02, [0.95, 0.85, 0.2]), { at: [0, y0 + 0.28, -L / 2 - 0.02] })]); // number plate (yellow, NL)
}

function carWheel() {
  return merge([place(cyl(WHEEL_R, WHEEL_R, 0.21, 0.1, 18), { rot: [0, 0, Math.PI / 2] }),
    place(cyl(WHEEL_R * 0.55, WHEEL_R * 0.55, 0.215, 0.75, 14), { rot: [0, 0, Math.PI / 2] })]);
}

let geoCache = null;
export function VEHICLE_GEOS() {
  if (geoCache) return geoCache;
  geoCache = { bikeFrame: bikeFrame(), bikeWheel: bikeWheel(), carWheel: carWheel() };
  for (const [k, t] of Object.entries(CAR_TYPES)) { geoCache[`body:${k}`] = carBody(t); geoCache[`glass:${k}`] = carGlass(t); }
  return geoCache;
}

const WHITE = new THREE.Color(1, 1, 1);
const WHEEL_COL = new THREE.Color('#d8d8d8');

export class VehicleFleet {
  /** caps: { bikes, cars }. */
  constructor({ bikes = 400, cars = 200, clippingPlanes = null, shadows = true, material = null } = {}) {
    this.material = material || figureMaterial({ clippingPlanes });
    this.group = new THREE.Group();
    this.group.name = 'vehicles';
    const G = VEHICLE_GEOS();
    const caps = { bikeFrame: bikes, bikeWheel: bikes * 2, carWheel: cars * 4 };
    for (const k of Object.keys(CAR_TYPES)) { caps[`body:${k}`] = cars; caps[`glass:${k}`] = cars; }
    this.meshes = new Map();
    for (const [key, cap] of Object.entries(caps)) {
      const mesh = new THREE.InstancedMesh(G[key], this.material, cap);
      mesh.name = `vehicle:${key}`;
      mesh.count = 0; mesh.frustumCulled = false; mesh.castShadow = shadows; mesh.receiveShadow = true;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.setColorAt(0, WHITE);
      this.group.add(mesh);
      this.meshes.set(key, { mesh, n: 0, cap, m: mesh.instanceMatrix.array, c: mesh.instanceColor.array });
    }
    this._root = new THREE.Matrix4(); this._w = new THREE.Matrix4(); this._t = new THREE.Matrix4();
    this._q = new THREE.Quaternion(); this._v = new THREE.Vector3(); this._one = new THREE.Vector3(1, 1, 1);
    this._up = new THREE.Vector3(0, 1, 0); this._col = new THREE.Color();
  }

  begin() { for (const e of this.meshes.values()) e.n = 0; }

  put(key, mat, col) {
    const e = this.meshes.get(key);
    if (!e || e.n >= e.cap) return;
    const i = e.n++;
    e.m.set(mat.elements, i * 16);
    e.c[i * 3] = col.r; e.c[i * 3 + 1] = col.g; e.c[i * 3 + 2] = col.b;
  }

  root(x, y, z, rotY) { return this._root.compose(this._v.set(x, y, z), this._q.setFromAxisAngle(this._up, rotY), this._one); }

  /** A bicycle at three.js (x, y, z), heading rotY; opts.colour (hex or Color), opts.spin (wheel angle, rad). */
  addBike(x, y, z, rotY, { colour = '#22385A', spin = 0 } = {}) {
    const root = this.root(x, y, z, rotY);
    this.put('bikeFrame', root, colour instanceof THREE.Color ? colour : this._col.set(colour));
    for (const az of [BIKE.rear, BIKE.front]) {
      this._w.multiplyMatrices(root, this._t.makeTranslation(0, HUB_Y, az)).multiply(this._t.makeRotationX(spin));
      this.put('bikeWheel', this._w, WHEEL_COL);
    }
  }

  /** A car of `type` (CAR_TYPES key) at three.js (x, y, z), heading rotY. */
  addCar(type, x, y, z, rotY, { colour = '#A33A2B', spin = 0 } = {}) {
    const t = CAR_TYPES[type] || CAR_TYPES.hatch;
    const root = this.root(x, y, z, rotY);
    this.put(`body:${type}`, root, colour instanceof THREE.Color ? colour : this._col.set(colour));
    this.put(`glass:${type}`, root, WHITE);
    for (const sx of [-1, 1]) for (const az of [-1, 1]) {
      this._w.multiplyMatrices(root, this._t.makeTranslation(sx * (t.W / 2 - 0.04), WHEEL_R, az * (t.L / 2 - 0.85))).multiply(this._t.makeRotationX(spin));
      this.put('carWheel', this._w, WHITE);
    }
  }

  end() {
    for (const { mesh, n } of this.meshes.values()) {
      mesh.count = n; mesh.visible = n > 0;
      mesh.instanceMatrix.needsUpdate = true; mesh.instanceColor.needsUpdate = true;
    }
  }

  drawCalls() { let k = 0; for (const { mesh } of this.meshes.values()) if (mesh.visible && mesh.count > 0) k++; return k; }
}

export const CAR_WHEEL_R = WHEEL_R;
