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
  assert.ok(strideAt(1.4) > 0.6 && strideAt(1.4) < 0.85);
  assert.ok(strideAt(0.5) < strideAt(1.0) && strideAt(1.0) < strideAt(1.4), 'slow steps are short steps');
  assert.ok(strideAt(5) > 1.2);
  const steps = (speed) => { const m = new MotionState(); for (let q = 0; q < 60; q++) m.update(DT, { ...base, speed, travelled: speed * DT }); return m.phase / Math.PI; };
  const walk = steps(1.4), sprint = steps(5);
  assert.ok(walk > 1.4 && walk < 2.2, `walk steps/s ${walk}`);
  assert.ok(sprint > 2.6 && sprint < 4.6, `sprint steps/s ${sprint}`);
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
  assert.ok(Math.abs(heads(0)) < 0.01);
  assert.ok(Math.abs(heads(0.2) - heads(0)) > 0.1);
});

test('standing still for a while, the head looks around', () => {
  const m = new MotionState();
  let most = 0;
  for (let t = 0; t < 12; t += DT) most = Math.max(most, Math.abs(m.update(DT, base).look));
  assert.ok(most > 0.2, `look ${most}`);
  const w = new MotionState();
  let moving = 0;
  for (let t = 0; t < 12; t += DT) moving = Math.max(moving, Math.abs(w.update(DT, { ...base, speed: 1.4, travelled: 1.4 * DT }).look));
  assert.ok(moving < 1e-6, 'not while walking straight');
});

test('turning on the spot shuffles the feet; a jump reaches up then down; a running landing recovers faster', () => {
  const m = new MotionState();
  let p0 = m.phase, out;
  for (let q = 0; q < 30; q++) out = m.update(DT, { ...base, angVel: 6 });
  assert.ok(m.phase - p0 > 1 && out.blend > 0.2, `steps while turning: ${m.phase - p0}, blend ${out.blend}`);
  const j = new MotionState();
  for (let q = 0; q < 12; q++) out = j.update(DT, { ...base, grounded: false, vy: 4 });
  assert.ok(out.rise > 0.5 && out.air > 0.8, `rising ${out.rise}`);
  for (let q = 0; q < 20; q++) out = j.update(DT, { ...base, grounded: false, vy: -5 });
  assert.ok(out.rise < -0.5);
  const up = jointAngles(v, { mode: MODE.WALK, phase: 0, speed: 1, blend: 0, air: 1, rise: 1 });
  const down = jointAngles(v, { mode: MODE.WALK, phase: 0, speed: 1, blend: 0, air: 1, rise: -1 });
  assert.ok(up.sh[0] > down.sh[0] + 0.4 && down.abd[0] > up.abd[0], 'arms up on the way up, out on the way down');
  const land = (speed) => { const s = new MotionState(); s.update(DT, { ...base, speed, grounded: false, vy: -6 }); let d; for (let q = 0; q < 12; q++) d = s.update(DT, { ...base, speed, travelled: speed * DT }).dip; return d; };
  assert.ok(land(0) > land(4) * 1.5 && land(0) > 0.1, `standing ${land(0)} vs running ${land(4)}`);
});

test('feet follow the ground through a start: phase advances with distance at the stride of the moment', () => {
  const m = new MotionState();
  let phase = 0, dist = 0;
  for (let q = 0; q < 30; q++) { const sp = Math.min(1.5, q * 0.2); m.update(DT, { ...base, speed: sp, travelled: sp * DT }); dist += sp * DT; }
  phase = m.phase;
  const steps = phase / Math.PI;
  assert.ok(steps > dist / 0.75 * 0.9 && steps < dist / 0.2, `${steps} steps over ${dist} m`);
});
