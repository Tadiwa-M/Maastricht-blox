// Walking routes (src/plan/walk.js) and journey geometry (src/plan/route.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WalkRouter } from '../src/plan/walk.js';
import { shapeBetween, journeyGeometry } from '../src/plan/route.js';

// a block: the direct street (0,0)-(100,0) is missing in the middle, so the walk goes round
//   (0,100) ---- (100,100)
//      |             |
//   (0,0)  -x- x-  (100,0)
const doc = { nodes: [0, 0, 0, 100, 100, 100, 100, 0, 40, 0, 60, 0], edges: [0, 1, 1, 2, 2, 3, 0, 4, 5, 3] };

test('A* takes the way round when the direct street is cut', () => {
  const w = new WalkRouter(doc);
  const r = w.route([-3, 0], [103, 0]);
  assert.ok(r);
  assert.deepEqual(r.pts.slice(1, -1), [[0, 0], [0, 100], [100, 100], [100, 0]]);
  assert.ok(Math.abs(r.dist - (3 + 300 + 3)) < 1e-6);
  assert.equal(w.route([500, 500], [0, 0]), null, 'off the network: no route');
});

test('a shape cut between two distances, with interpolated ends', () => {
  const shape = { pts: [[0, 0], [100, 0], [100, 100]], cum: [0, 100, 200] };
  assert.deepEqual(shapeBetween(shape, 50, 150), [[50, 0], [100, 0], [100, 50]]);
});

test('journey geometry: bus legs on their shape, walks on the graph', () => {
  const tt = { patterns: [{ shape: 0, st: [0, 0, 0, 60, 60, 100, 120, 120, 200] }], shapes: [{ pts: [[0, 0], [100, 0], [100, 100]], cum: [0, 100, 200] }] };
  const j = { legs: [
    { mode: 'walk', from: { x: -3, z: 0 }, to: { x: 103, z: 0 }, dist: 130 },
    { mode: 'bus', pattern: 0, fromI: 0, toI: 2, from: { x: 0, z: 0 }, to: { x: 100, z: 100 } },
  ] };
  const g = journeyGeometry(tt, j, new WalkRouter(doc));
  assert.equal(g[0].walkDist, 306);
  assert.deepEqual(g[1].pts, [[0, 0], [100, 0], [100, 100]]);
  assert.deepEqual(journeyGeometry(tt, j, null)[0].pts, [[-3, 0], [103, 0]], 'no walk graph: a straight line');
});
