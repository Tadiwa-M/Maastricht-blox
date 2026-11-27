// Junction boxes for the cars (traffic.js): the path a car takes through a junction (a
// "movement": in-lane, corner, out-lane), whether two movements cross or merge (then only one
// car may be in the box at a time), and whether a bus or train will sweep through a car's path
// while it crosses (buses keep to their timetable, so the car waits for them). Pure (no
// three.js), tested in test/life.junctions.test.mjs. Positions Unity metres (x east, z north).

export const BOX = {
  margin: 2.4, // box radius = the widest lane offset at the node + this (a car's half width + room)
  min: 3.5, // smallest box radius (m)
  halfW: 0.95, // half the width a car sweeps going straight on (m) ...
  turnHalfW: 1.5, // ... and turning (its body is at an angle across the lanes)
  gapM: 0.1, // two movements conflict when their centre lines come closer than both half widths and this
  carHalfW: 0.95, // a car's half width for bus sweeps (m)
  horizonS: 8, // longest look into a bus's future (s)
  laneSweepS: 1.2, // bus positions this far ahead count as standing in a car's lane
  bendM: 3, // a car's path bends through the lane corner from this far before a node to this far after
};

/** Box radius of every node: how far from the node centre a car must stop to keep clear of it. */
export function boxRadii(g) {
  const n = g.x.length, r = new Float32Array(n).fill(BOX.min);
  for (let e = 0; e < g.count; e++) {
    const w = g.laneOffset(e) + BOX.margin;
    for (const k of [g.from[e], g.to[e]]) if (w > r[k]) r[k] = w;
  }
  return r;
}

/** Lane point (x, z) at distance s along edge e (right of the centre line). */
export function lanePoint(g, e, s) {
  const a = g.from[e], b = g.to[e], L = g.len[e], f = Math.max(0, Math.min(1, s / L));
  const dx = (g.x[b] - g.x[a]) / L, dz = (g.z[b] - g.z[a]) / L, lane = g.laneOffset(e);
  return [g.x[a] + (g.x[b] - g.x[a]) * f + dz * lane, g.z[a] + (g.z[b] - g.z[a]) * f - dx * lane];
}

/** Where lines p + t*u and q + s*v meet, or null when (nearly) parallel. */
function meet(p, u, q, v) {
  const den = u[0] * v[1] - u[1] * v[0];
  if (Math.abs(den) < 0.15) return null;
  const t = ((q[0] - p[0]) * v[1] - (q[1] - p[1]) * v[0]) / den;
  return [p[0] + u[0] * t, p[1] + u[1] * t];
}

/**
 * Corner of the lane lines of eIn and eOut (they meet there, not at the node: the in-lane of a
 * right turn ends before the node, a left turn's after it), cached: { c: [x, z], r } with r the
 * distance before and after the node over which a car's path bends through c (carPose).
 */
export function corner(g, eIn, eOut) {
  g._corners ||= new Map();
  const key = eIn * (g.count + 1) + eOut;
  let k = g._corners.get(key);
  if (k) return k;
  const node = g.to[eIn], Li = g.len[eIn], Lo = g.len[eOut];
  const pIn = lanePoint(g, eIn, Li), pOut = lanePoint(g, eOut, 0);
  const uIn = [(g.x[node] - g.x[g.from[eIn]]) / Li, (g.z[node] - g.z[g.from[eIn]]) / Li];
  const uOut = [(g.x[g.to[eOut]] - g.x[node]) / Lo, (g.z[g.to[eOut]] - g.z[node]) / Lo];
  const m = meet(pIn, uIn, pOut, uOut);
  const r = Math.min(BOX.bendM, Li / 2, Lo / 2);
  const ok = m && Math.hypot(m[0] - g.x[node], m[1] - g.z[node]) < r + 2.5;
  k = { c: ok ? m : [(pIn[0] + pOut[0]) / 2, (pIn[1] + pOut[1]) / 2], r };
  g._corners.set(key, k);
  return k;
}

/**
 * Where a car's centre line is at distance s along edge e, bending through the corner with the
 * edge before it (ePrev) or after it (eNext) near the nodes (-1: none known): [x, z].
 */
