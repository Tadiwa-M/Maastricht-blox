import { test } from 'node:test';
import assert from 'node:assert/strict';
import { liveIndex, delaysByRow, LiveFeed } from '../src/life/live.js';
import { Timetable } from '../src/life/schedule.js';

const doc = {
  version: 2, routes: [{ id: 'r4', short: '4' }], stops: [{ name: 'A' }, { name: 'B' }],
  shapes: [{ id: 's', pts: [0, 0, 0, 1000, 0, 1000] }],
  patterns: [{ shape: 0, route: 0, head: 'B', st: [0, 0, 0, 600, 600, 1000], stops: [0, 1] }],
  trips: [[0, 36000, 31], [0, 39600, 31]], tripIds: [['a'], ['b']], realtimeIds: [['ARR:21004:1'], ['ARR:21004:2']],
};

test('live index: line bases for the relay, realtime id -> rows', () => {
  const ix = liveIndex(doc.realtimeIds);
  assert.deepEqual(ix.lines, ['ARR_21004']);
  assert.deepEqual(ix.rows.get('ARR:21004:2'), [1]);
  assert.deepEqual([...delaysByRow({ journeys: { 'ARR:21004:1': { delay: 120 }, 'X:1:1': { delay: 5 }, 'ARR:21004:2': { delay: 9999 } } }, ix.rows)], [[0, 120]]);
});

test('a delayed bus is further back on its route, and says live', () => {
  const tt = new Timetable(doc);
  const on = tt.activeAt(0, 36300)[0];
  tt.setDelays(new Map([[0, 120]]));
  const late = tt.activeAt(0, 36300)[0];
  assert.ok(late.dist < on.dist && late.live && late.delay === 120);
  assert.equal(on.live, false);
  tt.delaysOn = false; // fast-forward / another time: back to the timetable
  assert.equal(tt.activeAt(0, 36300)[0].dist, on.dist);
});

test('feed: applies delays, keeps them through a short outage', async () => {
  const tt = new Timetable(doc);
  let fail = false;
  const fake = async () => (fail ? { ok: false, status: 502 } : { ok: true, json: async () => ({ journeys: { 'ARR:21004:1': { delay: 60 } } }) });
  const feed = new LiveFeed('https://relay/', tt, fake);
  assert.equal(await feed.poll(1000), true);
  assert.equal(tt.delays.get(0), 60);
  fail = true;
  assert.equal(await feed.poll(1060), true); // a minute without answers: still the last delays
  assert.equal(await feed.poll(1300), false); // stale: back to the timetable
  assert.equal(tt.delays.size, 0);
});
