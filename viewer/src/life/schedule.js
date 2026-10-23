// Timetable buses (life/transit.json, see docs/guide/05-movers-and-models.md): which trips
// run at a moment of the week and how far along their shape each one is.
//
// A trip is [pattern, startSec, dayMask]; a pattern holds its stop times relative to the
// start as (arrival, departure, distAlongShape) triplets. Position = distance interpolated
// between the bracketing stop times; between arrival and departure the bus dwells. When the
// feed gives no dwell (arrival == departure) a short one is added by leaving a little later
// (arrivals stay on time). Trips after midnight (start or stops >= 24:00) belong to the
// previous service day. Pure logic, tested in test/life.schedule.test.mjs.

export const DWELL_S = 15;

/**
 * Distance along the shape at time tRel (seconds since the trip's first stop), or null
 * before the first arrival / after the last arrival. st: flat [arr, dep, dist, ...].
 */
export function tripDistAt(st, tRel, dwell = DWELL_S) {
  const n = st.length / 3;
  if (n < 1 || tRel < st[0] || tRel > st[3 * (n - 1)]) return null;
  for (let i = 0; i < n - 1; i++) {
    const arr = st[3 * i], dep = st[3 * i + 1], d = st[3 * i + 2];
    const nArr = st[3 * i + 3], nD = st[3 * i + 5];
    if (tRel < arr) return d; // (only if times go backwards)
    let leave = dep;
    if (dep <= arr && i > 0) leave = arr + Math.min(dwell, 0.3 * Math.max(0, nArr - arr));
    if (tRel <= leave) return d;
    if (tRel <= nArr) {
      const span = nArr - leave;
      return span > 0 ? d + (nD - d) * ((tRel - leave) / span) : nD;
    }
  }
  return st[3 * (n - 1) + 2];
}

export class Timetable {
  /** doc: parsed transit.json. */
  constructor(doc) {
    this.routes = doc.routes || [];
    this.shapes = (doc.shapes || []).map((s) => {
      const pts = [], cum = [];
      for (let q = 0; q < s.pts.length; q += 3) { pts.push([s.pts[q], s.pts[q + 1]]); cum.push(s.pts[q + 2]); }
      return { id: s.id, pts, cum, d0: cum[0], d1: cum[cum.length - 1] };
    });
    this.patterns = (doc.patterns || []).map((p) => ({ ...p, duration: p.st[p.st.length - 3] }));
    this.trips = (doc.trips || []).slice().sort((a, b) => a[1] - b[1]);
    this.starts = Float64Array.from(this.trips, (t) => t[1]);
    this.maxDuration = this.patterns.reduce((m, p) => Math.max(m, p.duration), 0);
    this.week = doc.meta?.week || null;
  }

  /** Index of the first trip starting at or after sec. */
  lowerBound(sec) {
    let lo = 0, hi = this.starts.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (this.starts[mid] < sec) lo = mid + 1; else hi = mid; }
    return lo;
  }

  /**
   * Trips under way at (day 0 = Monday, sec since midnight) inside their shape's exported
   * part: [{ id, trip, pattern, shape, route, dist }]. id is stable while the trip runs.
   */
  activeAt(day, sec) {
    const out = [];
    // today's service day, and yesterday's trips still running after midnight
    for (const [d, s] of [[day, sec], [(day + 6) % 7, sec + 86400]]) {
      const bit = 1 << d;
      for (let q = this.lowerBound(s - this.maxDuration); q < this.trips.length && this.starts[q] <= s; q++) {
        const [pi, start, mask] = this.trips[q];
        if (!(mask & bit)) continue;
        const pattern = this.patterns[pi];
        const dist = tripDistAt(pattern.st, s - start, DWELL_S);
        if (dist === null) continue;
        const shape = this.shapes[pattern.shape];
        if (dist < shape.d0 || dist > shape.d1) continue;
        out.push({ id: `${d}:${q}`, trip: q, pattern, shape, route: this.routes[pattern.route], dist });
      }
    }
    return out;
  }
}
