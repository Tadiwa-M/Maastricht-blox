// Buses and trains in traffic (src/life/busflow.js, buses.js): their sweep from the timetable,
// holding back for what is in front of them and making the lag up again.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sweepSamples, aheadGap, nextLag, lagCap, pathPoint, HOLD } from '../src/life/busflow.js';
import { TimetableBuses } from '../src/life/buses.js';
import { Timetable } from '../src/life/schedule.js';
import { LifeClock } from '../src/life/clock.js';
import { PathMover } from '../src/mover.js';
import { MaterialSet } from '../src/materials.js';

const contract = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'contract');
const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));
const palette = new Map(readJson(join(contract, 'palette.json')).entries.map((e) => [e.idx, e]));
const types = new Map(readJson(join(contract, 'brick_catalogue.json')).types.map((t) => [t.id, t]));
const bus = readJson(join(contract, 'models', 'bus.json'));
const opts = { palette, types, mats: new MaterialSet(), studM: 0.5, plateM: 0.2 };

test('sweep: the body now, then the front over the next seconds; nothing new while it stands', () => {
  const point = (d) => ({ x: 0, z: d });
  const moving = sweepSamples(point, (t) => 100 + 10 * t, 6, 2);
  assert.ok(moving.filter((p) => p.t === 0).every((p) => p.z >= 94 - 1e-9 && p.z <= 106 + 1e-9), 'body from rear to front');
  const ahead = moving.filter((p) => p.t > 0);
  assert.equal(ahead.length, 8);
  assert.ok(Math.abs(ahead[ahead.length - 1].z - (100 + 20 + 6)) < 1e-9, 'front in 2 s');
  // standing at a stop for 1 s, then away: the samples start when it moves
  const dwell = sweepSamples(point, (t) => 100 + Math.max(0, t - 1) * 8, 6, 2);
  assert.ok(dwell.filter((p) => p.t > 0).every((p) => p.t > 1));
  // the fast path lookup agrees with the mover (straight line), lane to the right
  const m = new PathMover({ path: [[0, 0], [0, 100]], loop: false });
  const p = pathPoint(m, 40, 1.6);
  assert.ok(Math.abs(p.x - 1.6) < 1e-9 && Math.abs(p.z - 40) < 1e-9);
});

test('free road ahead: footprints and circles in the path, not beside it', () => {
  const ahead = Array.from({ length: 10 }, (_, k) => ({ x: 0, z: k * 1.5, a: k * 1.5 }));
  const car = { x: 0, z: 9, yaw: 0, halfW: 0.9, halfL: 2.1 };
  assert.equal(aheadGap(ahead, 1.25, [car]), 6, 'the first point within half a bus width of the car (rear at 6.9 m)');
  assert.equal(aheadGap(ahead, 1.25, [{ ...car, x: 3.4 }]), Infinity, 'the oncoming lane');
  assert.equal(aheadGap(ahead, 1.25, [{ x: 0.5, z: 3, r: 0.5 }]), 1.5, 'a bike');
});

test('lag: stand still for a blocked road, slow for a short one, make it up afterwards', () => {
  const v = 8, want = HOLD.minM + v * HOLD.lookS;
  assert.equal(nextLag(0, 0.2, v, 1), 1, 'blocked: the lag grows as fast as time (it stands)');
  const half = nextLag(0, (want + HOLD.clearM) / 2, v, 1);
  assert.ok(half > 0.4 && half < 0.6, `half the road: half speed (${half})`);
  assert.equal(nextLag(10, Infinity, v, 1), 10 - HOLD.catchUp);
  assert.equal(nextLag(0.1, Infinity, v, 1), 0);
  assert.equal(nextLag(5, 0, 0, 1), 5 - HOLD.catchUp, 'standing at a stop anyway: no extra lag');
  assert.equal(nextLag(HOLD.maxLagS, 0, v, 1), HOLD.maxLagS, 'never more than maxLagS');
  assert.ok(lagCap(30) < 10 && lagCap(1e5) === HOLD.maxLagS, 'near its last stop it may hardly be late');
  assert.ok(nextLag(20, 0, v, 1, lagCap(30)) < 20, 'and makes the lag up before it gets there');
});

test('timetable bus: holds back for a car standing in its lane, then catches up', () => {
  const doc = { routes: [{ short: '4', colour: '#00A0E0' }], shapes: [{ id: 's', pts: [100, 0, 0, 100, 3000, 3000] }],
    patterns: [{ shape: 0, route: 0, head: 'Station', st: [0, 0, 0, 600, 600, 3000] }], trips: [[0, 36000, 0b1111111]] };
  const buses = new TimetableBuses({ timetable: new Timetable(doc), model: bus, opts, ground: () => 0 });
  const cam = { position: { x: 100, y: 50, z: -1500 } };
  const clock = new LifeClock({ day: 2, sec: 36000 + 300 });
  let [b] = buses.update(clock, cam);
  assert.ok(Math.abs(b.v - 5) < 0.01, `timetable speed ${b.v}`);
  assert.ok(b.sweep().some((p) => p.t > 0 && p.z > b.z + b.halfL + 10), 'its sweep reaches ahead');
  const car = { x: 101.6, z: b.z + b.halfL + 6, yaw: 0, halfW: 0.9, halfL: 2.1 }; // a car waiting in its lane
  for (let q = 0; q < 30 * 20; q++) {
    clock.advance(1 / 30);
    [b] = buses.update(clock, cam);
    buses.hold(1 / 30, [car], [100, 1500]);
    assert.ok(b.z + b.halfL < car.z - car.halfL + 0.05, `t ${q}: the bus front stays behind the car`);
  }
  assert.ok(b.lag > 15, `about 20 s behind its timetable (${b.lag.toFixed(1)})`);
  for (let q = 0; q < 30 * 120; q++) { clock.advance(1 / 30); [b] = buses.update(clock, cam); buses.hold(1 / 30, [], [100, 1500]); }
  assert.equal(buses.lag.size, 0, 'made it up');
  assert.ok(Math.abs(b.z - (36000 + 300 + 140 - 36000) * 5) < 1e-6, 'back on the timetable');
});
