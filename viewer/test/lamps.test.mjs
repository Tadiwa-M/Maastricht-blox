// Street lamps lighting the street (src/render/lamps.js): found in raw records and in a World alike,
// turned with the piece, two lantern heads at the ends of its long side.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lampsFromRecords, LampLights, LAMP } from '../src/render/lamps.js';

const lamp = { id: 53, name: LAMP.type, w: 3, d: 1, h: 22 };
const rec = (list) => ({ i: list.map((r) => r[0]), j: list.map((r) => r[1]), k: list.map((r) => r[2]), type: list.map((r) => r[3]), rotFlags: list.map((r) => r[4]) });

test('lamps in the raw records: base on the ground, heads at the top of both ends, turned with the piece', () => {
  const out = lampsFromRecords(rec([[10, 20, 90, 53, 0], [30, 5, 90, 53, 1], [1, 1, 90, 7, 0]]), 64, 128, lamp);
  assert.equal(out.length, 2, 'only the lamp pieces');
  const [a, b] = out;
  assert.deepEqual(a.base.map((v) => +v.toFixed(2)), [(64 + 10 + 1.5) * 0.5, 18, -(128 + 20 + 0.5) * 0.5].map((v) => +v.toFixed(2)));
  assert.ok(Math.abs(a.heads[0][1] - ((90 + 22) * 0.2 - 0.45)) < 1e-9);
  assert.ok(a.heads[0][2] === a.heads[1][2] && a.heads[0][0] < a.heads[1][0], 'unturned: the heads spread east-west');
  assert.ok(b.heads[0][0] === b.heads[1][0] && b.heads[0][2] !== b.heads[1][2], 'a quarter turn: they spread north-south');
  assert.deepEqual(lampsFromRecords(rec([[1, 1, 1, 53, 0]]), 0, 0, null), [], 'no lamp type in the catalogue');
});

test('light only at night, nearest lamps first up to the cap, removed with their chunk', () => {
  const L = new LampLights();
  const cam = { position: { x: 0, y: 10, z: 0, clone() { return { ...this, distanceToSquared: () => 0 }; } }, quaternion: { x: 0, y: 0, z: 0, w: 1, isQuaternion: true } };
  cam.position.distanceToSquared = () => 0;
  const many = [];
  for (let q = 0; q < LAMP.cap + 40; q++) many.push({ base: [q * 3, 0, 0], heads: [[q * 3, 4, 0], [q * 3 + 1, 4, 0]] });
  L.add('c1', many);
  L.update(cam, 0);
  assert.equal(L.group.visible, false, 'day: off');
  L.update(cam, 1);
  assert.equal(L.pools.count, LAMP.cap);
  assert.equal(L.glows.count, LAMP.cap * 2);
  L.remove('c1');
  L.update(cam, 1);
  assert.equal(L.pools.count, 0);
});
