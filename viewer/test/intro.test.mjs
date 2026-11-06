// The opening fly-in path (src/intro.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { flyPose, ease, lookYaw, wantsIntro } from '../src/intro.js';

const close = (a, b, eps = 1e-6) => a.every((v, i) => Math.abs(v - b[i]) < eps);
const from = { cam: [0, 3000, 2000], target: [0, 50, 0] };
const to = { cam: [1000, 52, -1980], target: [1000, 47, -2000] };

test('fly-in: starts and ends exactly on the two poses, eased', () => {
  assert.ok(close(flyPose(from, to, 0).cam, from.cam, 1e-6) && close(flyPose(from, to, 0).target, from.target));
  assert.ok(close(flyPose(from, to, 1).cam, to.cam, 1e-6) && close(flyPose(from, to, 1).target, to.target));
  assert.equal(ease(0), 0); assert.equal(ease(1), 1); assert.equal(ease(0.5), 0.5);
});

test('fly-in: descends steadily and never dips under the target', () => {
  let lastH = Infinity;
  for (let k = 0; k <= 1.0001; k += 0.05) {
    const p = flyPose(from, to, k), h = p.cam[1] - p.target[1];
    assert.ok(h > 0, `camera above the target at ${k}`);
    assert.ok(h <= lastH + 1e-6, `keeps coming down at ${k}`);
    lastH = h;
  }
});

test('lookYaw: compass yaw from camera to target', () => {
  assert.ok(Math.abs(lookYaw([0, 0, 10], [0, 0, 0])) < 1e-9); // looking north (three.js -z)
  assert.ok(Math.abs(lookYaw([0, 0, 0], [10, 0, 0]) - Math.PI / 2) < 1e-9); // east
});

test('wantsIntro: plain loads only', () => {
  assert.equal(wantsIntro('', ''), true);
  assert.equal(wantsIntro('#t=13', ''), true);
  assert.equal(wantsIntro('#view=markt', ''), false);
  assert.equal(wantsIntro('#mode=walk&at=1,2', ''), false);
  assert.equal(wantsIntro('#intro=0', ''), false);
  assert.equal(wantsIntro('#view=city&intro=1', ''), true);
  assert.equal(wantsIntro('', '?shot=1'), false);
  assert.equal(wantsIntro('', '', true), false, 'automated browsers (tools/) skip it');
  assert.equal(wantsIntro('#intro=1', '', true), true);
});
