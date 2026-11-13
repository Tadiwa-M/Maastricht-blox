// Pedestrian walk graph (life/walkways.json) and the walker's motion on it. Pure logic
// (no three.js), tested in test/life.walkers.test.mjs.
//
// Walkers do a random walk: at each node they pick a neighbour, weighted by the node's spawn
// weight (busy streets attract) and by going straight on (no zig-zag across squares); back
// only at dead ends. Corners are rounded with a quadratic curve through the node (radius
// CORNER_M) so heading changes smoothly; a lateral offset spreads people across the way.

export const CORNER_M = 1.2;

/** Deterministic random numbers (mulberry32) so tests and screenshots repeat. */
export function rng(seed = 1) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class WalkGraph {
  /** doc: { nodes: [x, z, ...] Unity metres, weights: [...], edges: [a, b, ...] }. */
  constructor(doc, { cell = 32 } = {}) {
    const n = doc.nodes.length / 2;
    this.count = n;
    this.x = new Float32Array(n); this.z = new Float32Array(n);
    for (let q = 0; q < n; q++) { this.x[q] = doc.nodes[2 * q]; this.z[q] = doc.nodes[2 * q + 1]; }
    this.w = Float32Array.from({ length: n }, (_, q) => doc.weights?.[q] ?? 1);
    this.base = this.w.slice(); // export weights; this.w may be boosted for the moment (density.js liveWeights)
    const deg = new Uint32Array(n + 1);
    for (let q = 0; q < doc.edges.length; q++) deg[doc.edges[q] + 1]++;
    for (let q = 0; q < n; q++) deg[q + 1] += deg[q];
    this.off = deg.slice();
    this.adj = new Int32Array(doc.edges.length);
    const fill = deg.slice();
    for (let q = 0; q < doc.edges.length; q += 2) {
      const a = doc.edges[q], b = doc.edges[q + 1];
      this.adj[fill[a]++] = b; this.adj[fill[b]++] = a;
    }
    this.cell = cell;
    this.buckets = new Map();
    for (let q = 0; q < n; q++) {
      if (this.off[q + 1] === this.off[q]) continue; // isolated: never spawn there
      const k = this.key(Math.floor(this.x[q] / cell), Math.floor(this.z[q] / cell));
      if (!this.buckets.has(k)) this.buckets.set(k, []);
      this.buckets.get(k).push(q);
    }
  }

  key(i, j) { return i * 100003 + j; }
  neighbours(q) { return this.adj.subarray(this.off[q], this.off[q + 1]); }
  dist(a, b) { return Math.hypot(this.x[b] - this.x[a], this.z[b] - this.z[a]); }

  /**
   * Next node after walking prev -> cur. prev < 0: any neighbour. goal { x, z } (optional):
   * neighbours towards it are favoured (a group heading somewhere; routines.js).
   */
  pickNext(prev, cur, rand, goal = null) {
    const nb = this.neighbours(cur);
    if (nb.length === 0) return prev >= 0 ? prev : cur;
    let dx = 0, dz = 0;
    if (prev >= 0) { const L = this.dist(prev, cur) || 1; dx = (this.x[cur] - this.x[prev]) / L; dz = (this.z[cur] - this.z[prev]) / L; }
    let gx = 0, gz = 0;
    if (goal) { const L = Math.hypot(goal.x - this.x[cur], goal.z - this.z[cur]) || 1; gx = (goal.x - this.x[cur]) / L; gz = (goal.z - this.z[cur]) / L; }
    let total = 0;
    const ws = new Float64Array(nb.length);
    for (let q = 0; q < nb.length; q++) {
      const m = nb[q];
      if (m === prev && nb.length > 1) continue;
      const L = this.dist(cur, m) || 1;
      const cos = prev >= 0 ? ((this.x[m] - this.x[cur]) * dx + (this.z[m] - this.z[cur]) * dz) / L : 0;
      ws[q] = Math.sqrt(this.w[m]) * (0.25 + 2 * Math.max(0, cos) ** 2);
      if (goal) ws[q] *= 0.3 + 2 * Math.max(0, ((this.x[m] - this.x[cur]) * gx + (this.z[m] - this.z[cur]) * gz) / L) ** 2;
      total += ws[q];
    }
    let r = rand() * total;
    for (let q = 0; q < nb.length; q++) { r -= ws[q]; if (ws[q] > 0 && r <= 0) return nb[q]; }
    return nb[nb.length - 1];
  }

  /** Weighted random node with rMin <= distance <= rMax from (x, z), or -1. */
  spawnNear(x, z, rMax, rand, rMin = 0) {
    const c = this.cell, cand = [];
    let total = 0;
    for (let i = Math.floor((x - rMax) / c); i <= Math.floor((x + rMax) / c); i++) {
      for (let j = Math.floor((z - rMax) / c); j <= Math.floor((z + rMax) / c); j++) {
        for (const q of this.buckets.get(this.key(i, j)) || []) {
          const d = Math.hypot(this.x[q] - x, this.z[q] - z);
          if (d > rMax || d < rMin) continue;
          cand.push(q); total += this.w[q];
        }
      }
    }
    if (!cand.length) return rMin > 0 ? this.spawnNear(x, z, rMax, rand, 0) : -1;
    let r = rand() * total;
    for (const q of cand) { r -= this.w[q]; if (r <= 0) return q; }
    return cand[cand.length - 1];
  }
}

