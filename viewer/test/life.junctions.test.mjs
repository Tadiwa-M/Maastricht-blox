// Junction boxes, giving way to buses and trains, red lights two junctions ahead, the police car
// (src/life/junctions.js, traffic.js, police.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RoadGraph, stepTraffic, carPose, signalState } from '../src/life/traffic.js';
import { movement, movesConflict, turnOf, behindInLane, vehicleSweep, sweepHits, routePoint } from '../src/life/junctions.js';
import { POLICE, pullsOver, beacons, sirenStep } from '../src/life/police.js';
import { rng } from '../src/life/walkgraph.js';

const CLASSES = ['primary', 'secondary', 'tertiary', 'residential'];
/** A + junction at (0, 0): arms of 60 m to N, E, S, W (node 0 = centre, 1 N, 2 E, 3 S, 4 W). */
function cross({ ns = 'residential', ew = 'residential', signals = [] } = {}) {
  const f = (c) => CLASSES.indexOf(c) << 1;
  return new RoadGraph({ nodes: [0, 0, 0, 60, 60, 0, 0, -60, -60, 0], edges: [0, 1, 0, 2, 0, 3, 0, 4],
    flags: [f(ns), f(ew), f(ns), f(ew)], classes: CLASSES, signals });
}
const edge = (g, a, b) => g.from.findIndex((x, i) => x === a && g.to[i] === b);
const ARM = { N: 1, E: 2, S: 3, W: 4 };
/** A car coming in from arm `from`, leaving to arm `to`, s m along its 60 m approach. */
const car = (g, from, to, s, v = 6, more = {}) => ({ e: edge(g, ARM[from], 0), next: edge(g, 0, ARM[to]), s, v, len: 4.2, prev: -1, ...more });
const mv = (g, from, to) => movement(g, edge(g, ARM[from], 0), edge(g, 0, ARM[to]));

/** Footprints (Unity x/z, yaw) overlap? Corner-in-rectangle test both ways. */
function overlap(a, b) {
  const pts = (f) => {
    const r = (f.yaw * Math.PI) / 180, fx = Math.sin(r), fz = Math.cos(r), out = [[f.x, f.z]];
    for (const p of [-1, 1]) for (const q of [-1, 1]) out.push([f.x + fx * f.halfL * p + fz * f.halfW * q, f.z + fz * f.halfL * p - fx * f.halfW * q]);
    return out;
  };
  const inside = (f, [x, z]) => {
    const r = (f.yaw * Math.PI) / 180, fx = Math.sin(r), fz = Math.cos(r), dx = x - f.x, dz = z - f.z;
    return Math.abs(dx * fx + dz * fz) <= f.halfL && Math.abs(dx * fz - dz * fx) <= f.halfW;
  };
  return pts(a).some((p) => inside(b, p)) || pts(b).some((p) => inside(a, p));
}
const foot = (g, c) => ({ ...carPose(g, c), halfW: 0.9, halfL: c.len / 2 });

test('junction movements: crossing and merging paths conflict, oncoming lanes and one lane do not', () => {
  const g = cross();
  assert.ok(movesConflict(mv(g, 'S', 'N'), mv(g, 'W', 'E')), 'straight across each other');
  assert.ok(!movesConflict(mv(g, 'S', 'N'), mv(g, 'N', 'S')), 'oncoming, straight on: side by side');
  assert.ok(!movesConflict(mv(g, 'S', 'E'), mv(g, 'N', 'S')), 'turning right past oncoming traffic');
  assert.ok(movesConflict(mv(g, 'S', 'W'), mv(g, 'N', 'S')), 'turning left across oncoming traffic');
  assert.ok(movesConflict(mv(g, 'S', 'E'), mv(g, 'W', 'E')), 'merging into the same lane');
  assert.ok(!movesConflict(mv(g, 'S', 'N'), mv(g, 'S', 'N')), 'same lane, same way: just following');
  assert.ok(movesConflict(mv(g, 'S', 'N'), mv(g, 'S', 'E')), 'the one turning off is still in the box');
  assert.equal(turnOf(g, edge(g, 3, 0), edge(g, 0, 2)), 'right');
  assert.equal(turnOf(g, edge(g, 3, 0), edge(g, 0, 4)), 'left');
  assert.equal(turnOf(g, edge(g, 3, 0), edge(g, 0, 1)), 'straight');
});

