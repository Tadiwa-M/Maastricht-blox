import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lineKeys, journeyDelays } from '../src/ovapi.js';
import { stationCodes, departures } from '../src/ns.js';
import { checkReport, bodyWithImages, rateLimiter } from '../src/report.js';

test('line keys: validated, both directions, no injection', () => {
  assert.deepEqual(lineKeys('ARR_21004, ARR_21004,bad/../x,ARR_3'), ['ARR_21004_1', 'ARR_21004_2', 'ARR_3_1', 'ARR_3_2']);
  assert.deepEqual(lineKeys(''), []);
});

test('journey delays: next pass not yet passed, keyed like GTFS realtime_trip_id', () => {
  const pass = (n, status, target, expected) => ({ DataOwnerCode: 'ARR', LinePlanningNumber: '21004', JourneyNumber: 1234,
    UserStopOrderNumber: n, TripStopStatus: status, TimingPointName: `Stop ${n}`,
    TargetArrivalTime: `2026-10-31T10:0${n}:00`, ExpectedArrivalTime: `2026-10-31T10:0${n}:${expected}` });
  const doc = { ARR_21004_1: { Actuals: { a: pass(1, 'PASSED', 0, '30'), b: pass(2, 'DRIVING', 0, '45'), c: pass(3, 'PLANNED', 0, '50') } } };
  assert.deepEqual(journeyDelays(doc), { 'ARR:21004:1234': { delay: 45, stop: 'Stop 2', status: 'DRIVING', order: 2 } });
  const done = { L: { Actuals: { a: pass(1, 'PASSED', 0, '10'), b: pass(2, 'PASSED', 0, '20') } } };
  assert.equal(journeyDelays(done)['ARR:21004:1234'].delay, 20); // all passed: the latest
});

test('NS: known stations only, delays in seconds', () => {
  assert.deepEqual(stationCodes('mt, MTR, ASD'), ['MT', 'MTR']);
  const d = departures({ payload: { departures: [{ product: { number: '3967', operatorName: 'Arriva' }, direction: 'Roermond',
    plannedDateTime: '2026-10-31T10:00:00+0100', actualDateTime: '2026-10-31T10:03:00+0100', plannedTrack: '2' }] } });
  assert.equal(d[0].delay, 180);
  assert.equal(d[0].train, '3967');
});

test('reports: only map reports, JPEG images within limits; image links replace placeholders', () => {
  assert.equal(checkReport({ title: 'hello' }).ok, false);
  const jpeg = 'data:image/jpeg;base64,' + 'A'.repeat(100);
  const r = checkReport({ title: '[map] Markt: x', body: 'b\n\n_Sent with x_', labels: ['map-report', 'evil label'], images: { screenshot: jpeg, nope: jpeg } });
  assert.ok(r.ok);
  assert.deepEqual(r.labels, ['map-report']);
  assert.deepEqual(r.images.map((i) => i.name), ['screenshot']);
  assert.equal(checkReport({ title: '[map] x', images: { photo: 'data:image/png;base64,AAAA' } }).ok, false);
  const body = bodyWithImages('text\n\n_Sent with the button._', { screenshot: 'https://raw/x.jpg' });
  assert.match(body, /!\[screenshot\]\(https:\/\/raw\/x\.jpg\)\n\n_Sent with/);
});

test('rate limit: 5 an hour per IP', () => {
  const ok = rateLimiter(2, 1000);
  assert.deepEqual([ok('a', 0), ok('a', 1), ok('a', 2), ok('b', 2), ok('a', 1500)], [true, true, false, true, true]);
});