const PACE_UP = 1.8, PACE_DOWN = 6; // 1/s: walking pace reached in ~0.55 s, a stop takes ~0.17 s

const bez = (p0, p1, p2, u) => (1 - u) * (1 - u) * p0 + 2 * u * (1 - u) * p1 + u * u * p2;
const bezD = (p0, p1, p2, u) => 2 * (1 - u) * (p1 - p0) + 2 * u * (p2 - p1);

/** One walker on the graph: edge a -> b at distance s, prev node p, next node c. */
export class Walker {
  constructor(graph, start, rand, { speed = 1.3, lateral = 0, corner = CORNER_M, ease = false } = {}) {
    Object.assign(this, { g: graph, rand, speed, lateral, lateralGoal: lateral, slow: 1, corner });
    // ease: people don't change pace in one frame. pace (0..1) follows slow with a limited rate
    // (quicker to brake than to set off); without it (bikes) pace is slow itself.
    this.ease = ease; this.pace = ease ? 0 : 1;
    this.p = -1;
    this.a = start;
    this.b = graph.pickNext(-1, start, rand);
    this.c = graph.pickNext(this.a, this.b, rand);
    this.s = rand() * graph.dist(this.a, this.b);
    this.x = 0; this.z = 0; this.yaw = 0; this.heading = null;
    this.goal = null; // { x, z } a place the walker is heading for (set by Pedestrians)
  }

  cornerR(a, b, c) {
    if (a < 0 || c < 0 || a === c) return 0;
    return Math.min(this.corner, this.g.dist(a, b) / 2, this.g.dist(b, c) / 2);
  }

  /** Advance dt seconds. Returns metres travelled. */
  step(dt) {
    // (someone right in front, slow <= 0.15: an emergency stop, a few frames)
    if (this.ease) this.pace += Math.max(-(this.slow <= 0.15 ? 3 * PACE_DOWN : PACE_DOWN) * dt, Math.min(PACE_UP * dt, this.slow - this.pace));
    else this.pace = this.slow;
    const g = this.g, move = this.speed * this.pace * dt;
    this.s += move;
    let L = g.dist(this.a, this.b);
    let guard = 0;
    while (this.s >= L && guard++ < 64) {
      this.s -= L;
      this.p = this.a; this.a = this.b; this.b = this.c;
      this.c = g.pickNext(this.a, this.b, this.rand, this.goal);
      L = g.dist(this.a, this.b);
      if (L === 0) { this.s = 0; break; }
    }
    if (!this.stopped) this.lateral += (this.lateralGoal - this.lateral) * Math.min(1, dt * 1.5); // (standing people don't slide)
    this.place();
    return move;
  }

