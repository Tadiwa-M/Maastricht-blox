// Daily routines (src/life/routines.js): who is out where and when, and groups heading somewhere.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pull, nightFactor, placesUnity, placeDist, spotPulls, spotWeights, goalPlan, pickGoal, eventCrowd, eventOutfit,
  PLACES_RD } from '../src/life/routines.js';
import { crowdFactor } from '../src/life/density.js';
import { eventsAt, dayNumber, carnavalDays } from '../src/life/calendar.js';
import { WalkGraph, Walker, rng } from '../src/life/walkgraph.js';
import { PLACES_RD as NAMED } from '../src/places.js';

const MON = 0, TUE = 1, THU = 3, FRI = 4, SAT = 5, SUN = 6;

test('students in the morning, shoppers by day, commuters at 8 and 17, nightlife at night', () => {
  assert.ok(pull('study', 8.5, TUE) > 2.5 && pull('study', 8.5, SAT) === 1 && pull('study', 22, TUE) === 1);
  assert.ok(pull('shop', 13, SAT) > 2.5 && pull('shop', 22, SAT) === 1);
  assert.ok(pull('shop', 10, MON) < pull('shop', 10, TUE), 'Monday: shops open late');
  assert.ok(pull('shop', 20.5, THU) > pull('shop', 20.5, TUE), 'Thursday: late-night shopping');
  assert.ok(pull('shop', 10.5, SUN) === 1 && pull('shop', 14, SUN) > 2);
  assert.ok(pull('commute', 8, TUE) > pull('commute', 12, TUE) + 1 && pull('commute', 17.2, TUE) > pull('commute', 14, TUE) + 1);
  assert.ok(pull('night', 23, SAT) > pull('night', 23, TUE), 'Saturday night out');
  assert.ok(pull('night', 1, SUN) > 2, 'Sunday 1 am is still Saturday night');
  assert.ok(pull('night', 23, THU) > 2.5, 'Thursday: the students go out');
  assert.equal(pull('night', 12, SAT), 1);
});

test('almost nobody out at 3 am on a weeknight; nights out keep their crowd', () => {
  assert.ok(crowdFactor(3, TUE) * nightFactor(3, TUE) < 0.04);
  assert.ok(nightFactor(1, SAT) > 1.1, 'Friday night');
  assert.ok(nightFactor(3, SAT) > 0.9);
  assert.equal(nightFactor(14, TUE), 1);
  assert.equal(nightFactor(14, SAT), 1);
  for (let h = 0; h < 24; h += 0.25) for (let d = 0; d < 7; d++) assert.ok(nightFactor(h, d) > 0.3 && nightFactor(h, d) <= 1.25);
});

test('places: real Maastricht geometry, in world metres', () => {
  const near = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  assert.ok(near(PLACES_RD.markt.a, NAMED.markt) < 40);
  assert.ok(near(PLACES_RD.vrijthof.a, NAMED.vrijthof) < 50);
  assert.ok(near(PLACES_RD.station.a, NAMED.station) < 40);
  assert.ok(near(PLACES_RD.brugstraat.b, NAMED.brug) < 100, 'the Brugstraat ends at the bridge');
  const P = placesUnity([175700, 316500]);
  assert.equal(P.markt.ax, PLACES_RD.markt.a[0] - 175700);
  assert.ok(placeDist(P.grotestaat, P.grotestaat.ax + 50, P.grotestaat.az) < 1, 'on the street');
  assert.ok(Math.abs(placeDist(P.grotestaat, P.grotestaat.ax - 10, P.grotestaat.az) - 10) < 0.5, 'beyond its end');
});

test('spawn weights: x pull near a place, fading out, untouched far away', () => {
  const P = { sq: { ax: 0, az: 0, bx: 0, bz: 0, r: 50 } };
  const xs = Float32Array.from([0, 40, 60, 90, 300]), zs = new Float32Array(5), w = new Float32Array(5).fill(2);
  const out = spotWeights(w, xs, zs, P, { sq: 3 });
  assert.equal(out[0], 6); assert.equal(out[1], 6);
  assert.ok(out[2] > 2 && out[2] < 6, 'fading');
  assert.equal(out[3], 2); assert.equal(out[4], 2);
  assert.equal(w[0], 2, 'input unchanged');
  assert.equal(spotWeights(w, xs, zs, P, { sq: 1 })[0], 2);
});

test('pulls with events, goal plans and picks', () => {
  const quiet = spotPulls(3, TUE, []);
  assert.ok(Object.values(quiet).every((k) => k < 1.1), 'nothing pulls at 3 am on a Tuesday');
  const P = placesUnity([175700, 316500]);
  assert.equal(goalPlan(P, quiet).share < 0.05, true);
  const morning = goalPlan(P, spotPulls(8.5, TUE, []));
  assert.ok(morning.share > 0.4);
  const top = morning.goals.slice().sort((a, b) => b.w - a.w)[0];
  assert.ok(['tongersestraat', 'minderbroedersberg', 'grotegracht', 'randwyck', 'station'].includes(top.name), top.name);
  const [fri] = carnavalDays(2027);
  const ev = eventsAt(fri + 1, 15);
  const carn = spotPulls(15, SAT, ev);
  assert.ok(carn.vrijthof > 2.5 && carn.markt > 2.5);
  assert.ok(eventCrowd(ev) > 1.5 && eventOutfit(ev).style === 'carnaval');
  assert.equal(eventCrowd([]), 1); assert.equal(eventOutfit([]), null);
  const plan = { share: 0.5, goals: [{ name: 'a', w: 1 }, { name: 'b', w: 3 }] };
  assert.equal(pickGoal(plan, 0.6, 0.1), null);
  assert.equal(pickGoal(plan, 0.1, 0.1).name, 'a');
  assert.equal(pickGoal(plan, 0.1, 0.9).name, 'b');
  assert.equal(pickGoal(null, 0, 0), null);
  const pre = spotPulls(15, SAT, eventsAt(dayNumber(2026, 8, 29), 15));
  assert.ok(pre.vrijthof > 3.5, 'Preuvenemint fills the Vrijthof');
});

test('a walker with a goal heads there; without one it wanders', () => {
  const n = 31, nodes = [], edges = [];
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) nodes.push((i - 15) * 10, (j - 15) * 10);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    if (i < n - 1) edges.push(j * n + i, j * n + i + 1);
    if (j < n - 1) edges.push(j * n + i, (j + 1) * n + i);
  }
  const g = new WalkGraph({ nodes, edges, weights: nodes.map(() => 1) });
  const run = (goal, seed) => {
    const w = new Walker(g, 15 * n + 15, rng(seed), { speed: 1.4 });
    w.goal = goal;
    for (let s = 0; s < 600; s++) w.step(0.1);
    return w;
  };
  let east = 0, free = 0;
  for (let seed = 1; seed <= 10; seed++) { east += run({ x: 1000, z: 0 }, seed).x; free += run(null, seed).x; }
  assert.ok(east / 10 > 50, `heads east: ${(east / 10).toFixed(1)} m`);
  assert.ok(Math.abs(free / 10) < east / 20, 'wanders without one');
});
