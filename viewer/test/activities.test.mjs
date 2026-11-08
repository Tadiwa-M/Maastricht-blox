// Activities (src/activities/): the G key's choice, sitting, cycling, landing from a boat, the
// ducks, and the terrace share with weather. Pure logic over the synthetic city.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chooseAction, promptText, REACH } from '../src/activities/choose.js';
import { seatView, leftSeat } from '../src/activities/seat.js';
import { nearestBike, Pedals, dismount, RIDE } from '../src/activities/bike.js';
import { waterAt, nearestWater, findLanding, waterAhead } from '../src/activities/water.js';
import { Ducks } from '../src/activities/ducks.js';
import { terraceShare, Terraces } from '../src/life/terraces.js';
import { terraceFactor } from '../src/life/density.js';
import { synthCity } from './player-city.mjs';

const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);

/** 40 x 40 cells (20 m): land in the west, a 'river' (water on top) for x >= 10 m. */
function riverCity() {
  const city = synthCity({ size: 40, floorK: 5 });
  city.water(20, 0, 5, 39, 39, 5); // one plate of water on the floor, east half
  return city;
}

test('chooseAction: busy states end with G; the nearest of chair / bike wins', () => {
  assert.equal(chooseAction('sit').action, 'stand');
  assert.equal(chooseAction('bike').action, 'dismount');
  assert.equal(chooseAction('boat').action, 'land');
  assert.equal(chooseAction('boat', {}, { pendingLand: true }).action, 'stay');
  assert.equal(chooseAction(null, {}), null);
  assert.equal(chooseAction(null, { seat: 1.0, bike: 0.5 }).action, 'bike');
  assert.equal(chooseAction(null, { seat: 0.4, bike: 0.5 }).action, 'sit');
  assert.equal(chooseAction(null, { seat: REACH.seat + 0.1 }), null);
  // by the water: a boat in reach first, else the ducks
  assert.equal(chooseAction(null, { water: 3, boat: 30 }).action, 'boat');
  assert.equal(chooseAction(null, { water: 3, boat: 90 }).action, 'ducks');
  assert.equal(chooseAction(null, { water: REACH.ducks + 0.5, boat: 90 }), null);
  assert.equal(chooseAction(null, { seat: 1, water: 0 }).action, 'sit');
});

test('promptText: the key on keyboards, a note first', () => {
  assert.equal(promptText(chooseAction(null, { bike: 1 })), 'Ride bike (G)');
  assert.equal(promptText(chooseAction(null, { bike: 1 }), true), 'Ride bike');
  assert.match(promptText(chooseAction('boat', {}, { pendingLand: true })), /^Getting off at the next quay · Stay aboard \(G\)$/);
  assert.equal(promptText(null), '');
});

test('seatView: sit facing the table, camera out over the street; leftSeat on a step or jump', () => {
  const poi = { x: 0, z: 0, f: [1, 0], d: 8 }; // street to the east
  const v = seatView({ poi, chair: { x: 3, z: 2, yaw: 90 } });
  assert.deepEqual(v.feet, [3, -2]);
  near(v.face, Math.PI / 2);
  near(v.cam.yaw, Math.PI / 2); // looking east
  assert.equal(leftSeat([3, -2], v.feet), false);
  assert.equal(leftSeat([3.3, -2], v.feet), true);
  assert.equal(leftSeat([3, -2], v.feet, 2), true);
});

test('Terraces.freeSeat: only empty chairs on the pavement; the player\'s chair stays empty', () => {
  const t = new Terraces({ pois: [{ x: 0, z: 0, f: [0, 1], d: 10 }], ground: () => 0 });
  t.refresh([0, 0]);
  const chairs = t.active[0].layout.chairs;
  t.share = 0; // nobody seated: every chair is free
  const c = chairs[0], seat = t.freeSeat(c.x, c.z, 0.5);
  assert.ok(seat && seat.q === 0 && seat.d < 1e-9);
  t.share = 1; // all taken
  assert.equal(t.freeSeat(c.x, c.z, 0.5), null);
  // the player sits on chair 0 at full share: draw skips it
  const drawn = [];
  const crowd = { add: (v, p) => drawn.push(p) };
  t.taken = { id: 0, q: 0 };
  t.draw(crowd, { hours: 13, day: 5 }, 0, 0);
  const seated = chairs.filter((ch) => ch.u <= t.share).length;
  assert.ok(seated > 0);
  assert.equal(drawn.length, seated - (c.u <= t.share ? 1 : 0));
});

