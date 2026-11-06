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