test('car pose turns smoothly through the lane corner (no jump back, no spin)', () => {
  const g = cross();
  let last = null;
  for (let s = 50; s <= 60; s += 0.25) {
    const p = carPose(g, car(g, 'S', 'E', s));
    if (last) {
      assert.ok(Math.hypot(p.x - last.x, p.z - last.z) < 0.6, `moves on smoothly at s ${s}`);
      const turn = ((p.yaw - last.yaw + 540) % 360) - 180;
      assert.ok(turn > -1 && turn < 25, `turns right, steadily (s ${s}: ${turn.toFixed(1)})`);
    }
    last = p;
  }
  const c = routePoint(g, edge(g, 3, 0), 60, -1, edge(g, 0, 2)); // the corner of a right turn: before the node
  assert.ok(c[0] > 1 && c[1] < -1, `${c}`);
});

test('two streams across an equal junction never share the box', () => {
  const g = cross();
  const cars = [];
  for (let k = 0; k < 4; k++) {
    cars.push(car(g, 'S', 'N', 10 + k * 12, 7), car(g, 'W', 'E', 4 + k * 12, 7), car(g, 'E', 'S', 8 + k * 12, 7), car(g, 'N', 'W', 2 + k * 12, 7));
  }
  const rand = rng(4);
  let through = 0;
  for (let q = 0; q < 30 * 60; q++) {
    stepTraffic(g, cars, 1 / 30, rand, { t: 0 });
    const live = cars.filter((c) => !c.gone);
    for (let a = 0; a < live.length; a++) for (let b = a + 1; b < live.length; b++) {
      assert.ok(!overlap(foot(g, live[a]), foot(g, live[b])), `t ${(q / 30).toFixed(1)}: two cars in one place`);
    }
  }
  for (const c of cars) if (c.gone || g.from[c.e] === 0) through++;
  assert.ok(through >= 14, `${through} of 16 cars got through`);
});

test('a car never runs a red light, even with a short edge just before the junction', () => {
  // west -> east: 0 (-100) -- 1 (-3) -- 2 (0, lights; arms north and south)
  const g = new RoadGraph({ nodes: [-100, 0, -3, 0, 0, 0, 0, 60, 0, -60, 60, 0], edges: [0, 1, 1, 2, 2, 3, 2, 4, 2, 5],
    flags: [6, 6, 6, 6, 6], classes: CLASSES, signals: [2] });
  const t = 10; // east-west: red until 28 s into the cycle
  assert.equal(signalState(g, edge(g, 1, 2), t), 'red');
  const c = { e: edge(g, 0, 1), s: 50, v: 11, len: 4.2, next: edge(g, 1, 2), prev: -1 };
  for (let q = 0; q < 30 * 10; q++) stepTraffic(g, [c], 1 / 30, () => 0.5, { t: t + q / 30 * 0.1 });
  assert.ok(!(g.from[c.e] === 2), 'did not cross the junction');
  const front = (g.from[c.e] === 1 ? 97 + c.s : c.s) + 2.1; // metres east of node 0
  assert.ok(front < 100 - g.boxR[2] + 0.5 && c.v < 0.2, `waits at the line (front ${front.toFixed(1)} m, v ${c.v.toFixed(2)})`);
});