  /**
   * Turn round on the spot: walk the current edge back the way it came. The lateral offset is
   * mirrored so the walker stays where it is (it is measured to the right of the heading).
   */
  reverse() {
    const g = this.g, L = g.dist(this.a, this.b);
    const back = this.p >= 0 && this.p !== this.b ? this.p : g.pickNext(this.b, this.a, this.rand, this.goal);
    [this.p, this.a, this.b, this.c] = [this.c, this.b, this.a, back];
    this.s = Math.max(0, L - this.s);
    this.lateral = -this.lateral; this.lateralGoal = -this.lateralGoal;
    if (this.baseLateral !== undefined) this.baseLateral = -this.baseLateral;
    this.place();
  }

  /** Position (x, z) and heading (yaw degrees clockwise from north) from the edge state. */
  place() {
    const g = this.g, { p, a, b, c, s } = this;
    const L = g.dist(a, b) || 1e-6;
    const rA = this.cornerR(p, a, b), rB = this.cornerR(a, b, c);
    const X = g.x, Z = g.z;
    let x, z, tx, tz;
    const onEdge = (u, v, d) => { const l = g.dist(u, v) || 1e-6; return [X[u] + (X[v] - X[u]) * d / l, Z[u] + (Z[v] - Z[u]) * d / l]; };
    if (rA > 0 && s < rA) { // second half of the corner at a
      const [x0, z0] = onEdge(a, p, rA), [x2, z2] = onEdge(a, b, rA), u = 0.5 + s / (2 * rA);
      x = bez(x0, X[a], x2, u); z = bez(z0, Z[a], z2, u); tx = bezD(x0, X[a], x2, u); tz = bezD(z0, Z[a], z2, u);
    } else if (rB > 0 && s > L - rB) { // first half of the corner at b
      const [x0, z0] = onEdge(b, a, rB), [x2, z2] = onEdge(b, c, rB), u = (s - (L - rB)) / (2 * rB);
      x = bez(x0, X[b], x2, u); z = bez(z0, Z[b], z2, u); tx = bezD(x0, X[b], x2, u); tz = bezD(z0, Z[b], z2, u);
    } else {
      x = X[a] + (X[b] - X[a]) * s / L; z = Z[a] + (Z[b] - Z[a]) * s / L; tx = X[b] - X[a]; tz = Z[b] - Z[a];
    }
    const tl = Math.hypot(tx, tz) || 1;
    // lateral offset to the right of the walking direction (right of +z north is +x east)
    this.x = x + (tz / tl) * this.lateral;
    this.z = z - (tx / tl) * this.lateral;
    this.dirX = tx / tl; this.dirZ = tz / tl;
    this.yaw = ((Math.atan2(tx, tz) * 180) / Math.PI + 360) % 360;
  }
}

/** Turn `from` toward `to` (degrees) by at most maxDeg, the short way. */
export function turnToward(from, to, maxDeg) {
  if (from === null || from === undefined) return to;
  const d = ((to - from + 540) % 360) - 180;
  return (from + Math.max(-maxDeg, Math.min(maxDeg, d)) + 360) % 360;
}

/**
 * Loose avoidance: walkers closer than `radius` slow down behind someone going the same way
 * and step aside (to the right) for oncoming ones. Uses a uniform grid; O(n).
 */
