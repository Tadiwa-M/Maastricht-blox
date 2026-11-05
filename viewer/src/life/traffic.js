// Cars on the road graph (life/streets.json `roads`): right-hand traffic, one-way streets,
// a simple car-following rule (Intelligent Driver Model: keep a time gap to the car ahead,
// brake smoothly), slowing down into junctions, no cars on pedestrian streets (the export
// leaves them out). Pure logic (no three.js), tested in test/life.traffic.test.mjs.
//
// Traffic rules (game phase G1b, GTA / Cities: Skylines style lane traffic): every rule becomes a
// "stop line", a standing obstacle the IDM brakes for, so one car-following law does everything.
// - Traffic lights (OSM signals): one city-wide cycle; north-south approaches get green while
//   east-west get red and the other way round, with amber and an all-red gap (SIGNAL).
// - Junctions without lights: the bigger road goes first; between equal roads, give way to
//   traffic from the right (Dutch rule); cars entering a roundabout give way to cars on it.
//   A car that has waited YIELD_MAX_S goes anyway (no four-way standoffs).
// - Crossings: stop when someone is within CROSSING_M of the crossing.
// - Anything in the lane ahead (buses, bikes, the player): queue behind it. Braking is capped
//   (MAX_BRAKE), so a car can still hit someone who steps out right in front of it.

export const CLASS_SPEED = { primary: 13.9, secondary: 11.1, tertiary: 9.7, residential: 8.3, unclassified: 8.3, service: 5.5, living_street: 4.2 };
export const CLASS_WEIGHT = { primary: 4, secondary: 3, tertiary: 2.5, residential: 1, unclassified: 1, service: 0.3, living_street: 0.3 };
export const IDM = { a: 1.4, b: 2.5, T: 1.2, s0: 2.2, delta: 4 };
export const JUNCTION_V = 4.5; // m/s through a junction
export const JUNCTION_M = 18; // start slowing this far before it
export const SIGNAL = { cycle: 60, green: 26, amber: 3 }; // s: NS green 0-26, amber 26-29, all red 29-30, EW from 30
export const CLASS_RANK = { primary: 5, secondary: 4, tertiary: 3, unclassified: 2, residential: 2, service: 1, living_street: 1 };
export const YIELD_M = 25; // look for priority traffic this far before a junction
export const YIELD_MAX_S = 6; // after waiting this long, go
export const CROSSING_M = 4;
export const MAX_BRAKE = 7; // m/s²
export const LOOK_M = 30; // obstacles this far ahead in the lane
const LANE_HALF = 1.6;

export class RoadGraph {
  /** doc: { nodes: [x, z, ...], edges: [a, b, ...], flags: [...], classes: [...] } (Unity metres). */
  constructor(doc) {
    const n = doc.nodes.length / 2;
    this.x = new Float32Array(n); this.z = new Float32Array(n);
    for (let q = 0; q < n; q++) { this.x[q] = doc.nodes[2 * q]; this.z[q] = doc.nodes[2 * q + 1]; }
    // directed edges: from, to, class, length, twoWay; out-lists per node
    this.from = []; this.to = []; this.cls = []; this.len = []; this.twoWay = [];
    this.out = Array.from({ length: n }, () => []);
    this.into = Array.from({ length: n }, () => []);
    this.degree = new Uint16Array(n);
    this.round = [];
    this.signal = new Uint8Array(n); this.crossing = new Uint8Array(n);
    for (const k of doc.signals || []) this.signal[k] = 1;
    for (const k of doc.crossings || []) this.crossing[k] = 1;
    const rb = new Set(doc.roundabout || []);
    const classes = doc.classes || Object.keys(CLASS_SPEED);
    for (let q = 0; q < doc.flags.length; q++) {
      const a = doc.edges[2 * q], b = doc.edges[2 * q + 1], fl = doc.flags[q];
      const cls = classes[fl >> 1] || 'residential', one = !!(fl & 1);
      this.degree[a]++; this.degree[b]++;
      const e0 = this.from.length;
      this.add(a, b, cls, !one);
      if (rb.has(q)) this.round[e0] = 1;
      if (!one) this.add(b, a, cls, true);
    }
    this.count = this.from.length;
  }

  add(a, b, cls, twoWay) {
    const e = this.from.length;
    this.from.push(a); this.to.push(b); this.cls.push(cls); this.twoWay.push(twoWay);
    this.len.push(Math.hypot(this.x[b] - this.x[a], this.z[b] - this.z[a]) || 0.01);
    this.out[a].push(e);
    this.into[b].push(e);
    this.round.push(0);
  }

