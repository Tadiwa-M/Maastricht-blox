// The comic-print focus test flag (src/render/verse.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lookFromHash, twosTick, VERSE, chooseLook, hashWithLook, MENU_LOOKS, isPhone } from '../src/render/verse.js';

test('only the explicit flag turns it on', () => {
  assert.equal(lookFromHash('#look=verse'), 'verse');
  assert.equal(lookFromHash('#t=21&look=verse&quality=high'), 'verse');
  assert.equal(lookFromHash('#look=verses'), null);
  assert.equal(lookFromHash('#t=21'), null);
  assert.equal(lookFromHash('#look=manga&t=9'), 'manga');
});

test('the saved look applies unless the address says otherwise; switching keeps the other settings', () => {
  const store = (v) => ({ getItem: () => v });
  assert.equal(chooseLook('#t=9', store('verse')), 'verse');
  assert.equal(chooseLook('#t=9', store('classic')), null);
  assert.equal(chooseLook('#look=classic', store('verse')), null);
  assert.equal(chooseLook('#look=manga', store('verse')), 'manga');
  assert.equal(chooseLook('', null), null);
  assert.equal(hashWithLook('#t=9&look=verse&quality=high', null), '#t=9&quality=high&look=classic');
  assert.equal(hashWithLook('', 'verse'), '#look=verse');
  assert.deepEqual(MENU_LOOKS.map((l) => l.id), [null, 'verse']);
  assert.equal(isPhone(true, 412), true, 'a phone');
  assert.equal(isPhone(false, 400), false, 'a small laptop window is not a phone');
  assert.equal(isPhone(true, 800), false, 'a touch laptop or tablet is not a phone');
  assert.equal(lookFromHash(undefined), null);
});

test('animation on twos: a new pose 12 times a second', () => {
  let changes = 0, prev = twosTick(0);
  for (let t = 1 / 60; t < 1; t += 1 / 60) { const k = twosTick(t); if (k !== prev) changes++; prev = k; }
  assert.ok(changes >= VERSE.twosHz - 1 && changes <= VERSE.twosHz, `${changes} new poses in a second`);
});
