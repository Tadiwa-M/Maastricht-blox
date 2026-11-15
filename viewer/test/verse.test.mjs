// The comic-print focus test flag (src/render/verse.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lookFromHash, twosTick, VERSE } from '../src/render/verse.js';

test('only the explicit flag turns it on', () => {
  assert.equal(lookFromHash('#look=verse'), 'verse');
  assert.equal(lookFromHash('#t=21&look=verse&quality=high'), 'verse');
  assert.equal(lookFromHash('#look=verses'), null);
  assert.equal(lookFromHash('#t=21'), null);
  assert.equal(lookFromHash('#look=manga&t=9'), 'manga');
  assert.equal(lookFromHash(undefined), null);
});

test('animation on twos: a new pose 12 times a second', () => {
  let changes = 0, prev = twosTick(0);
  for (let t = 1 / 60; t < 1; t += 1 / 60) { const k = twosTick(t); if (k !== prev) changes++; prev = k; }
  assert.ok(changes >= VERSE.twosHz - 1 && changes <= VERSE.twosHz, `${changes} new poses in a second`);
});