  /** Compass bearing (degrees) of edge e's direction of travel. */
  bearing(e) {
    return ((Math.atan2(this.x[this.to[e]] - this.x[this.from[e]], this.z[this.to[e]] - this.z[this.from[e]]) * 180) / Math.PI + 360) % 360;
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

/** Light for a car arriving along edge e at time t (s): 'green' | 'amber' | 'red'. */
export function signalState(g, e, t) {
  const a = g.bearing(e) % 180;
  const ns = a < 45 || a >= 135;
  const u = ((t % SIGNAL.cycle) + SIGNAL.cycle) % SIGNAL.cycle;
  const half = SIGNAL.cycle / 2, k = ns ? u : (u + half) % SIGNAL.cycle;
  return k < SIGNAL.green ? 'green' : k < SIGNAL.green + SIGNAL.amber ? 'amber' : 'red';
}

/** Does car o (approaching the same junction) go before car c? */
export function hasPriority(g, c, o) {
  const node = g.to[c.e];
  const cRound = !!g.round[c.e], oRound = !!g.round[o.e];
  if (cRound !== oRound) return oRound; // on the roundabout goes first
  const rc = CLASS_RANK[g.cls[c.e]] || 2, ro = CLASS_RANK[g.cls[o.e]] || 2;
  if (rc !== ro) return ro > rc;
  // equal roads: give way to the right. o comes from where its edge starts.
  const toO = ((Math.atan2(g.x[g.from[o.e]] - g.x[node], g.z[g.from[o.e]] - g.z[node]) * 180) / Math.PI + 360) % 360;
  const rel = ((toO - g.bearing(c.e) + 540) % 360) - 180; // + = clockwise = right
  return rel > 30 && rel < 150;
}

/**
 * Where car c must stop before (m from its front) because of a light, a crossing or traffic with
 * priority at the junction it is approaching; Infinity when the way is clear. env: { t, people }.
 */
export function stopLine(g, c, byNode, env) {
  const toEnd = g.len[c.e] - c.s, node = g.to[c.e];
  let stop = Infinity;
  if (g.signal[node] && env.t !== undefined) {
    const st = signalState(g, c.e, env.t);
    const brakeDist = (c.v * c.v) / (2 * 3);
    if (st === 'red' || (st === 'amber' && toEnd > brakeDist)) stop = Math.min(stop, toEnd - 1.5);
  }
  if (g.crossing[node] && env.people?.length) {
    const nx = g.x[node], nz = g.z[node];
    for (const p of env.people) if (Math.abs(p.x - nx) < CROSSING_M && Math.abs(p.z - nz) < CROSSING_M) { stop = Math.min(stop, toEnd - 3); break; }
  }
  c.yielding = false;
  if ((c.wait || 0) >= YIELD_MAX_S) c.goNode = node; // waited long enough: this junction, we go
  if (!g.signal[node] && g.degree[node] > 2 && toEnd < YIELD_M && c.goNode !== node) {
    for (const o of byNode.get(node) || []) {
      if (o === c || o.e === c.e || g.len[o.e] - o.s > YIELD_M) continue;
      if (o.waitingFor === c) continue; // it is already waiting for us
      if (hasPriority(g, c, o)) { stop = Math.min(stop, toEnd - 2); c.yielding = true; c.waitingFor = o; break; }
    }
  }
  if (!c.yielding) c.waitingFor = null;
  return stop;
}

/** Gap (m, bumper to obstacle) to the nearest obstacle in c's lane ahead; obstacles [{ x, z, r }]. */
export function laneGap(g, c, obstacles) {
  if (!obstacles?.length) return Infinity;
  const p = carPose(g, c), r = (p.yaw * Math.PI) / 180, fx = Math.sin(r), fz = Math.cos(r);
  let gap = Infinity;
  for (const o of obstacles) {
    const dx = o.x - p.x, dz = o.z - p.z;
    const along = dx * fx + dz * fz;
    if (along <= 0 || along > LOOK_M) continue;
    if (Math.abs(dx * fz - dz * fx) > LANE_HALF + (o.r || 0.4)) continue;
    gap = Math.min(gap, along - c.len / 2 - (o.r || 0.4));
  }
  return gap;
}

/**
 * One car: { e (directed edge), s (m along it), v (m/s), next (edge after e), prev, len (car length), mood (speed factor) }.
 * stepTraffic advances every car by dt seconds; cars that run off a dead end get `gone = true`.
 * env (optional): { t (s, the traffic-light clock), people [{x, z}] (near crossings), obstacles [{x, z, r}] }.
 */
export function stepTraffic(g, cars, dt, rand, env = {}) {
  const byNode = new Map(); // cars approaching each node (for right of way)
  for (const c of cars) {
    if (c.gone) continue;
    const n = g.to[c.e];
    if (!byNode.has(n)) byNode.set(n, []);
    byNode.get(n).push(c);
  }
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
    // rules: lights, crossings, right of way; and anything standing in the lane
    const rule = stopLine(g, c, byNode, env);
    if (rule < gap) { gap = Math.max(0.1, rule); lead = null; }
    const obs = laneGap(g, c, env.obstacles);
    if (obs < gap) { gap = Math.max(0.1, obs); lead = null; }
    const v0 = desiredSpeed(g, c.e, c.s) * (c.mood || 1);
    c.acc = Math.max(-MAX_BRAKE, idmAccel(c.v, v0, gap, lead ? c.v - lead.v : c.v));
    c.wait = c.yielding && c.v < 0.5 ? (c.wait || 0) + dt : 0;
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