export function routePoint(g, e, s, ePrev = -1, eNext = -1) {
  const L = g.len[e];
  if (eNext >= 0 && eNext !== e) {
    const k = corner(g, e, eNext);
    if (s > L - k.r) {
      const a = lanePoint(g, e, L - k.r), f = (s - (L - k.r)) / k.r;
      return [a[0] + (k.c[0] - a[0]) * f, a[1] + (k.c[1] - a[1]) * f];
    }
  }
  if (ePrev >= 0 && ePrev !== e) {
    const k = corner(g, ePrev, e);
    if (s < k.r) {
      const b = lanePoint(g, e, k.r), f = s / k.r;
      return [k.c[0] + (b[0] - k.c[0]) * f, k.c[1] + (b[1] - k.c[1]) * f];
    }
  }
  return lanePoint(g, e, s);
}

/**
 * The path of a car through the junction between edges eIn -> eOut (either may be -1: a car
 * that starts or ends at the node): { eIn, eOut, node, poly: [[x, z], ...] } from the box edge on
 * the way in, over the corner where the two lanes meet, to the box edge on the way out. Cached.
 */
export function movement(g, eIn, eOut) {
  eIn = eIn ?? -1; eOut = eOut ?? -1;
  g._moves ||= new Map();
  const key = (eIn + 1) * (g.count + 2) + (eOut + 1);
  let m = g._moves.get(key);
  if (m) return m;
  const node = eIn >= 0 ? g.to[eIn] : g.from[eOut], R = g.boxR ? g.boxR[node] : BOX.min;
  const poly = [];
  let pIn = null, uIn = null, pOut = null, uOut = null;
  if (eIn >= 0) {
    const L = g.len[eIn];
    poly.push(lanePoint(g, eIn, L - Math.min(R, L)));
    pIn = lanePoint(g, eIn, L);
    uIn = [(g.x[g.to[eIn]] - g.x[g.from[eIn]]) / L, (g.z[g.to[eIn]] - g.z[g.from[eIn]]) / L];
  }
  if (eOut >= 0) {
    const L = g.len[eOut];
    pOut = lanePoint(g, eOut, 0);
    uOut = [(g.x[g.to[eOut]] - g.x[g.from[eOut]]) / L, (g.z[g.to[eOut]] - g.z[g.from[eOut]]) / L];
  }
  if (pIn && pOut) {
    const c = meet(pIn, uIn, pOut, uOut);
    const near = c && Math.hypot(c[0] - g.x[node], c[1] - g.z[node]) < R + 2;
    poly.push(near ? c : [(pIn[0] + pOut[0]) / 2, (pIn[1] + pOut[1]) / 2]);
  } else poly.push(pIn || pOut);
  if (eOut >= 0) poly.push(lanePoint(g, eOut, Math.min(R, g.len[eOut])));
  const turning = eIn >= 0 && eOut >= 0 && turnOf(g, eIn, eOut) !== 'straight';
  m = { eIn, eOut, node, poly, w: turning ? BOX.turnHalfW : BOX.halfW };
  g._moves.set(key, m);
  return m;
}

/** Distance from point (px, pz) to segment a-b. */
export function segPointDist(px, pz, a, b) {
  const dx = b[0] - a[0], dz = b[1] - a[1], L2 = dx * dx + dz * dz;
  const t = L2 > 0 ? Math.max(0, Math.min(1, ((px - a[0]) * dx + (pz - a[1]) * dz) / L2)) : 0;
  return Math.hypot(px - a[0] - dx * t, pz - a[1] - dz * t);
}

function cross(o, a, b) { return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]); }

/** Distance between segments a-b and c-d (0 when they cross). */
function segDist(a, b, c, d) {
  const d1 = cross(a, b, c), d2 = cross(a, b, d), d3 = cross(c, d, a), d4 = cross(c, d, b);
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return 0;
  return Math.min(segPointDist(c[0], c[1], a, b), segPointDist(d[0], d[1], a, b), segPointDist(a[0], a[1], c, d), segPointDist(b[0], b[1], c, d));
}

