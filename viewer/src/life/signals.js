// Traffic lights and crossings at their real places (OSM nodes snapped to the road graph,
// streets.json `roads.signals` / `roads.crossings`), for everyone who is not a car:
// - where the light poles stand (one per approach, on its right-hand kerb) and the zebra stripes
//   lie (signalsdraw.js draws them),
// - pedestrians: a walker about to step onto the carriageway at a crossing waits for a gap in
//   the traffic (zebra: cars stop for them, traffic.js) or for the green man (signals),
//   and walk routes across a road prefer the crossing (walkBias),
// - bikes stop at red like the cars, and buses and trains hold back (busflow.js lag) for a red
//   light or someone on a zebra (transitGap).
// One city-wide cycle drives it all (traffic.js signalAt). Pure (no three.js), tested in
// test/life.signals.test.mjs. Positions Unity metres (x east, z north), bearings degrees
// clockwise from north.
import { signalAt, signalPhase, CROSSING_M } from './traffic.js';

export const XING = {
  cell: 24, // grid cell (m) of the node and road indexes
  armM: 9, // a crossing reaches this far along each road from its node
  kerbM: 0.7, // light poles stand this far outside the carriageway
  pedGreen: [1, 19], // s into the walking direction's half of the cycle: the green man (cars across have red until 28)
  comfortB: 3, // m/s²: a car that cannot stop this gently for a zebra is let past
  riderLookM: 14, // bikes check lights this far ahead
  biasAt: 6, // a walk edge crossing a road within this of a crossing node uses the crossing ...
  biasNear: 30, // ... one crossing it farther than that, but within this, is a shortcut people avoid
  biasUse: 3, // pickNext weight factors for those two
  biasAvoid: 0.2,
};

/** Half width of the carriageway of road edge e (m). */
export function roadHalf(g, e) {
  return g.twoWay[e] ? g.laneOffset(e) + 1.6 : 2.2;
}

/** Pedestrian light for someone walking `bearing` at time t: 'green' | 'red'. */
export function pedSignal(bearing, t) {
  const k = signalPhase(bearing, t);
  return k >= XING.pedGreen[0] && k < XING.pedGreen[1] ? 'green' : 'red';
}

/** Distance from (px, pz) to segment (ax, az)-(bx, bz). */
function segDist(px, pz, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz;
  const t = L2 > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / L2)) : 0;
  return Math.hypot(px - ax - dx * t, pz - az - dz * t);
}

/** Where segments p0-p1 and q0-q1 cross: [x, z] or null. */
function segCross(p0x, p0z, p1x, p1z, q0x, q0z, q1x, q1z) {
  const rx = p1x - p0x, rz = p1z - p0z, sx = q1x - q0x, sz = q1z - q0z, den = rx * sz - rz * sx;
  if (Math.abs(den) < 1e-9) return null;
  const t = ((q0x - p0x) * sz - (q0z - p0z) * sx) / den, u = ((q0x - p0x) * rz - (q0z - p0z) * rx) / den;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? [p0x + rx * t, p0z + rz * t] : null;
}

/** Is there a walk-graph node within r of (x, z)? Then a footway crosses the road there. */
export function footwayAt(walk, x, z, r = 2.5) {
  const c = walk.cell;
  for (let i = Math.floor((x - r) / c); i <= Math.floor((x + r) / c); i++) {
    for (let j = Math.floor((z - r) / c); j <= Math.floor((z + r) / c); j++) {
      for (const q of walk.buckets.get(walk.key(i, j)) || []) if (Math.hypot(walk.x[q] - x, walk.z[q] - z) < r) return true;
    }
  }
  return false;
}