export function avoid(walkers, radius = 1.1) {
  // w.hw: half the width of what walks there (a group side by side) beyond one person
  const wide = walkers.reduce((m, w) => Math.max(m, w.hw || 0), 0);
  const cell = radius + 2 * wide, grid = new Map();
  const k = (i, j) => i * 73856093 ^ j * 19349663;
  for (const w of walkers) {
    w.slow = 1;
    const key = k(Math.floor(w.x / cell), Math.floor(w.z / cell));
    if (!grid.has(key)) grid.set(key, []);
    grid.get(key).push(w);
  }
  for (const w of walkers) {
    const i0 = Math.floor(w.x / cell), j0 = Math.floor(w.z / cell);
    let side = 0;
    for (let i = i0 - 1; i <= i0 + 1; i++) for (let j = j0 - 1; j <= j0 + 1; j++) {
      for (const o of grid.get(k(i, j)) || []) {
        if (o === w) continue;
        const dx = o.x - w.x, dz = o.z - w.z, d = Math.hypot(dx, dz), R = radius + (w.hw || 0) + (o.hw || 0);
        if (d > R || d === 0) continue;
        const ahead = (dx * w.dirX + dz * w.dirZ) / d;
        if (ahead < 0.3) continue;
        if (o.stopped) { // people standing (a chat, waiting at the kerb): walk round them, don't through
          side = 1;
          w.slow = Math.min(w.slow, Math.max(0, (d - 0.6) / R));
          continue;
        }
        const same = o.dirX * w.dirX + o.dirZ * w.dirZ;
        if (same > 0.5) w.slow = Math.min(w.slow, Math.max(d < R * 0.55 ? 0 : 0.3, d / R * Math.min(1, o.speed / w.speed)));
        else side = 1;
      }
    }
    w.lateralGoal = side ? Math.min(2.5, (w.baseLateral ?? 0) + 0.9 + (w.hw || 0)) : w.baseLateral ?? w.lateralGoal;
  }
}

/** How pedestrians read each other (steer()). Metres, seconds. */
export const STEER = {
  ahead: 6, // an oncoming or standing group is noticed this far ahead
  ramp: 1.5, // m over which the reaction builds up once noticed (no step in the path)
  pass: 1.0, // clear gap between two people passing (centre to centre, before group widths)
  near: 1.5, // closer than this behind someone going the same way: match their pace
  overtake: 2.6, // a slower group this close ahead is passed
  maxShift: 2.2, // most a group moves off its line for others
  maxLateral: 2.5,
};

/**
 * Anticipatory avoidance for people: each walker looks STEER.ahead metres down its line and
 * starts easing sideways as soon as someone is on a collision course, instead of side-stepping
 * at arm's length. Oncoming groups each give half the room and pass on the side they are already
 * on (dead ahead: both keep right, as people do); standing groups are walked round on the nearer
 * side; someone slower in front is overtaken on the free side, or followed at their pace when
 * close. The shift grows as the other comes nearer, so the path is one smooth curve. Sets
 * w.lateralGoal and w.slow (Walker eases both). O(n) with a grid; separate() still guarantees
 * personal space afterwards.
 */
