// Riding a bike (src/player/locomotion.js ride, src/activities/bike.js): it builds speed, rolls on,
// turns no tighter than a bicycle can, leans into turns, and the cranks stop when you coast.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Locomotion, BIKE_LOCO } from '../src/player/locomotion.js';
import { Pedals, riderLean } from '../src/activities/bike.js';

const bike = () => new Locomotion(BIKE_LOCO);

test('pedalling builds speed over seconds, not instantly; letting go rolls on; pulling back brakes', () => {
  const L = bike();
  L.update(0.25, 0, 6);
  assert.ok(L.speed < 1, `not instant: ${L.speed}`);
  for (let i = 0; i < 12; i++) L.update(0.25, 0, 6);
  assert.ok(L.speed > 5.5, `up to speed in ~3 s: ${L.speed}`);
  const v = L.speed;
  for (let i = 0; i < 4; i++) L.update(0.25, null, 0);
  assert.ok(L.speed > v - 0.6 && L.speed < v, `rolls on: ${L.speed}`);
  assert.equal(L.pedalling, false);
  for (let i = 0; i < 4; i++) L.update(0.25, Math.PI, 6);
  assert.ok(L.speed < v - 4, `brakes hard: ${L.speed}`);
  const turned = Math.min(L.heading, 2 * Math.PI - L.heading);
  assert.ok(turned < 0.5, `no quick U-turn: ${turned.toFixed(2)} rad (only a slow turn once nearly stopped)`);
});

test('turning: no tighter than the minimum radius at speed, slowly at a crawl', () => {
  const L = bike();
  for (let i = 0; i < 20; i++) L.update(0.25, 0, 6);
  const v = L.speed, h0 = L.heading;
  L.update(0.1, Math.PI / 2, 6);
  const rate = Math.abs(L.heading - h0) / 0.1;
  assert.ok(rate <= v / BIKE_LOCO.minRadius + 1e-6, `${rate.toFixed(2)} rad/s at ${v.toFixed(1)} m/s`);
  const slow = bike();
  slow.update(0.1, Math.PI / 2, 0.4);
  assert.ok(slow.heading > 0 && slow.heading <= BIKE_LOCO.turnSlow * 0.1 + 1e-9, 'walking it round');
});

test('lean into the turn the right way and no more than a rider can; stand up pushing off; cranks level when coasting', () => {
  assert.ok(riderLean(6, 1, 0).bank > 0.2 && riderLean(6, 1, 0).bank <= 0.28); // a calm lean
  assert.ok(riderLean(6, -0.5, 0).bank < 0, 'left turn leans left');
  assert.equal(riderLean(0, 2, 0).bank, 0);
  assert.ok(riderLean(2, 0, 2.6).standing > 0.9 && riderLean(6, 0, 2.6).standing === 0, 'out of the saddle only from slow');
  const p = new Pedals();
  p.step(1.3, true);
  const moving = p.step(1.3, true).phase;
  assert.ok(moving > 3);
  let ph = moving;
  for (let i = 0; i < 60; i++) ph = p.step(0.2, false, 1 / 30).phase;
  assert.ok(Math.abs(Math.cos(ph)) < 0.02, `cranks level: ${ph}`);
  assert.ok(p.step(0.2, false, 1 / 30).spin < moving * -0.1, 'the wheels still turn');
});
