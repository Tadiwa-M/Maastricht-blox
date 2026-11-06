// Cyclists on the cycle graph (life/streets.json `cycle`): toy figures in the cycling pose on
// smooth toy bikes (src/figure/vehicles.js), keeping to the right, 3.5-6 m/s, pedalling and
// wheels turning with the distance ridden. Parked bikes: clusters at the export's bike spots
// (stations, squares, shopping blocks), with racks.
import { MODE } from '../figure/rig.js';
import { makeVariant } from '../figure/variants.js';
import { BIKE } from '../figure/vehicles.js';
import { Walker, avoid, rng, turnToward } from './walkgraph.js';
import { clearVehicles, inVehiclePath } from './walkers.js';

const LOOK_M = 3.5; // a rider checks this far ahead for a vehicle in the way

const BIKE_COLOURS = ['#1E1F21', '#1E1F21', '#22385A', '#2F5A3C', '#A33A2B', '#5C6062', '#6E8798', '#F2F0EA', '#C0643A', '#88A891', '#5B8DB8', '#7A2A22'];
const CRANK_M = 5.2; // metres ridden per pedal turn

/**
 * Bikes queue: a rider stops behind the bike in front (same direction, same lane) instead of
 * riding through it; GAP_M nose to tail at a standstill, full speed from GAP_M + 3 m.
 */
const GAP_M = 2.0;
export function queue(riders) {
  const cell = 6, grid = new Map(), key = (x, z) => `${Math.floor(x / cell)},${Math.floor(z / cell)}`;
  for (const w of riders) { const k = key(w.x, w.z); if (!grid.has(k)) grid.set(k, []); grid.get(k).push(w); }
  for (const w of riders) {
    const fx = w.dirX ?? 0, fz = w.dirZ ?? 1, i0 = Math.floor(w.x / cell), j0 = Math.floor(w.z / cell);
    for (let i = i0 - 1; i <= i0 + 1; i++) for (let j = j0 - 1; j <= j0 + 1; j++) {
      for (const o of grid.get(`${i},${j}`) || []) {
        if (o === w) continue;
        const dx = o.x - w.x, dz = o.z - w.z, along = dx * fx + dz * fz, across = Math.abs(dx * fz - dz * fx);
        if (along <= 0 || along > GAP_M + 3 || across > 0.9) continue;
        if ((o.dirX ?? 0) * fx + (o.dirZ ?? 1) * fz < 0.3) continue; // oncoming: avoid() steps aside
        w.slow = Math.min(w.slow, Math.max(0, (along - GAP_M) / 3));
      }
    }
  }
}

export class Cyclists {
  /** graph: WalkGraph of the cycle network. ground(x, z) -> y. */
  constructor({ graph, ground, cap = 160, seed = 41 }) {
    Object.assign(this, { graph, ground, cap });
    this.rand = rng(seed);
    this.riders = [];
    this.count = 0;
    this.radius = 200;
    this.nextId = 1;
  }

  spawn(c, x, z, rMin) {
    const n = this.graph.spawnNear(x, z, this.radius, this.rand, rMin);
    if (n < 0) return false;
    const r = this.rand;
    const lateral = 1.0 + r() * 0.8; // right of the centreline
    const walker = new Walker(this.graph, n, r, { speed: 3.5 + r() * 2.5, lateral, corner: 4 });
    walker.baseLateral = lateral;
    walker.place();
    const v = makeVariant(this.nextId++ * 53 + 11, { kind: 'adult' });
    if (v.acc === 'bag') v.acc = 'none';
    Object.assign(c, { walker, v, colour: BIKE_COLOURS[Math.floor(r() * BIKE_COLOURS.length)], dist: r() * 10, yaw: null });
    return true;
  }

  setCount(n, target) {
    n = Math.min(n, this.cap);
    while (this.riders.length < n) {
      const c = {};
      if (!this.spawn(c, target[0], target[1], 0)) break;
      this.riders.push(c);
    }
    this.count = Math.min(n, this.riders.length);
  }

