import test from 'node:test';
import assert from 'node:assert/strict';
import { shopLightsFromRecords, POOL, PoolLights, poolSources, poolUniforms } from '../src/render/pools.js';

const win = { id: 7, w: 2, d: 1, h: 12 };
const rec = (rot) => ({ i: [10], j: [20], k: [5], type: [7], rotFlags: [rot] });

test('a shop light sits in front of the window, on the side it faces', () => {
  const [a] = shopLightsFromRecords(rec(0), 0, 0, [win], 0.5, 0.2); // front toward +j = three.js -z
  assert.ok(a.p[2] < -20 * 0.5 - 0.5, `z ${a.p[2]}`);
  const [b] = shopLightsFromRecords(rec(1), 0, 0, [win], 0.5, 0.2); // toward +i = +x
  assert.ok(b.p[0] > 10 * 0.5 + 1, `x ${b.p[0]}`);
  assert.ok(Math.abs(a.p[1] - (5 * 0.2 + 0.9)) < 1e-9);
  assert.equal(a.r, POOL.shopR);
  assert.equal(shopLightsFromRecords(rec(0), 0, 0, [], 0.5, 0.2).length, 0);
});

test('the nearest lights win, none by day', () => {
  const src = { lights: () => Array.from({ length: 80 }, (_, n) => ({ p: [n, 0, 0], r: 5, c: [1, 1, 1] })) };
  poolSources.add(src);
  const cam = { position: { x: 0, y: 0, z: 0, clone() { return { ...this, distanceToSquared: () => 0 }; } } };
  const pl = new PoolLights();
  pl.update(cam, 1);
  assert.equal(poolUniforms.uPoolN.value, POOL.cap);
  assert.equal(poolUniforms.uPoolP.value[0].x, 0);
  assert.equal(poolUniforms.uPoolP.value[POOL.cap - 1].x, POOL.cap - 1);
  pl.update(cam, 0);
  assert.equal(poolUniforms.uPoolN.value, 0);
  poolSources.delete(src);
});