test('terraceShare: rain and cold empty the terraces, no weather changes nothing', () => {
  const base = terraceFactor(14, 5);
  near(terraceShare(14, 5), base);
  near(terraceShare(14, 5, 0, undefined), base);
  near(terraceShare(14, 5, 0, { tempC: 20 }), base);
  assert.ok(terraceShare(14, 5, 0, { rain: 1 }) < base * 0.2);
  assert.ok(terraceShare(14, 5, 0, { tempC: 4 }) < base * 0.2);
  assert.ok(terraceShare(14, 5, 0, { tempC: 4 }) > 0); // a few hardy sitters
  assert.ok(terraceShare(14, 5, 0, { cloud: 1 }) < base);
  near(terraceShare(14, 5, 0.5, { rain: 0.2 }), terraceShare(14, 5, 0.5)); // the wetter source counts
});

test('bikes: nearest in reach, pedals turn with the distance, getting off to the left', () => {
  const bikes = [{ x: 0, z: 0, yaw: 0 }, { x: 1, z: 0, yaw: 90 }, { x: 0.2, z: 0, yaw: 0, gone: true }];
  assert.equal(nearestBike(bikes, 0.9, 0, 2).bike, bikes[1]);
  assert.equal(nearestBike(bikes, 0.1, 0, 2).bike, bikes[0]);
  assert.equal(nearestBike(bikes, 9, 9, 2), null);
  const p = new Pedals({ crankM: 5, wheelR: 0.5 });
  p.step(2.5);
  const s = p.step(2.5);
  near(s.phase, Math.PI * 2);
  near(s.spin, -10);
  const d = dismount(10, 20, Math.PI / 2); // riding east: step off to the north
  assert.deepEqual([d.bike.x, d.bike.z], [10, 20]);
  near(d.bike.yaw, 90);
  near(d.step.x, 10); near(d.step.z, 20.6);
  assert.ok(RIDE.walk > 1.4 * 2 && RIDE.run > RIDE.walk);
});

test('water: surface, distance to the edge, water ahead', () => {
  const city = riverCity();
  near(waterAt(city, 15, -5), 1.2); // floor 1.0 m + a plate of water
  assert.equal(waterAt(city, 5, -5), null);
  assert.equal(nearestWater(city, 12, -5), 0);
  const d = nearestWater(city, 7, -5, 7);
  assert.ok(d >= 3 && d <= 4, `edge at ${d}`);
  assert.equal(nearestWater(city, 1, -5, 3), null);
  const a = waterAhead(city, 8, -5, Math.PI / 2, 7); // facing east, toward the water
  assert.ok(a && a.x >= 10);
});

test('findLanding: from the boat to the nearest open bank, never under a roof or into the unknown', () => {
  const city = riverCity();
  const l = findLanding(city, 15, -5, { maxR: 12, step: 1 });
  assert.ok(l && l.x < 10 && l.d <= 6, JSON.stringify(l));
  // roof the near bank over (x 7.5..9.99 m): the landing moves further west
  city.fill(15, 0, 9, 19, 39, 10);
  const l2 = findLanding(city, 15, -5, { maxR: 12, step: 1 });
  assert.ok(l2 && l2.x < 7.5, JSON.stringify(l2));
  assert.equal(findLanding(city, 15, -5, { maxR: 3, step: 1 }), null);
});

test('ducks: appear on the water near the player, stay on it, and swim to bread', () => {
  const city = riverCity();
  const ducks = new Ducks({ water: (x, z) => waterAt(city, x, z), opts: { count: 4, spawnR: 6 } });
  for (let q = 0; q < 10; q++) ducks.refresh(9, -10, 20);
  const list = ducks.visible();
  assert.equal(list.length, 4);
  for (const d of list) assert.ok(d.x >= 10, `duck on land at ${d.x}`);
  // no water near: nobody shows
  const dry = new Ducks({ water: () => null });
  dry.refresh(0, 0);
  assert.equal(dry.visible().length, 0);
  // throw bread at (13, -10): within a minute the ducks get there and eat some of it
  const n = ducks.feed(13, -10, [9, 2.3, -10], 6);
  assert.ok(n > 0);
  let closest = Infinity;
  for (let s = 0; s < 600; s++) {
    ducks.update(0.1, 9, -10);
    for (const d of ducks.visible()) {
      assert.ok(waterAt(city, d.x, d.z) !== null, 'a duck left the water');
      closest = Math.min(closest, Math.hypot(d.x - 13, d.z + 10));
    }
  }
  assert.ok(ducks.crumbs.length < n, 'bread eaten');
  assert.ok(closest < 1.5, `closest ${closest}`);
});
