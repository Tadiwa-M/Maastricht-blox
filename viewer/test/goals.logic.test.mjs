// Light goals: picking, timing, checking and the tally (src/goals/logic.js, src/goals/spots.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  compassWord, distLabel, clockLabel, hhmm, weekDelta, weighted, pickTourist, touristLimit, askLine, placeLabel,
  pickBus, BusWatch, goldenOpen, pickViewpoint, toSunset, loadTally, saveTally, bump, STORE_KEY, WEEK_S,
} from '../src/goals/logic.js';
import { locateSpot, VIEWPOINTS, TOWERS } from '../src/goals/spots.js';
import { gpsToUnity } from '../src/plan/geo.js';

const seq = (...xs) => { let i = 0; return () => xs[i++ % xs.length]; };

test('compass words and labels', () => {
  assert.equal(compassWord(0, 10), 'north');
  assert.equal(compassWord(10, 10), 'north-east');
  assert.equal(compassWord(-10, 0), 'west');
  assert.equal(compassWord(-1, -10), 'south');
  assert.equal(distLabel(3), '10 m');
  assert.equal(distLabel(327), '330 m');
  assert.equal(distLabel(1240), '1.2 km');
  assert.equal(clockLabel(245), '4:05');
  assert.equal(clockLabel(-3), '0:00');
  assert.equal(hhmm(14 * 3600 + 32 * 60 + 59), '14:32');
  assert.equal(hhmm(86400 + 60), '00:01');
});

test('week delta goes the short way round Sunday night', () => {
  assert.equal(weekDelta(100, 40), 60);
  assert.equal(weekDelta(30, WEEK_S - 30), 60);
  assert.equal(weekDelta(WEEK_S - 30, 30), -60);
});

test('weighted pick follows the weights; nothing to pick gives null', () => {
  assert.equal(weighted(['a', 'b'], (x) => (x === 'a' ? 1 : 3), () => 0.1), 'a');
  assert.equal(weighted(['a', 'b'], (x) => (x === 'a' ? 1 : 3), () => 0.5), 'b');
  assert.equal(weighted([], () => 1), null);
  assert.equal(weighted(['a'], () => 0), null);
});

const ROWS = [
  ['Bonnefanten', 'landmark', 300, 0, 'landmark'],
  ['Café Sjiek', 'poi', 0, 200, 'cafe'],
  ['Kruidvat', 'poi', 0, -200, 'chemist'], // not something a tourist asks for
  ['Far Away Museum', 'poi', 3000, 0, 'museum'], // too far
  ['Next Door', 'landmark', 40, 0, 'landmark'], // too close
  ['Maastricht', 'station', -400, 0, 'station'],
  ['Boschstraat', 'street', 200, 200, 'street'],
];

test('a tourist asks for a real, pleasant place a short walk away', () => {
  const names = new Set();
  for (const r of [0.01, 0.3, 0.6, 0.99]) names.add(pickTourist(ROWS, [0, 0], { rand: () => r })?.name);
  assert.deepEqual([...names].sort(), ['Bonnefanten', 'Café Sjiek', 'Maastricht']);
  const p = pickTourist(ROWS, [0, 0], { rand: () => 0 });
  assert.equal(p.d, 300);
  // recently asked and unbuilt places are skipped
  assert.equal(pickTourist(ROWS, [0, 0], { recent: new Set(['Bonnefanten', 'Maastricht']), rand: () => 0 }).name, 'Café Sjiek');
  assert.equal(pickTourist(ROWS, [0, 0], { built: () => false }), null);
});

test('the tourist time limit is generous and grows with distance', () => {
  assert.ok(touristLimit(300) > 300 / 1.4 * 1.5);
  assert.ok(touristLimit(600) > touristLimit(300));
});

test('how places are named in the question', () => {
  assert.equal(placeLabel({ name: 'Bonnefanten', kind: 'landmark' }), 'the Bonnefanten');
  assert.equal(placeLabel({ name: 'De Vijf Koppen', kind: 'landmark' }), 'De Vijf Koppen');
  assert.equal(placeLabel({ name: 'Maastricht', kind: 'station' }), 'Maastricht station');
  assert.equal(placeLabel({ name: 'Station Maastricht', kind: 'station' }), 'Station Maastricht');
  assert.equal(askLine({ name: 'Café Sjiek', kind: 'poi' }), 'Excuse me, do you know the way to Café Sjiek?');
});

