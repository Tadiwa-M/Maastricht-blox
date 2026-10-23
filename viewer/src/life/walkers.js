// Pedestrians: N walkers on the walk graph around the camera, drawn as one InstancedModel of
// the original blocky character (contract/models/character.json; not a toy minifigure).
// Each walker gets palette colours (shirt, trousers, skin, hair), a speed, a lateral place on
// the way and a walk cycle driven by distance (src/mover.js WalkCycle). Walkers that end up
// far from the camera target are recycled to a busy node near it.
import { WalkCycle } from '../mover.js';
import { InstancedModel } from './instancer.js';
import { Walker, avoid, rng, turnToward } from './walkgraph.js';

// character.json colours by role -> palette choices (indices in contract/palette.json)
const ROLES = {
  44: [44, 38, 8, 37, 41, 20, 45, 43, 4, 9, 42, 21, 17, 11], // shirt
  21: [21, 11, 10, 19, 20, 18, 7, 12], // trousers
  18: [18, 17, 19, 7, 46], // skin (hands, head)
  7: [7, 11, 43, 10, 8, 19, 30], // hair
};
export const WALKERS_BY_TIER = { high: 360, medium: 200, low: 90 };

/** Share of the crowd out on the street at an hour of the day (0..24): busy afternoons, quiet nights. */
export function crowdFactor(hours) {
  const h = ((hours % 24) + 24) % 24;
  const pts = [[0, 0.12], [5, 0.06], [7, 0.3], [9, 0.6], [12, 1], [17, 1], [19, 0.75], [22, 0.35], [24, 0.12]];
  for (let q = 1; q < pts.length; q++) {
    const [h0, v0] = pts[q - 1], [h1, v1] = pts[q];
    if (h <= h1) return v0 + (v1 - v0) * ((h - h0) / (h1 - h0));
  }
  return pts[0][1];
}

/**
 * Step out of the way of vehicles: a walker inside a vehicle's footprint (+ margin) is moved
 * sideways to the nearer long side. vehicles: [{ x, z, yaw, halfW, halfL }] (Unity metres).
 * Returns how many walkers were moved.
 */
export function clearVehicles(walkers, vehicles, margin = 0.8) {
  let moved = 0;
  for (const v of vehicles) {
    const r = (v.yaw * Math.PI) / 180, fx = Math.sin(r), fz = Math.cos(r); // forward; right = (fz, -fx)
    const hw = v.halfW + margin, hl = v.halfL + margin;
    for (const w of walkers) {
      const dx = w.x - v.x, dz = w.z - v.z;
      const along = dx * fx + dz * fz, across = dx * fz - dz * fx;
      if (Math.abs(along) > hl || Math.abs(across) > hw) continue;
      const push = (across >= 0 ? hw : -hw) - across;
      w.x += fz * push; w.z -= fx * push;
      moved++;
    }
  }
  return moved;
}

export class Pedestrians {
  /** graph: WalkGraph. model: character JSON. opts: buildModel opts. ground(x, z) -> y. */
  constructor({ graph, model, opts, ground, cap = WALKERS_BY_TIER.high, seed = 7 }) {
    Object.assign(this, { graph, ground, cap });
    this.rand = rng(seed);
    this.model = new InstancedModel(model, opts, cap);
    this.group = this.model.group;
    this.group.name = 'life:walkers';
    this.walkers = [];
    this.count = 0;
    this.radius = 120;
  }

  spawn(w, x, z, rMin) {
    const n = this.graph.spawnNear(x, z, this.radius, this.rand, rMin);
    if (n < 0) return false;
    const r = this.rand;
    const lateral = (r() - 0.5) * 1.6;
    const fresh = new Walker(this.graph, n, r, { speed: 0.9 + r() * 0.8, lateral });
    fresh.baseLateral = lateral;
    Object.assign(w, { walker: fresh, yaw: null });
    w.walker.place();
    return true;
  }

  colours(slot) {
    const pick = (a) => a[Math.floor(this.rand() * a.length)];
    this.model.setColors(slot, Object.fromEntries(Object.entries(ROLES).map(([k, v]) => [k, pick(v)])));
  }

  /** Number of walkers wanted (quality tier); target: [x, z] Unity metres around which they live. */
  setCount(n, target) {
    n = Math.min(n, this.cap);
    while (this.walkers.length < n) {
      const slot = this.walkers.length;
      const w = { slot, cycle: new WalkCycle(this.fakeParts()), parts: null, walker: null };
      w.parts = w.cycle.parts;
      if (!this.spawn(w, target[0], target[1], 0)) break;
      this.colours(slot);
      this.walkers.push(w);
    }
    this.count = Math.min(n, this.walkers.length);
    this.model.setCount(this.count);
  }

  fakeParts() {
    return { leg_l: { rotation: { x: 0 } }, leg_r: { rotation: { x: 0 } }, arm_l: { rotation: { x: 0 } }, arm_r: { rotation: { x: 0 } } };
  }

  /**
   * dt: real seconds. target: [x, z] Unity metres (camera focus). radius: living area.
   * vehicles: footprints to keep clear (clearVehicles).
   */
  update(dt, target, radius = this.radius, vehicles = []) {
    this.radius = radius;
    const active = this.walkers.slice(0, this.count);
    avoid(active.map((w) => w.walker));
    for (const w of active) {
      const k = w.walker;
      if (Math.hypot(k.x - target[0], k.z - target[1]) > radius * 1.25) {
        this.spawn(w, target[0], target[1], radius * 0.5);
        this.colours(w.slot);
      }
      const travelled = w.walker.step(dt);
      if (vehicles.length) clearVehicles([w.walker], vehicles);
      w.yaw = turnToward(w.yaw, w.walker.yaw, 540 * Math.max(dt, 1 / 60));
      w.cycle.update(travelled, dt > 0 ? travelled / dt : 0);
      const p = w.parts;
      const y = this.ground(w.walker.x, w.walker.z);
      this.model.setPose(w.slot, w.walker.x, y, -w.walker.z, (-w.yaw * Math.PI) / 180,
        { leg_l: p.leg_l.rotation.x, leg_r: p.leg_r.rotation.x, arm_l: p.arm_l.rotation.x, arm_r: p.arm_r.rotation.x });
    }
    this.model.commit();
  }
}