test('cars give way to a bus crossing the junction (it keeps to its timetable and cannot wait)', () => {
  const g = cross();
  const c = car(g, 'S', 'N', 30, 8);
  let bx = -45; // the bus: eastbound in its lane, 8 m/s
  let minGap = Infinity, waited = false;
  for (let q = 0; q < 30 * 15; q++) {
    const bus = { x: bx, z: -1.6, yaw: 90, halfW: 1.25, halfL: 6, v: 8 };
    stepTraffic(g, [c], 1 / 30, () => 0.5, { t: 0, vehicles: [bus] });
    bx += 8 / 30;
    if (overlap(foot(g, c), bus)) assert.fail(`t ${(q / 30).toFixed(1)}: the car is inside the bus`);
    if (Math.abs(bx) < 6 && c.v < 0.5) waited = true;
    minGap = Math.min(minGap, Math.hypot(foot(g, c).x - bus.x, foot(g, c).z - bus.z));
  }
  assert.ok(waited, 'it waited while the bus went through');
  assert.equal(g.from[c.e], 0, 'and then went on');
});

test('a bus about to pull out (timetable sweep) holds the car; a bus behind it in its lane does not', () => {
  const g = cross();
  // a bus standing in the box's east-west lane that leaves in 1 s (its sweep from the timetable)
  const sweep = () => [{ x: -10, z: -1.6, t: 0 }, { x: -4, z: -1.6, t: 0 }, ...Array.from({ length: 12 }, (_, k) => ({ x: -4 + k * 2, z: -1.6, t: 1 + k * 0.25 }))];
  const bus = { x: -7, z: -1.6, yaw: 90, halfW: 1.25, halfL: 6, v: 0, sweep };
  assert.ok(sweepHits(mv(g, 'S', 'N').poly, vehicleSweep(bus), bus.halfW, 4));
  assert.ok(!sweepHits(mv(g, 'S', 'N').poly, vehicleSweep(bus), bus.halfW, 0.5), 'not if the car is across by then');
  const c = car(g, 'S', 'N', 45, 6);
  for (let q = 0; q < 30 * 4; q++) stepTraffic(g, [c], 1 / 30, () => 0.5, { t: 0, vehicles: [{ ...bus }] });
  assert.ok(c.e === edge(g, 3, 0) && c.v < 0.3, `waits for it (s ${c.s.toFixed(1)}, v ${c.v.toFixed(2)})`);
  // a bus right behind the car, same lane, same way: the car cannot help it by stopping
  const d = car(g, 'S', 'N', 30, 6), p = carPose(g, d);
  const behind = { x: p.x, z: p.z - 9, yaw: 0, halfW: 1.25, halfL: 6, v: 8 };
  assert.ok(behindInLane(p, behind));
  for (let q = 0; q < 30 * 2; q++) stepTraffic(g, [d], 1 / 30, () => 0.5, { t: 0, vehicles: [{ ...behind, z: behind.z + (q * 8) / 30 }] });
  assert.ok(d.v > 4, `keeps going (v ${d.v.toFixed(2)})`);
});

