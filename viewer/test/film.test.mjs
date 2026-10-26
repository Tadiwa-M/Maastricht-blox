import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SHOTS, shotPose } from '../tools/film.mjs';

const presets = {
  city: { cam: [0, 500, 500], target: [0, 0, 0], fov: 40 },
  markt: { cam: [100, 60, 160], target: [100, 0, 100], fov: 40 },
};

test('orbit keeps distance and height, centred on the preset angle', () => {
  const shot = { kind: 'orbit', view: 'markt', deg: 90, zoom: 0.5 };
  const mid = shotPose(shot, presets, 0.5);
  assert.deepEqual(mid.cam.map((v) => Math.round(v)), [100, 30, 130]); // preset direction, half distance
  for (const u of [0, 0.3, 1]) {
    const p = shotPose(shot, presets, u);
    assert.ok(Math.abs(Math.hypot(p.cam[0] - 100, p.cam[2] - 100) - 30) < 1e-9);
    assert.equal(p.cam[1], 30);
  }
});

test('move starts and ends exactly on the presets and rises in between', () => {
  const shot = { kind: 'move', from: 'city', to: 'markt' };
  assert.deepEqual(shotPose(shot, presets, 0).cam, presets.city.cam);
  assert.deepEqual(shotPose(shot, presets, 1).cam, presets.markt.cam);
  const mid = shotPose(shot, presets, 0.5);
  assert.ok(mid.cam[1] > (presets.city.cam[1] + presets.markt.cam[1]) / 2);
});

test('every shot names a kind and a positive length', () => {
  for (const s of SHOTS) {
    assert.ok(['orbit', 'move'].includes(s.kind), s.name);
    assert.ok(s.seconds > 0, s.name);
  }
});
