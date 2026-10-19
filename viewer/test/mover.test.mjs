// PathMover and WalkCycle (src/mover.js): poses along a square loop and an open path.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PathMover, WalkCycle, WheelSpin } from '../src/mover.js';

const near = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;
const square = [[0, 0], [10, 0], [10, 10], [0, 10]]; // east, north, west, south

test('loop length and wrap-around', () => {
  const m = new PathMover({ path: square, loop: true });
  assert.equal(m.length, 40);
  assert.deepEqual(m.pointAt(45), m.pointAt(5));
  assert.deepEqual(m.pointAt(-5), m.pointAt(35));
});

test('yaw is clockwise from north on straight stretches', () => {
  const m = new PathMover({ path: square, turnRadius: 1 });
  assert.ok(near(m.poseAt(5).yaw, 90));   // heading east
  assert.ok(near(m.poseAt(15).yaw, 0));   // heading north
  assert.ok(near(m.poseAt(25).yaw, 270)); // heading west
  assert.ok(near(m.poseAt(35).yaw, 180)); // heading south
  assert.deepEqual(m.poseAt(5).position, [5, 0, 0]);
});

test('corners are smoothed: heading halfway through the turn, position cut inside', () => {
  const m = new PathMover({ path: square, turnRadius: 2 });
  const p = m.poseAt(10); // at the corner (10, 0)
  assert.ok(near(p.yaw, 45));
  assert.deepEqual(p.position, [9, 0, 1]);
});

test('open path stops at the end and keeps its last heading', () => {
  const m = new PathMover({ path: [[0, 0, 0], [0, 2, 10]], loop: false, speed: 4 });
  for (let q = 0; q < 10; q++) m.update(1);
  const { pose, travelled } = m.update(1);
  assert.equal(travelled, 0);
  assert.ok(near(pose.yaw, 0));
  assert.ok(near(pose.position[2], 10 - 1));
});

test('walk cycle swings legs in opposition and rests when standing', () => {
  const parts = { leg_l: { rotation: { x: 0 } }, leg_r: { rotation: { x: 0 } } };
  const w = new WalkCycle(parts, { stride: 1 });
  w.update(0.5, 1.2); // a quarter of a stride cycle: sin(pi/2) = 1 -> full swing
  assert.ok(parts.leg_l.rotation.x > 0.5 && near(parts.leg_l.rotation.x, -parts.leg_r.rotation.x));
  w.update(0, 0);
  assert.equal(parts.leg_l.rotation.x, 0);
});

test('wheels roll one radian per radius travelled, other parts untouched', () => {
  const parts = { wheel_fl: { rotation: { x: 0 } }, door: { rotation: { x: 0 } } };
  new WheelSpin(parts, () => 0.3).update(0.6);
  assert.ok(near(parts.wheel_fl.rotation.x, -2));
  assert.equal(parts.door.rotation.x, 0);
});
