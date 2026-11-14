// The city now in the game (src/life/cityfeed.js): the line people read, and the feed's failures.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cityText, maasState, CityFeed, STALE_S } from '../src/life/cityfeed.js';

const CITY = { at: 1, water: { levelM: 44.07, inflow: 47.6, tempC: 10.3, at: 1 }, air: { label: 'moderate', stations: [] } };

test('text: only what is known, high water said in words', () => {
  assert.equal(cityText(CITY), 'Maas 44.07 m · 48 m³/s · 10 °C · air moderate');
  assert.equal(cityText({ water: { levelM: 45.9, inflow: 1620, tempC: null } }), 'Maas 45.90 m · 1620 m³/s (flood level)');
  assert.equal(cityText({ water: null, air: { label: 'good' } }), 'air good');
  assert.equal(cityText(null), '');
  assert.deepEqual([maasState(200), maasState(1200), maasState(2000), maasState(null)], ['normal', 'high', 'flood', null]);
});

test('feed: asks the relay, keeps the last answer through a failure, forgets it when stale', async () => {
  let fail = false, asked = '';
  const feed = new CityFeed('https://relay.example/', async (url) => { asked = url; if (fail) throw new Error('offline'); return { ok: true, json: async () => CITY }; });
  assert.equal((await feed.poll(1000)).water.levelM, 44.07);
  assert.equal(asked, 'https://relay.example/city');
  fail = true;
  assert.ok(await feed.poll(2000), 'still the last answer');
  assert.equal(await feed.poll(1000 + STALE_S + 1), null);
  const empty = new CityFeed('x', async () => ({ ok: true, json: async () => ({ water: null, air: null }) }));
  assert.equal(await empty.poll(1), null);
});
