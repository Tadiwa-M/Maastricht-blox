// Cars on the road graph (life/streets.json `roads`): right-hand traffic, one-way streets,
// a simple car-following rule (Intelligent Driver Model: keep a time gap to the car ahead,
// brake smoothly), slowing down into junctions, no cars on pedestrian streets (the export
// leaves them out). Pure logic (no three.js), tested in test/life.traffic.test.mjs.

export const CLASS_SPEED = { primary: 13.9, secondary: 11.1, tertiary: 9.7, residential: 8.3, unclassified: 8.3, service: 5.5, living_street: 4.2 };
export const CLASS_WEIGHT = { primary: 4, secondary: 3, tertiary: 2.5, residential: 1, unclassified: 1, service: 0.3, living_street: 0.3 };
export const IDM = { a: 1.4, b: 2.5, T: 1.2, s0: 2.2, delta: 4 };
export const JUNCTION_V = 4.5; // m/s through a junction
export const JUNCTION_M = 18; // start slowing this far before it

export class RoadGraph {
  /** doc: { nodes: [x, z, ...], edges: [a, b, ...], flags: [...], classes: [...] } (Unity metres). */
  constructor(doc) {
    const n = doc.nodes.length / 2;
    this.x = new Float32Array(n); this.z = new Float32Array(n);
    for (let q = 0; q < n; q++) { this.x[q] = doc.nodes[2 * q]; this.z[q] = doc.nodes[2 * q + 1]; }
    // directed edges: from, to, class, length, twoWay; out-lists per node
    this.from = []; this.to = []; this.cls = []; this.len = []; this.twoWay = [];
    this.out = Array.from({ length: n }, () => []);
    this.degree = new Uint16Array(n);
    const classes = doc.classes || Object.keys(CLASS_SPEED);
    for (let q = 0; q < doc.flags.length; q++) {
      const a = doc.edges[2 * q], b = doc.edges[2 * q + 1], fl = doc.flags[q];
      const cls = classes[fl >> 1] || 'residential', one = !!(fl & 1);
      this.degree[a]++; this.degree[b]++;
      this.add(a, b, cls, !one);
      if (!one) this.add(b, a, cls, true);
    }
    this.count = this.from.length;
  }

  add(a, b, cls, twoWay) {
    const e = this.from.length;
    this.from.push(a); this.to.push(b); this.cls.push(cls); this.twoWay.push(twoWay);
    this.len.push(Math.hypot(this.x[b] - this.x[a], this.z[b] - this.z[a]) || 0.01);
    this.out[a].push(e);
  }

  /** Lane offset to the right of the centreline (m): one-way streets drive near the middle. */
  laneOffset(e) {
    if (!this.twoWay[e]) return 0.4;
    return this.cls[e] === 'primary' || this.cls[e] === 'secondary' ? 1.9 : 1.5;
  }

  /** Next edge after e (not straight back unless it is a dead end); -1 at a dead end. */
  pickNext(e, rand) {
    const outs = this.out[this.to[e]];
    const cand = outs.filter((f) => this.to[f] !== this.from[e]);
    if (!cand.length) return -1;
    // prefer going straight on and bigger roads
    const dx = this.x[this.to[e]] - this.x[this.from[e]], dz = this.z[this.to[e]] - this.z[this.from[e]], L = this.len[e];
    let tot = 0;
    const w = cand.map((f) => {
      const fx = this.x[this.to[f]] - this.x[this.from[f]], fz = this.z[this.to[f]] - this.z[this.from[f]];
      const cos = (dx * fx + dz * fz) / (L * this.len[f]);
      const v = (0.3 + Math.max(0, cos) ** 2 * 2) * Math.sqrt(CLASS_WEIGHT[this.cls[f]] || 1);
      tot += v;
      return v;
    });
    let r = rand() * tot;
    for (let q = 0; q < cand.length; q++) { r -= w[q]; if (r <= 0) return cand[q]; }
    return cand[cand.length - 1];
  }

  /** Point (x, z) at distance s along edge e. */
  at(e, s) {
    const a = this.from[e], b = this.to[e], f = s / this.len[e];
    return [this.x[a] + (this.x[b] - this.x[a]) * f, this.z[a] + (this.z[b] - this.z[a]) * f];
  }
}

