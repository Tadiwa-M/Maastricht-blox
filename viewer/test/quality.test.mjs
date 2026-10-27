// Quality tiers (src/quality.js): starting tier, LOD switch, auto step-down, fps meter.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TIERS, initialTier, useLod, FrameGovernor, FpsMeter } from '../src/quality.js';

const oneChunk = { chunks: 1, bricks: 4247 };
const town = { chunks: 49, bricks: 265761 };

test('auto: one chunk starts high without LOD (the look-test look), a town starts medium with LOD', () => {
  assert.equal(initialTier('auto', oneChunk), 'high');
  assert.equal(useLod('high', oneChunk), false);
  assert.equal(initialTier('auto', town), 'medium');
  assert.equal(useLod('medium', town), true);
  assert.equal(useLod('high', town), true); // high on a town: bigger near zone, still LOD
});

test('an explicit mode wins over the world size', () => {
  assert.equal(initialTier('low', oneChunk), 'low');
  assert.equal(initialTier('high', town), 'high');
  assert.equal(useLod('low', oneChunk), true);
});

test('tiers get cheaper from high to low', () => {
  const [h, m, l] = [TIERS.high, TIERS.medium, TIERS.low];
  assert.ok(h.pixelRatio > m.pixelRatio || m.pixelRatio === 1);
  assert.deepEqual([h.ao, m.ao, l.ao], ['full', 'half', 'off']);
  assert.ok(h.nearDist > m.nearDist && m.nearDist > l.nearDist);
  assert.ok(h.studCap > m.studCap && m.studCap > l.studCap);
  assert.equal(h.bloom, 'always');
  assert.equal(m.bloom, 'night');
  assert.ok(h.shadowRange > m.shadowRange && m.shadowRange > l.shadowRange);
  const lite = TIERS.lite; // the floor: below 1x resolution, no shadows, no bloom
  assert.ok(lite.pixelRatio < 1 && lite.shadows === false && lite.bloom === 'off');
  assert.ok(lite.farDist[1] < l.farDist[1] && lite.streamRadius < l.streamRadius && lite.nearTriCap < l.nearTriCap);
});

test('auto picks the start tier from the GPU class for big worlds only', () => {
  const town = { chunks: 64, bricks: 1e6 }, one = { chunks: 1, bricks: 5000 };
  assert.equal(initialTier('auto', town, 'lite'), 'lite');
  assert.equal(initialTier('auto', one, 'lite'), 'high');
  assert.equal(initialTier('medium', town, 'lite'), 'medium');
});

test('governor steps down after a slow window, ignores the settle period, never steps up', () => {
  const g = new FrameGovernor('medium', { slowMs: 40, windowMs: 1000, settleMs: 500 });
  for (let q = 0; q < 14; q++) assert.equal(g.sample(100), null); // 500 ms settle + 900 ms of window
  assert.equal(g.sample(100), 'low'); // window full (1000 ms) at 100 ms/frame
  for (let q = 0; q < 14; q++) assert.equal(g.sample(100), null);
  assert.equal(g.sample(100), 'lite'); // and once more to the floor
  for (let q = 0; q < 50; q++) assert.equal(g.sample(100), null); // already at the bottom
  const fast = new FrameGovernor('high', { slowMs: 40, windowMs: 1000, settleMs: 0 });
  for (let q = 0; q < 200; q++) assert.equal(fast.sample(10), null);
  assert.equal(fast.tier, 'high');
});

test('fps meter measures real frame intervals and never rounds a slow machine to 0', () => {
  const m = new FpsMeter(1000);
  assert.equal(m.label(), '… fps');
  let t = 0;
  for (let q = 0; q < 30; q++) { m.tick(t); t += 1000 / 60; }
  assert.ok(Math.abs(m.fps - 60) < 0.5);
  assert.equal(m.label(), '60 fps (16.7 ms)');
  const slow = new FpsMeter(1000);
  slow.tick(0); slow.tick(2500); slow.tick(5000); // 2.5 s per frame
  assert.equal(slow.label(), '0.4 fps (2500.0 ms)');
});
