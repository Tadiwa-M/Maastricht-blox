// Map camera for a city (src/citycam.js) and the street-level spot finder (src/citymode.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { tiltFor, zoomT, clampTarget, NEAR_DIST, FAR_DIST } from '../src/citycam.js';
import { CityQuery } from '../src/city.js';
import { SolidMap } from '../src/solidmap.js';

test('tilt: nearly horizontal at street level, steeper as you zoom out, never past the horizon', () => {
  assert.equal(zoomT(NEAR_DIST), 0);
  assert.equal(zoomT(FAR_DIST), 1);
  let last = Infinity;
  for (const d of [5, 25, 60, 150, 400, 1000, 2600, 9000]) {
    const { maxPolar, preferred } = tiltFor(d);
    assert.ok(maxPolar <= last + 1e-12, `max tilt shrinks with distance (${d} m)`);
    assert.ok(preferred <= maxPolar && maxPolar < Math.PI / 2);
    last = maxPolar;
  }
  // street level: may look within 3-10 degrees of horizontal, so the sky is in the frame
  assert.ok(tiltFor(25).maxPolar > THREE.MathUtils.degToRad(80));
  // whole city: at least 35 degrees down
  assert.ok(tiltFor(2600).maxPolar <= THREE.MathUtils.degToRad(55));
});

test('the orbit target stays inside the city box plus a margin', () => {
  const box = new THREE.Box3(new THREE.Vector3(0, 0, -100), new THREE.Vector3(100, 10, 0));
  const p = clampTarget(new THREE.Vector3(-500, 3, 500), box, 50);
  assert.deepEqual([p.x, p.y, p.z], [-50, 3, 50]);
});

test('street spot: open ground near a building, camera looking along a free line', async () => {
  const { findStreetSpot } = await import('../src/citymode.js');
  const m = new SolidMap(0, 0, 0, 64, 64, 60);
  for (let I = 0; I < 64; I++) for (let J = 0; J < 64; J++) m.set(I, J, 0); // ground: top 0.2 m
  for (let I = 24; I < 40; I++) for (let J = 24; J < 40; J++) for (let K = 1; K < 50; K++) m.set(I, J, K); // a tower
  const q = new CityQuery({ hasChunk: () => true });
  q.setChunk(0, 0, m);
  const s = findStreetSpot(q, 16, -16); // the tower's centre
  assert.ok(s);
  assert.ok(Math.abs(s.target.y - (0.2 + 1.7)) < 1e-9, 'eye height above the street, not on the roof');
  assert.equal(q.isSolid(s.cam.x, s.target.y, s.cam.z), false);
  assert.equal(q.isSolid(s.target.x, s.target.y, s.target.z), false);
});
