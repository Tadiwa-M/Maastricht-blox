// Trip planner: RAPTOR (Round-bAsed Public Transit Optimized Router, Delling et al. 2012), the
// search behind modern transit apps, over the timetable the game already loads
// (life/transit.json v2 via life/schedule.js Timetable). Pure; tested in test/plan-raptor.test.mjs.
//
// Round k finds the earliest arrival at every stop using at most k buses. Each round scans the
// patterns (a line's stop sequence) serving stops improved in the previous round, boards the
// earliest trip that can be caught there and rides it; then walking transfers to stops within
// TRANSFER_M relax from every improved stop. Origin and destination connect to stops within
// ACCESS_M on foot. Walking time is the straight-line distance x DETOUR at WALK_MS (the route
// on the walk graph comes with drawing, R3b). Live delays (Timetable.delays, from the relay)
// shift their trips. The result is a few journeys: the fastest, one with fewer transfers if it
// is not much slower, and the next departures after them.

export const PLAN = {
  walk: 1.3, // m/s
  detour: 1.25, // walking distance / straight line
  accessM: 1200, // walk at most this far to the first stop / from the last
  transferM: 350, // walking transfer between stops
  transferSlack: 60, // s: a transfer at the same stop needs this long
  rounds: 4, // at most this many buses in a journey
  fewerTransfersSlack: 600, // s: a journey with fewer transfers is offered if it arrives within this
};

const INF = Infinity;

export class TripPlanner {
  /** tt: Timetable (life/schedule.js) of a v2 transit.json (stops and pattern stop lists). */
  constructor(tt, o = {}) {
    this.tt = tt;
    this.o = { ...PLAN, ...o };
    const stops = tt.stops || [];
    this.n = stops.length;
    this.sx = Float64Array.from(stops, (s) => s.x);
    this.sz = Float64Array.from(stops, (s) => s.y);
    // the patterns calling at each stop, with the position(s) of that stop in the pattern
    this.byStop = Array.from({ length: this.n }, () => []);
    tt.patterns.forEach((p, pi) => (p.stops || []).forEach((s, i) => this.byStop[s].push([pi, i])));
    // walking transfers between nearby stops (a grid keeps it linear)
    const cell = this.o.transferM, grid = new Map();
    const key = (x, z) => `${Math.floor(x / cell)},${Math.floor(z / cell)}`;
    for (let s = 0; s < this.n; s++) {
      const k = key(this.sx[s], this.sz[s]);
      if (!grid.has(k)) grid.set(k, []);
      grid.get(k).push(s);
    }
    this.grid = grid; this.cell = cell;
    this.foot = Array.from({ length: this.n }, () => []);
    for (let a = 0; a < this.n; a++) {
      for (const b of this.near(this.sx[a], this.sz[a], this.o.transferM)) {
        if (b !== a) this.foot[a].push([b, this.walkSec(a, b)]);
      }
    }
    this.day = null;
  }

  /** Stops within r metres of (x, z) (Unity metres). */
  near(x, z, r) {
    const out = [], c = this.cell, n = Math.ceil(r / c);
    const ci = Math.floor(x / c), cj = Math.floor(z / c);
    for (let i = ci - n; i <= ci + n; i++) {
      for (let j = cj - n; j <= cj + n; j++) {
        for (const s of this.grid.get(`${i},${j}`) || []) if (Math.hypot(this.sx[s] - x, this.sz[s] - z) <= r) out.push(s);
      }
    }
    return out;
  }

  walkSecM(m) { return (m * this.o.detour) / this.o.walk; }
  walkSec(a, b) { return this.walkSecM(Math.hypot(this.sx[a] - this.sx[b], this.sz[a] - this.sz[b])); }

  /**
   * Today's trips per pattern, sorted: [{ q (trips row), start (s since today's midnight) }].
   * Trips of the previous service day that run past midnight count, shifted by -24 h.
   */
  prepareDay(day) {
    if (this.day === day) return;
    const tt = this.tt;
    this.byPattern = tt.patterns.map(() => []);
    const prev = (day + 6) % 7;
    tt.trips.forEach(([pi, start, mask], q) => {
      if (mask & (1 << day)) this.byPattern[pi].push({ q, start });
      if (mask & (1 << prev) && start + tt.patterns[pi].duration >= 86400) this.byPattern[pi].push({ q, start: start - 86400 });
    });
    for (const list of this.byPattern) list.sort((a, b) => a.start - b.start);
    this.day = day;
  }

  /** Arrival and departure (s since today's midnight) of trip t of pattern pi at its stop position i. */
  times(pi, t, i) {
    const st = this.tt.patterns[pi].st;
    const d = this.tt.delaysOn === false ? 0 : this.tt.delays?.get(t.q) ?? 0;
    const arr = t.start + st[3 * i] + d;
    return [arr, Math.max(arr, t.start + st[3 * i + 1] + d)];
  }

