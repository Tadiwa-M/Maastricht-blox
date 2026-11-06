// Cars on the road graph (life/streets.json `roads`): right-hand traffic, one-way streets,
// a simple car-following rule (Intelligent Driver Model: keep a time gap to the car ahead,
// brake smoothly), slowing down into junctions, no cars on pedestrian streets (the export
// leaves them out). Pure logic (no three.js), tested in test/life.traffic.test.mjs and
// test/life.junctions.test.mjs.
//
// Traffic rules (game phase G1b, GTA / Cities: Skylines style lane traffic): every rule becomes a
// "stop line", a standing obstacle the IDM brakes for, so one car-following law does everything.
// A car looks two junctions ahead along its route (so short OSM edges cannot hide a red light).
// - Traffic lights (OSM signals): one city-wide cycle; north-south approaches get green while
//   east-west get red and the other way round, with amber and an all-red gap (SIGNAL). On green,
//   a car turning left gives way to oncoming traffic going straight on or right.
// - Junctions without lights: the bigger road goes first; between equal roads, give way to
//   traffic from the right (Dutch rule); cars entering a roundabout give way to cars on it.
//   A car that has waited YIELD_MAX_S goes anyway, and a ring of cars all waiting for each other
//   lets one go at once (no four-way standoffs).
// - Junction boxes (junctions.js): before a car enters a junction it "commits" to it; it does
//   not while a committed car on a crossing or merging path is still in the box, while a bus or
//   train will sweep through its path before it is across, or while there is no room behind the
//   junction (keep the box clear). A committed car drives through (no stopping in the box).
// - Crossings: stop when someone is within CROSSING_M of the crossing.
// - Anything in the lane ahead (buses and trains where they are and are about to be, bikes, the
//   player): queue behind it. Braking is capped (MAX_BRAKE), so a car can still hit someone who
//   steps out right in front of it.
// - The police car with its lights on (police.js): cars ahead pull over, junctions let it through.

import { boxRadii, movement, movesConflict, turnOf, vehicleSweep, sweepHits, behindInLane, clearTime, routePoint, BOX } from './junctions.js';
import { POLICE, pullsOver } from './police.js';

export const CLASS_SPEED = { primary: 13.9, secondary: 11.1, tertiary: 9.7, residential: 8.3, unclassified: 8.3, service: 5.5, living_street: 4.2 };
export const CLASS_WEIGHT = { primary: 4, secondary: 3, tertiary: 2.5, residential: 1, unclassified: 1, service: 0.3, living_street: 0.3 };
export const IDM = { a: 1.4, b: 2.5, T: 1.2, s0: 2.2, delta: 4 };
export const JUNCTION_V = 4.5; // m/s through a junction
export const JUNCTION_M = 18; // start slowing this far before it
export const SIGNAL = { cycle: 60, green: 25, amber: 3 }; // s: NS green 0-25, amber 25-28, all red 28-30, EW from 30
export const CLASS_RANK = { primary: 5, secondary: 4, tertiary: 3, unclassified: 2, residential: 2, service: 1, living_street: 1 };
export const YIELD_M = 25; // look for priority traffic this far before a junction
export const YIELD_MAX_S = 6; // after waiting this long, go
export const CROSSING_M = 4;
export const MAX_BRAKE = 7; // m/s²
export const LOOK_M = 30; // obstacles this far ahead in the lane
const LANE_HALF = 1.6;
const LOOK_AHEAD_M = 45; // rules: junctions this far ahead along the route
const COMFORT_B = 3; // m/s²: a car that cannot stop for amber this gently goes on


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
    this.boxR = boxRadii(this); // junction box radius per node (junctions.js)
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

const committed = (c, n) => !!c.commits && c.commits.includes(n);

/** Where car o is headed at node n (one of the next two nodes on its route): { d (m, centre to node), eIn, eOut } or null. */
function approach(g, o, n) {
  const toEnd = g.len[o.e] - o.s;
  if (g.to[o.e] === n) return { d: toEnd, eIn: o.e, eOut: o.next ?? -1 };
  if (o.next >= 0 && g.to[o.next] === n) return { d: toEnd + g.len[o.next], eIn: o.next, eOut: o.next2 ?? -1 };
  return null;
}

