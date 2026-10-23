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

  /** Next node after walking prev -> cur. prev < 0: any neighbour. */
  pickNext(prev, cur, rand) {
    const nb = this.neighbours(cur);
    if (nb.length === 0) return prev >= 0 ? prev : cur;
    let dx = 0, dz = 0;
    if (prev >= 0) { const L = this.dist(prev, cur) || 1; dx = (this.x[cur] - this.x[prev]) / L; dz = (this.z[cur] - this.z[prev]) / L; }
    let total = 0;
    const ws = new Float64Array(nb.length);
    for (let q = 0; q < nb.length; q++) {
      const m = nb[q];
      if (m === prev && nb.length > 1) continue;
      const L = this.dist(cur, m) || 1;
      const cos = prev >= 0 ? ((this.x[m] - this.x[cur]) * dx + (this.z[m] - this.z[cur]) * dz) / L : 0;
      ws[q] = Math.sqrt(this.w[m]) * (0.25 + 2 * Math.max(0, cos) ** 2);
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

const bez = (p0, p1, p2, u) => (1 - u) * (1 - u) * p0 + 2 * u * (1 - u) * p1 + u * u * p2;
const bezD = (p0, p1, p2, u) => 2 * (1 - u) * (p1 - p0) + 2 * u * (p2 - p1);

/** One walker on the graph: edge a -> b at distance s, prev node p, next node c. */
export class Walker {
  constructor(graph, start, rand, { speed = 1.3, lateral = 0 } = {}) {
    Object.assign(this, { g: graph, rand, speed, lateral, lateralGoal: lateral, slow: 1 });
    this.p = -1;
    this.a = start;
    this.b = graph.pickNext(-1, start, rand);
    this.c = graph.pickNext(this.a, this.b, rand);
    this.s = rand() * graph.dist(this.a, this.b);
    this.x = 0; this.z = 0; this.yaw = 0; this.heading = null;
  }

  cornerR(a, b, c) {
    if (a < 0 || c < 0 || a === c) return 0;
    return Math.min(CORNER_M, this.g.dist(a, b) / 2, this.g.dist(b, c) / 2);
  }

  /** Advance dt seconds. Returns metres travelled. */
  step(dt) {
    const g = this.g, move = this.speed * this.slow * dt;
    this.s += move;
    let L = g.dist(this.a, this.b);
    let guard = 0;
    while (this.s >= L && guard++ < 64) {
      this.s -= L;
      this.p = this.a; this.a = this.b; this.b = this.c;
      this.c = g.pickNext(this.a, this.b, this.rand);
      L = g.dist(this.a, this.b);
      if (L === 0) { this.s = 0; break; }
    }
    this.lateral += (this.lateralGoal - this.lateral) * Math.min(1, dt * 1.5);
    this.place();
    return move;
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
  const cell = radius, grid = new Map();
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
        const dx = o.x - w.x, dz = o.z - w.z, d = Math.hypot(dx, dz);
        if (d > radius || d === 0) continue;
        const ahead = (dx * w.dirX + dz * w.dirZ) / d;
        if (ahead < 0.3) continue;
        const same = o.dirX * w.dirX + o.dirZ * w.dirZ;
        if (same > 0.5) w.slow = Math.min(w.slow, Math.max(0.3, d / radius * Math.min(1, o.speed / w.speed)));
        else side = 1;
      }
    }
    w.lateralGoal = side ? Math.min(2, w.baseLateral + 0.9) : w.baseLateral ?? w.lateralGoal;
  }
}
