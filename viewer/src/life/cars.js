// Cars and vans driving the road graph near the camera (traffic.js does the driving). They
// spawn on roads within the living radius, weighted by road class (main roads busiest), are
// recycled when they drift far away or reach a dead end at the edge of the export, and are
// drawn as smooth toy cars (src/figure/vehicles.js) in a few instanced draw calls. Now and then
// one of them is the police car (police.js): it patrols like the others and rarely drives with
// its lights on.
import { RoadGraph, stepTraffic, carPose, CLASS_WEIGHT, CLASS_SPEED } from './traffic.js';
import { CAR_TYPES, CAR_WHEEL_R } from '../figure/vehicles.js';
import { rng } from './walkgraph.js';
import { nextPatrolIn, sirenStep, switchOn, beacons, POLICE } from './police.js';

// common car colours (palette hex where one fits; movers may use non-palette colours)
const COLOURS = ['#F2F0EA', '#F2F0EA', '#1E1F21', '#1E1F21', '#5C6062', '#A7AAA8', '#A7AAA8', '#22385A', '#A33A2B', '#6E8798', '#2F5A3C', '#C8102E', '#5B8DB8', '#8F7A57'];
const TYPES = [['hatch', 0.45], ['saloon', 0.35], ['van', 0.2]];

export class Cars {
  /** doc: streets.json roads. ground(x, z) -> y. */
  constructor({ doc, ground, cap = 160, seed = 23 }) {
    this.g = new RoadGraph(doc);
    Object.assign(this, { ground, cap });
    this.rand = rng(seed);
    this.cars = [];
    this.count = 0;
    this.radius = 200;
    this.nextId = 1;
    this.time = 0;
    this.patrolIn = nextPatrolIn(this.rand); // s until the police car turns up (none about)
  }

  /** The police car, if one is about. */
  get police() { return this.cars.slice(0, this.count).find((c) => c.police && !c.gone) || null; }

  /** A random directed edge with a point within [rMin, rMax] of (x, z), class-weighted; -1 if none. */
  pickEdge(x, z, rMax, rMin = 0) {
    const g = this.g;
    let tot = 0;
    const cand = [];
    for (let e = 0; e < g.count; e++) {
      const a = g.from[e], d = Math.hypot(g.x[a] - x, g.z[a] - z);
      if (d > rMax || d < rMin) continue;
      const w = (CLASS_WEIGHT[g.cls[e]] || 1) * g.len[e];
      cand.push([e, w]); tot += w;
    }
    if (!cand.length) return rMin > 0 ? this.pickEdge(x, z, rMax, 0) : -1;
    let r = this.rand() * tot;
    for (const [e, w] of cand) { r -= w; if (r <= 0) return e; }
    return cand[cand.length - 1][0];
  }

  spawn(c, x, z, rMin, police = false) {
    const e = this.pickEdge(x, z, police ? this.radius * 0.5 : this.radius, rMin);
    if (e < 0) return false;
    const r = this.rand;
    let u = r(), type = 'hatch';
    for (const [t, p] of TYPES) { if (u < p) { type = t; break; } u -= p; }
    if (police) type = 'police';
    const s = r() * this.g.len[e];
    // keep clear of cars already on that edge, and of any car near that spot
    for (const o of this.cars) if (o !== c && !o.gone && o.e === e && Math.abs(o.s - s) < 10) return false;
    const p = carPose(this.g, { e, s, next: -1 });
    for (const o of this.cars.slice(0, this.count)) {
      if (o === c || o.gone) continue;
      const q = carPose(this.g, o);
      if (Math.abs(q.x - p.x) < 7 && Math.abs(q.z - p.z) < 7) return false;
    }
    // (rule state from a previous life is reset: commits, waiting, pulling over, lights)
    Object.assign(c, { e, s, v: (CLASS_SPEED[this.g.cls[e]] || 8) * 0.6, next: undefined, next2: undefined, prev: -1, gone: false,
      type, len: CAR_TYPES[type].L, mood: 0.85 + r() * 0.25, colour: police ? '#F4F4F2' : COLOURS[Math.floor(r() * COLOURS.length)], dist: 0, id: this.nextId++,
      commits: [], wait: 0, goNode: undefined, yieldNode: undefined, yielding: false, waitingFor: null, lat: 0, latWant: 0,
      police, siren: false, sirenT: 0 });
    if (police && r() < POLICE.sirenOnSpawn) switchOn(c, r);
    return true;
  }

  /** Respawn car c near target; the police car's turn when it is due. */
  respawn(c, target, rMin) {
    const due = this.patrolIn <= 0 && !this.police;
    if (this.spawn(c, target[0], target[1], rMin, due)) {
      if (due) this.patrolIn = nextPatrolIn(this.rand);
      return true;
    }
    return false;
  }

  /** Cars wanted near target ([x, z] Unity metres). */
  setCount(n, target) {
    n = Math.min(n, this.cap);
    let guard = 0;
    while (this.cars.length < n && guard++ < n * 3) {
      const c = {};
      if (this.spawn(c, target[0], target[1], 0)) this.cars.push(c);
    }
    this.count = Math.min(n, this.cars.length);
  }

  /** env: traffic-rule inputs for stepTraffic ({ t, people, obstacles, vehicles }). */
  update(dt, target, radius = this.radius, env = {}) {
    this.radius = radius;
    this.time += dt;
    const active = this.cars.slice(0, this.count);
    stepTraffic(this.g, active, dt, this.rand, env);
    if (!this.police) this.patrolIn -= dt;
    let due = this.patrolIn <= 0 && !this.police;
    for (const c of active) {
      if (c.police && !c.gone) sirenStep(c, dt, this.rand);
      const a = this.g.from[c.e];
      if (c.gone || Math.hypot(this.g.x[a] - target[0], this.g.z[a] - target[1]) > radius * 1.3) {
        // the police car turns up close to the camera (rMin 0, within half the radius)
        if (!this.respawn(c, target, due ? 0 : radius * 0.55)) c.gone = true;
        due = this.patrolIn <= 0 && !this.police;
      }
    }
    // nobody is being recycled (a quiet view): swap the farthest ordinary car for the police car
    if (due && active.length) {
      let far = null, fd = -1;
      for (const c of active) {
        const p = carPose(this.g, c), d = Math.hypot(p.x - target[0], p.z - target[1]);
        if (!c.police && d > fd) { fd = d; far = c; }
      }
      if (far && fd > radius * 0.6) this.respawn(far, target, 0);
    }
  }

  /** Poses [{ x, z, yaw, halfW, halfL }] of the active cars (Unity metres) for walkers to step aside. */
  footprints(near = null, max = 40) {
    const out = [];
    for (const c of this.cars.slice(0, this.count)) {
      if (c.gone) continue;
      const p = carPose(this.g, c);
      if (near && Math.hypot(p.x - near[0], p.z - near[1]) > 80) continue;
      out.push({ x: p.x, z: p.z, yaw: p.yaw, halfW: CAR_TYPES[c.type].W / 2, halfL: c.len / 2, v: c.v });
      if (out.length >= max) break;
    }
    return out;
  }

  /** Add the cars to a VehicleFleet. */
  draw(fleet) {
    for (const c of this.cars.slice(0, this.count)) {
      if (c.gone) continue;
      const p = carPose(this.g, c);
      fleet.addCar(c.type, p.x, this.ground(p.x, p.z), -p.z, (-p.yaw * Math.PI) / 180, { colour: c.colour, spin: -c.dist / CAR_WHEEL_R,
        beacons: c.police ? beacons(c.siren, this.time) : null });
    }
  }
}