// a tiny timetable: line 10 runs A -> B -> C -> D -> E -> F; line 3 is a train
function timetable(inSec = 300) {
  const stops = [
    { name: 'A', x: 50, y: 0 }, { name: 'B', x: 300, y: 0 }, { name: 'C', x: 600, y: 0 },
    { name: 'D', x: 900, y: 0 }, { name: 'E', x: 1200, y: 0 }, { name: 'F', x: 1500, y: 0 },
  ];
  const bus = { route: { short: '10', colour: '#c00', mode: 'bus' }, head: 'F', stops: [0, 1, 2, 3, 4, 5] };
  return {
    stops,
    departures(k, day, sec, n, horizon) {
      if (k !== 0) return [];
      return [{ trip: 1, pattern: bus, route: bus.route, head: 'F', inSec, at: sec + inSec },
        { trip: 2, pattern: bus, route: { short: 'IC', mode: 'rail' }, head: 'F', inSec: inSec + 10, at: sec + inSec + 10 }]
        .filter((d) => d.inSec <= horizon).slice(0, n);
    },
  };
}

test('a bus to catch: a near stop, a departure you can make, a stop a few calls on', () => {
  const b = pickBus(timetable(300), [0, 0], 2, 12 * 3600, { rand: () => 0.99 });
  assert.equal(b.line, '10');
  assert.equal(b.from.name, 'A');
  assert.ok(['C', 'D', 'E', 'F'].includes(b.to.name));
  assert.deepEqual([b.to.x, b.to.z], [timetable().stops[b.to.k].x, 0]);
  assert.equal(b.inSec, 300);
  assert.equal(b.at, 12 * 3600 + 300);
  // the one three stops on is the favourite
  const counts = {};
  for (let i = 0; i < 50; i++) { const r = pickBus(timetable(), [0, 0], 2, 0, { rand: () => i / 50 }); counts[r.to.name] = (counts[r.to.name] || 0) + 1; }
  assert.ok(counts.D > counts.C);
});

test('no bus goal when the bus leaves too soon or too late, or no stop is near', () => {
  assert.equal(pickBus(timetable(60), [0, 0], 2, 0), null);
  assert.equal(pickBus(timetable(1200), [0, 0], 2, 0), null);
  assert.equal(pickBus(timetable(300), [5000, 0], 2, 0), null);
  assert.equal(pickBus(null, [0, 0], 2, 0), null);
});

test('the bus watch: ride that line and get off at that stop', () => {
  const goal = { line: '10', to: { name: 'D', x: 900, z: 0 } };
  const w = new BusWatch(goal);
  assert.equal(w.update({ ride: null, pos: [0, 0] }), null);
  assert.equal(w.update({ ride: { line: '10', atStop: 'A' }, pos: null }), 'riding');
  assert.equal(w.update({ ride: { line: '10', atStop: 'D' }, pos: null }), 'riding');
  assert.equal(w.update({ ride: null, pos: [905, 20] }), 'done');
});

test('the bus watch: wrong line, wrong stop or no stop do not count', () => {
  const goal = { line: '10', to: { name: 'D', x: 900, z: 0 } };
  const wrong = new BusWatch(goal);
  assert.equal(wrong.update({ ride: { line: '4', atStop: 'D' }, pos: null }), 'wrong');
  assert.equal(wrong.update({ ride: null, pos: [900, 0] }), null);
  const early = new BusWatch(goal);
  early.update({ ride: { line: '10', atStop: 'B' }, pos: null });
  assert.equal(early.update({ ride: null, pos: [300, 0] }), null);
  // a stop name seen while riding counts even when you land on the map (no position)
  const map = new BusWatch(goal);
  map.update({ ride: { line: '10', atStop: 'D' }, pos: null });
  assert.equal(map.update({ ride: null, pos: null }), 'done');
});

test('golden hour: offered late afternoon, until shortly before sunset', () => {
  assert.equal(goldenOpen(12), false);
  assert.equal(goldenOpen(16.5), true);
  assert.equal(goldenOpen(17.9), false);
  assert.equal(toSunset(17 * 3600), 3600);
  const spots = [{ name: 'near', x: 100, z: 0 }, { name: 'mid', x: 400, z: 0 }, { name: 'far', x: 5000, z: 0 }];
  assert.equal(pickViewpoint(spots, [0, 0]).name, 'mid');
  assert.equal(pickViewpoint(spots, [0, 0], { built: (x) => x !== 400 }), null);
});

test('the tally survives in storage and never throws', () => {
  const mem = new Map();
  const store = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v) };
  let t = loadTally(store);
  assert.deepEqual(t, { total: 0, tourist: 0, bus: 0, golden: 0 });
  t = saveTally(store, bump(bump(t, 'bus'), 'golden'));
  assert.deepEqual(loadTally(store), { total: 2, tourist: 0, bus: 1, golden: 1 });
  saveTally(store, { ...t, prompted: true, off: true });
  assert.equal(loadTally(store).prompted, true);
  assert.equal(loadTally(store).off, true);
  mem.set(STORE_KEY, '{broken');
  assert.equal(loadTally(store).total, 0);
  const throwing = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };
  assert.equal(loadTally(throwing).total, 0);
  assert.doesNotThrow(() => saveTally(throwing, t));
  assert.equal(loadTally(null).total, 0);
});

