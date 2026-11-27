// Rooms with the light on through the night (src/glow.js litShare), and the near look giving every
// window its room colour (the shader decides which are on).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { litShare, windowColor } from '../src/glow.js';

test('evenings busiest, small hours nearly dark, a morning bump; smooth and in 0..1', () => {
  assert.ok(litShare(20.5) > 0.6);
  assert.ok(litShare(3.5) < 0.1);
  assert.ok(litShare(7) > litShare(4) && litShare(7) > litShare(12));
  assert.ok(litShare(23.9) > litShare(1.5));
  let prev = litShare(0);
  for (let h = 0.05; h < 24; h += 0.05) {
    const v = litShare(h);
    assert.ok(v >= 0 && v <= 1);
    assert.ok(Math.abs(v - prev) < 0.02, `jump at ${h.toFixed(2)}`);
    prev = v;
  }
  assert.ok(Math.abs(litShare(24) - litShare(0)) < 1e-9 && Math.abs(litShare(-1) - litShare(23)) < 1e-9);
});

test('the near look colours every window; the far look keeps its fixed cut', () => {
  let dark = 0, darkAll = 0;
  for (let q = 0; q < 400; q++) {
    if (windowColor(7, q, q * 3, 40).r === 0) dark++;
    if (windowColor(7, q, q * 3, 40, undefined, true).getHex() === 0) darkAll++;
  }
  assert.ok(dark > 100 && dark < 250, `far: ${dark} of 400 dark`);
  assert.equal(darkAll, 0);
});