export class CrossingMap {
  /** g: RoadGraph (traffic.js). footway(x, z) -> does a footway cross the road there (pedestrian lights)? */
  constructor(g, { footway = null } = {}) {
    this.g = g;
    this.footway = footway;
    this.t = 0; // the light clock (s of the day), set every frame
    this.grid = new Map();
    this.arms = new Map(); // node -> [{ ux, uz (unit, away from the node), len, half }]
    for (let n = 0; n < g.x.length; n++) {
      if (!g.signal[n] && !g.crossing[n]) continue;
      const k = this.key(g.x[n], g.z[n]);
      if (!this.grid.has(k)) this.grid.set(k, []);
      this.grid.get(k).push(n);
      const arms = [], seen = new Set();
      const add = (e, other) => {
        if (seen.has(other) || other === n) return;
        seen.add(other);
        const L = g.len[e];
        arms.push({ ux: (g.x[other] - g.x[n]) / L, uz: (g.z[other] - g.z[n]) / L, len: L, half: roadHalf(g, e) });
      };
      for (const e of g.out[n]) add(e, g.to[e]);
      for (const e of g.into[n]) add(e, g.from[e]);
      this.arms.set(n, arms);
    }
  }

  key(x, z) { return Math.floor(x / XING.cell) * 100003 + Math.floor(z / XING.cell); }

  /** Signal and crossing nodes within r of (x, z). */
  near(x, z, r) {
    const out = [], c = XING.cell, g = this.g;
    for (let i = Math.floor((x - r) / c); i <= Math.floor((x + r) / c); i++) {
      for (let j = Math.floor((z - r) / c); j <= Math.floor((z + r) / c); j++) {
        for (const n of this.grid.get(i * 100003 + j) || []) if (Math.hypot(g.x[n] - x, g.z[n] - z) <= r) out.push(n);
      }
    }
    return out;
  }

  /**
   * Is someone at (x, z) about to step onto the carriageway at a crossing (the point (ax, az)
   * ahead of them is on it, they are not)? { n (node), arm } or null.
   */
  kerbStep(x, z, ax, az) {
    const g = this.g;
    const dx = ax - x, dz = az - z, dl = Math.hypot(dx, dz) || 1;
    for (const n of this.near(x, z, XING.armM + 4)) {
      const nx = g.x[n], nz = g.z[n];
      for (const arm of this.arms.get(n)) {
        if (Math.abs((dx * arm.ux + dz * arm.uz) / dl) > 0.75) continue; // walking along the road, not across
        const L = Math.min(arm.len, XING.armM), bx = nx + arm.ux * L, bz = nz + arm.uz * L;
        const back = Math.min(2, arm.len); // the crossing itself reaches a little back over the node
        const cx = nx - arm.ux * back, cz = nz - arm.uz * back;
        if (segDist(ax, az, cx, cz, bx, bz) < arm.half && segDist(x, z, cx, cz, bx, bz) >= arm.half - 0.3) return { n, arm };
      }
    }
    return null;
  }

  /**
   * Should a walker at (x, z) heading `yaw`, looking at (ax, az), wait at the kerb? vehicles:
   * footprints { x, z, yaw, halfW, halfL, v }. -> null (no crossing here) or { n, zebra (it is
   * a crossing without lights: cars stop for people waiting there), wait }.
   */
  crossingHold(x, z, yaw, ax, az, vehicles, t = this.t) {
    const step = this.kerbStep(x, z, ax, az);
    if (!step) return null;
    const g = this.g, n = step.n;
    if (g.signal[n]) return { n, zebra: false, wait: pedSignal(yaw, t) !== 'green' };
    // a zebra: wait for a gap (a vehicle that cannot stop gently any more), then step on
    for (const f of vehicles) {
      if (!(f.v > 0.5)) continue; // standing still: it waits (the usual kerb check sees the ones in the way)
      const r = (f.yaw * Math.PI) / 180, fx = Math.sin(r), fz = Math.cos(r);
      const dx = g.x[n] - f.x, dz = g.z[n] - f.z;
      const ahead = dx * fx + dz * fz - f.halfL, across = Math.abs(dx * fz - dz * fx);
      if (ahead < -f.halfL - CROSSING_M || ahead > 40 || across > step.arm.half + 1.5) continue;
      if (ahead < (f.v * f.v) / (2 * XING.comfortB) + CROSSING_M + 1) return { n, zebra: true, wait: true };
    }
    return { n, zebra: true, wait: false };
  }

