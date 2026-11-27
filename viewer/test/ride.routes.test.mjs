import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ribbonArrays } from '../src/ride/routes.js';

test('route ribbon: two vertices per point, width across the direction of travel', () => {
  const { pos, idx } = ribbonArrays([[0, 0], [10, 0], [20, 0]], () => 50, 4, 1); // heading east
  assert.equal(pos.length, 3 * 2 * 3);
  assert.equal(idx.length, 2 * 6);
  // east-west line: the ribbon spreads north-south (three z), 2 m each side, at ground + 1
  assert.deepEqual([pos[0], pos[1], Math.abs(pos[2])], [0, 51, 2]);
  assert.equal(pos[2], -pos[5]);
});