/** Is o (through the cars it waits for) waiting for c? Then giving way to o would close a ring. */
function waitsFor(o, c) {
  let x = o;
  for (let k = 0; k < 6 && x; k++) { x = x.waitingFor; if (x === c) return true; }
  return false;
}

/** At node n, does a car going cIn -> cOut give way to car o (on o.e -> o.next)? */
function givesWay(g, n, cIn, cOut, o, env) {
  if (!g.signal[n]) return hasPriority(g, { e: cIn }, o);
  // on green: turning left waits for oncoming traffic going straight on or right
  if (env.t === undefined || turnOf(g, cIn, cOut) !== 'left' || signalState(g, o.e, env.t) === 'red') return false;
  const opposite = Math.abs(((g.bearing(o.e) - g.bearing(cIn) + 540) % 360) - 180) > 135;
  return opposite && turnOf(g, o.e, o.next ?? -1) !== 'left';
}

/** Car c will drive through junction n (movement mv): it holds the box until it is out. */
function commit(c, n, mv, ctx) {
  if (!committed(c, n)) c.commits.push(n);
  if (!ctx) return;
  if (!ctx.boxes.has(n)) ctx.boxes.set(n, []);
  const list = ctx.boxes.get(n);
  if (!list.some((o) => o.c === c)) list.push({ c, mv });
}

/**
 * The rules at one node n on car c's route (reached over eIn, left over eOut; `front` = metres
 * from c's front bumper to the node): { stop (gap for the IDM, Infinity = no stop), pass (the
 * car will be through this node: look at the next one) }.
 */
function nodeRule(g, c, n, eIn, eOut, front, byNode, env, ctx) {
  const R = g.boxR[n], toLine = front - R;
  const hold = { stop: Math.max(0.1, toLine + IDM.s0 - 1), pass: false }; // the front stops ~1 m before the box
  const go = { stop: Infinity, pass: true };
  const isIn = committed(c, n);
  if (g.signal[n] && env.t !== undefined && !isIn && !c.siren && toLine > -0.5) {
    const st = signalState(g, eIn, env.t);
    if (st === 'red' || (st === 'amber' && toLine > (c.v * c.v) / (2 * COMFORT_B))) return hold;
  }
  if (g.crossing[n] && env.people?.length && front > CROSSING_M) {
    const nx = g.x[n], nz = g.z[n];
    for (const p of env.people) {
      if (Math.abs(p.x - nx) < CROSSING_M && Math.abs(p.z - nz) < CROSSING_M) return { stop: Math.max(0.1, front - CROSSING_M + IDM.s0 - 1.5), pass: false };
    }
  }
  if (g.degree[n] <= 2 || isIn) return go;
  const mv = movement(g, eIn, eOut);
  if (toLine < -0.3) { commit(c, n, mv, ctx); return go; } // already in the box: drive out of it
  if (!c.siren) {
    // the police car with its lights on goes first
    for (const p of ctx?.sirens || []) {
      const a = p !== c && !committed(p, n) ? approach(g, p, n) : null;
      if (a && a.d < POLICE.junctionM && movesConflict(mv, movement(g, a.eIn, a.eOut))) return hold;
    }
    if (c.goNode !== n && toLine < YIELD_M) {
      for (const o of byNode.get(n) || []) {
        if (o === c || o.e === eIn || o.siren || committed(o, n)) continue;
        if (g.len[o.e] - o.s - (o.len || 4.2) / 2 - R > YIELD_M) continue;
        if (o.next !== undefined && !movesConflict(mv, movement(g, o.e, o.next))) continue;
        if (!givesWay(g, n, eIn, eOut, o, env) || waitsFor(o, c)) continue; // a ring of waiting cars: this one goes
        c.yielding = true; c.waitingFor = o; c.yieldNode = n;
        return hold;
      }
    }
  }
  if (ctx) {
    // a car on a crossing or merging path is in the box
    for (const o of ctx.boxes.get(n) || []) if (o.c !== c && movesConflict(mv, o.mv)) return hold;
    // a bus or train will come through before this car is across (they cannot wait: the car does)
    const T = Math.min(BOX.horizonS, clearTime(c.v, Math.max(0, toLine) + 2 * R + c.len) + 1);
    const pose = ctx.poses?.get(c) || carPose(g, c);
    for (const veh of ctx.vehicles) {
      if (Math.hypot(veh.x - g.x[n], veh.z - g.z[n]) > veh.halfL + R + 20 * T) continue;
      if (behindInLane(pose, veh)) continue;
      if (sweepHits(mv.poly, vehicleSweep(veh), veh.halfW, T)) return hold;
    }
    // keep the box clear: room for the whole car behind the junction
    const q = eOut >= 0 ? ctx.onEdge.get(eOut)?.[0] : null;
    if (q && q !== c && q.v < 2 && q.s - (q.len || 4.2) / 2 < R + c.len + 1) return hold;
  }
  if (toLine <= (c.v * c.v) / (2 * COMFORT_B) + 1.5) { commit(c, n, mv, ctx); return go; }
  return { stop: Infinity, pass: false };
}

