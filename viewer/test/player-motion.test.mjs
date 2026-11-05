// Player motion layer (src/player/motion.js + figure/rig.js motion fields).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MotionState, strideAt } from '../src/player/motion.js';
import { jointAngles, poseFigure, MODE } from '../src/figure/rig.js';
import { makeVariant } from '../src/figure/variants.js';

const DT = 1 / 60;
const base = { speed: 0, travelled: 0, angVel: 0, accel: 0, steer: 0, grounded: true, vy: 0 };
const v = makeVariant(52, { kind: 'adult' });

test('walk fades in with speed: standing is the idle pose, no pop at the start', () => {
  const m = new MotionState();
  const still = m.update(DT, base);
  assert.equal(still.blend, 0);
  const idle = jointAngles(v, { mode: MODE.IDLE, t: still.t });
  const blended = jointAngles(v, { ...still });
  assert.ok(Math.abs(blended.hip[0] - idle.hip[0]) < 1e-9);
  let p; // the controller eases speed up at 7 m/s² (locomotion.js)
  for (let q = 1; q <= 4; q++) { const sp = Math.min(1.4, 7 * q * DT); p = m.update(DT, { ...base, speed: sp, travelled: sp * DT }); }
  assert.ok(p.blend > 0 && p.blend < 0.5, `early blend ${p.blend}`);
  for (let q = 0; q < 60; q++) p = m.update(DT, { ...base, speed: 1.4, travelled: 1.4 * DT });
  assert.ok(p.blend > 0.95);
});

test('stride grows with speed so the step rate stays natural (no skating)', () => {
  assert.ok(strideAt(1.4) > 0.7 && strideAt(1.4) < 0.85);
  assert.ok(strideAt(5) > 1.3);
  const steps = (speed) => { const m = new MotionState(); for (let q = 0; q < 60; q++) m.update(DT, { ...base, speed, travelled: speed * DT }); return m.phase / Math.PI; };
  const walk = steps(1.4), sprint = steps(5);
  assert.ok(walk > 1.4 && walk < 2.2, `walk steps/s ${walk}`);
  assert.ok(sprint > 2.6 && sprint < 4, `sprint steps/s ${sprint}`);
});

test('leans into acceleration, banks into turns (the inside of the turn)', () => {
  const m = new MotionState();
  let p;
  for (let q = 0; q < 20; q++) p = m.update(DT, { ...base, speed: 2, travelled: 2 * DT, accel: 6 });
  assert.ok(p.lean > 0.08, `lean ${p.lean}`);
  for (let q = 0; q < 30; q++) p = m.update(DT, { ...base, speed: 4, travelled: 4 * DT, angVel: 2 });
  assert.ok(p.bank < -0.1, `turning clockwise (right) rolls right: ${p.bank}`);
  for (let q = 0; q < 30; q++) p = m.update(DT, { ...base, speed: 4, travelled: 4 * DT, angVel: -2 });
  assert.ok(p.bank > 0.1);
});

test('jump tucks the legs; a harder landing dips deeper', () => {
  const dipAfter = (fall) => {
    const m = new MotionState();
    m.update(DT, base);
    let p;
    for (let q = 0; q < 20; q++) p = m.update(DT, { ...base, grounded: false, vy: -fall });
    assert.ok(p.air > 0.7, `air ${p.air}`);
    return m.update(DT, { ...base, grounded: true }).dip;
  };
  assert.ok(dipAfter(7) > dipAfter(2));
  const tucked = jointAngles(v, { mode: MODE.WALK, phase: 0, speed: 1, blend: 1, air: 1 });
  const flat = jointAngles(v, { mode: MODE.WALK, phase: 0, speed: 1, blend: 1 });
  assert.ok(tucked.knee[0] < flat.knee[0] - 0.5);
});

test('bank rolls the whole figure about the feet', () => {
  const heads = (bank) => { let h; poseFigure(v, { x: 0, y: 0, z: 0, rotY: 0, mode: MODE.IDLE, bank }, (k, m) => { if (k === 'head') h = m[12]; }); return h; };
  assert.ok(Math.abs(heads(0)) < 1e-6);
  assert.ok(Math.abs(heads(0.2)) > 0.1);
});