test('police car: cars ahead pull over and slow, it passes, junctions let it through', () => {
  // a long straight street, the police car with its lights on behind a car
  const doc = { nodes: [], edges: [], flags: [], classes: CLASSES };
  for (let q = 0; q < 12; q++) doc.nodes.push(q * 30, 0);
  for (let q = 0; q + 1 < 12; q++) { doc.edges.push(q, q + 1); doc.flags.push(3 << 1); }
  const g = new RoadGraph(doc);
  const e = (k) => edge(g, k, k + 1);
  const slow = { e: e(1), s: 10, v: 6, len: 4.2, prev: -1, mood: 0.9 };
  const cop = { e: e(0), s: 10, v: 10, len: 4.55, prev: -1, police: true, siren: true };
  assert.ok(pullsOver(carPose(g, slow), carPose(g, cop)));
  let pulled = 0;
  for (let q = 0; q < 30 * 12; q++) {
    stepTraffic(g, [slow, cop], 1 / 30, () => 0.5, {});
    pulled = Math.max(pulled, slow.lat);
    assert.ok(!overlap(foot(g, slow), foot(g, cop)), `t ${(q / 30).toFixed(1)}: police car drove into the car`);
  }
  assert.ok(pulled > POLICE.pullM * 0.8, `pulled over ${pulled.toFixed(2)} m`);
  const at = (c) => g.from[c.e] * 30 + c.s;
  assert.ok(at(cop) > at(slow) + 5, 'the police car got past');
  assert.ok(slow.lat < 0.3 || at(cop) - at(slow) < POLICE.besideM + 1, 'and the car pulls back in behind it');

  // at a junction: a car on the main road waits for it; it does not stop at a red light
  const j = cross({ ew: 'secondary' });
  const main = car(j, 'W', 'E', 40, 7), siren = car(j, 'S', 'N', 35, 9, { police: true, siren: true });
  for (let q = 0; q < 30 * 6; q++) {
    stepTraffic(j, [main, siren], 1 / 30, () => 0.5, { t: 0 });
    assert.ok(!overlap(foot(j, main), foot(j, siren)));
  }
  assert.equal(j.from[siren.e], 0, 'the police car went first');
  const red = cross({ signals: [0] }), cop2 = car(red, 'W', 'E', 40, 8, { police: true, siren: true });
  for (let q = 0; q < 30 * 5; q++) stepTraffic(red, [cop2], 1 / 30, () => 0.5, { t: 5 }); // east-west red
  assert.equal(red.from[cop2.e], 0, 'through the red light');
});

test('police lights: alternate left and right while on, dark when off; they switch off again', () => {
  const seen = new Set();
  for (let t = 0; t < 2; t += 0.05) { const [l, r] = beacons(true, t); assert.ok(l !== r); seen.add(l); }
  assert.equal(seen.size, 2);
  assert.deepEqual(beacons(false, 1.3), [false, false]);
  const c = { siren: true, sirenT: 1 };
  sirenStep(c, 0.6, () => 0.99); assert.ok(c.siren);
  sirenStep(c, 0.6, () => 0.99); assert.ok(!c.siren);
  sirenStep(c, 1, () => 0); assert.ok(c.siren && c.sirenT >= POLICE.sirenS[0], 'and, rarely, on');
});

test('the police car turns up now and then near the camera, drawn with its light bar', async () => {
  const { Cars } = await import('../src/life/cars.js');
  const { VehicleFleet } = await import('../src/figure/vehicles.js');
  // a 6 x 6 grid of streets, 60 m blocks
  const doc = { nodes: [], edges: [], flags: [], classes: CLASSES };
  for (let i = 0; i < 6; i++) for (let j = 0; j < 6; j++) doc.nodes.push(i * 60, j * 60);
  for (let i = 0; i < 6; i++) for (let j = 0; j < 6; j++) {
    if (i < 5) { doc.edges.push(i * 6 + j, (i + 1) * 6 + j); doc.flags.push(3 << 1); }
    if (j < 5) { doc.edges.push(i * 6 + j, i * 6 + j + 1); doc.flags.push(3 << 1); }
  }
  const cars = new Cars({ doc, ground: () => 0, cap: 30 });
  cars.setCount(20, [150, 150]);
  assert.equal(cars.police, null);
  cars.patrolIn = 0.05;
  for (let q = 0; q < 30 * 3 && !cars.police; q++) cars.update(1 / 30, [150, 150], 150);
  const cop = cars.police;
  assert.ok(cop && cop.type === 'police', 'it came');
  assert.ok(cars.patrolIn > 30, 'and the next one is a while off');
  const fleet = new VehicleFleet({ cars: 30 });
  fleet.begin(); cars.draw(fleet); fleet.end();
  assert.equal(fleet.meshes.get('beacon').mesh.count, 2, 'two lenses on its light bar');
  assert.equal(fleet.meshes.get('body:police').mesh.count, 1);
  assert.equal(cars.cars.filter((c) => c.police).length, 1, 'only one at a time');
});