/**
 * Where car c must stop (gap in m for the IDM, from its front) because of a light, a crossing, a
 * junction it must not enter yet (traffic with priority, a car or bus in the way, no room
 * behind it); Infinity when the way is clear. Looks at the next two junctions on its route.
 * env: { t, people }. ctx (stepTraffic): { boxes, onEdge, vehicles, sirens, poses, rand }.
 */
export function stopLine(g, c, byNode, env = {}, ctx = null) {
  c.commits ||= [];
  c.yielding = false;
  if ((c.wait || 0) >= YIELD_MAX_S && c.yieldNode !== undefined) c.goNode = c.yieldNode; // waited long enough: we go
  let eIn = c.e, eOut = c.next ?? -1, front = g.len[c.e] - c.s - (c.len || 4.2) / 2, stop = Infinity;
  for (let hop = 0; hop < 2; hop++) {
    const n = g.to[eIn];
    if (front - g.boxR[n] > LOOK_AHEAD_M) break;
    const r = nodeRule(g, c, n, eIn, eOut, front, byNode, env, ctx);
    stop = Math.min(stop, r.stop);
    if (!r.pass || eOut < 0 || !ctx || hop === 1) break;
    front += g.len[eOut];
    if (front - g.boxR[g.to[eOut]] > LOOK_AHEAD_M) break;
    if (c.next2 === undefined) c.next2 = g.pickNext(eOut, ctx.rand); // the way out of the junction after this one
    eIn = eOut; eOut = c.next2;
  }
  if (!c.yielding) c.waitingFor = null;
  return stop;
}

/**
 * Gap (m, bumper to obstacle) to the nearest obstacle in c's lane ahead; obstacles [{ x, z, r }].
 * pose: c's pose (carPose) if known; skip(o): obstacles to leave out.
 */
export function laneGap(g, c, obstacles, pose = null, skip = null) {
  if (!obstacles?.length) return Infinity;
  const p = pose || carPose(g, c), r = (p.yaw * Math.PI) / 180, fx = Math.sin(r), fz = Math.cos(r);
  let gap = Infinity;
  for (const o of obstacles) {
    const dx = o.x - p.x, dz = o.z - p.z;
    const along = dx * fx + dz * fz;
    if (along <= 0 || along > LOOK_M) continue;
    if (Math.abs(dx * fz - dz * fx) > LANE_HALF + (o.r || 0.4)) continue;
    if (skip?.(o)) continue;
    gap = Math.min(gap, along - c.len / 2 - (o.r || 0.4));
  }
  return gap;
}

/**
 * The car ahead of c along its route (same edge, then the next two): { lead, gap (centre to
 * centre), passing (the police car is passing cars that pulled over) }.
 */
