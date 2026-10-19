// Ray picking through the occupancy grid (src/picking.js) on a tiny hand-made world.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../src/world.js';
import { pickBrick } from '../src/picking.js';
import { exteriorAir } from '../src/exterior.js';

const meta = {
  palette: { entries: [{ idx: 1, name: 'red', srgb: '#ff0000', material: 'solid' }] },
  catalogue: { types: [{ id: 1, name: 'brick_1x1', kind: 'brick', w: 1, d: 1, h: 3, studs: 'all' },
    { id: 9, name: 'brick_2x4', kind: 'brick', w: 2, d: 4, h: 3, studs: 'all' }] },
};
const v = (x, y, z) => ({ x, y, z });

test('a ray straight down hits the top brick of a stack', () => {
  const w = World.fromRecords(meta, [{ I: 2, J: 3, K: 0, type: 1, color: 1 }, { I: 2, J: 3, K: 3, type: 1, color: 1 }]);
  const hit = pickBrick(w, v(1.25, 10, -1.75), v(0, -1, 0)); // above cell (2, 3)
  assert.equal(hit.n, 1);
  assert.equal(hit.K, 5);
});

test('rotated brick footprint is hit at its rotated cells, misses beside it', () => {
  const w = World.fromRecords(meta, [{ I: 0, J: 0, K: 0, type: 9, color: 1, rot: 1 }]); // 4 x 2 along (i, j)
  assert.equal(pickBrick(w, v(1.9, 5, -0.25), v(0, -1, 0))?.n, 0); // I = 3, J = 0
  assert.equal(pickBrick(w, v(0.25, 5, -1.25), v(0, -1, 0)), null); // J = 2: outside
});

test('an oblique ray returns the nearest of two bricks', () => {
  const w = World.fromRecords(meta, [{ I: 0, J: 0, K: 0, type: 1, color: 1 }, { I: 5, J: 0, K: 0, type: 1, color: 1 }]);
  const dir = v(1, -0.05, 0);
  assert.equal(pickBrick(w, v(-3, 0.3, -0.25), dir).n, 0);
  assert.equal(pickBrick(w, v(1, 0.3, -0.25), dir).n, 1);
});

test('exterior flood fill sees through open air but not into a closed box', () => {
  const recs = [];
  for (let I = 0; I < 3; I++) for (let J = 0; J < 3; J++) for (const K of [0, 6]) recs.push({ I, J, K, type: 1, color: 1 });
  for (let I = 0; I < 3; I++) for (let J = 0; J < 3; J++) if (I !== 1 || J !== 1) recs.push({ I, J, K: 3, type: 1, color: 1 });
  const w = World.fromRecords(meta, recs);
  const out = exteriorAir(w);
  assert.equal(out(1, 1, 3), false); // sealed cell in the middle
  assert.equal(out(1, 1, 9), true);  // above the lid
  assert.equal(out(5, 5, 0), true);  // outside the bounds
});

test('exterior: air under an overhang is outside, air under the terrain shell is not', () => {
  const recs = [];
  // a 5x5 ground layer at K=0 with a 1-cell overhang at K=6 over (2, 2)
  for (let I = 0; I < 5; I++) for (let J = 0; J < 5; J++) recs.push({ I, J, K: 0, type: 1, color: 1 });
  recs.push({ I: 2, J: 2, K: 6, type: 1, color: 1 });
  // a floating 3x3 "terrain shell" far away at K=12 with only air (reachable from the world edge) below it
  for (let I = 10; I < 13; I++) for (let J = 0; J < 3; J++) recs.push({ I, J, K: 12, type: 1, color: 1 });
  const out = exteriorAir(World.fromRecords(meta, recs));
  assert.equal(out(2, 2, 3), true);   // under the overhang: seen from the street beside it
  assert.equal(out(11, 1, 5), false); // under the shell: only reachable from the world's edge
  assert.equal(out(11, 1, 15), true); // above the shell
  assert.equal(out(13, 1, 5), true);  // beside the shell, beyond the world bounds
});
