// Timetable buses (src/life/schedule.js): interpolation between stop times with dwell,
// before the first / after the last stop, day masks and trips running past midnight.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tripDistAt, Timetable, DWELL_S } from '../src/life/schedule.js';

// arrive/depart/dist triplets: stop A at 0 m, B at 300 m (60 s dwell), C at 900 m (no dwell given), D at 1200 m
const ST = [0, 0, 0, 120, 180, 300, 360, 360, 900, 480, 480, 1200];

test('between stops: linear in time from departure to arrival', () => {
  assert.equal(tripDistAt(ST, 60), 150);
  assert.equal(tripDistAt(ST, 0), 0);
  assert.equal(tripDistAt(ST, 120), 300);
});

test('dwell: stands still between arrival and departure', () => {
  for (const t of [120, 150, 180]) assert.equal(tripDistAt(ST, t), 300);
  assert.ok(tripDistAt(ST, 181) > 300);
});

test('a short dwell is added where the feed gives none (arrivals stay on time)', () => {
  assert.equal(tripDistAt(ST, 360), 900); // arrives on time
  assert.equal(tripDistAt(ST, 360 + DWELL_S), 900); // waits DWELL_S
  assert.ok(tripDistAt(ST, 360 + DWELL_S + 1) > 900);
  assert.equal(tripDistAt(ST, 480), 1200);
  assert.equal(tripDistAt(ST, 0, 0), 0);
});

test('before the first and after the last stop: not on the road', () => {
  assert.equal(tripDistAt(ST, -1), null);
  assert.equal(tripDistAt(ST, 481), null);
});

function doc() {
  return {
    meta: { week: ['2026-10-26'] },
    routes: [{ short: '4', colour: '#00A0E0' }],
    shapes: [{ id: 's', pts: [0, 0, 0, 0, 600, 600, 0, 1200, 1200] }],
    patterns: [{ shape: 0, route: 0, head: 'Station', st: ST }],
    trips: [
      [0, 10 * 3600, 0b0011111], // weekdays 10:00
      [0, 25 * 3600, 0b0000001], // Monday's service, 01:00 on Tuesday
      [0, 11 * 3600, 1 << 6], // Sunday 11:00
    ],
  };
}

test('activeAt: trips under way with their distance', () => {
  const tt = new Timetable(doc());
  const a = tt.activeAt(0, 10 * 3600 + 60);
  assert.equal(a.length, 1);
  assert.equal(a[0].dist, 150);
  assert.equal(a[0].route.short, '4');
  assert.equal(tt.activeAt(0, 10 * 3600 - 1).length, 0);
  assert.equal(tt.activeAt(0, 10 * 3600 + 481).length, 0);
  assert.equal(tt.activeAt(5, 10 * 3600 + 60).length, 0); // Saturday: not in the mask
  assert.equal(tt.activeAt(6, 11 * 3600 + 60).length, 1);
});

test('day rollover: a 25:00 trip of Monday runs on Tuesday 01:00, not on Monday 01:00', () => {
  const tt = new Timetable(doc());
  const tue = tt.activeAt(1, 3600 + 60);
  assert.equal(tue.length, 1);
  assert.equal(tue[0].dist, 150);
  assert.equal(tt.activeAt(0, 3600 + 60).length, 0);
  // Sunday's service does not leak into Monday morning
  assert.equal(tt.activeAt(0, 11 * 3600 + 60).length, 0);
});

test('only the exported part of the shape is shown', () => {
  const d = doc();
  d.shapes[0].pts = [0, 0, 100, 0, 500, 500]; // clipped: distances 100..500
  const tt = new Timetable(d);
  assert.equal(tt.activeAt(0, 10 * 3600 + 20).length, 0); // at 50 m: before the clip
  assert.equal(tt.activeAt(0, 10 * 3600 + 60).length, 1); // 150 m
  assert.equal(tt.activeAt(0, 10 * 3600 + 300).length, 0); // ~ 700 m: past it
});