function leaderAhead(g, c, onEdge, rand) {
  const skip = (o) => c.siren && (o.lat || 0) > POLICE.passLat; // with its lights on the police car passes cars that pulled over
  const list = onEdge.get(c.e), me = list.indexOf(c);
  // the police car stays out to the left until it is past the cars that pulled over
  let passing = c.siren && list.some((o) => o !== c && (o.lat || 0) > 0.3 && o.s - c.s > -8 && o.s - c.s < LOOK_M);
  for (let i = me + 1; i < list.length; i++) {
    if (!skip(list[i])) return { lead: list[i], gap: list[i].s - c.s, passing };
  }
  let off = g.len[c.e] - c.s, e = c.next;
  for (let hop = 0; hop < 2 && e >= 0 && e !== c.e && off < LOOK_M + 20; hop++) {
    for (const o of onEdge.get(e) || []) {
      if (o !== c && !skip(o)) return { lead: o, gap: off + o.s, passing };
      if (o !== c && off + o.s < LOOK_M) passing = true;
    }
    off += g.len[e];
    if (hop === 0) { if (c.next2 === undefined) c.next2 = g.pickNext(e, rand); e = c.next2; }
  }
  return { lead: null, gap: Infinity, passing };
}

/** Buses and trains near any of the cars (posed): the rest cannot matter this frame. */
function nearVehicles(vehicles, poses) {
  if (!vehicles?.length || !poses.size) return [];
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const p of poses.values()) { x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); z0 = Math.min(z0, p.z); z1 = Math.max(z1, p.z); }
  const m = 120;
  return vehicles.filter((v) => v.x > x0 - m && v.x < x1 + m && v.z > z0 - m && v.z < z1 + m);
}

/** Which junction boxes each car is in or has committed to: Map node -> [{ c, mv (movement) }]. */
function occupancy(g, live) {
  const boxes = new Map();
  const add = (n, c, mv) => {
    if (g.degree[n] <= 2) return;
    if (!boxes.has(n)) boxes.set(n, []);
    boxes.get(n).push({ c, mv });
  };
  for (const c of live) {
    const half = c.len / 2, n1 = g.to[c.e], n0 = g.from[c.e];
    if (committed(c, n1) || g.len[c.e] - c.s - half < g.boxR[n1]) add(n1, c, movement(g, c.e, c.next ?? -1));
    if (c.next >= 0 && committed(c, g.to[c.next])) add(g.to[c.next], c, movement(g, c.next, c.next2 ?? -1));
    if (c.s - half < g.boxR[n0]) add(n0, c, movement(g, c.prev >= 0 && g.to[c.prev] === n0 ? c.prev : -1, c.e));
  }
  return boxes;
}

/**
 * One car: { e (directed edge), s (m along it), v (m/s), next (edge after e), next2 (and after
 * that, once picked), prev, len (car length), mood (speed factor), siren (police lights on),
 * lat (m, sideways from its lane: pulling over) }. stepTraffic advances every car by dt seconds;
 * cars that run off a dead end get `gone = true`. env (optional): { t (s, the traffic-light
 * clock), people [{x, z}] (near crossings), obstacles [{x, z, r}] (bikes, the player), vehicles
 * [{ x, z, yaw, halfW, halfL, v, sweep?() }] (buses and trains, junctions.js vehicleSweep) }.
 */