/** IDM acceleration for speed v, desired v0, gap to the leader (bumper to bumper) and closing speed dv. */
export function idmAccel(v, v0, gap, dv) {
  const { a, b, T, s0, delta } = IDM;
  const free = 1 - (v / Math.max(v0, 0.1)) ** delta;
  if (!Number.isFinite(gap)) return a * free;
  const sStar = s0 + Math.max(0, v * T + (v * dv) / (2 * Math.sqrt(a * b)));
  return a * (free - (sStar / Math.max(gap, 0.1)) ** 2);
}

/** Desired speed on edge e at distance s: the class speed, eased down before a junction. */
export function desiredSpeed(g, e, s) {
  const v0 = (CLASS_SPEED[g.cls[e]] || 8) * 1;
  const toEnd = g.len[e] - s, node = g.to[e];
  if (g.degree[node] > 2 && toEnd < JUNCTION_M) return Math.min(v0, JUNCTION_V + (toEnd / JUNCTION_M) * (v0 - JUNCTION_V));
  return v0;
}

/**
 * One car: { e (directed edge), s (m along it), v (m/s), next (edge after e), prev, len (car length), mood (speed factor) }.
 * stepTraffic advances every car by dt seconds; cars that run off a dead end get `gone = true`.
 */
export function stepTraffic(g, cars, dt, rand) {
  const onEdge = new Map();
  for (const c of cars) {
    if (c.gone) continue;
    if (!onEdge.has(c.e)) onEdge.set(c.e, []);
    onEdge.get(c.e).push(c);
  }
  for (const list of onEdge.values()) list.sort((p, q) => p.s - q.s);
  for (const c of cars) {
    if (c.gone) continue;
    if (c.next === undefined) c.next = g.pickNext(c.e, rand);
    const list = onEdge.get(c.e);
    const i = list.indexOf(c);
    let lead = null, gap = Infinity;
    if (i < list.length - 1) { lead = list[i + 1]; gap = lead.s - c.s; }
    else if (c.next >= 0) {
      const nl = onEdge.get(c.next);
      if (nl?.length) { lead = nl[0]; gap = g.len[c.e] - c.s + lead.s; }
    }
    if (lead) gap -= (lead.len + c.len) / 2;
    if (c.next < 0) { const end = g.len[c.e] - c.s + 4; if (end < gap) { gap = end; lead = null; } } // dead end: stop there
    const v0 = desiredSpeed(g, c.e, c.s) * (c.mood || 1);
    c.acc = idmAccel(c.v, v0, gap, lead ? c.v - lead.v : c.v);
  }
  for (const c of cars) {
    if (c.gone) continue;
    c.v = Math.max(0, c.v + c.acc * dt);
    c.s += c.v * dt;
    c.dist = (c.dist || 0) + c.v * dt;
    let guard = 0;
    while (c.s >= g.len[c.e] && guard++ < 8) {
      if (c.next < 0) { c.gone = true; break; }
      c.s -= g.len[c.e];
      c.prev = c.e; c.e = c.next;
      c.next = g.pickNext(c.e, rand);
    }
  }
}

/**
 * Pose of a car: centre (x, z) shifted to its lane and heading yaw (degrees clockwise from
 * north), from the points `axle` metres behind and ahead along its route (rounds corners).
 */
export function carPose(g, c, axle = 1.3) {
  const along = (ds) => {
    let e = c.e, s = c.s + ds;
    if (s > g.len[e] && c.next >= 0) { s -= g.len[e]; e = c.next; }
    if (s < 0 && c.prev !== undefined && c.prev >= 0 && g.to[c.prev] === g.from[c.e]) { e = c.prev; s += g.len[e]; }
    s = Math.max(0, Math.min(g.len[e], s));
    const [x, z] = g.at(e, s), lane = g.laneOffset(e);
    const dx = g.x[g.to[e]] - g.x[g.from[e]], dz = g.z[g.to[e]] - g.z[g.from[e]], L = g.len[e];
    return [x + (dz / L) * lane, z - (dx / L) * lane];
  };
  const [bx, bz] = along(-axle), [fx, fz] = along(axle);
  const yaw = ((Math.atan2(fx - bx, fz - bz) * 180) / Math.PI + 360) % 360;
  return { x: (bx + fx) / 2, z: (bz + fz) / 2, yaw };
}
