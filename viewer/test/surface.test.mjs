import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { KIND_OF, KINDS, registerSurfaceEntry, surfaceKey, surfaceUniforms } from '../src/render/surface.js';
import { readFileSync } from 'node:fs';

const palette = JSON.parse(readFileSync(new URL('../../contract/palette.json', import.meta.url))).entries;

test('every textured material names a real palette entry', () => {
  const names = new Set(palette.map((e) => e.name));
  for (const n of Object.keys(KIND_OF)) assert.ok(names.has(n), n);
});

test('registered entries carry their kind and chromaticity; others are ignored', () => {
  const brick = palette.find((e) => e.name === 'brick_red');
  assert.equal(registerSurfaceEntry(brick), 'brick');
  assert.equal(registerSurfaceEntry(brick), 'brick'); // once only
  assert.equal(registerSurfaceEntry(palette.find((e) => e.name === 'bus_red')), null);
  const k = surfaceUniforms.uSurfKey.value;
  assert.equal(k[0].w, KINDS.brick);
  assert.equal(k[1].z, -1, 'one slot used');
  const [r, g, L] = surfaceKey(new THREE.Color(brick.srgb));
  assert.ok(Math.abs(k[0].x - r) < 1e-6 && Math.abs(k[0].y - g) < 1e-6 && Math.abs(k[0].z - L) < 1e-6);
});

test('the brick colours a shader must tell apart are apart in chromaticity (match radius 0.008)', () => {
  const key = (n) => surfaceKey(new THREE.Color(palette.find((e) => e.name === n).srgb));
  const d = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  assert.ok(d(key('brick_red'), key('bus_red')) > 0.016, 'brick vs bus red');
  assert.ok(d(key('pavement'), key('light_grey')) > 0.016 || Math.abs(key('pavement')[2] / key('light_grey')[2] - 1) > 0.2, 'pavement vs light grey');
});