  /** The earliest trip of pattern pi leaving its stop position i at or after `when`. */
  catchable(pi, i, when) {
    const list = this.byPattern[pi];
    const off = this.tt.patterns[pi].st[3 * i + 1];
    // trips are sorted by start: binary search on the scheduled departure, then step over delays
    let lo = 0, hi = list.length;
    const slack = Math.max(0, this.tt.maxDelay || 0);
    while (lo < hi) { const m = (lo + hi) >> 1; if (list[m].start + off < when - slack) lo = m + 1; else hi = m; }
    for (let k = lo; k < list.length; k++) {
      if (this.times(pi, list[k], i)[1] >= when) return list[k];
      if (list[k].start + off > when + slack + 3600) break;
    }
    return null;
  }

  /**
   * One RAPTOR search. from/to: [x, z] Unity metres; day (0 = Monday); sec: leave at or after.
   * Returns the best journey per number of buses: [{ rides, arr, legs }] (Pareto front).
   */
  search(from, to, day, sec) {
    this.prepareDay(day);
    const o = this.o, n = this.n, K = o.rounds;
    const best = new Float64Array(n).fill(INF);
    const tau = [new Float64Array(n).fill(INF)];
    const label = [new Array(n).fill(null)];
    let marked = new Set();
    for (const s of this.near(from[0], from[1], o.accessM)) {
      const t = sec + this.walkSecM(Math.hypot(this.sx[s] - from[0], this.sz[s] - from[1]));
      if (t < tau[0][s]) { tau[0][s] = best[s] = t; label[0][s] = { mode: 'walk', from: null, dep: sec, arr: t }; marked.add(s); }
    }
    const egress = new Map();
    for (const s of this.near(to[0], to[1], o.accessM)) egress.set(s, this.walkSecM(Math.hypot(this.sx[s] - to[0], this.sz[s] - to[1])));
    const direct = sec + this.walkSecM(Math.hypot(to[0] - from[0], to[1] - from[1]));
    const front = [];
    let bestTarget = INF; // walking all the way is offered on its own: it must not prune the buses
    for (let k = 1; k <= K && marked.size; k++) {
      tau.push(Float64Array.from(tau[k - 1]));
      label.push(new Array(n).fill(null));
      // patterns to scan, from their earliest marked stop position
      const queue = new Map();
      for (const s of marked) for (const [pi, i] of this.byStop[s]) if (!queue.has(pi) || i < queue.get(pi)) queue.set(pi, i);
      const improved = new Set();
      for (const [pi, i0] of queue) {
        const stops = this.tt.patterns[pi].stops;
        let trip = null, boardI = -1, boardStop = -1, boardDep = 0;
        for (let i = i0; i < stops.length; i++) {
          const s = stops[i];
          if (trip) {
            const [arr] = this.times(pi, trip, i);
            if (arr < Math.min(best[s], bestTarget)) {
              tau[k][s] = best[s] = arr;
              label[k][s] = { mode: 'bus', pattern: pi, trip, fromI: boardI, toI: i, fromStop: boardStop, dep: boardDep, arr };
              improved.add(s);
            }
          }
          // can we catch an earlier trip here (having arrived in the previous round)?
          const ready = tau[k - 1][s] + (k > 1 && label[k - 1][s]?.mode === 'bus' ? o.transferSlack : 0);
          if (ready < INF && (!trip || ready <= this.times(pi, trip, i)[1])) {
            const t = this.catchable(pi, i, ready);
            if (t && (!trip || t !== trip)) {
              const dep = this.times(pi, t, i)[1];
              if (!trip || dep <= this.times(pi, trip, i)[1]) { trip = t; boardI = i; boardStop = s; boardDep = dep; }
            }
          }
        }
      }
      // walking transfers from the stops improved by a bus this round
      const walked = new Set();
      for (const a of improved) {
        for (const [b, w] of this.foot[a]) {
          const t = tau[k][a] + w;
          if (t < Math.min(best[b], bestTarget)) {
            tau[k][b] = best[b] = t;
            label[k][b] = { mode: 'walk', from: a, dep: tau[k][a], arr: t };
            walked.add(b);
          }
        }
      }
      marked = new Set([...improved, ...walked]);
      // best arrival at the destination with k buses
      let arr = INF, last = -1;
      for (const [s, w] of egress) if (tau[k][s] + w < arr && label[k][s]) { arr = tau[k][s] + w; last = s; }
      if (last >= 0 && arr < bestTarget) {
        bestTarget = arr;
        front.push({ rides: k, arr, legs: this.legs(label, k, last, from, to, arr) });
      }
    }
    front.unshift({ rides: 0, arr: direct, legs: [walkLeg(from, to, sec, direct)] });
    return front;
  }