export function steer(walkers, o = STEER) {
  const wide = walkers.reduce((m, w) => Math.max(m, w.hw || 0), 0);
  const cell = o.ahead + 2 * wide, grid = new Map();
  const k = (i, j) => i * 73856093 ^ j * 19349663;
  for (const w of walkers) {
    w.slow = 1;
    // where the walker would be without giving way (its own line): reading each other's lines, not
    // the places already moved to, keeps the answer steady while they pass (no wavering)
    const off = w.stopped ? 0 : (w.lateral ?? 0) - (w.baseLateral ?? w.lateral ?? 0);
    w.lx = w.x - (w.dirZ ?? 1) * off; w.lz = w.z + (w.dirX ?? 0) * off;
    const key = k(Math.floor(w.x / cell), Math.floor(w.z / cell));
    if (!grid.has(key)) grid.set(key, []);
    grid.get(key).push(w);
  }
  for (const w of walkers) {
    const i0 = Math.floor(w.x / cell), j0 = Math.floor(w.z / cell), fx = w.dirX ?? 0, fz = w.dirZ ?? 1;
    let shift = 0, urgent = 0;
    for (let i = i0 - 1; i <= i0 + 1; i++) for (let j = j0 - 1; j <= j0 + 1; j++) {
      for (const p of grid.get(k(i, j)) || []) {
        if (p === w) continue;
        const dx = p.x - w.x, dz = p.z - w.z;
        const ahead = dx * fx + dz * fz;
        if (ahead < 0.2 || ahead > o.ahead) continue;
        const side = (p.lx - w.lx) * fz - (p.lz - w.lz) * fx; // + : the other's line is to my right
        const need = o.pass + (w.hw || 0) + (p.hw || 0), miss = Math.abs(side);
        if (miss >= need) continue;
        const same = (p.dirX ?? 0) * fx + (p.dirZ ?? 1) * fz, d = Math.hypot(dx, dz);
        const R = o.near + (w.hw || 0) + (p.hw || 0);
        let want = 0, weight = 0;
        if (p.stopped) { // standing: all the room is mine to make, round the nearer side
          want = (side > 0 ? -1 : 1) * (need - miss + 0.1);
          weight = Math.min(1, (o.ahead - ahead) / o.ramp);
          if (d < R) w.slow = Math.min(w.slow, Math.max(0, (d - 0.7) / R));
        } else if (same < -0.3) { // oncoming: half each, on the side we are already on; dead ahead: keep right
          want = (miss < 0.12 ? 1 : side > 0 ? -1 : 1) * ((need - miss) / 2 + 0.1);
          weight = Math.min(1, (o.ahead - ahead) / o.ramp);
        } else if (same > 0.5) { // same way: pass someone slower, else fall in behind at their pace
          const slower = (p.speed ?? 1) < (w.speed ?? 1) - 0.12;
          if (slower && ahead < o.overtake + (w.hw || 0) + (p.hw || 0)) { want = (side > 0 ? -1 : 1) * (need - miss + 0.1); weight = 1; }
          if (d < R) w.slow = Math.min(w.slow, Math.max(d < R * 0.5 ? 0 : 0.3, (d / R) * Math.min(1, (p.speed ?? 1) / (w.speed || 1))));
        } else if (d < R) { // crossing close: ease off and pass behind them
          w.slow = Math.min(w.slow, 0.55);
          want = (side > 0 ? -1 : 1) * 0.6; weight = 0.9;
        }
        const rank = weight / ahead; // the nearest claim on my path decides
        if (rank > urgent && want) { urgent = rank; shift = want * weight; }
      }
    }
    const base = w.baseLateral ?? 0;
    shift = Math.max(-o.maxShift, Math.min(o.maxShift, shift));
    w.shift = shift; // (Pedestrians checks the room for it: never into a wall)
    w.lateralGoal = Math.max(-o.maxLateral, Math.min(o.maxLateral, base + shift));
  }
}

/**
 * Personal space: groups (a disc of radius `body` + their half width w.hw) that overlap step
 * apart sideways (their lateral offset, which eases back afterwards), and a walker with someone
 * right in front slows nearly to a stop. Run after avoid(); O(n) with a grid.
 */
export function separate(walkers, body = 0.3, maxLateral = 3) {
  const wide = walkers.reduce((m, w) => Math.max(m, w.hw || 0), 0);
  const cell = 2 * (body + wide) || 1, grid = new Map(), key = (i, j) => i * 73856093 ^ j * 19349663;
  for (const w of walkers) {
    const k = key(Math.floor(w.x / cell), Math.floor(w.z / cell));
    if (!grid.has(k)) grid.set(k, []);
    grid.get(k).push(w);
  }
  const seen = new Set();
  for (const w of walkers) {
    const i0 = Math.floor(w.x / cell), j0 = Math.floor(w.z / cell);
    seen.add(w);
    for (let i = i0 - 1; i <= i0 + 1; i++) for (let j = j0 - 1; j <= j0 + 1; j++) {
      for (const o of grid.get(key(i, j)) || []) {
        if (seen.has(o)) continue;
        const dx = o.x - w.x, dz = o.z - w.z, d = Math.hypot(dx, dz) || 1e-3, R = 2 * body + (w.hw || 0) + (o.hw || 0);
        if (d >= R) continue;
        const nx = dx / d, nz = dz / d, push = (R - d) / 2;
        for (const [a, s] of [[w, -1], [o, 1]]) {
          const fx = a.dirX ?? 0, fz = a.dirZ ?? 1;
          a.lateral = Math.max(-maxLateral, Math.min(maxLateral, a.lateral + s * (nx * fz - nz * fx) * push));
          if (s * (nx * fx + nz * fz) < -0.5 && !a.stopped) a.slow = Math.min(a.slow ?? 1, 0.15); // someone right in front
        }
      }
    }
  }
}
