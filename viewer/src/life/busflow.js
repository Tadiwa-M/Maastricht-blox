// Timetable vehicles in traffic. Buses and trains run on their timetable (buses.js), so they
// cannot brake for the cars; instead
// - their sweep says where they are and will be over the next seconds (from the timetable, so a
//   bus about to pull out of a stop counts too): cars wait for it at junctions (traffic.js), and
// - a small per-trip lag lets a bus hold back for a car, bike or person right in front of it
//   (seconds behind its timetable, at most HOLD.maxLagS), which it then makes up by running a
//   little faster (HOLD.catchUp) and shorter stops.
// Pure (no three.js), tested in test/life.busflow.test.mjs.

export const HOLD = {
  lookS: 1.5, // the bus wants this many seconds of free road ahead (at its timetable speed) ...
  minM: 3.5, // ... and at least this many metres
  clearM: 0.8, // closer than this: it stands still
  maxLagS: 120, // never more than this far behind the timetable (then it just goes) ...
  endShare: 0.2, // ... nor more than this share of the time left to its last stop (it arrives there)
  catchUp: 0.25, // making up lag: seconds per second (runs 25% faster than its timetable)
};
export const SWEEP = { horizonS: 8, dtS: 0.25, bodyStepM: 2 };

/**
 * Where a vehicle is and will be: [{ x, z, t }]: its body now (t = 0, rear to front every
 * bodyStepM) and its front every dtS seconds up to horizon. point(d) -> { x, z } on its path at
 * distance d; distAt(t) -> its distance along the path t seconds from now.
 */
export function sweepSamples(point, distAt, halfL, horizon = SWEEP.horizonS) {
  const d = distAt(0), out = [];
  const n = Math.max(1, Math.ceil((2 * halfL) / SWEEP.bodyStepM));
  for (let k = 0; k <= n; k++) { const p = point(d - halfL + (2 * halfL * k) / n); out.push({ x: p.x, z: p.z, t: 0 }); }
  let last = d;
  for (let t = SWEEP.dtS; t <= horizon + 1e-6; t += SWEEP.dtS) {
    const dt = distAt(t);
    if (dt - last < 0.5) continue; // standing (at a stop): nothing new
    last = dt;
    const p = point(dt + halfL);
    out.push({ x: p.x, z: p.z, t });
  }
  return out;
}

/**
 * Point on a PathMover's polyline at distance s, laneM to the right of it (binary search: sweeps
 * ask for many points a frame): { x, z }. Unlike mover.poseAt it does not round the corners.
 */
export function pathPoint(m, s, laneM = 0) {
  const cum = m.cum, n = cum.length;
  s = Math.max(0, Math.min(m.length, s));
  let lo = 1, hi = n - 1;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (cum[mid] < s) lo = mid + 1; else hi = mid; }
  const a = m.pts[lo - 1], b = m.pts[lo], L = cum[lo] - cum[lo - 1] || 1, f = (s - cum[lo - 1]) / L;
  const len = Math.hypot(b[0] - a[0], b[2] - a[2]) || 1, dx = (b[0] - a[0]) / len, dz = (b[2] - a[2]) / len;
  return { x: a[0] + (b[0] - a[0]) * f + dz * laneM, z: a[2] + (b[2] - a[2]) * f - dx * laneM };
}

/** Is (px, pz) inside footprint f ({ x, z, yaw, halfW, halfL }) grown by margin? */
function inside(f, px, pz, margin) {
  const r = (f.yaw * Math.PI) / 180, fx = Math.sin(r), fz = Math.cos(r);
  const dx = px - f.x, dz = pz - f.z;
  return Math.abs(dx * fx + dz * fz) <= f.halfL + margin && Math.abs(dx * fz - dz * fx) <= f.halfW + margin;
}

/**
 * Free road ahead of a vehicle (m): ahead = [{ x, z, a }] points on its path, a = metres ahead of
 * its front; blockers = footprints { x, z, yaw, halfW, halfL } or circles { x, z, r }. The first
 * point within halfW of a blocker, Infinity if none.
 */
export function aheadGap(ahead, halfW, blockers) {
  let gap = Infinity;
  for (const b of blockers) {
    for (const p of ahead) {
      if (p.a >= gap) break;
      const hit = b.halfL !== undefined ? inside(b, p.x, p.z, halfW) : Math.hypot(p.x - b.x, p.z - b.z) < halfW + (b.r || 0.4);
      if (hit) { gap = p.a; break; }
    }
  }
  return gap;
}

/** Metres of free road a vehicle at timetable speed v wants ahead of it. */
export const wantAhead = (v) => HOLD.minM + v * HOLD.lookS;

/** Most lag a trip may have with `left` timetable seconds to its last stop. */
export const lagCap = (left) => Math.max(0, Math.min(HOLD.maxLagS, HOLD.endShare * left));

/**
 * Lag (s behind the timetable) after dt seconds, with `gap` metres free ahead at timetable speed
 * v: hold back (the lag grows by up to dt: standing still) while the road ahead is short, make
 * it up otherwise, and whenever it is above `cap` (lagCap).
 */
export function nextLag(lag, gap, v, dt, cap = HOLD.maxLagS) {
  const want = wantAhead(v);
  if (lag > cap) return Math.max(0, lag - HOLD.catchUp * dt); // too late (or its trip ends soon): make it up
  if (v > 0.3 && gap < want) {
    if (lag >= cap) return lag; // far enough behind: on at timetable speed, whatever is there
    const share = Math.max(0, gap - HOLD.clearM) / (want - HOLD.clearM); // share of its timetable speed
    return Math.min(cap, lag + dt * (1 - share));
  }
  return Math.max(0, lag - HOLD.catchUp * dt);
}
