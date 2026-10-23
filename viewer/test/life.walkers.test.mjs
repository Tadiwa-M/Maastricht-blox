// Pedestrians on the walk graph (src/life/walkgraph.js, fallback.js): random walk stays on
// edges, never turns back except at dead ends, turns smoothly, spawns near a point, avoids.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WalkGraph, Walker, rng, avoid, turnToward } from '../src/life/walkgraph.js';
import { walkwaysFromWorld } from '../src/life/fallback.js';
import { clipWalkways } from '../src/life/index.js';

// a 5 x 5 lattice, 10 m apart, plus a dead-end spur east of the top-right node
function lattice() {
  const nodes = [], edges = [], weights = [];
  const id = (i, j) => i * 5 + j;
  for (let i = 0; i < 5; i++) for (let j = 0; j < 5; j++) { nodes.push(i * 10, j * 10); weights.push(i === 2 && j === 2 ? 8 : 2); }
  for (let i = 0; i < 5; i++) for (let j = 0; j < 5; j++) {
    if (i < 4) edges.push(id(i, j), id(i + 1, j));
    if (j < 4) edges.push(id(i, j), id(i, j + 1));
  }
  nodes.push(60, 40); weights.push(1); edges.push(id(4, 4), 25);
  return { nodes, edges, weights };
}

function distToGraph(g, x, z) {
  let best = Infinity;
  for (let a = 0; a < g.count; a++) for (const b of g.neighbours(a)) {
    const ax = g.x[a], az = g.z[a], dx = g.x[b] - ax, dz = g.z[b] - az, L2 = dx * dx + dz * dz;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / L2));
    best = Math.min(best, Math.hypot(ax + dx * t - x, az + dz * t - z));
  }
  return best;
}

test('graph adjacency', () => {
  const g = new WalkGraph(lattice());
  assert.equal(g.count, 26);
  assert.deepEqual([...g.neighbours(0)].sort(), [1, 5]);
  assert.deepEqual([...g.neighbours(25)], [24]);
});

test('next node: never straight back, except at a dead end', () => {
  const g = new WalkGraph(lattice()), r = rng(3);
  for (let q = 0; q < 200; q++) assert.notEqual(g.pickNext(6, 7, r), 6);
  assert.equal(g.pickNext(24, 25, r), 24);
  // going straight on is preferred over turning
  let straight = 0;
  for (let q = 0; q < 1000; q++) if (g.pickNext(6, 7, r) === 8) straight++;
  assert.ok(straight > 500, `straight ${straight}`);
});

test('a walker stays on the graph and turns smoothly', () => {
  const g = new WalkGraph(lattice()), r = rng(11);
  const w = new Walker(g, 12, r, { speed: 1.4, lateral: 0 });
  w.place();
  let prevYaw = w.yaw, maxTurn = 0, travelled = 0;
  for (let q = 0; q < 3000; q++) {
    travelled += w.step(1 / 30);
    assert.ok(distToGraph(g, w.x, w.z) < 0.6, `off the graph at ${w.x}, ${w.z}`);
    const d = Math.abs(((w.yaw - prevYaw + 540) % 360) - 180);
    if (w.p !== w.b) maxTurn = Math.max(maxTurn, d); // not on a dead-end U-turn
    prevYaw = w.yaw;
  }
  assert.ok(Math.abs(travelled - 1.4 * 100) < 1e-6);
  assert.ok(maxTurn < 12, `max heading change per frame ${maxTurn.toFixed(1)} deg`);
});

test('spawn near a point, weighted, within the radius', () => {
  const g = new WalkGraph(lattice()), r = rng(5);
  const hits = new Map();
  for (let q = 0; q < 2000; q++) {
    const n = g.spawnNear(20, 20, 10.5, r);
    assert.ok(Math.hypot(g.x[n] - 20, g.z[n] - 20) <= 10.5);
    hits.set(n, (hits.get(n) || 0) + 1);
  }
  assert.ok(hits.get(12) > hits.get(7), 'the busy centre node is picked more often');
  assert.equal(g.spawnNear(500, 500, 10, r), -1);
  const far = g.spawnNear(20, 20, 30, r, 25);
  assert.ok(Math.hypot(g.x[far] - 20, g.z[far] - 20) >= 25);
});

test('loose avoidance: slow behind, step aside for oncoming', () => {
  const mk = (x, z, dx, dz, speed = 1.4) => ({ x, z, dirX: dx, dirZ: dz, speed, baseLateral: 0, lateralGoal: 0, slow: 1 });
  const a = mk(0, 0, 0, 1), b = mk(0, 0.6, 0, 1, 0.7), c = mk(5, 0, 0, 1), d = mk(5, 0.8, 0, -1);
  avoid([a, b, c, d]);
  assert.ok(a.slow < 1 && b.slow === 1);
  assert.ok(c.lateralGoal > 0 && d.lateralGoal > 0);
  assert.equal(turnToward(350, 10, 5), 355);
  assert.equal(turnToward(null, 10, 5), 10);
});

test('fallback walkways from the paved cells of a world', () => {
  // 40 x 40 studs: a cobbled east-west street (J 16..23) on grass, all at ground level
  const pal = new Map([[1, { name: 'cobble_grey' }], [2, { name: 'grass' }]]);
  const world = {
    bounds: { I0: 0, J0: 0, I1: 40, J1: 40 }, groundK: 3, studM: 0.5,
    topK: () => 3, brickAt: (I, J) => (J >= 16 && J < 24 ? 1 : 2), color: { 1: 1, 2: 2 }, palette: pal,
  };
  const doc = walkwaysFromWorld(world);
  const n = doc.nodes.length / 2;
  assert.equal(n, 20); // 10 lattice columns x 2 rows on the street
  for (let q = 0; q < n; q++) assert.ok(doc.nodes[2 * q + 1] >= 8 && doc.nodes[2 * q + 1] < 12);
  assert.ok(doc.edges.length / 2 >= 9 + 9 + 10);
  const g = new WalkGraph(doc);
  assert.ok(g.buckets.size > 0);
  const clipped = clipWalkways(doc, [0, 0, 10, 20]);
  assert.equal(clipped.nodes.length / 2, 10);
  for (const e of clipped.edges) assert.ok(e < 10);
});
