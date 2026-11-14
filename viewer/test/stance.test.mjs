// Carrying a gun on the legs (src/player/stance.js) and the three holds (src/figure/rig.js holdGun).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stance, STANCE } from '../src/player/stance.js';
import { holdGun, jointAngles, captureParts, MODE } from '../src/figure/rig.js';
import { makeVariant } from '../src/figure/variants.js';

const near = (a, b, e = 1e-6) => assert.ok(Math.abs(a - b) < e, `${a} vs ${b}`);

test('stance: legs follow the travel up to a waist twist, backwards they step backwards, still they face the aim', () => {
  near(stance(0, 2, 0).legYaw, 0);
  const fwd = stance(0, 0.3, 3); near(fwd.legYaw, 0.3); near(fwd.twist, 0.3); assert.equal(fwd.back, false);
  const side = stance(0, Math.PI / 2, 3); near(side.legYaw, STANCE.twistMax); assert.equal(side.back, false);
  const back = stance(0, Math.PI, 3); near(back.legYaw, 0); assert.equal(back.back, true);
  const backL = stance(0, Math.PI - 0.4, 3); assert.equal(backL.back, true); near(backL.legYaw, -0.4);
  near(stance(3.1, -3.1, 3).legYaw, -3.1); // across the wrap: the short way
});

test('the chest really faces the aim when the legs turn away (rig twist)', () => {
  const v = makeVariant(4, { kind: 'adult' });
  const aimYaw = 0, st = stance(aimYaw, 0.9, 3); // walking off to the right of the aim
  const parts = captureParts(v, { x: 0, y: 0, z: 0, rotY: -st.legYaw, mode: MODE.WALK, phase: 0, speed: 3, twist: st.twist });
  const torso = parts.find((p) => p.key.startsWith('top:'));
  // the torso's local forward (-z) in world space: column 2 of its matrix, negated
  const fx = -torso.mat[8], fz = -torso.mat[10];
  const yaw = Math.atan2(fx, -fz); // compass (three.js -z = north)
  assert.ok(Math.abs(yaw - aimYaw) < 0.25, `chest yaw ${yaw.toFixed(2)} should be near the aim`);
});

test('holds: at the hip by default (hands low, barrel down), up to the shoulder when ready, across the chest in a sprint', () => {
  const v = makeVariant(3, { kind: 'adult' });
  const base = () => jointAngles(v, { mode: MODE.WALK, phase: 0, speed: 1 });
  const low = holdGun(1, 0, base(), { ready: 0 });
  const up = holdGun(1, 0, base(), { ready: 1 });
  assert.ok(low.sh[1] < 0.6 && up.sh[1] > 1.1, 'right arm: hip vs shoulder');
  assert.ok(low.elbow[1] > up.elbow[1], 'the elbow bends at the hip');
  const run = holdGun(1, 0, base(), { ready: 1, sprint: 1, speed: 5 });
  assert.ok(run.sh[1] < up.sh[1] - 0.4 && run.lean > up.lean + 0.1, 'a sprint lowers the gun even when ready');
});
