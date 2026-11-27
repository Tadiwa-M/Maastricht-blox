import test from 'node:test';
import assert from 'node:assert/strict';
import { figureBlocksAim, CLEAR_OUT } from '../src/mp/aimview.js';

const cam = [0, 1.6, 0], fwd = [0, 0, -1];

test('a figure straight down the aim ray blocks it fully', () => {
  assert.equal(figureBlocksAim(cam, fwd, [0, 0, -2.6]), 1);
});

test('the over-the-shoulder offset (1 m) leaves the aim clear', () => {
  assert.equal(figureBlocksAim(cam, fwd, [-1.0, 0, -2.6]), 0);
  assert.equal(figureBlocksAim(cam, fwd, [-CLEAR_OUT - 0.01, 0, -2.6]), 0);
});

test('partly in the way gives a value in between; behind the camera never counts', () => {
  const k = figureBlocksAim(cam, fwd, [-0.45, 0, -2.6]);
  assert.ok(k > 0 && k < 1, String(k));
  assert.equal(figureBlocksAim(cam, fwd, [0, 0, 2]), 0);
});
