// How a plain load starts (src/intro.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lookYaw, wantsIntro } from '../src/intro.js';

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
