// Navigation cue maths (src/goals/screen.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { edgeArrow, beamOpacity, towerAlpha, angleOff } from '../src/goals/screen.js';

const W = 1000, H = 600;
const near = (a, b, e = 1e-6) => Math.abs(a - b) < e;

test('no glint while the target is on screen', () => {
  assert.equal(edgeArrow({ x: 0, y: 0, z: -50 }, { x: 0.2, y: -0.1 }, W, H), null);
});

test('off to the right: a glint on the right edge pointing right', () => {
  const a = edgeArrow({ x: 80, y: 0, z: -20 }, { x: 3, y: 0 }, W, H, 34);
  assert.ok(near(a.x, W - 34) && near(a.y, H / 2));
  assert.ok(near(a.angle, 0));
});

test('above the view: top edge, pointing up', () => {
  const a = edgeArrow({ x: 0, y: 40, z: -10 }, { x: 0, y: 2 }, W, H, 30);
  assert.ok(near(a.y, 30) && near(a.x, W / 2));
  assert.ok(near(a.angle, -Math.PI / 2));
});

test('behind: on the left or right edge, never the bottom (no mirror flip)', () => {
  const a = edgeArrow({ x: -30, y: 5, z: 40 }, { x: 0.5, y: 0 }, W, H, 34);
  assert.ok(near(a.x, 34) && near(a.y, H / 2) && near(a.angle, Math.PI));
  const b = edgeArrow({ x: 0, y: 0, z: 40 }, { x: 0, y: 0 }, W, H, 34);
  assert.ok(near(b.x, W - 34) && near(b.angle, 0));
});

test('the bottom band stays clear', () => {
  const a = edgeArrow({ x: 0, y: -50, z: -5 }, { x: 0, y: -3 }, W, H, 34, 120);
  assert.ok(near(a.y, H - 120) && near(a.angle, Math.PI / 2));
});

test('a diagonal stays inside the viewport', () => {
  const a = edgeArrow({ x: 100, y: -100, z: -1 }, { x: 5, y: -5 }, W, H, 34);
  assert.ok(a.x <= W - 34 + 1e-6 && a.y <= H - 34 + 1e-6 && a.x >= 34 && a.y >= 34);
});

test('the beam fades out as you reach it', () => {
  assert.equal(beamOpacity(5), 0);
  assert.equal(beamOpacity(500), 1);
  assert.ok(beamOpacity(40) > 0 && beamOpacity(40) < 1);
  assert.ok(beamOpacity(30) < beamOpacity(50));
});

test('tower labels: only far away and only when looking toward the tower', () => {
  assert.equal(towerAlpha(0, 100), 0);
  assert.ok(towerAlpha(0, 800) > 0.99);
  assert.equal(towerAlpha(30, 800), 0);
  assert.ok(towerAlpha(7, 800) > 0 && towerAlpha(7, 800) < 1);
  assert.equal(towerAlpha(0, 5000), 0);
});

test('angle between headings wraps', () => {
  assert.ok(near(angleOff(0.1, -0.1), (0.2 * 180) / Math.PI));
  assert.ok(near(angleOff(Math.PI - 0.05, -Math.PI + 0.05), (0.1 * 180) / Math.PI));
  assert.ok(near(angleOff(0, Math.PI), 180));
});