  /** Legs of the journey ending at stop `last` in round k (walk, bus, walk, ...). */
  legs(label, k, last, from, to, arrive) {
    const out = [];
    let s = last, r = k;
    const egressSec = arrive - this.bestAt(label, k, last);
    out.push(walkLeg(this.pos(last), to, arrive - egressSec, arrive, this.tt.stops[last].name, null));
    while (r >= 0 && s >= 0) {
      const l = label[r][s];
      if (!l) { r--; continue; }
      if (l.mode === 'bus') {
        const p = this.tt.patterns[l.pattern], route = this.tt.routes[p.route] || {};
        out.push({ mode: 'bus', line: route.short, colour: route.colour, head: p.head, pattern: l.pattern, trip: l.trip.q,
          from: this.stopRef(l.fromStop), to: this.stopRef(s), dep: l.dep, arr: l.arr, stops: l.toI - l.fromI,
          live: this.tt.delays?.has(l.trip.q) ?? false, fromI: l.fromI, toI: l.toI });
        s = l.fromStop; r--;
      } else if (l.from === null) {
        out.push(walkLeg(from, this.pos(s), l.dep, l.arr, null, this.tt.stops[s].name));
        break;
      } else {
        out.push(walkLeg(this.pos(l.from), this.pos(s), l.dep, l.arr, this.tt.stops[l.from].name, this.tt.stops[s].name));
        s = l.from;
      }
    }
    return out.reverse().filter((l) => l.mode === 'bus' || l.arr - l.dep >= 1);
  }

  bestAt(label, k, s) { return label[k][s]?.arr ?? INF; }
  pos(s) { return [this.sx[s], this.sz[s]]; }
  stopRef(s) { return { stop: s, name: this.tt.stops[s].name, x: this.sx[s], z: this.sz[s] }; }

  /**
   * A few good journeys from `from` to `to` leaving at or after (day, sec): the fastest, a
   * fewer-transfers one if not much slower, and the next departures. Sorted by arrival.
   * Each: { dep, arr, duration, walkSec, transfers, legs, lines }.
   */
  plan(from, to, day, sec, count = 3) {
    const out = [], seen = new Set();
    let t = sec;
    for (let tries = 0; out.length < count && tries < count + 3; tries++) {
      const front = this.search(from, to, day, t);
      const walk = front[0]; // rides 0
      const buses = front.filter((j) => j.rides > 0);
      // like a maps app: bus options are listed even when walking is quicker; walking is listed
      // first time round when it is the fastest
      const fastest = buses.length ? buses.reduce((a, b) => (b.arr < a.arr ? b : a)) : walk;
      const picks = [fastest];
      if (tries === 0 && walk.arr < fastest.arr) picks.push(walk);
      const fewer = buses.filter((j) => j.rides < fastest.rides && j.arr <= fastest.arr + this.o.fewerTransfersSlack);
      if (fewer.length) picks.push(fewer[0]);
      for (const j of picks) {
        const sum = summarise(j);
        const id = sum.legs.map((l) => (l.mode === 'bus' ? `${l.trip}:${l.from.stop}` : '')).join('|') || `walk${sum.arr}`;
        if (!seen.has(id)) { seen.add(id); out.push(sum); }
      }
      const firstBus = fastest.legs.find((l) => l.mode === 'bus');
      if (!firstBus) break; // walking is best: later departures won't beat it
      const walkIn = fastest.legs[0].mode === 'walk' ? fastest.legs[0].arr - fastest.legs[0].dep : 0;
      t = firstBus.dep - walkIn + 60; // leave a minute after the previous option would have left
    }
    return out.sort((a, b) => a.arr - b.arr).slice(0, count);
  }
}

function walkLeg(a, b, dep, arr, fromName = null, toName = null) {
  return { mode: 'walk', from: { x: a[0], z: a[1], name: fromName }, to: { x: b[0], z: b[1], name: toName }, dep, arr,
    dist: Math.round(Math.hypot(b[0] - a[0], b[1] - a[1]) * PLAN.detour) };
}

/** Totals of a journey for the results list. */
export function summarise(j) {
  const legs = j.legs;
  const buses = legs.filter((l) => l.mode === 'bus');
  // leave as late as possible: the first walk ends when the first bus leaves
  if (legs[0]?.mode === 'walk' && buses.length) {
    const w = legs[0].arr - legs[0].dep;
    legs[0].arr = buses[0].dep; legs[0].dep = buses[0].dep - w;
  }
  const dep = legs[0].dep, arr = legs[legs.length - 1].arr;
  return {
    dep, arr, duration: arr - dep, legs,
    walkSec: legs.filter((l) => l.mode === 'walk').reduce((a, l) => a + (l.arr - l.dep), 0),
    transfers: Math.max(0, buses.length - 1), lines: buses.map((b) => b.line), live: buses.some((b) => b.live),
  };
}
