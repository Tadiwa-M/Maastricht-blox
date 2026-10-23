// Pooling and LOD for life movers: caps on full models and boxes, instanced model counts,
// buses posed along their shape facing the direction of travel, boats' river loop.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assignLod } from '../src/life/lodpick.js';
import { InstancedModel } from '../src/life/instancer.js';
import { TimetableBuses, LANE_M, nearestPalette } from '../src/life/buses.js';
import { Timetable } from '../src/life/schedule.js';
import { LifeClock } from '../src/life/clock.js';
import { offsetLine, riverLoop } from '../src/life/boats.js';
import { MaterialSet } from '../src/materials.js';

const contract = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'contract');
const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));
const palette = new Map(readJson(join(contract, 'palette.json')).entries.map((e) => [e.idx, e]));
const types = new Map(readJson(join(contract, 'brick_catalogue.json')).types.map((t) => [t.id, t]));
const bus = readJson(join(contract, 'models', 'bus.json'));
const character = readJson(join(contract, 'models', 'character.json'));
const opts = { palette, types, mats: new MaterialSet(), studM: 0.5, plateM: 0.2 };

test('LOD: nearest get full models up to the cap, then boxes, the rest hidden', () => {
  const dist = [500, 10, 50, 2000, 30, 170, Infinity, 20];
  const lod = assignLod(dist, { fullDist: 100, farDist: 1000, fullCap: 3, boxCap: 2 });
  assert.deepEqual(lod.full, [1, 7, 4]);
  assert.deepEqual(lod.box, [2, 5]); // 50 m is near but the full cap is used up
  assert.equal(lod.hidden, 3);
  const many = assignLod(Array.from({ length: 1000 }, (_, q) => q), { fullDist: 200, farDist: 600, fullCap: 24, boxCap: 300 });
  assert.equal(many.full.length, 24);
  assert.equal(many.box.length, 300);
  assert.equal(many.hidden, 676);
});

test('instanced model: draw count follows the pool size', () => {
  const m = new InstancedModel(character, opts, 50);
  const perCopy = m.batches.reduce((a, b) => a + b.list.length, 0);
  assert.ok(perCopy >= character.bricks.length);
  m.setCount(20);
  assert.equal(m.batches.reduce((a, b) => a + b.mesh.count, 0), 20 * perCopy);
  m.setCount(80);
  assert.equal(m.count, 50); // capped
  assert.deepEqual(Object.keys(m.hinges).sort(), ['arm_l', 'arm_r', 'leg_l', 'leg_r']);
});

test('instanced model: a copy is placed like buildModel places the model', () => {
  const m = new InstancedModel(character, opts, 2);
  m.setCount(1);
  m.setPose(0, 10, 2, -20, 0);
  const pts = [];
  for (const { mesh, list } of m.batches) list.forEach((_, q) => {
    const e = mesh.instanceMatrix.array;
    pts.push([e[q * 16 + 12], e[q * 16 + 13], e[q * 16 + 14]]);
  });
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  assert.ok(Math.min(...xs) >= 10 - 1.01 && Math.max(...xs) <= 10 + 1.01, 'within the 2 m wide figure');
  assert.ok(Math.min(...ys) >= 2 - 1e-6 && Math.max(...ys) <= 2 + 2.1, 'stands on y = 2');
});

function busDoc(n) {
  // n trips on one straight northbound shape, 2 minutes apart, 10 minutes long each
  return {
    routes: [{ short: '4', colour: '#00A0E0' }],
    shapes: [{ id: 's', pts: [100, 0, 0, 100, 3000, 3000] }],
    patterns: [{ shape: 0, route: 0, head: 'Station', st: [0, 0, 0, 600, 600, 3000] }],
    trips: Array.from({ length: n }, (_, q) => [0, 36000 + q * 10, 0b1111111]),
  };
}

test('buses: pose on the shape, right lane, facing travel; LOD caps hold', () => {
  const buses = new TimetableBuses({ timetable: new Timetable(busDoc(1)), model: bus, opts, ground: () => 5,
    caps: { full: 4, box: 6 } });
  const clock = new LifeClock({ day: 2, sec: 36000 + 300 });
  const cam = { position: { x: 100, y: 50, z: -1500 } };
  const [b] = buses.update(clock, cam);
  assert.ok(Math.abs(b.z - 1500) < 1e-6 && Math.abs(b.x - (100 + LANE_M)) < 1e-6, `${b.x}, ${b.z}`);
  assert.ok(Math.abs(b.yaw) < 1e-6 || Math.abs(b.yaw - 360) < 1e-6, 'northbound = yaw 0');
  assert.equal(b.y, 5);
  assert.deepEqual(buses.stats, { active: 1, full: 1, box: 0, hidden: 0 });

  const crowd = new TimetableBuses({ timetable: new Timetable(busDoc(40)), model: bus, opts, ground: () => 0,
    caps: { full: 4, box: 6, fullDist: 10000, farDist: 20000 } });
  crowd.update(new LifeClock({ day: 0, sec: 36000 + 400 }), cam);
  assert.equal(crowd.stats.active, 40);
  assert.equal(crowd.stats.full, 4);
  assert.equal(crowd.stats.box, 6);
  assert.equal(crowd.stats.hidden, 30);
  assert.equal(crowd.full.count, 4);
  assert.equal(crowd.boxes.count, 6);
});

test('route colour maps to the nearest palette colour', () => {
  assert.equal(nearestPalette(palette, '#C8102E', [38, 21, 8]), 38);
  assert.equal(nearestPalette(palette, '#203050', [38, 21, 8]), 21);
});

test('boats: river loop keeps right on both legs', () => {
  const north = [[0, 0], [0, 100]];
  assert.deepEqual(offsetLine(north, 10), [[10, 0], [10, 100]]); // right of north = east
  const loop = riverLoop(north, 10);
  assert.deepEqual(loop, [[10, 0], [10, 100], [-10, 100], [-10, 0]]);
});
