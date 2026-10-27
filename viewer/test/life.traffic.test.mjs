// Cars (src/life/traffic.js), busy-city density, spawn weighting, terraces, the market
// schedule and layout, parked bikes, bus liveries.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RoadGraph, stepTraffic, carPose, idmAccel, desiredSpeed, JUNCTION_V, CLASS_SPEED } from '../src/life/traffic.js';
import { crowdFactor, trafficFactor, terraceFactor, marketState, liveWeights, inPoly, FIGURES_BY_TIER } from '../src/life/density.js';
import { WalkGraph, rng } from '../src/life/walkgraph.js';
import { terraceLayout } from '../src/life/terraces.js';
import { stallLayout } from '../src/life/market.js';
import { parkedBikes } from '../src/life/cyclists.js';
import { liveryFor } from '../src/life/livery.js';
import { Pedestrians, groupSize } from '../src/life/walkers.js';

const CLASSES = ['primary', 'secondary', 'tertiary', 'residential', 'unclassified', 'service', 'living_street'];
/** A straight road west -> east, 20 m nodes; flags: class (and one-way bit). */
function line(n, cls = 'residential', one = false) {
  const nodes = [], edges = [], flags = [];
  for (let q = 0; q < n; q++) nodes.push(q * 20, 0);
  for (let q = 0; q + 1 < n; q++) { edges.push(q, q + 1); flags.push((one ? 1 : 0) | (CLASSES.indexOf(cls) << 1)); }
  return { nodes, edges, flags, classes: CLASSES };
}

test('road graph: two-way streets give both directions, one-way only one', () => {
  const two = new RoadGraph(line(4)), one = new RoadGraph(line(4, 'tertiary', true));
  assert.equal(two.count, 6);
  assert.equal(one.count, 3);
  assert.ok(one.from.every((a, e) => one.to[e] === a + 1), 'one-way west -> east only');
  assert.ok(two.laneOffset(0) > 1 && one.laneOffset(0) < 1);
});

test('car following: the car behind keeps its distance and never runs into the leader', () => {
  const g = new RoadGraph(line(40, 'secondary', true));
  const lead = { e: 2, s: 5, v: 2, len: 4.5, next: undefined }, back = { e: 0, s: 0, v: 11, len: 4.5, next: undefined };
  const rand = rng(1);
  let minGap = Infinity;
  for (let q = 0; q < 600; q++) {
    lead.v = Math.min(lead.v, 2); // a slow leader (a delivery van)
    stepTraffic(g, [lead, back], 0.05, rand);
    lead.v = 2;
    const gap = (lead.e * 20 + lead.s) - (back.e * 20 + back.s) - 4.5;
    minGap = Math.min(minGap, gap);
  }
  assert.ok(minGap > 1.5, `min gap ${minGap.toFixed(2)} m`);
  assert.ok(Math.abs(back.v - 2) < 0.3, `follows at the leader's speed (${back.v.toFixed(2)})`);
  assert.ok(idmAccel(10, 10, Infinity, 0) === 0 && idmAccel(0, 10, Infinity, 0) > 0 && idmAccel(10, 10, 3, 5) < -2);
});

test('cars slow down into junctions and stop at dead ends', () => {
  // a T: 0-1-2-3 east, and 2-4 north
  const doc = line(4);
  doc.nodes.push(40, 20); doc.edges.push(2, 4); doc.flags.push(3 << 1);
  const g = new RoadGraph(doc);
  const e = g.from.findIndex((a, q) => a === 1 && g.to[q] === 2);
  assert.ok(desiredSpeed(g, e, 19.5) < JUNCTION_V + 0.5 && desiredSpeed(g, e, 0) > JUNCTION_V + 1);
  const end = new RoadGraph(line(3)), c = { e: end.from.findIndex((a, q) => a === 1 && end.to[q] === 2), s: 0, v: 8, len: 4 };
  for (let q = 0; q < 400 && !c.gone; q++) stepTraffic(end, [c], 0.05, rng(2));
  assert.ok(c.v < 0.5 || c.gone, 'brakes for the end of the road');
});

test('car pose: right-hand lane, heading along the road', () => {
  const g = new RoadGraph(line(5));
  const east = g.from.findIndex((a, q) => a === 1 && g.to[q] === 2), west = g.from.findIndex((a, q) => a === 2 && g.to[q] === 1);
  const pe = carPose(g, { e: east, s: 10, next: -1 }), pw = carPose(g, { e: west, s: 10, next: -1 });
  assert.ok(Math.abs(pe.yaw - 90) < 1 && Math.abs(pw.yaw - 270) < 1);
  assert.ok(pe.z < 0 && pw.z > 0, 'eastbound on the south side, westbound on the north side');
  assert.equal(CLASS_SPEED.living_street < CLASS_SPEED.residential, true);
});

test('density: day curve, weekend boost, terraces, tier counts', () => {
  assert.ok(crowdFactor(14, 5) > crowdFactor(14, 2), 'Saturday busier');
  assert.ok(crowdFactor(9, 6) < crowdFactor(9, 2), 'Sunday morning quiet');
  assert.ok(crowdFactor(4, 2) < 0.1);
  assert.ok(trafficFactor(8, 1) > trafficFactor(11, 1) && trafficFactor(17.5, 1) > trafficFactor(21, 1), 'rush hours');
  assert.ok(trafficFactor(8, 6) < trafficFactor(8, 1));
  assert.ok(terraceFactor(13, 2) > 0.7 && terraceFactor(4, 2) < 0.05);
  assert.deepEqual(FIGURES_BY_TIER, { high: 900, medium: 500, low: 200, lite: 80 });
});

