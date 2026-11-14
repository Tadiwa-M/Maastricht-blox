// Running into people (src/life/reactions.js contact) and carrying a gun on the move (src/figure/rig.js holdGun).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { contact, REACT } from '../src/life/reactions.js';
import { holdGun, jointAngles, MODE } from '../src/figure/rig.js';
import { makeVariant } from '../src/figure/variants.js';

const runner = (speed) => ({ x: 0, z: 0, vx: 0, vz: speed, speed }); // heading north

test('contact: a sprint knocks over, a jog or a walk shoves, and only going toward someone', () => {
  assert.equal(contact(runner(5), 0, 0.4), 'knock');
  assert.equal(contact(runner(2.5), 0, 0.4), 'shove');
  assert.equal(contact(runner(1.4), 0.2, 0.4), 'shove');
  assert.equal(contact(runner(0.3), 0, 0.4), null, 'standing still next to them');
  assert.equal(contact(runner(5), 0, 0.8), null, 'not touching');
  assert.equal(contact(runner(5), 0, -0.4), null, 'running away from them');
  assert.equal(contact(runner(5), 0.5, 0.05), null, 'passing beside, not into them');
  assert.ok(REACT.knockSpeed > 4 && REACT.knockSpeed < 5, 'a full run (5 m/s) knocks, a jog does not');
});

test('holding a gun: aiming raises both arms; a sprint lowers them into a carry and leans in; the stride moves them', () => {
  const v = makeVariant(3, { kind: 'adult' });
  const base = () => jointAngles(v, { mode: MODE.WALK, phase: 0, speed: 1 });
  const aim = holdGun(1, 0, base());
  assert.ok(aim.sh[1] > 1 && aim.sh[0] > 1, 'both arms up to the gun');
  const sprint = holdGun(1, 0, base(), { sprint: 1, speed: 5 });
  assert.ok(sprint.sh[1] < aim.sh[1] - 0.4 && sprint.elbow[1] > aim.elbow[1] + 0.5, 'gun low, elbows bent');
  assert.ok(sprint.lean > aim.lean + 0.1);
  const a = holdGun(1, 0, base(), { speed: 4, phase: Math.PI / 4 }).sh[1], b = holdGun(1, 0, base(), { speed: 4, phase: 3 * Math.PI / 4 }).sh[1];
  assert.ok(Math.abs(a - b) > 0.05, 'the arms ride the stride');
  const up = holdGun(1, 0.5, base()).sh[1];
  assert.ok(up > aim.sh[1] + 0.4, 'aiming up lifts the arms');
  assert.ok(Math.abs(holdGun(1, 0.5, base(), { sprint: 1, speed: 5 }).sh[1] - sprint.sh[1]) < 1e-9, 'a sprint carry ignores where you look');
});
