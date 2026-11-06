// Trip planner (src/plan/raptor.js) on a small synthetic network with known answers.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Timetable } from '../src/life/schedule.js';
import { TripPlanner, summarise } from '../src/plan/raptor.js';

// stops on a line west -> east (A..D, y = 0) and north (E at the transfer stop C, F north)
//   A(0,0) -- B(1000,0) -- C(2000,0) -- D(3000,0)
//                           |
//                           E(2050,0)  -- F(2050,2000)
const STOPS = [['A', 0, 0], ['B', 1000, 0], ['C', 2000, 0], ['D', 3000, 0], ['E', 2050, 0], ['F', 2050, 2000], ['G', 0, 2000]];
const st = (...mins) => mins.flatMap((m, i) => [m * 60, m * 60, i * 1000]); // arrive = depart, minutes from the start
function timetable({ east = [], north = [], slow = [], mask = 0b1111111 } = {}) {
  return new Timetable({
    version: 2,
    routes: [{ short: '1', colour: '#f00' }, { short: '2', colour: '#00f' }, { short: '9', colour: '#0f0' }],
    stops: STOPS.map(([name, x, y], i) => ({ id: `s${i}`, name, x, y })),
    shapes: [],
    patterns: [
      { route: 0, head: 'D', shape: 0, stops: [0, 1, 2, 3], st: st(0, 3, 6, 9) }, // line 1: A -> D, 3 min a stop
      { route: 1, head: 'F', shape: 0, stops: [4, 5], st: st(0, 5) }, // line 2: E -> F
      { route: 2, head: 'F', shape: 0, stops: [0, 6, 5], st: st(0, 20, 40) }, // line 9: A -> G -> F, slow
    ],
    trips: [...east.map((s) => [0, s, mask]), ...north.map((s) => [1, s, mask]), ...slow.map((s) => [2, s, mask])],
  });
}
const H = 3600, DAY = 1; // Tuesday

test('one bus: walk to the stop, ride, walk on', () => {
  const p = new TripPlanner(timetable({ east: [8 * H, 8 * H + 600] }));
  const [j] = p.plan([0, 50], [3000, 60], DAY, 8 * H - 300);
  assert.deepEqual(j.lines, ['1']);
  assert.equal(j.transfers, 0);
  const bus = j.legs.find((l) => l.mode === 'bus');
  assert.equal(bus.from.name, 'A'); assert.equal(bus.to.name, 'D');
  assert.equal(bus.dep, 8 * H); assert.equal(bus.arr, 8 * H + 540);
  assert.ok(j.legs[0].mode === 'walk' && j.legs[0].arr === 8 * H, 'leave just in time for the bus');
  assert.ok(j.legs.at(-1).mode === 'walk' && j.arr > bus.arr);
});

test('a transfer: line 1 to C, walk 50 m to E, line 2 to F, beating the slow direct line', () => {
  const p = new TripPlanner(timetable({ east: [8 * H], north: [8 * H + 480, 8 * H + 900], slow: [8 * H] }));
  const js = p.plan([0, 0], [2050, 2000], DAY, 8 * H - 60);
  const fast = js[0];
  assert.deepEqual(fast.lines, ['1', '2']);
  assert.equal(fast.transfers, 1);
  assert.ok(fast.legs.some((l) => l.mode === 'walk' && l.from.name === 'C' && l.to.name === 'E'));
  assert.equal(fast.arr, 8 * H + 480 + 300);
  assert.ok(!js.some((j) => j.lines.join() === '9'), '27 min slower: not offered by default');
  const relaxed = new TripPlanner(p.tt, { fewerTransfersSlack: 3600 }).plan([0, 0], [2050, 2000], DAY, 8 * H - 60);
  assert.ok(relaxed.some((j) => j.lines.join() === '9'), 'the no-transfer bus, when within the margin');
});

test('too tight a transfer waits for the next bus', () => {
  // arrive at C at 8:06; walking to E takes ~48 s; the 8:06:30 departure from E is missed
  const p = new TripPlanner(timetable({ east: [8 * H], north: [8 * H + 390, 8 * H + 900] }));
  const [j] = p.plan([0, 0], [2050, 2000], DAY, 8 * H - 60);
  assert.equal(j.legs.find((l) => l.line === '2').dep, 8 * H + 900);
});

test('short trips are walked; the next departures follow the first option', () => {
  const p = new TripPlanner(timetable({ east: [8 * H, 8 * H + 600, 8 * H + 1200] }));
  const [w] = p.plan([0, 0], [300, 0], DAY, 8 * H);
  assert.equal(w.lines.length, 0);
  const js = p.plan([0, 0], [3000, 0], DAY, 8 * H - 120);
  assert.equal(js.length, 3);
  assert.deepEqual(js.map((j) => j.legs.find((l) => l.mode === 'bus').dep), [8 * H, 8 * H + 600, 8 * H + 1200]);
});

test('days, after-midnight trips and live delays', () => {
  const monOnly = new TripPlanner(timetable({ east: [8 * H], mask: 0b0000001 }));
  assert.equal(monOnly.plan([0, 0], [3000, 0], DAY, 7 * H)[0].lines.length, 0, 'no Monday bus on Tuesday: walk');
  const late = new TripPlanner(timetable({ east: [24 * H + 600], mask: 0b0000001 })); // Monday's 00:10 service
  const [n] = late.plan([0, 0], [3000, 0], DAY, 0);
  assert.equal(n.legs.find((l) => l.mode === 'bus').dep, 600);
  const tt = timetable({ east: [8 * H, 8 * H + 1800] });
  tt.setDelays(new Map([[0, 240]])); // the 8:00 runs 4 minutes late
  const [d] = new TripPlanner(tt).plan([0, 0], [3000, 0], DAY, 8 * H + 60);
  const bus = d.legs.find((l) => l.mode === 'bus');
  assert.equal(bus.dep, 8 * H + 240, 'the late bus can still be caught');
  assert.ok(bus.live && d.live);
});

test('summaries: walking time, duration, leave time', () => {
  const p = new TripPlanner(timetable({ east: [8 * H] }));
  const [j] = p.plan([0, 0], [3000, 0], DAY, 7 * H);
  assert.equal(j.duration, j.arr - j.dep);
  assert.ok(j.walkSec >= 0 && j.dep >= 7 * H);
  assert.equal(summarise({ legs: [{ mode: 'walk', dep: 0, arr: 10 }] }).walkSec, 10);
});

test('usable stops: no boarding, getting off or walking at stops outside (the built city)', () => {
  const p = new TripPlanner(timetable({ east: [8 * H] }));
  const [j] = p.plan([1000, 50], [3000, 60], DAY, 8 * H - 300);
  assert.equal(j.legs.find((l) => l.mode === 'bus').from.name, 'B');
  p.setUsable((k, s) => s.name !== 'B'); // B is past the edge
  const js = p.plan([1000, 50], [3000, 60], DAY, 8 * H - 300);
  for (const x of js) for (const l of x.legs) if (l.mode === 'bus') assert.notEqual(l.from.name, 'B');
  p.setUsable((k, s) => s.name !== 'D');
  const bus = p.plan([0, 0], [3000, 60], DAY, 8 * H - 300)[0].legs.find((l) => l.mode === 'bus');
  assert.ok(!bus || bus.to.name !== 'D', 'never gets off at an unusable stop');
  p.setUsable(null);
  assert.equal(p.plan([0, 50], [3000, 60], DAY, 8 * H - 300)[0].legs.find((l) => l.mode === 'bus').to.name, 'D');
});
