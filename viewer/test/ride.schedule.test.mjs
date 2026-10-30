import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Timetable, upcomingCalls, waitLabel } from '../src/life/schedule.js';

// one route, 4 stops, trips at 10:00 and 10:30 on weekdays (Mon = bit 0)
const doc = {
  version: 2,
  routes: [{ id: 'r4', short: '4', mode: 'bus' }],
  stops: [{ name: 'Vrijthof' }, { name: 'Markt' }, { name: 'Brug' }, { name: 'Station' }],
  shapes: [{ id: 's', pts: [0, 0, 0, 1000, 0, 1000] }],
  patterns: [{ shape: 0, route: 0, head: 'Station', st: [0, 0, 0, 180, 240, 300, 360, 360, 600, 600, 600, 1000], stops: [0, 1, 2, 3] }],
  trips: [[0, 36000, 31], [0, 37800, 31]],
  tripIds: [['t4a'], ['t4b']],
};

test('departure board: next buses from a stop, soonest first', () => {
  const tt = new Timetable(doc);
  const d = tt.departures(1, 0, 36000 - 60); // Markt, Monday 09:59
  assert.deepEqual(d.map((x) => [x.trip, x.inSec, x.head]), [[0, 300, 'Station'], [1, 2100, 'Station']]);
  assert.equal(tt.departures(3, 0, 35000).length, 0, 'no departures from the last stop');
  assert.equal(tt.departures(1, 5, 35000).length, 0, 'not on Saturday');
});

test('upcoming calls: the stop a bus is dwelling at is still next', () => {
  const p = doc.patterns[0];
  assert.deepEqual(upcomingCalls(p, 100).map((c) => [c.stop, c.inSec]), [[1, 80], [2, 260], [3, 500]]);
  assert.deepEqual(upcomingCalls(p, 200).map((c) => c.stop), [1, 2, 3]); // dwelling at Markt (180..240)
  assert.deepEqual(upcomingCalls(p, 250).map((c) => c.stop), [2, 3]);
  assert.equal(upcomingCalls(p, 601).length, 0);
});

test('elapsed and wait labels', () => {
  const tt = new Timetable(doc);
  assert.equal(tt.elapsed(0, 0, 36100), 100);
  assert.equal(tt.elapsed(0, 0, 35000), null);
  assert.equal(tt.activeAt(0, 36100)[0].tRel, 100);
  assert.deepEqual([waitLabel(20), waitLabel(61), waitLabel(720)], ['now', '1 min', '12 min']);
});
