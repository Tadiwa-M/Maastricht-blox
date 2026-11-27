import { test } from 'node:test';
import assert from 'node:assert/strict';
import { seatPosition, lookTarget, outsideView, angleDelta, smoothYaw, doorSide, DOOR_SIDE_M, SEATS } from '../src/ride/seat.js';

const near = (a, b, eps = 1e-6) => a.every((v, i) => Math.abs(v - b[i]) < eps);

test('seat sits ahead and to the left, at eye height, for any heading', () => {
  // facing north (yaw 0): forward = three -z, left = three -x
  assert.ok(near(seatPosition({ x: 10, y: 50, z: 20, yaw: 0 }), [10 - 0.55, 50 + SEATS.bus.eye, -20 - 2.2]));
  // facing east (yaw 90): forward = +x, left = three -z (north)
  assert.ok(near(seatPosition({ x: 10, y: 50, z: 20, yaw: 90 }), [10 + 2.2, 50 + SEATS.bus.eye, -20 - 0.55]));
  assert.ok(SEATS.bus.eye > 1.2 + 0.6 && SEATS.bus.eye < 2.4, 'eyes at window height (1.2-2.4 m)');
  assert.equal(seatPosition({ x: 0, y: 0, z: 0, yaw: 0 }, 'rail')[1], SEATS.rail.eye);
});

test('look target follows compass heading and pitch', () => {
  assert.ok(near(lookTarget([0, 0, 0], 0, 0, 10), [0, 0, -10])); // north
  assert.ok(near(lookTarget([0, 0, 0], 90, 0, 10), [10, 0, 0])); // east
  const up = lookTarget([0, 0, 0], 0, Math.PI / 4, 10);
  assert.ok(up[1] > 7 && up[2] < -7);
});

test('outside view is behind the vehicle and above it', () => {
  const { cam, target } = outsideView({ x: 0, y: 0, z: 0, yaw: 0 });
  assert.ok(cam[2] > target[2] && cam[1] > target[1]); // facing north: behind = +z in three
});

test('yaw smoothing takes the short way round and snaps on big jumps', () => {
  assert.equal(angleDelta(350, 10), 20);
  assert.equal(angleDelta(10, 350), -20);
  const y = smoothYaw(350, 10, 0.1);
  assert.ok(angleDelta(350, y) > 0 && angleDelta(350, y) < 20);
  assert.equal(smoothYaw(0, 170, 0.1), 170);
  assert.equal(smoothYaw(null, 42, 0.1), 42);
});

test('ride: without a stop position the passenger steps off on the right (kerb) side', () => {
  const north = doorSide({ x: 10, z: 20, yaw: 0 }); // heading north: right is east (+x)
  assert.ok(Math.abs(north.x - (10 + DOOR_SIDE_M.bus)) < 1e-9 && Math.abs(north.z - 20) < 1e-9);
  const east = doorSide({ x: 0, z: 0, yaw: 90 }, 'rail'); // heading east: right is south (-z)
  assert.ok(Math.abs(east.x) < 1e-9 && Math.abs(east.z + DOOR_SIDE_M.rail) < 1e-9 && east.yaw === 90);
});