  /** vehicles: footprints (buses, trains, cars) to wait for and keep clear of. */
  update(dt, target, radius = this.radius, vehicles = []) {
    this.radius = radius;
    const riders = this.riders.slice(0, this.count);
    avoid(riders.map((c) => c.walker), 2.2); // slow down behind a slower bike, pass on the side
    queue(riders.map((c) => c.walker)); // and never ride into the one in front
    for (const c of riders) {
      const k = c.walker;
      if (Math.hypot(k.x - target[0], k.z - target[1]) > radius * 1.25) this.spawn(c, target[0], target[1], radius * 0.5);
      // a bus or car in the way (ahead of the bike, or about to cross): brake and wait
      const ax = k.x + (k.dirX ?? 0) * LOOK_M, az = k.z + (k.dirZ ?? 1) * LOOK_M;
      if (vehicles.some((f) => inVehiclePath(f, ax, az, 5, 0.4))) k.slow = 0;
      c.dist += k.step(dt);
      if (vehicles.length) { // never inside one (a bike is ~1.7 m long): step aside, and stay aside
        const x0 = k.x, z0 = k.z;
        if (clearVehicles([k], vehicles, 1.0)) {
          const fx = k.dirX ?? 0, fz = k.dirZ ?? 1;
          k.lateral = Math.max(-3.5, Math.min(3.5, k.lateral + (k.x - x0) * fz - (k.z - z0) * fx));
        }
      }
      c.yaw = turnToward(c.yaw, k.yaw, 200 * Math.max(dt, 1 / 60));
    }
  }

  /** Where the riders are (Unity metres): obstacles for the cars' lanes. */
  positions(out = []) {
    for (const c of this.riders.slice(0, this.count)) out.push({ x: c.walker.x, z: c.walker.z, r: 0.5 });
    return out;
  }

  /** Riders into the FigureCrowd, bikes into the VehicleFleet. */
  draw(crowd, fleet) {
    for (const c of this.riders.slice(0, this.count)) {
      const k = c.walker, y = this.ground(k.x, k.z), rot = (-c.yaw * Math.PI) / 180;
      fleet.addBike(k.x, y, -k.z, rot, { colour: c.colour, spin: -c.dist / BIKE.wheelR });
      crowd.add(c.v, { x: k.x, y, z: -k.z, rotY: rot, mode: MODE.CYCLE, phase: (c.dist / CRANK_M) * Math.PI * 2 });
    }
  }
}

/**
 * Parked bikes at spots [[x, z, dx, dz, len?], ...] (row direction (dx, dz)): a row of 6-14 (or len / 0.7)
 * bikes side by side at right angles to the street, with racks. Returns
 * { bikes: [{ x, z, yaw, colour }], racks: [{ x, z, yaw }] } (Unity metres, yaw degrees).
 */
export function parkedBikes(spots, seed = 5) {
  const r = rng(seed), bikes = [], racks = [];
  for (const [x, z, dx, dz, len] of spots) {
    const n = len ? Math.max(2, Math.floor(len / 0.7)) : 6 + Math.floor(r() * 9); // tree rows: fill the gap between the trees
    const yaw = ((Math.atan2(-dz, dx) * 180) / Math.PI + 360) % 360; // bikes point across the street (right angle)
    const along = (q) => (q - (n - 1) / 2) * 0.7;
    for (let q = 0; q < n; q++) {
      if (r() < 0.12) continue; // a gap in the row
      const a = along(q);
      bikes.push({ x: x + dx * a, z: z + dz * a, yaw: (yaw + (r() < 0.25 ? 180 : 0) + (r() - 0.5) * 8) % 360, colour: BIKE_COLOURS[Math.floor(r() * BIKE_COLOURS.length)] });
    }
    for (let q = 0; q < Math.ceil(n / 6); q++) {
      const a = along(q * 6 + 2.5);
      racks.push({ x: x + dx * a, z: z + dz * a, yaw }); // the rack's hoops run like the bikes
    }
  }
  return { bikes, racks };
}