/** Smallest distance between two polylines. */
export function polyDist(P, Q) {
  let best = Infinity;
  for (let i = 0; i + 1 < P.length; i++) for (let j = 0; j + 1 < Q.length; j++) best = Math.min(best, segDist(P[i], P[i + 1], Q[j], Q[j + 1]));
  if (P.length === 1 || Q.length === 1) { // a single point (a car parked on the node)
    const [A, B] = P.length === 1 ? [P, Q] : [Q, P];
    for (let j = 0; j + 1 < B.length; j++) best = Math.min(best, segPointDist(A[0][0], A[0][1], B[j], B[j + 1]));
  }
  return best;
}

/**
 * Do two movements through the same junction cross or merge (or turn too close)? Cars from the
 * same lane to the same exit just follow; from the same lane to different exits they do not
 * (the one turning off is still in the box, out of sight of the car-following).
 */
export function movesConflict(a, b) {
  if (a.eIn >= 0 && a.eIn === b.eIn && a.eOut === b.eOut) return false;
  return polyDist(a.poly, b.poly) < (a.w ?? BOX.halfW) + (b.w ?? BOX.halfW) + BOX.gapM;
}

/** 'left' | 'right' | 'straight' for a car going eIn -> eOut. */
export function turnOf(g, eIn, eOut) {
  if (eIn < 0 || eOut < 0) return 'straight';
  const rel = ((g.bearing(eOut) - g.bearing(eIn) + 540) % 360) - 180; // + = clockwise = right
  return rel > 30 && rel < 150 ? 'right' : rel < -30 && rel > -150 ? 'left' : 'straight';
}

/**
 * Where a bus or train is and will be: [{ x, z, t }] (t = seconds from now; 0 for its body).
 * veh: { x, z, yaw, halfW, halfL, v, sweep?() } (sweep: from the timetable, buses.js); without
 * one, straight on at speed v. Cached on the vehicle (one per frame).
 */
export function vehicleSweep(veh) {
  if (veh._sweep) return veh._sweep;
  if (veh.sweep) return (veh._sweep = veh.sweep());
  const r = (veh.yaw * Math.PI) / 180, fx = Math.sin(r), fz = Math.cos(r), out = [];
  for (let s = -veh.halfL; s <= veh.halfL + 1e-6; s += 2) out.push({ x: veh.x + fx * s, z: veh.z + fz * s, t: 0 });
  const v = veh.v || 0;
  if (v > 0.2) {
    for (let t = 0.25; t <= BOX.horizonS + 1e-6; t += 0.25) {
      const s = veh.halfL + v * t;
      out.push({ x: veh.x + fx * s, z: veh.z + fz * s, t });
    }
  }
  return (veh._sweep = out);
}

/** Will the vehicle's sweep (within T seconds) come closer to the path than its half width plus a car's? */
export function sweepHits(poly, samples, halfW, T) {
  const reach = halfW + BOX.carHalfW + 0.3;
  for (const p of samples) {
    if (p.t > T) continue;
    for (let i = 0; i + 1 < poly.length; i++) if (segPointDist(p.x, p.z, poly[i], poly[i + 1]) < reach) return true;
  }
  return false;
}

/**
 * Is the vehicle behind (or beside) the car in its own lane, heading the same way? Then the car
 * cannot get out of its way by waiting: it ignores it (the bus holds back instead, buses.js).
 * pose: the car's { x, z, yaw }.
 */
export function behindInLane(pose, veh) {
  const r = (pose.yaw * Math.PI) / 180, fx = Math.sin(r), fz = Math.cos(r);
  const dx = veh.x - pose.x, dz = veh.z - pose.z;
  const along = dx * fx + dz * fz, across = dx * fz - dz * fx;
  const turn = Math.abs(((veh.yaw - pose.yaw + 540) % 360) - 180);
  return along < 0.5 && Math.abs(across) < 2.6 && turn < 50;
}

/** Seconds for a car at speed v to cover d metres (gentle start, IDM-like acceleration a). */
export function clearTime(v, d, a = 1.4) {
  if (d <= 0) return 0;
  return (-v + Math.sqrt(v * v + 2 * a * d)) / a;
}