  /**
   * How much of its speed a bike keeps for the lights ahead (0 = stop at the line, 1 = ride on).
   * (x, z) position, (dx, dz) unit direction, yaw its heading, v speed (m/s).
   */
  riderSlow(x, z, dx, dz, yaw, v, t = this.t) {
    const g = this.g;
    let slow = 1;
    for (const n of this.near(x, z, XING.riderLookM)) {
      if (!g.signal[n]) continue;
      const ox = g.x[n] - x, oz = g.z[n] - z, along = ox * dx + oz * dz;
      if (along <= 0 || Math.abs(ox * dz - oz * dx) > 5) continue; // behind, or not on its way
      const toLine = along - g.boxR[n] - 0.8;
      if (toLine < -0.5) continue; // already over the line: ride on
      const st = signalAt(yaw, t);
      if (st === 'green' || (st === 'amber' && toLine < (v * v) / (2 * XING.comfortB))) continue;
      slow = Math.min(slow, Math.max(0, Math.min(1, toLine / 4)));
    }
    return slow;
  }

  /**
   * A bus or train's stop line ahead: metres from its front to where it must stand (a red
   * light; someone on or waiting at a zebra), Infinity if none. b: { x, z, yaw, v, vt?, halfL };
   * ahead: [{ x, z, a }] its path ahead of its front (buses.js ahead()); people: [{ x, z, zebra? }].
   */
  transitGap(b, ahead, people = [], t = this.t) {
    if (!ahead.length) return Infinity;
    const g = this.g, last = ahead[ahead.length - 1].a;
    let gap = Infinity;
    for (const n of this.near(b.x, b.z, last + b.halfL + 8)) {
      let R;
      if (g.signal[n]) {
        const st = signalAt(b.yaw, t);
        if (st === 'green') continue;
        R = g.boxR[n] - 0.5;
        if (st === 'amber') {
          const d = this.firstWithin(ahead, n, R), v = b.vt ?? b.v;
          if (d === null || d < (v * v) / (2 * XING.comfortB)) continue;
        }
      } else {
        const nx = g.x[n], nz = g.z[n];
        if (!people.some((p) => p.zebra === n || (Math.abs(p.x - nx) < CROSSING_M && Math.abs(p.z - nz) < CROSSING_M))) continue;
        R = CROSSING_M;
      }
      const d = this.firstWithin(ahead, n, R);
      if (d !== null && d > 0) gap = Math.min(gap, d); // (d = 0: its front is over the line already: on)
    }
    return gap;
  }

  /** Metres ahead (p.a) of the first path point within R of node n, or null. */
  firstWithin(ahead, n, R) {
    const nx = this.g.x[n], nz = this.g.z[n];
    for (const p of ahead) if (Math.hypot(p.x - nx, p.z - nz) < R) return p.a;
    return null;
  }

  /**
   * Light heads: one per approach to every signal node, on the pole at its right-hand kerb just
   * before the node: [{ n, e (the approach), x, z, yaw (the way the lamps face: towards the
   * traffic), ped (a pedestrian head on the same pole, facing across the road) }].
   */
  heads() {
    const g = this.g, out = [];
    for (const [n] of this.arms) {
      if (!g.signal[n]) continue;
      const ped = this.footway ? this.footway(g.x[n], g.z[n]) : false;
      for (const e of g.into[n]) {
        const L = g.len[e], ux = (g.x[n] - g.x[g.from[e]]) / L, uz = (g.z[n] - g.z[g.from[e]]) / L;
        const back = Math.min(g.boxR[n] - 0.5, L * 0.45), off = roadHalf(g, e) + XING.kerbM;
        const x = g.x[n] - ux * back + uz * off, z = g.z[n] - uz * back - ux * off; // right of travel: (uz, -ux)
        if (out.some((h) => Math.abs(h.x - x) < 1.5 && Math.abs(h.z - z) < 1.5)) continue;
        out.push({ n, e, x, z, yaw: (g.bearing(e) + 180) % 360, ped });
      }
    }
    return out;
  }

