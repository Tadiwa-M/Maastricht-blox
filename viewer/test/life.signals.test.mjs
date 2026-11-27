// Traffic lights and crossings for everyone who is not a car (src/life/signals.js), and the
// cars stopping for people waiting at a zebra (traffic.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RoadGraph, stepTraffic, signalAt } from '../src/life/traffic.js';
import { CrossingMap, pedSignal, walkBias } from '../src/life/signals.js';
import { rng } from '../src/life/walkgraph.js';

const CLASSES = ['primary', 'secondary', 'tertiary', 'residential', 'unclassified', 'service', 'living_street'];
/** A straight two-way road, 20 m nodes, west -> east (or south -> north). */
function road(n, { ns = false, signals = [], crossings = [] } = {}) {
  const nodes = [], edges = [], flags = [];
  for (let q = 0; q < n; q++) nodes.push(ns ? 0 : q * 20, ns ? q * 20 : 0);
  for (let q = 0; q + 1 < n; q++) { edges.push(q, q + 1); flags.push(CLASSES.indexOf('residential') << 1); }
  return new RoadGraph({ nodes, edges, flags, classes: CLASSES, signals, crossings });
}

test('pedestrian green only while the traffic they cross has red', () => {
  let green = 0;
  for (let t = 0; t < 120; t += 0.25) {
    if (pedSignal(90, t) !== 'green') continue; // walking east, across a north-south road
    green++;
    assert.equal(signalAt(0, t), 'red');
    assert.equal(signalAt(180, t), 'red');
  }
  assert.ok(green > 50);
});

test('light heads: one per approach, on its right-hand kerb before the node, facing the traffic', () => {
  const g = road(3, { ns: true, signals: [1] }), map = new CrossingMap(g, { footway: () => true });
  const heads = map.heads();
  assert.equal(heads.length, 2);
  const north = heads.find((h) => g.bearing(h.e) < 1 || g.bearing(h.e) > 359); // traffic heading north
  assert.ok(north.x > 2.5, 'right of a northbound car is east');
  assert.ok(north.z < 20, 'before the node');
  assert.equal(Math.round(north.yaw), 180, 'lamps face south, towards the car');
  assert.ok(north.ped);
});

test('zebra stripes lie across the road, each running along it', () => {
  const g = road(3, { crossings: [1] }), stripes = new CrossingMap(g).zebras();
  assert.ok(stripes.length >= 5);
  for (const s of stripes) { assert.equal(Math.round(s.yaw) % 180, 90); assert.ok(Math.abs(s.x - 20) < 1e-6); }
  const zs = stripes.map((s) => s.z);
  assert.ok(Math.max(...zs) - Math.min(...zs) > 4, 'spread over the carriageway');
});

test('walkers: wait for a gap at a zebra, for green at a light', () => {
  const g = road(5, { crossings: [2] }), map = new CrossingMap(g);
  const step = [40, -5, 0, 40, -2.5]; // x, z, yaw (north), ahead x, z: about to step on
  const car = (x, v) => ({ x, z: -1.5, yaw: 90, halfW: 0.9, halfL: 2.1, v });
  assert.deepEqual(map.crossingHold(...step, [car(25, 10)]), { n: 2, zebra: true, wait: true }, 'it cannot stop: let it pass');
  assert.equal(map.crossingHold(...step, [car(-20, 10)]).wait, false, 'far enough: step on (it will stop)');
  assert.equal(map.crossingHold(...step, [car(55, 10)]).wait, false, 'gone past');
  assert.equal(map.crossingHold(40, -9, 0, 40, -6.5, [car(25, 10)]), null, 'not at the kerb yet');
  assert.equal(map.crossingHold(40, -5, 90, 42.5, -5, [car(25, 10)]), null, 'walking along the pavement');
  const s = new CrossingMap(road(5, { signals: [2] }));
  const red = [...Array(240).keys()].map((q) => q / 4).find((t) => pedSignal(0, t) === 'red');
  const green = [...Array(240).keys()].map((q) => q / 4).find((t) => pedSignal(0, t) === 'green');
  assert.equal(s.crossingHold(...step, [], red).wait, true);
  assert.equal(s.crossingHold(...step, [], green).wait, false);
});

