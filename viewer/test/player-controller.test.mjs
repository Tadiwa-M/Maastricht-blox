// Character controller (src/player/controller.js) against a synthetic isSolid grid:
// walking speed, step-up of 1-2 plates, wall stop, gravity and landing, rotated (island-like)
// walls, unknown space, jump, facing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CharacterController, angleDelta } from '../src/player/controller.js';
import { cityFromWorld } from '../src/player/city-adapter.js';
import { World } from '../src/world.js';
import { synthCity } from './player-city.mjs';

const DT = 1 / 60;
const run = (c, seconds, input, camYaw = 0) => { for (let t = 0; t < seconds; t += DT) c.update(DT, input, camYaw); };
const north = (speed = 1.4) => ({ move: [0, 1], speed });
const east = (speed = 1.4) => ({ move: [1, 0], speed });
// cell J -> three z of its south edge: z = -J * 0.5

test('stands on the floor and walks at walk / run speed after accelerating', () => {
  const city = synthCity();
  const c = new CharacterController(city);
  c.spawn(5, city.floorY + 0.3, -5);
  run(c, 0.5, {});
  assert.ok(c.grounded);
  assert.ok(Math.abs(c.pos[1] - city.floorY) < 0.02, `feet ${c.pos[1]}`);
  run(c, 1, north());
  const z0 = c.pos[2];
  run(c, 1, north());
  assert.ok(Math.abs((z0 - c.pos[2]) - 1.4) < 0.05, `walked ${z0 - c.pos[2]}`);
  run(c, 1, north(4));
  const z1 = c.pos[2];
  run(c, 1, north(4));
  assert.ok(Math.abs((z1 - c.pos[2]) - 4) < 0.1, `ran ${z1 - c.pos[2]}`);
});

test('steps up a 1-plate kerb and 2-plate step, but not a 3-plate wall', () => {
  for (const [plates, climbs] of [[1, true], [2, true], [3, false]]) {
    const city = synthCity({ floorK: 5 });
    city.fill(0, 20, 5, 39, 39, 5 + plates - 1); // raised area north of J = 20 (z < -10)
    const c = new CharacterController(city);
    c.spawn(5, city.floorY, -8);
    run(c, 3, north());
    const top = city.floorY + plates * 0.2;
    if (climbs) {
      assert.ok(c.pos[2] < -11, `${plates} plates: should be up, z ${c.pos[2]}`);
      assert.ok(Math.abs(c.pos[1] - top) < 0.02, `${plates} plates: feet ${c.pos[1]} vs ${top}`);
    } else {
      assert.ok(c.pos[2] > -10 && c.pos[2] < -9.6, `wall stops the body at its radius, z ${c.pos[2]}`);
      assert.ok(Math.abs(c.pos[1] - city.floorY) < 0.02);
    }
  }
});

test('slides along a wall when walking diagonally into it', () => {
  const city = synthCity();
  city.fill(0, 20, 5, 39, 20, 20); // wall along x at z = -10
  const c = new CharacterController(city);
  c.spawn(5, city.floorY, -8);
  run(c, 3, { move: [Math.SQRT1_2, Math.SQRT1_2], speed: 1.4 });
  assert.ok(c.pos[2] > -10 && c.pos[0] > 6.5, `slid to x ${c.pos[0]}, z ${c.pos[2]}`);
});

test('walks down off a step (snaps) and falls off a ledge with gravity, landing exactly', () => {
  const city = synthCity({ floorK: 5 });
  city.fill(0, 0, 5, 39, 19, 6); // 2 plates up south of z = -10
  city.fill(0, 30, 5, 39, 39, 24); // big block far north, irrelevant
  const c = new CharacterController(city);
  c.spawn(5, city.floorY + 0.4, -8);
  run(c, 0.3, {});
  assert.ok(Math.abs(c.pos[1] - (city.floorY + 0.4)) < 0.02);
  run(c, 2.5, north());
  assert.ok(c.pos[2] < -11 && Math.abs(c.pos[1] - city.floorY) < 0.02 && c.grounded, `stepped down to ${c.pos}`);
  // a 3 m drop: falls, never below the surface
  const g = synthCity({ floorK: 5 });
  g.fill(0, 0, 5, 39, 19, 19); // 3 m platform
  const f = new CharacterController(g);
  f.spawn(5, g.floorY + 3, -9.2);
  let minY = Infinity, airborne = false;
  for (let t = 0; t < 3; t += DT) { f.update(DT, north(), 0); minY = Math.min(minY, f.pos[1]); airborne ||= !f.grounded; }
  assert.ok(airborne, 'fell');
  assert.ok(f.grounded && Math.abs(f.pos[1] - g.floorY) < 0.02, `landed at ${f.pos[1]}`);
  assert.ok(minY > g.floorY - 0.02, `never sank: ${minY}`);
});