test('market schedule: Wednesday and Friday 08:00-13:00, setup and packing around it', () => {
  const m = { days: [2, 4], open: 8 * 3600, close: 13 * 3600 };
  assert.equal(marketState(m, 2, 11 * 3600), 'open');
  assert.equal(marketState(m, 4, 8 * 3600), 'open');
  assert.equal(marketState(m, 4, 13 * 3600), 'packing');
  assert.equal(marketState(m, 2, 7.5 * 3600), 'setup');
  assert.equal(marketState(m, 2, 15 * 3600), 'off');
  assert.equal(marketState(m, 3, 11 * 3600), 'off', 'not on Thursday');
  assert.equal(marketState(null, 2, 11 * 3600), 'off');
});

test('spawn weighting: busy nodes get more people, the market square when it is on', () => {
  // 10 x 10 lattice; the west half weight 1, the east half 8
  const nodes = [], weights = [], edges = [];
  for (let i = 0; i < 10; i++) for (let j = 0; j < 10; j++) { nodes.push(i * 4, j * 4); weights.push(i < 5 ? 1 : 8); }
  for (let i = 0; i < 10; i++) for (let j = 0; j < 10; j++) { if (i < 9) edges.push(i * 10 + j, (i + 1) * 10 + j); if (j < 9) edges.push(i * 10 + j, i * 10 + j + 1); }
  const g = new WalkGraph({ nodes, weights, edges });
  const r = rng(3);
  let east = 0;
  for (let q = 0; q < 2000; q++) if (g.x[g.spawnNear(18, 18, 100, r)] >= 20) east++;
  assert.ok(east / 2000 > 0.8, `east share ${east / 2000}`);
  const market = { poly: [0, 0, 16, 0, 16, 36, 0, 36] };
  assert.ok(inPoly(market.poly, 5, 5) && !inPoly(market.poly, 30, 5));
  const w = liveWeights(g.base, g.x, g.z, { market, open: true, hours: 11 });
  assert.equal(w[0], 3 * 1, 'market nodes x3 while open');
  assert.ok(Math.abs(w[99] - 8 * 1.6) < 1e-5, 'the busiest nodes x1.6 by day');
  assert.equal(liveWeights(g.base, g.x, g.z, { market, open: false, hours: 22 })[0], 1);
  // people come in groups; the crowd counts people, not groups
  assert.equal(groupSize(0.1), 1); assert.equal(groupSize(0.7), 2); assert.equal(groupSize(0.99), 4);
  const peds = new Pedestrians({ graph: g, ground: () => 0, cap: 300 });
  peds.setCount(120, [18, 18]);
  assert.ok(peds.people >= 120 && peds.people < 124 && peds.active < 110, `${peds.people} people in ${peds.active} groups`);
  for (let q = 0; q < 50; q++) peds.update(0.2, [18, 18], 60);
  for (const k of peds.positions()) assert.ok(k.x > -3 && k.x < 40 && k.z > -3 && k.z < 40);
});

test('terraces face the street; stalls fit the square; parked bikes line up; buses are Arriva blue', () => {
  const t = terraceLayout({ x: 0, z: 0, f: [0, -1], d: 10 }, 4);
  assert.ok(t.tables.length >= 2 && t.chairs.length >= 2 * t.tables.length);
  for (const tb of t.tables) assert.ok(tb.z < -2 && tb.z > -6.5, 'tables in front, on the pavement');
  for (const c of t.chairs) {
    const tb = t.tables[c.table], yaw = (Math.atan2(tb.x - c.x, tb.z - c.z) * 180) / Math.PI;
    assert.ok(Math.abs(((yaw - c.yaw + 540) % 360) - 180) < 1, 'sitters face their table');
  }
  const market = { poly: [0, 0, 60, 0, 60, 40, 0, 40] };
  const stalls = stallLayout(market);
  assert.ok(stalls.length > 10, `${stalls.length} stalls`);
  for (const s of stalls) assert.ok(inPoly(market.poly, s.x, s.z));
  assert.ok(stallLayout(market, { keep: (x) => x < 30 }).every((s) => s.x < 30));
  assert.ok(stalls.vans.length >= 2, 'delivery vans at the heads of the rows');
  for (const v of stalls.vans) for (const st of stalls) assert.ok(Math.hypot(v.x - st.x, v.z - st.z) > 3, 'vans do not stand in a stall');
  const { bikes, racks } = parkedBikes([[0, 0, 1, 0]]);
  assert.ok(bikes.length >= 4 && racks.length >= 1);
  for (const b of bikes) assert.ok(Math.abs(b.z) < 1e-9 && [0, 180].some((y) => Math.abs(((b.yaw - y + 540) % 360) - 180) < 5));
  assert.equal(liveryFor({ agency: 'ARR', colour: '#E30613' }), '#0B5FA5');
  assert.equal(liveryFor({}), '#0B5FA5');
  assert.equal(liveryFor({ agency: 'QBUZZ' }), '#E2001A');
});

test('parked bikes: only the nearest within the tier range are drawn', async () => {
  const { nearestWithin, PARKED_BIKES_BY_TIER } = await import('../src/life/density.js');
  const bikes = Array.from({ length: 200 }, (_, q) => ({ x: q, z: 0 }));
  const got = nearestWithin(bikes, 50, 0, 10, 5);
  assert.deepEqual(got.map((b) => b.x), [50, 49, 51, 48, 52]);
  assert.equal(nearestWithin(bikes, 1000, 0, 10, 5).length, 0);
  const t = PARKED_BIKES_BY_TIER;
  assert.ok(t.high.cap > t.medium.cap && t.medium.cap > t.low.cap && t.low.r > t.lite.r);
});
