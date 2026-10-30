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
    // v2 (stops, trip ids): absent in v1 exports, then names and boards are simply unavailable
    this.stops = doc.stops || [];
    this.tripIds = doc.tripIds || null;
    this.version = doc.version || 1;
  }

  /** Is this trips row running on (day, sec)? -> seconds since its start, or null. */
  elapsed(q, day, sec) {
    const [, start, mask] = this.trips[q];
    for (const [d, s] of [[day, sec], [(day + 6) % 7, sec + 86400]]) {
      if (mask & (1 << d) && s >= start && s - start <= this.patterns[this.trips[q][0]].duration) return s - start;
    }
    return null;
  }

  /**
   * Upcoming departures from stop index `stop` after (day, sec), soonest first:
   * [{ trip, pattern, route, head, inSec, at (sec of day) }]. Only stops before the last call.
   */
  departures(stop, day, sec, n = 8, horizon = 3 * 3600) {
    const out = [];
    for (const [d, s] of [[day, sec], [(day + 6) % 7, sec + 86400]]) {
      const bit = 1 << d;
      for (let q = this.lowerBound(s - this.maxDuration); q < this.trips.length && this.starts[q] <= s + horizon; q++) {
        const [pi, start, mask] = this.trips[q];
        if (!(mask & bit)) continue;
        const pat = this.patterns[pi], k = pat.stops ? pat.stops.indexOf(stop) : -1;
        if (k < 0 || k === pat.stops.length - 1) continue;
        const at = start + pat.st[3 * k + 1];
        if (at < s || at > s + horizon) continue;
        out.push({ trip: q, pattern: pat, route: this.routes[pat.route], head: pat.head, inSec: at - s, at: at % 86400 });
      }
    }
    return out.sort((a, b) => a.inSec - b.inSec).slice(0, n);
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
        out.push({ id: `${d}:${q}`, trip: q, pattern, shape, route: this.routes[pattern.route], dist, tRel: s - start });
      }
    }
    return out;
  }
}

/**
 * The calls still ahead of a vehicle tRel seconds into its pattern:
 * [{ k (call index), stop (index into Timetable.stops or -1), inSec, dist }]. A call counts as
 * ahead until the vehicle leaves it (dwelling at a stop: that stop is still "next").
 */
export function upcomingCalls(pattern, tRel) {
  const out = [], st = pattern.st, n = st.length / 3;
  for (let k = 0; k < n; k++) {
    const dep = Math.max(st[3 * k], st[3 * k + 1]);
    if (dep < tRel) continue;
    out.push({ k, stop: pattern.stops ? pattern.stops[k] : -1, inSec: Math.max(0, st[3 * k] - tRel), dist: st[3 * k + 2] });
  }
  return out;
}

/** "now", "1 min", "12 min" for a wait in seconds. */
export function waitLabel(sec) {
  if (sec < 45) return 'now';
  return `${Math.round(sec / 60)} min`;
}