test('a big time step does not tunnel through a thin wall or the floor', () => {
  const city = synthCity();
  city.fill(0, 20, 5, 39, 20, 20);
  const c = new CharacterController(city);
  c.spawn(5, city.floorY, -8);
  c.vel = [0, 0, -4];
  for (let q = 0; q < 10; q++) c.update(0.1, north(4), 0);
  assert.ok(c.pos[2] > -10);
  const f = new CharacterController(city);
  f.spawn(2, city.floorY + 8, -2);
  for (let q = 0; q < 30; q++) f.update(0.1, {}, 0);
  assert.ok(Math.abs(f.pos[1] - city.floorY) < 0.02, `fell to ${f.pos[1]}`);
});

test('rotated box (island at 30 degrees) blocks the body', () => {
  for (const yawDeg of [30, -20]) {
    const city = synthCity({ rotBoxes: [{ cx: 10, cz: -12, hx: 4, hz: 1, y0: 0, y1: 20, yawDeg }] });
    const c = new CharacterController(city);
    c.spawn(10, city.floorY, -7);
    run(c, 5, north());
    // the nearest face of the turned box under x = 10 is at north distance 1/cos(yaw) from its centre
    const faceZ = -12 + 1 / Math.cos((yawDeg * Math.PI) / 180);
    assert.ok(c.pos[2] > faceZ, `inside the box: z ${c.pos[2]} vs face ${faceZ}`);
    assert.ok(c.pos[2] < faceZ + 0.6, `stopped too early: z ${c.pos[2]}`);
    for (let a = 0; a < 8; a++) { // no body sample inside the box
      const x = c.pos[0] + Math.cos(a) * 0.24, z = c.pos[2] + Math.sin(a) * 0.24;
      assert.equal(city.isSolid(x, city.floorY + 1, z), false);
    }
  }
});

test('unknown (unloaded) space is a wall and a floor; spawning inside it freezes', () => {
  const city = synthCity({ unknownX: 10 });
  const c = new CharacterController(city);
  c.spawn(8, city.floorY, -5);
  run(c, 4, east(4));
  assert.ok(c.pos[0] < 10 - 0.2 && c.pos[0] > 9, `stopped before unknown: ${c.pos[0]}`);
  const f = new CharacterController(city);
  f.spawn(12, city.floorY + 5, -5);
  run(f, 1, east());
  assert.ok(f.frozen);
  assert.deepEqual(f.pos, [12, city.floorY + 5, -5]);
});

test('jump: small hop, lands back; turns toward the move direction', () => {
  const city = synthCity();
  const c = new CharacterController(city);
  c.spawn(5, city.floorY, -5);
  run(c, 0.2, {});
  c.update(DT, { jump: true }, 0);
  let top = 0;
  for (let t = 0; t < 1.5; t += DT) { c.update(DT, {}, 0); top = Math.max(top, c.pos[1] - city.floorY); }
  assert.ok(top > 0.35 && top < 0.7, `jump height ${top}`);
  assert.ok(c.grounded && Math.abs(c.pos[1] - city.floorY) < 0.02);
  run(c, 1, east());
  assert.ok(Math.abs(angleDelta(c.yaw, Math.PI / 2)) < 0.01, `yaw ${c.yaw}`);
  // camera-relative: camera looking east, stick forward -> moves east
  const x0 = c.pos[0];
  run(c, 1, north(), Math.PI / 2);
  assert.ok(c.pos[0] - x0 > 1);
});

test('spawned inside a building block, the body is lifted on top of it', () => {
  const city = synthCity();
  city.fill(8, 8, 5, 12, 12, 9); // 1 m block
  const c = new CharacterController(city);
  c.spawn(5, city.floorY + 0.5, -5);
  assert.ok(Math.abs(c.pos[1] - (city.floorY + 1)) < 0.02, `lifted to ${c.pos[1]}`);
});

test('adapter over a World: solid bricks, air above, unknown outside loaded chunks', () => {
  const meta = { palette: { entries: [{ idx: 1, name: 'grey' }] }, catalogue: { types: [{ id: 1, name: 'brick_1x1', w: 1, d: 1, h: 3 }] } };
  const recs = [];
  for (let I = 0; I < 64; I++) for (let J = 0; J < 64; J++) recs.push({ I, J, K: 0, type: 1, color: 1 });
  recs.push({ I: 10, J: 10, K: 3, type: 1, color: 1 });
  const city = cityFromWorld(World.fromRecords(meta, recs));
  assert.equal(city.isSolid(5.2, 0.3, -5.2), true);   // cell (10, 10, 1): floor
  assert.equal(city.isSolid(5.2, 0.7, -5.2), true);   // stacked brick K 3..5
  assert.equal(city.isSolid(6.2, 0.7, -5.2), false);
  assert.equal(city.isSolid(40, 0.7, -5), 'unknown'); // I = 80: chunk 1 not loaded
  assert.ok(Math.abs(city.groundHeight(5.2, -5.2) - 1.2) < 1e-9);
  assert.ok(Math.abs(city.groundHeight(1, -1) - 0.6) < 1e-9);
  const c = new CharacterController(city);
  c.spawn(3, 0.6, -5.2);
  run(c, 3, east());
  assert.ok(Math.abs(c.pos[1] - 0.6) < 0.02, `on the floor: ${c.pos[1]}`);
  assert.ok(c.pos[0] < 5 - 0.2, 'brick on top of the floor is a wall');
});
