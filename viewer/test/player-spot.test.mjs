// standSpot (src/player/spot.js): a point inside a building's footprint puts you beside it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { standSpot } from '../src/player/spot.js';
import { synthCity } from './player-city.mjs';

test('standSpot: open street stays put; inside a building -> the nearest street-level spot', () => {
  const c = synthCity({ size: 80 });
  c.fill(20, 20, 5, 39, 39, 60); // a 10 x 10 m block, 11 m tall, x 10..20, north 10..20
  const open = standSpot(c, 5, -5);
  assert.deepEqual([open.x, open.z], [5, -5]);
  const s = standSpot(c, 15, -15); // the block's centre (its roof)
  assert.ok(s, 'found a spot');
  assert.equal(c.groundHeight(s.x, s.z), c.floorY, 'on the street, not the roof');
  assert.ok(Math.hypot(s.x - 15, s.z + 15) <= 7.5, 'just outside the block');
});

test('standSpot: nothing streamed in -> null', () => {
  const c = synthCity({ size: 80, unknownX: -1 });
  assert.equal(standSpot(c, 10, -10), null);
});

test('openSpot: the open middle of a square, facing a long view with room behind', async () => {
  const { openSpot } = await import('../src/player/spot.js');
  const c = synthCity({ size: 120 }); // 60 x 60 m
  // a square ringed by buildings, 20..40 m, with a narrow gap on the east side
  c.fill(30, 30, 5, 89, 39, 60); // south row (north 15..20 m)
  c.fill(30, 80, 5, 89, 89, 60); // north row (north 40..45 m)
  c.fill(30, 40, 5, 39, 79, 60); // west row
  c.fill(80, 40, 5, 89, 57, 60); c.fill(80, 62, 5, 89, 79, 60); // east row, gap at north 29..31 m
  const s = openSpot(c, 30, -30, { search: 12 });
  assert.ok(s, 'found');
  assert.ok(Math.abs(s.x - 30) <= 6 && Math.abs(-s.z - 30) <= 6, `near the middle of the square, got ${s.x}, ${-s.z}`);
  assert.equal(c.groundHeight(s.x, s.z), c.floorY);
  assert.ok(s.yaw >= 0 && s.yaw < 2 * Math.PI);
});