test('cars stop for someone waiting at the kerb of a zebra', () => {
  const g = road(8, { crossings: [4] }), rand = rng(3);
  const c = { e: 0, s: 2, v: 8, len: 4.2 }; // eastbound from x = 0, the zebra at x = 80
  for (let q = 0; q < 400; q++) stepTraffic(g, [c], 0.05, rand, { people: [{ x: 80, z: -6, zebra: 4 }] }); // 6 m out: outside the 4 m box
  const x = g.x[g.from[c.e]] + c.s;
  assert.ok(x < 80 - 4, `stopped before the zebra (front at ${(x + 2.1).toFixed(1)})`);
  assert.ok(c.v < 0.2);
  for (let q = 0; q < 400; q++) stepTraffic(g, [c], 0.05, rand, { people: [] });
  assert.ok(g.x[g.from[c.e]] + c.s > 80 || c.gone, 'and goes once nobody waits');
});

test('bikes stop at a red light and ride on at green', () => {
  const map = new CrossingMap(road(3, { ns: true, signals: [1] }));
  const t = (st) => [...Array(240).keys()].map((q) => q / 4).find((u) => signalAt(0, u) === st);
  assert.equal(map.riderSlow(1, 20 - 6, 0, 1, 0, 5, t('red')) < 0.6, true);
  assert.equal(map.riderSlow(1, 20 - 4.4, 0, 1, 0, 5, t('red')), 0, 'at the line: stand');
  assert.equal(map.riderSlow(1, 20 - 6, 0, 1, 0, 5, t('green')), 1);
  assert.equal(map.riderSlow(1, 20 + 3, 0, 1, 0, 5, t('red')), 1, 'past it');
});

test('buses: a stop line at a red light and at a zebra with someone on it', () => {
  const ahead = (x0) => [...Array(12).keys()].map((q) => ({ x: x0 + q * 1.5, z: -1.6, a: q * 1.5 }));
  const bus = { x: 20, z: -1.6, yaw: 90, v: 8, halfL: 6 };
  const red = [...Array(240).keys()].map((q) => q / 4).find((u) => signalAt(90, u) === 'red');
  const green = [...Array(240).keys()].map((q) => q / 4).find((u) => signalAt(90, u) === 'green');
  const s = new CrossingMap(road(5, { signals: [2] }));
  const gap = s.transitGap(bus, ahead(26), [], red);
  assert.ok(gap > 8 && gap < 13, `stops before the node (${gap})`);
  assert.equal(s.transitGap(bus, ahead(26), [], green), Infinity);
  const z = new CrossingMap(road(5, { crossings: [2] }));
  assert.equal(z.transitGap(bus, ahead(26), [], red), Infinity, 'empty zebra');
  assert.ok(z.transitGap(bus, ahead(26), [{ x: 40, z: 1 }], red) < 13);
  assert.ok(z.transitGap(bus, ahead(26), [{ x: 40, z: -9, zebra: 2 }], red) < 13, 'waiting at its kerb');
});

test('walk routes cross the road at the crossing, not just beside it', () => {
  const g = road(6, { crossings: [2] }), map = new CrossingMap(g);
  const walk = { count: 6, x: [40, 40, 55, 55, 150, 150], z: [-6, 6, -6, 6, -6, 6] };
  const bias = walkBias(walk, map);
  assert.ok(bias(0, 1) > 1, 'over the zebra');
  assert.ok(bias(2, 3) < 1, '15 m from it');
  assert.equal(bias(4, 5), 1, 'no crossing near');
  assert.equal(bias(0, 2), 1, 'along the pavement');
});
