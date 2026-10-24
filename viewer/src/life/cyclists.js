// Cyclists on the cycle graph (life/streets.json `cycle`): toy figures in the cycling pose on
// smooth toy bikes (src/figure/vehicles.js), keeping to the right, 3.5-6 m/s, pedalling and
// wheels turning with the distance ridden. Parked bikes: clusters at the export's bike spots
// (stations, squares, shopping blocks), with racks.
import { MODE } from '../figure/rig.js';
import { makeVariant } from '../figure/variants.js';
import { BIKE } from '../figure/vehicles.js';
import { Walker, rng, turnToward } from './walkgraph.js';

const BIKE_COLOURS = ['#1E1F21', '#1E1F21', '#22385A', '#2F5A3C', '#A33A2B', '#5C6062', '#6E8798', '#F2F0EA', '#C0643A', '#88A891', '#5B8DB8', '#7A2A22'];
const CRANK_M = 5.2; // metres ridden per pedal turn

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

  update(dt, target, radius = this.radius) {
    this.radius = radius;
    for (const c of this.riders.slice(0, this.count)) {
      const k = c.walker;
      if (Math.hypot(k.x - target[0], k.z - target[1]) > radius * 1.25) this.spawn(c, target[0], target[1], radius * 0.5);
      c.dist += k.step(dt);
      c.yaw = turnToward(c.yaw, k.yaw, 200 * Math.max(dt, 1 / 60));
    }
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
