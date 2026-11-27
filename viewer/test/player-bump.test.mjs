// Vehicle contacts (src/player/bump.js) and the pop-apart knock-down (src/player/scatter.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { VehicleContacts, lifeVehicles, KNOCK_SPEED } from '../src/player/bump.js';
import { Scatter, SCATTER } from '../src/player/scatter.js';
import { captureParts, MODE } from '../src/figure/rig.js';
import { makeVariant } from '../src/figure/variants.js';

const DT = 1 / 60;
const bus = (x, z) => ({ x, z, yaw: 0, halfW: 1.3, halfL: 6 }); // heading north (+z)

test('a parked bus pushes the player out to its nearer long side', () => {
  const c = new VehicleContacts();
  c.check([100, 100], [bus(0, 0)], DT);
  const r = c.check([0.5, 2], [bus(0, 0)], DT); // inside, right of the centre line
  assert.ok(r.push, JSON.stringify(r));
  assert.ok(Math.abs(0.5 + r.push[0] - (1.3 + 0.35)) < 1e-9 && Math.abs(r.push[1]) < 1e-9);
  assert.equal(c.check([5, 0], [bus(0, 0)], DT), null);
});

test('a moving bus knocks the player flying, forward and up; speed is measured between frames', () => {
  const c = new VehicleContacts();
  c.check([100, 100], [bus(0, -0.2)], DT);
  const r = c.check([-0.4, 3], [bus(0, 0)], DT); // moved 0.2 m in 1/60 s = 12 m/s
  assert.ok(r.knock, JSON.stringify(r));
  assert.ok(r.speed > KNOCK_SPEED && Math.abs(r.speed - 12) < 1e-6);
  assert.ok(r.knock[2] > 5 && r.knock[1] > 3 && r.knock[0] < 0, 'thrown north, up, and to its left side');
  assert.equal(c.speedOf(bus(50, 50), DT), 0, 'a vehicle seen for the first time counts as still');
});

test('life vehicles: buses, trains and cars become footprints', () => {
  const life = { vehicles: [{ x: 1, z: 2, yaw: 90, mode: 'bus' }, { x: 3, z: 4, yaw: 0, mode: 'rail' }],
    cars: { footprints: () => [{ x: 5, z: 6, yaw: 0, halfW: 0.9, halfL: 2.1 }] } };
  const f = lifeVehicles(life, [0, 0], [1.2, 6], [1.5, 20]);
  assert.equal(f.length, 3);
  assert.equal(f[1].halfL, 20);
  assert.deepEqual(lifeVehicles(null, [0, 0]), []);
});

test('scatter: parts fly apart, bounce on the ground, then snap back exactly onto the posed figure', () => {
  const v = makeVariant(52, { kind: 'adult' });
  const parts = captureParts(v, { x: 0, y: 10, z: 0, rotY: 0, mode: MODE.IDLE, t: 0 });
  let s = 1;
  const rand = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const sc = new Scatter(parts, [0, 4, -8], () => 10, rand);
  let out;
  let lowest = Infinity, spread = 0;
  for (let t = 0; t < SCATTER.fly; t += DT) {
    out = sc.update(DT);
    for (const p of out) { lowest = Math.min(lowest, p.mat[13]); spread = Math.max(spread, Math.hypot(p.mat[12], p.mat[14])); }
  }
  assert.ok(lowest >= 10.04 - 1e-6, `never below the ground: ${lowest}`);
  assert.ok(spread > 2, `flew apart: ${spread} m`);
  const target = captureParts(v, { x: 3, y: 10, z: -4, rotY: 0, mode: MODE.IDLE, t: 0 });
  for (let t = 0; t < SCATTER.gather + 2 * DT; t += DT) out = sc.update(DT, target);
  assert.ok(sc.done);
  for (let i = 0; i < out.length; i++) for (let k = 0; k < 16; k++) assert.ok(Math.abs(out[i].mat[k] - target[i].mat[k]) < 1e-3, `part ${i} m${k}`);
});
