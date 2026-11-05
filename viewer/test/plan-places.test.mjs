// Place search (src/plan/places.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { placesFromFeatures, PlaceIndex, norm } from '../src/plan/places.js';

const FEATURES = [
  { kind: 'poi', name: 'Missouri', centroid: [2000, 3000], tags: { shop: 'coffee' } },
  { kind: 'poi', name: "Café Sjiek", centroid: [2100, 3000], tags: { amenity: 'cafe' } },
  { kind: 'building', bagId: 'x', address: 'Papenstraat 5', centroid: [1064, 2207] },
  { kind: 'building', bagId: 'y', centroid: [10, 10] }, // no name, no address: not a place
  { kind: 'street', name: 'Boschstraat', centroid: [1400, 3000] },
  { kind: 'street', name: 'Boschstraat', centroid: [1410, 3004] }, // same street nearby: once
  { kind: 'station', name: 'Maastricht', centroid: [3400, 2600] },
];
const STOPS = [{ name: 'Maastricht, Markt', x: 700, y: 1500 }, { name: 'Maastricht, Markt', x: 710, y: 1510 }];

test('places from features: named POIs, streets once, addresses; positions in metres', () => {
  const p = placesFromFeatures(FEATURES, 0.5);
  assert.deepEqual(p.find((x) => x[0] === 'Missouri'), ['Missouri', 'poi', 1000, 1500, 'coffee']);
  assert.equal(p.filter((x) => x[0] === 'Boschstraat').length, 1);
  assert.deepEqual(p.find((x) => x[1] === 'address'), ['Papenstraat 5', 'address', 532, 1104, '']);
  assert.equal(p.length, 5);
});

test('search: forgiving of case, accents and partial words; stops grouped by name', () => {
  const idx = new PlaceIndex(placesFromFeatures(FEATURES, 0.5), STOPS);
  assert.equal(idx.search('missouri')[0].name, 'Missouri');
  assert.equal(idx.search('MISS')[0].name, 'Missouri');
  assert.equal(idx.search('cafe sjiek')[0].name, 'Café Sjiek');
  assert.equal(idx.search('papenstr 5')[0].name, 'Papenstraat 5');
  const m = idx.search('markt')[0];
  assert.equal(m.kind, 'stop');
  assert.ok(Math.abs(m.x - 705) < 1e-9 && Math.abs(m.z - 1505) < 1e-9);
  assert.equal(idx.search('maastricht')[0].kind, 'station', 'the station ranks above the stops');
  assert.deepEqual(idx.search('zzz'), []);
  assert.equal(norm('  Café-Sjiek! '), 'cafe sjiek');
});
