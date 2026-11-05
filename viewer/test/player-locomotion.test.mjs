// Locomotion (src/player/locomotion.js): heading turns in arcs, sharp turns cost speed, a hard
// reversal at speed plants and pivots, speed eases, the facing never slides.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Locomotion, LOCO } from '../src/player/locomotion.js';

const DT = 1 / 60;
const run = (l, s, want, speed) => { for (let t = 0; t < s; t += DT) l.update(DT, want, speed); return l; };

test('speeds up and slows down with eased acceleration and braking', () => {
  const l = new Locomotion();
  run(l, 0.1, 0, 4);
  assert.ok(l.speed > 0.4 && l.speed < 1.0, `after 0.1 s: ${l.speed}`);
  run(l, 1, 0, 4);
  assert.ok(Math.abs(l.speed - 4) < 1e-6);
  run(l, 0.2, null, 0);
  assert.ok(l.speed > 1.5 && l.speed < 2.5, `braking: ${l.speed}`); // 10 m/s² for 0.2 s
  run(l, 1, null, 0);
  assert.equal(l.speed, 0);
});

test('turns on the spot fast, in a wide arc at a sprint', () => {
  const still = new Locomotion();
  run(still, 0.15, Math.PI / 2, 1.4);
  assert.ok(still.heading > 1.2, `still: ${still.heading}`);
  const fast = run(new Locomotion(), 1.5, 0, LOCO.sprint);
  run(fast, 0.15, Math.PI / 2, LOCO.sprint);
  assert.ok(fast.heading < 0.8 && fast.heading > 0.2, `sprint: ${fast.heading}`); // 3-5 rad/s (faster as it slows)
  assert.ok(fast.heading < still.heading / 1.5, 'the sprint turns much wider than on the spot');
  assert.ok(fast.angVel > 1, 'turning clockwise shows as positive angular velocity');
});

test('a sharp turn costs speed; a straight line keeps it', () => {
  const l = run(new Locomotion(), 1.5, 0, 4);
  let low = 9;
  for (let t = 0; t < 0.5; t += DT) { l.update(DT, Math.PI / 2, 4); low = Math.min(low, l.speed); }
  assert.ok(low < 3.2, `slowest in the turn: ${low}`);
  run(l, 2, Math.PI / 2, 4);
  assert.ok(Math.abs(l.speed - 4) < 1e-6 && Math.abs(l.heading - Math.PI / 2) < 1e-6);
});

test('a hard reversal at speed plants, brakes and pivots instead of turning in a loop', () => {
  const l = run(new Locomotion(), 1.5, 0, 4);
  l.update(DT, Math.PI, 4);
  assert.ok(l.pivoting);
  assert.ok(Math.abs(l.heading) < 1e-6, 'keeps facing forward while braking');
  run(l, 0.6, Math.PI, 4);
  assert.ok(!l.pivoting && Math.abs(l.heading - Math.PI) < 1e-6, `turned round: ${l.heading}`);
  run(l, 1.5, Math.PI, 4);
  assert.ok(Math.abs(l.speed - 4) < 1e-6);
});

test('velocity always points along the heading (no sideways slide)', () => {
  const l = run(new Locomotion(), 1, 0, 3);
  for (let q = 0; q < 30; q++) {
    l.update(DT, 1.0, 3);
    const h = Math.atan2(l.vx, -l.vz);
    assert.ok(Math.abs(h - l.heading) < 1e-6 || l.speed === 0);
  }
});

test('in the air there is little grip; walls cut the speed', () => {
  const l = new Locomotion();
  for (let t = 0; t < 0.3; t += DT) l.update(DT, 0, 4, 0.25);
  assert.ok(l.speed < 0.6, `air: ${l.speed}`);
  run(l, 1, 0, 4);
  l.blocked(1.2);
  assert.equal(l.speed, 1.2);
});
