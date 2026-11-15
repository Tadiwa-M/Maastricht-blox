// The time-of-day look (src/render/look.js): sane values at every hour, no jumps between hours.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lookAt, blueWeight, hexToRgb } from '../src/render/look.js';

// the sun state as scene.js sunAt computes it (kept free of three.js here)
const smooth = (x, a, b) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
function sun(hours) {
  const raw = Math.sin(Math.PI * (hours - 6) / 12) * (52 * Math.PI / 180);
  return { night: smooth(-raw, -0.05, 0.3), low: 1 - smooth(raw, 0.05, 0.6) };
}
const flat = (L) => [L.sunIntensity / 3, // as a share of full daylight
   L.hemiIntensity, L.envIntensity, L.exposure, L.haze, ...L.sunColor, ...L.top, ...L.horizon,
  ...L.hemiSky, ...L.hemiGround, L.grade.saturation, L.grade.contrast, L.grade.vignette, ...L.grade.lift, ...L.grade.gain];

test('hexToRgb', () => assert.deepEqual(hexToRgb('#ff0080').map((v) => +v.toFixed(3)), [1, 0, 0.502]));

test('blue hour peaks half way through twilight', () => {
  assert.equal(blueWeight(0.5), 1);
  assert.equal(blueWeight(0), 0);
  assert.equal(blueWeight(1), 0);
});

test('every hour: finite values, colours in 0..1', () => {
  for (let h = 0; h < 24; h += 0.05) {
    const L = lookAt(sun(h));
    for (const v of flat(L)) assert.ok(Number.isFinite(v), `hour ${h}`);
    for (const c of [L.sunColor, L.top, L.horizon, L.hemiSky, L.hemiGround]) for (const v of c) assert.ok(v >= 0 && v <= 1);
    assert.ok(L.sunIntensity > 0 && L.exposure >= 1 && L.haze >= 0);
  }
});

test('noon is bright and vivid, midnight is dim moonlight, direct light dips at the switch to the moon', () => {
  const noon = lookAt(sun(12)), mid = lookAt(sun(0)), blue = lookAt({ night: 0.5, low: 1 });
  assert.ok(noon.sunIntensity > 2.5 && mid.sunIntensity < 1.5);
  assert.ok(blue.sunIntensity < 0.2, 'the sun/moon direction switch is hidden');
  assert.ok(mid.sunColor[2] > mid.sunColor[0], 'moonlight is cool');
  assert.ok(noon.hemiSky[0] > mid.hemiSky[0], 'the day light is warm, the night cool');
  assert.equal(mid.haze, 0);
});

test('no jumps: a minute of game time changes nothing by more than a few percent', () => {
  let prev = flat(lookAt(sun(0)));
  for (let h = 1 / 60; h <= 24; h += 1 / 60) {
    const cur = flat(lookAt(sun(h)));
    cur.forEach((v, i) => assert.ok(Math.abs(v - prev[i]) < 0.07, `hour ${h.toFixed(2)} value ${i}: ${prev[i]} -> ${v}`));
    prev = cur;
  }
});

test('night is night, not darkness: a strong coloured fill, readable buildings, saturated', () => {
  const lumOf = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  for (const h of [21, 22.5, 0, 2, 3.5]) {
    const L = lookAt(sun(h));
    const fill = L.hemiIntensity * lumOf(L.hemiSky) * L.exposure; // the light every surface gets
    assert.ok(fill > 0.5, `hour ${h}: fill ${fill.toFixed(2)} too dark`);
    assert.ok(L.hemiSky[2] > L.hemiSky[0] && L.hemiSky[2] > L.hemiSky[1], 'blue-violet');
    assert.ok(lumOf(L.horizon) > 0.18, `hour ${h}: the sky glows over the city`);
    assert.ok(L.grade.saturation >= 1.1, 'colourful');
  }
});
