// Trip guide (src/plan/trip.js): walk, wait, board, ride, get off, walk on, arrive.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TripGuide, ARRIVE_M, MISSED_S } from '../src/plan/trip.js';

const H = 3600;
const journey = () => ({ legs: [
  { mode: 'walk', from: { x: 0, z: 0, name: null }, to: { x: 200, z: 0, name: 'Markt' }, dep: 10 * H, arr: 10 * H + 150 },
  { mode: 'bus', line: '6', head: 'Amby', vid: '3:42', from: { x: 200, z: 0, name: 'Markt' }, to: { x: 900, z: 0, name: 'Station' },
    dep: 10 * H + 180, arr: 10 * H + 420, toI: 4 },
  { mode: 'walk', from: { x: 900, z: 0, name: 'Station' }, to: { x: 950, z: 30, name: null }, dep: 10 * H + 420, arr: 10 * H + 470 },
] });

test('the whole trip: walk to the stop, wait, board, ride, get off, walk, arrive', () => {
  const g = new TripGuide(journey(), 'Home');
  let r = g.update({ pos: [0, 0], sec: 10 * H, riding: null, vehicles: [] });
  assert.equal(r.phase, 'walk');
  assert.deepEqual(r.target, [200, 0]);
  assert.match(r.message, /Walk to Markt · 200 m · bus 6 at 10:03/);
  r = g.update({ pos: [195, 0], sec: 10 * H + 140, riding: null, vehicles: [] });
  assert.equal(r.phase, 'wait');
  assert.equal(r.canBoard, undefined);
  r = g.update({ pos: [195, 0], sec: 10 * H + 178, riding: null, vehicles: [{ id: '3:42', x: 205, z: 3 }] });
  assert.equal(r.canBoard, '3:42');
  r = g.update({ pos: [195, 0], sec: 10 * H + 200, riding: '3:42', vehicles: [] });
  assert.equal(r.phase, 'ride');
  assert.equal(r.offK, 4);
  r = g.update({ pos: [900, 0], sec: 10 * H + 425, riding: null, vehicles: [] }); // dropped at the stop
  assert.equal(r.phase, 'walk');
  assert.deepEqual(r.target, [950, 30]);
  r = g.update({ pos: [950 - ARRIVE_M / 2, 30], sec: 10 * H + 470, riding: null, vehicles: [] });
  assert.equal(r.phase, 'done');
  assert.ok(g.done && /Home/.test(r.message));
});

test('a bus that left without you: missed', () => {
  const g = new TripGuide(journey());
  g.jumpTo(1);
  const r = g.update({ pos: [195, 0], sec: 10 * H + 180 + MISSED_S + 1, riding: null, vehicles: [] });
  assert.equal(r.phase, 'missed');
  assert.ok(g.missed);
});

test('teleport: jump straight to the first bus leg', () => {
  const g = new TripGuide(journey());
  assert.equal(g.firstBus(), 1);
  g.jumpTo(g.firstBus());
  assert.equal(g.update({ pos: [5000, 0], sec: 10 * H + 177, riding: '3:42', vehicles: [] }).phase, 'ride');
});