test('spots: a named feature wins over the GPS fallback', () => {
  const origin = [175700, 316500];
  const fort = VIEWPOINTS[0];
  const gps = locateSpot(fort, [], origin);
  assert.deepEqual([gps.x, gps.z], gpsToUnity(fort.gps[0], fort.gps[1], origin));
  assert.equal(gps.fromData, false);
  assert.equal(gps.match, undefined);
  const feats = [{ name: 'Fort Sint Pieter', kind: 'poi', centroid: [800, 100] }, { name: 'Fort Sint Pieter', kind: 'landmark', centroid: [700, 90] }];
  const hit = locateSpot(fort, feats, origin, 0.5);
  assert.deepEqual([hit.x, hit.z, hit.fromData, hit.r], [350, 45, true, fort.r]);
});

test('spots: the GPS fallbacks land in the old town (default origin)', () => {
  const origin = [175700, 316500];
  for (const s of [...VIEWPOINTS, ...TOWERS]) {
    const p = locateSpot(s, [], origin);
    assert.ok(Math.abs(p.x - 700) < 900 && Math.abs(p.z - 900) < 1200, `${s.name} at ${p.x}, ${p.z}`);
  }
  const jan = locateSpot(TOWERS[0], [{ name: 'Sint-Janskerk', kind: 'landmark', centroid: [998, 2390] }, { name: 'Sint Servaasbrug', kind: 'street', centroid: [0, 0] }], origin);
  assert.equal(jan.fromData, true);
  assert.equal(locateSpot(TOWERS[1], [{ name: 'Sint Servaasbrug', kind: 'street', centroid: [0, 0] }], origin).fromData, false);
});

test('delivery: a shop in range, a time only a run makes, the nearest shop sends it', async () => {
  const { pickDelivery, deliveryLimit, DELIVERY_RANGE } = await import('../src/goals/logic.js');
  const rows = [['Bakkerij Mathieu', 'poi', 20, 0, 'bakery'], ['Boekhandel', 'poi', 300, 0, 'books'], ['Stadhuis', 'landmark', 250, 0, ''],
    ['Far Cafe', 'poi', 2000, 0, 'cafe'], ['Next Door', 'poi', 60, 0, 'cafe'], ['A bench', 'poi', 300, 50, 'bench']];
  const d = pickDelivery(rows, [0, 0], { rand: () => 0 });
  assert.equal(d.to.name, 'Boekhandel');
  assert.equal(d.from.name, 'Bakkerij Mathieu');
  assert.equal(d.parcel, 'a box of vlaai');
  assert.equal(pickDelivery(rows, [0, 0], { recent: new Set(['Boekhandel']) }), null, 'nothing else in range');
  assert.equal(pickDelivery(rows, [0, 0], { built: () => false }), null);
  for (const m of DELIVERY_RANGE) {
    const t = deliveryLimit(m);
    assert.ok(m * 1.3 / 1.5 > t, `walking ${m} m takes longer than ${t} s`);
    assert.ok(m * 1.3 / 5 < t - 8, `running ${m} m fits in ${t} s with a little room`);
  }
});

test('tour: three sights, nearest first but apart; seen as you reach them, any order', async () => {
  const { pickTour, tourVisit, tourNext } = await import('../src/goals/logic.js');
  const rows = [['A', 'landmark', 100, 0, ''], ['A twin', 'landmark', 120, 0, ''], ['B', 'park', 0, 300, ''], ['C', 'station', -400, 0, ''],
    ['D', 'landmark', 0, 800, ''], ['Shop', 'poi', 50, 50, 'cafe'], ['Here', 'landmark', 10, 0, '']];
  const stops = pickTour(rows, [0, 0]);
  assert.deepEqual(stops.map((s) => s.name), ['A', 'B', 'C'], 'not the twin 20 m away, not the one we stand on, no shops');
  assert.equal(pickTour(rows.slice(0, 3), [0, 0]), null, 'fewer than three sights');
  assert.equal(tourNext(stops, [0, 290]).name, 'B');
  assert.deepEqual(tourVisit(stops, [0, 290]), ['B']);
  assert.deepEqual(tourVisit(stops, [0, 290]), [], 'only once');
  assert.equal(tourNext(stops, [0, 290]).name, 'A');
  tourVisit(stops, [100, 0]); tourVisit(stops, [-400, 5]);
  assert.equal(tourNext(stops, [0, 0]), null, 'done');
});