  /**
   * Zebra stripes at crossings without lights (not at junctions: there the stripes would lie in
   * the middle): [{ x, z, yaw (the road's direction: stripes run along it), w, len }].
   */
  zebras() {
    const g = this.g, out = [];
    for (const [n, arms] of this.arms) {
      if (g.signal[n] || !arms.length || arms.length > 2) continue;
      const a = arms[0];
      let ux = a.ux, uz = a.uz;
      if (arms.length === 2) { ux = a.ux - arms[1].ux; uz = a.uz - arms[1].uz; const l = Math.hypot(ux, uz) || 1; ux /= l; uz /= l; }
      const half = Math.max(...arms.map((m) => m.half)), yaw = ((Math.atan2(ux, uz) * 180) / Math.PI + 360) % 360;
      const count = Math.max(2, Math.floor((2 * half) / 1.0));
      for (let q = 0; q < count; q++) {
        const o = -half + 0.5 + q * ((2 * half - 1) / Math.max(1, count - 1)); // across the road (right = (uz, -ux))
        out.push({ x: g.x[n] + uz * o, z: g.z[n] - ux * o, yaw, w: 0.5, len: 4 }); // Dutch zebra: 0.5 m stripes, 4 m long
      }
    }
    return out;
  }
}

/**
 * Walk-graph pickNext weights (walkgraph.js `bias`): a walk edge across a road at a crossing is
 * favoured, one across a road near (but not at) a crossing is avoided, so people use the
 * crossing. walk: WalkGraph; map: CrossingMap. -> (cur, next) => factor (cached).
 */
export function walkBias(walk, map) {
  const g = map.g, cache = new Map();
  let roads = null; // grid of road segments (built on first use)
  const build = () => {
    roads = new Map();
    for (let e = 0; e < g.count; e++) {
      const a = g.from[e], b = g.to[e];
      if (g.twoWay[e] && a > b) continue; // a two-way road once
      const i0 = Math.floor(Math.min(g.x[a], g.x[b]) / XING.cell), i1 = Math.floor(Math.max(g.x[a], g.x[b]) / XING.cell);
      const j0 = Math.floor(Math.min(g.z[a], g.z[b]) / XING.cell), j1 = Math.floor(Math.max(g.z[a], g.z[b]) / XING.cell);
      for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
        const k = i * 100003 + j;
        if (!roads.has(k)) roads.set(k, []);
        roads.get(k).push(e);
      }
    }
  };
  return (cur, m) => {
    const key = cur * walk.count + m;
    let f = cache.get(key);
    if (f !== undefined) return f;
    if (!roads) build();
    const x0 = walk.x[cur], z0 = walk.z[cur], x1 = walk.x[m], z1 = walk.z[m];
    f = 1;
    const seen = new Set();
    for (let i = Math.floor(Math.min(x0, x1) / XING.cell); i <= Math.floor(Math.max(x0, x1) / XING.cell) && f === 1; i++) {
      for (let j = Math.floor(Math.min(z0, z1) / XING.cell); j <= Math.floor(Math.max(z0, z1) / XING.cell) && f === 1; j++) {
        for (const e of roads.get(i * 100003 + j) || []) {
          if (seen.has(e)) continue;
          seen.add(e);
          const a = g.from[e], b = g.to[e];
          const p = segCross(x0, z0, x1, z1, g.x[a], g.z[a], g.x[b], g.z[b]);
          if (!p) continue;
          let d = Infinity;
          for (const n of map.near(p[0], p[1], XING.biasNear)) d = Math.min(d, Math.hypot(g.x[n] - p[0], g.z[n] - p[1]));
          f = d < XING.biasAt ? XING.biasUse : d < XING.biasNear ? XING.biasAvoid : 1;
          break;
        }
      }
    }
    cache.set(key, f);
    return f;
  };
}
