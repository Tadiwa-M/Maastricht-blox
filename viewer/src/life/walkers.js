// Pedestrians: people on the walk graph around the camera, drawn as smooth toy figures
// (src/figure/: one shared FigureCrowd, ~25 draw calls for everyone).
// A crowd should not look like noise, so people walk in groups (1-4 side by side, the group
// at its slowest member's pace), at their own pace (kids quick, older people slow), and
// sometimes stop to chat or look around. Groups that end up far from the camera target are
// recycled to a busy node near it (spawn weights: walkways.json, boosted by density.js).
import { MODE } from '../figure/rig.js';
import { makeVariant } from '../figure/variants.js';
import { Walker, avoid, rng, turnToward } from './walkgraph.js';
import { crowdFactor as dayCrowd, FIGURES_BY_TIER } from './density.js';

export const WALKERS_BY_TIER = FIGURES_BY_TIER;
/** Share of the crowd out at an hour (weekday curve; density.js has the day-aware one). */
export const crowdFactor = (hours, day = 2) => Math.min(1, dayCrowd(hours, day));

const GROUP_SIZES = [[1, 0.5], [2, 0.34], [3, 0.12], [4, 0.04]];
const SIDE = 0.62; // metres between people walking side by side
const STRIDE = 0.78; // metres per step at scale 1

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
      if (dx * dx + dz * dz > (hl + hw) * (hl + hw)) continue;
      const along = dx * fx + dz * fz, across = dx * fz - dz * fx;
      if (Math.abs(along) > hl || Math.abs(across) > hw) continue;
      const push = (across >= 0 ? hw : -hw) - across;
      w.x += fz * push; w.z -= fx * push;
      moved++;
    }
  }
  return moved;
}

/** Group size from a random number (weights GROUP_SIZES). */
export function groupSize(u) {
  for (const [n, p] of GROUP_SIZES) { if (u < p) return n; u -= p; }
  return 1;
}

/** In the rain a share of the grown-ups walk under an umbrella (instead of their bag). */
function umbrella(m, share) {
  m.v.acc = share > 0 && m.v.kind !== 'kid' && m.u < share ? 'umbrella' : m.v.baseAcc;
}

export class Pedestrians {
  /** graph: WalkGraph. ground(x, z) -> y (Unity metres). cap: most people. */
  constructor({ graph, ground, cap = FIGURES_BY_TIER.high, seed = 7 }) {
    Object.assign(this, { graph, ground, cap });
    this.rand = rng(seed);
    this.groups = [];
    this.people = 0; // people in active groups
    this.count = 0; // = people (old name)
    this.radius = 120;
    this.nextId = 1;
    this.t = 0;
    this.rain = 0;
  }

  /** (Re)place group g on a node near (x, z), at least rMin away; new people each time. */
  spawn(g, x, z, rMin) {
    const n = this.graph.spawnNear(x, z, this.radius, this.rand, rMin);
    if (n < 0) return false;
    const r = this.rand;
    const size = g.size || groupSize(r());
    const members = [];
    let speed = 9;
    const family = size >= 3 && r() < 0.4;
    for (let q = 0; q < size; q++) {
      const kind = family ? (q < 2 ? 'adult' : 'kid') : undefined; // a family: two adults and kids
      const v = makeVariant(this.nextId++ * 31 + 7, kind ? { kind } : {});
      v.baseAcc = v.acc;
      members.push({ v, phase: r() * Math.PI * 2, off: (q - (size - 1) / 2) * SIDE, back: (r() - 0.5) * 0.35, yaw: null, look: 0, u: r() });
      if (this.rain > 0) umbrella(members[members.length - 1], this.rain);
      speed = Math.min(speed, v.speed);
    }
    const lateral = (r() - 0.5) * 1.4;
    const walker = new Walker(this.graph, n, r, { speed, lateral });
    walker.baseLateral = lateral;
    walker.place();
    Object.assign(g, { walker, members, size, pause: 0, nextPause: 15 + r() * 60, chat: r() < 0.6 });
    return true;
  }

  /** Rain: 0 (dry) .. 1 (pouring); share of grown-ups with an umbrella. */
  setRain(rain) {
    const share = Math.max(0, Math.min(1, rain)) * 0.75;
    if (share === this.rain) return;
    this.rain = share;
    for (const g of this.groups) for (const m of g.members || []) umbrella(m, share);
  }

  /** Number of people wanted near target ([x, z] Unity metres). */
  setCount(n, target) {
    n = Math.min(n, this.cap);
    let people = 0, k = 0;
    for (; k < this.groups.length && people < n; k++) people += this.groups[k].size;
    while (people < n) {
      const g = { size: 0 };
      if (!this.spawn(g, target[0], target[1], 0)) break;
      this.groups.push(g);
      people += g.size; k++;
    }
    this.active = k;
    this.people = this.count = people;
  }

  /**
   * dt: real seconds. target: [x, z] Unity metres (camera focus). radius: living area.
   * vehicles: footprints to keep clear (clearVehicles).
   */
  update(dt, target, radius = this.radius, vehicles = []) {
    this.radius = radius;
    this.t += dt;
    this.dt = dt;
    const active = this.groups.slice(0, this.active ?? 0);
    avoid(active.map((g) => g.walker));
    const r = this.rand;
    for (const g of active) {
      const k = g.walker;
      if (Math.hypot(k.x - target[0], k.z - target[1]) > radius * 1.25) this.spawn(g, target[0], target[1], radius * 0.5);
      if (g.pause > 0) {
        g.pause -= dt;
        g.travelled = 0;
        k.place();
      } else {
        g.nextPause -= dt;
        if (g.nextPause <= 0) { // stop for a chat / to look around, then walk on
          g.pause = (g.size > 1 && g.chat ? 4 : 2) + r() * 8;
          g.nextPause = 25 + r() * 70;
        }
        g.travelled = k.step(dt);
      }
      // the whole group stands around its leader: keep the leader that much further clear
      if (vehicles.length) clearVehicles([k], vehicles, g.size > 1 ? 1.9 : 0.9);
    }
  }

  /** Add every visible person to the crowd (FigureCrowd). Ground from this.ground. */
  draw(crowd) {
    const t = this.t;
    for (let q = 0; q < (this.active ?? 0); q++) {
      const g = this.groups[q], k = g.walker;
      const fx = k.dirX ?? 0, fz = k.dirZ ?? 1; // walking direction (Unity x/z)
      const rx = fz, rz = -fx; // right
      const walking = g.pause <= 0;
      for (const m of g.members) {
        const x = k.x + rx * m.off - fx * m.back, z = k.z + rz * m.off - fz * m.back;
        let yaw = k.yaw;
        if (!walking && g.size > 1 && g.chat) yaw = (k.yaw + (m.off < 0 ? 70 : -70) + 360) % 360; // turn to each other
        m.yaw = turnToward(m.yaw, yaw, 400 * Math.max(this.dt || 0, 1 / 60));
        if (walking) m.phase += (g.travelled / (STRIDE * m.v.scale)) * Math.PI;
        crowd.add(m.v, { x, y: this.ground(x, z), z: -z, rotY: (-m.yaw * Math.PI) / 180,
          mode: walking ? MODE.WALK : MODE.IDLE, phase: m.phase, speed: walking ? k.speed * k.slow : 0, t: t + m.phase });
      }
    }
  }

  /** Walker positions (for vehicles clearing, tests). */
  positions() { return this.groups.slice(0, this.active ?? 0).map((g) => g.walker); }
}
