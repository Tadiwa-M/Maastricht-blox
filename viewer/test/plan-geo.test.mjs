// GPS -> RD (src/plan/geo.js) against pyproj (EPSG:4326 -> EPSG:28992) reference points.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { wgs84ToRd, gpsToUnity } from '../src/plan/geo.js';

const REF = [ // lon, lat, x, y (pyproj)
  [5.6909, 50.8492, 176388.98, 317751.41], [5.7055, 50.8496, 177417.02, 317800.28],
  [5.6876, 50.8513, 176155.61, 317984.08], [5.70, 50.83, 177039.0, 315618.13],
  [5.72, 50.87, 178427.89, 320074.31], [5.1, 52.1, 135321.22, 456900.43],
];

test('within 2 m of pyproj in Maastricht and the rest of the country', () => {
  for (const [lon, lat, x, y] of REF) {
    const [rx, ry] = wgs84ToRd(lat, lon);
    assert.ok(Math.hypot(rx - x, ry - y) < 2, `${lat},${lon}: off by ${Math.hypot(rx - x, ry - y).toFixed(2)} m`);
  }
});

test('Unity metres from the world origin', () => {
  const [x, z] = gpsToUnity(50.8492, 5.6909, [174700, 314000]);
  assert.ok(Math.abs(x - 1688.98) < 2 && Math.abs(z - 3751.41) < 2);
});

test('RD -> GPS within 2 m (round trip and pyproj points)', async () => {
  const { rdToWgs84, unityToGps } = await import('../src/plan/geo.js');
  for (const [lon, lat, x, y] of REF) {
    const [la, lo] = rdToWgs84(x, y);
    const m = Math.hypot((la - lat) * 111320, (lo - lon) * 111320 * Math.cos((lat * Math.PI) / 180));
    assert.ok(m < 2, `${x},${y}: ${m.toFixed(2)} m`);
  }
  const [la, lo] = unityToGps(1688.98, 3751.41, [174700, 314000]);
  assert.ok(Math.abs(la - 50.8492) < 3e-5 && Math.abs(lo - 5.6909) < 3e-5);
});