export function stepTraffic(g, cars, dt, rand, env = {}) {
  const live = cars.filter((c) => !c.gone);
  const byNode = new Map(), onEdge = new Map(); // cars approaching each node (right of way); cars per edge
  for (const c of live) {
    if (c.next === undefined) c.next = g.pickNext(c.e, rand);
    c.commits ||= [];
    const n = g.to[c.e];
    if (!byNode.has(n)) byNode.set(n, []);
    byNode.get(n).push(c);
    if (!onEdge.has(c.e)) onEdge.set(c.e, []);
    onEdge.get(c.e).push(c);
  }
  for (const list of onEdge.values()) list.sort((p, q) => p.s - q.s);
  const poses = new Map(live.map((c) => [c, carPose(g, c)]));
  const vehicles = nearVehicles(env.vehicles, poses);
  const vehObs = []; // buses and trains as lane obstacles: where they are and are about to be
  for (const v of vehicles) for (const p of vehicleSweep(v)) if (p.t <= BOX.laneSweepS) vehObs.push({ x: p.x, z: p.z, r: v.halfW, t: p.t, veh: v });
  const sirens = live.filter((c) => c.siren);
  const ctx = { boxes: occupancy(g, live), onEdge, vehicles, sirens, poses, rand };
  for (const c of live) {
    const pose = poses.get(c);
    let { lead, gap, passing } = leaderAhead(g, c, onEdge, rand);
    if (lead) gap -= (lead.len + c.len) / 2;
    const deadEnd = c.next < 0 ? g.len[c.e] - c.s + 4 : c.next2 === -1 ? g.len[c.e] - c.s + g.len[c.next] + 4 : Infinity;
    if (deadEnd < gap) { gap = deadEnd; lead = null; } // dead end: stop there
    // rules: lights, crossings, right of way, junction boxes; and anything standing in the lane
    const rule = stopLine(g, c, byNode, env, ctx);
    if (rule < gap) { gap = Math.max(0.1, rule); lead = null; }
    const inPath = new Map(); // is c already in that vehicle's way? then it drives on out of it
    const skipVeh = (o) => {
      if (behindInLane(pose, o.veh)) return true;
      if (!o.t) return false;
      if (!inPath.has(o.veh)) inPath.set(o.veh, vehObs.some((q) => q.veh === o.veh && q.t > 0 && Math.hypot(q.x - pose.x, q.z - pose.z) < q.r + c.len / 2));
      return inPath.get(o.veh);
    };
    const obs = Math.min(laneGap(g, c, env.obstacles, pose), laneGap(g, c, vehObs, pose, skipVeh));
    if (obs < gap) { gap = Math.max(0.1, obs); lead = null; }
    let v0 = desiredSpeed(g, c.e, c.s) * (c.mood || 1);
    c.latWant = 0;
    if (c.siren) { v0 *= POLICE.boost; c.latWant = passing ? -POLICE.passM : 0; } // out to the left to pass
    else if (sirens.some((p) => p !== c && pullsOver(pose, poses.get(p)))) { v0 *= POLICE.slow; c.latWant = POLICE.pullM; }
    c.acc = Math.max(-MAX_BRAKE, idmAccel(c.v, v0, gap, lead ? c.v - lead.v : c.v));
    c.wait = c.yielding && c.v < 0.5 ? (c.wait || 0) + dt : 0;
  }
  for (const c of live) {
    c.v = Math.max(0, c.v + c.acc * dt);
    c.s += c.v * dt;
    c.dist = (c.dist || 0) + c.v * dt;
    c.lat = (c.lat || 0) + ((c.latWant || 0) - (c.lat || 0)) * Math.min(1, dt * 1.5);
    let guard = 0;
    while (c.s >= g.len[c.e] && guard++ < 8) {
      if (c.next < 0) { c.gone = true; break; }
      c.s -= g.len[c.e];
      c.prev = c.e; c.e = c.next;
      c.next = c.next2 !== undefined ? c.next2 : g.pickNext(c.e, rand);
      c.next2 = undefined;
      c.commits = c.commits.filter((n) => n === g.to[c.e] || (c.next >= 0 && n === g.to[c.next]));
    }
  }
}

/**
 * Pose of a car: centre (x, z) on its lane, bending through the lane corners at nodes
 * (junctions.js routePoint), plus c.lat (pulling over), and heading yaw (degrees clockwise from
 * north), from the points `axle` metres behind and ahead along its route.
 */
export function carPose(g, c, axle = 1.3) {
  const prevOk = c.prev !== undefined && c.prev >= 0 && g.to[c.prev] === g.from[c.e];
  const along = (ds) => {
    let e = c.e, s = c.s + ds, before = prevOk ? c.prev : -1, after = c.next ?? -1;
    if (s > g.len[e] && c.next >= 0) { s -= g.len[e]; before = e; e = c.next; after = c.next2 ?? -1; }
    else if (s < 0 && prevOk) { e = c.prev; s += g.len[e]; before = -1; after = c.e; }
    s = Math.max(0, Math.min(g.len[e], s));
    const [x, z] = routePoint(g, e, s, before, after), lat = c.lat || 0;
    if (!lat) return [x, z];
    const dx = g.x[g.to[e]] - g.x[g.from[e]], dz = g.z[g.to[e]] - g.z[g.from[e]], L = g.len[e];
    return [x + (dz / L) * lat, z - (dx / L) * lat];
  };
  const [bx, bz] = along(-axle), [fx, fz] = along(axle);
  const yaw = ((Math.atan2(fx - bx, fz - bz) * 180) / Math.PI + 360) % 360;
  return { x: (bx + fx) / 2, z: (bz + fz) / 2, yaw };
}
