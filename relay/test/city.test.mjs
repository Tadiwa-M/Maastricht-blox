// The city now (src/city.js): the Maas from Rijkswaterstaat, the air from Luchtmeetnet.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { waterRequest, parseWater, parseAir, airLabel, cityNow, WATER } from '../src/city.js';

const NOW = Date.parse('2026-11-14T03:30:00+01:00') / 1000;
const series = (loc, q, datum, unit, rows) => ({ Locatie: { Code: loc }, AquoMetadata: { Grootheid: { Code: q }, Hoedanigheid: { Code: datum }, Eenheid: { Code: unit } },
  MetingenLijst: rows.map(([t, v]) => ({ Tijdstip: t, Meetwaarde: { Waarde_Numeriek: v } })) });
const RWS = { WaarnemingenLijst: [
  series(WATER.level, 'WATHTE', 'TAW', 'cm', [['2026-11-14T03:20:00.000+01:00', 4640]]), // the Belgian datum: not ours
  series(WATER.level, 'WATHTE', 'NAP', 'cm', [['2026-11-14T03:20:00.000+01:00', 4407]]),
  series(WATER.level, 'WATHTE', 'NAP', 'cm', [['2025-11-27T00:50:00.000+01:00', 4418]]), // a series that ended
  series(WATER.inflow, 'Q', 'NVT', 'm3/s', [['2026-11-14T02:10:00.000+01:00', 47.6], ['2026-08-24T08:20:00.000+01:00', 39.3]]),
  series(WATER.temp, 'T', 'NVT', 'oC', [['2026-11-14T03:10:00.000+01:00', 10.3], ['2026-11-14T03:00:00.000+01:00', 999999999]]),
] };
const AIR = { data: [
  { formula: 'PM25', value: 12, timestamp_measured: '2026-11-14T02:00:00+00:00' }, { formula: 'NO2', value: 20, timestamp_measured: '2026-11-14T02:00:00+00:00' },
  { formula: 'PM25', value: 30, timestamp_measured: '2026-11-14T01:00:00+00:00' }, { formula: 'FN', value: 1.3, timestamp_measured: '2026-11-14T02:00:00+00:00' },
  { formula: 'O3', value: 20, timestamp_measured: '2026-11-01T02:00:00+00:00' }, // stale
] };

test('water: the request names our three points and quantities', () => {
  const r = waterRequest();
  assert.deepEqual(r.LocatieLijst.map((l) => l.Code).sort(), Object.values(WATER).sort());
  assert.deepEqual(r.AquoPlusWaarnemingMetadataLijst.map((q) => q.AquoMetadata.Grootheid.Code), ['WATHTE', 'Q', 'T']);
});

test('water: newest fresh NAP level in metres, inflow, temperature; missing values left out', () => {
  assert.deepEqual(parseWater(RWS, NOW), { levelM: 44.07, inflow: 47.6, tempC: 10.3, at: Date.parse('2026-11-14T03:20:00+01:00') / 1000 });
  assert.equal(parseWater({ WaarnemingenLijst: [] }, NOW), null);
  assert.equal(parseWater(RWS, NOW + 30 * 86400), null, 'a month later all of it is stale');
  const neg = { WaarnemingenLijst: [series(WATER.inflow, 'Q', 'NVT', 'm3/s', [['2026-11-14T03:20:00.000+01:00', -23]])] };
  assert.equal(parseWater(neg, NOW).inflow, null);
});

test('air: the newest value per pollutant, and a label from the worst one', () => {
  const a = parseAir(AIR, NOW);
  assert.deepEqual([a.pm25, a.no2, a.o3, a.pm10], [12, 20, null, null]);
  assert.equal(airLabel(a), 'moderate'); // PM2.5 12 is over the good band
  assert.equal(airLabel({ pm25: 6, no2: 15 }), 'good');
  assert.equal(airLabel({ pm25: 6, pm10: 80 }), 'poor');
  assert.equal(airLabel({}), null);
  assert.equal(parseAir({ data: [] }, NOW), null);
});

test('cityNow: both sources, and one failing leaves the other', async () => {
  const ok = (doc) => ({ ok: true, json: async () => doc });
  const both = await cityNow(async (url) => ok(url.includes('rijkswaterstaat') ? RWS : AIR), NOW);
  assert.equal(both.water.levelM, 44.07);
  assert.equal(both.air.stations.length, 2);
  assert.equal(both.air.label, 'moderate');
  const noWater = await cityNow(async (url) => (url.includes('rijkswaterstaat') ? { ok: false, status: 500 } : ok(AIR)), NOW);
  assert.equal(noWater.water, null);
  assert.ok(noWater.air);
  const none = await cityNow(async () => { throw new Error('offline'); }, NOW);
  assert.deepEqual([none.water, none.air], [null, null]);
});
