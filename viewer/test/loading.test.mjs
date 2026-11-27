import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadState, LoadingScreen, MAX_STREAM_MS, WARM_FRAMES } from '../src/loading.js';

const base = { index: true, silhouette: true, loaded: 0, inflight: 0, pending: 0, settled: false, frames: 0, streamMs: 0 };

test('phases advance in order and never finish early', () => {
  const steps = [
    loadState({ ...base, index: false }),
    loadState({ ...base, silhouette: false }),
    loadState({ ...base, loaded: 5, inflight: 5, pending: 10 }),
    loadState({ ...base, loaded: 20, settled: true, frames: 2 }),
    loadState({ ...base, loaded: 20, settled: true, frames: WARM_FRAMES }),
  ];
  for (let i = 1; i < steps.length; i++) assert.ok(steps[i].frac > steps[i - 1].frac, `step ${i}`);
  assert.deepEqual(steps.map((s) => s.done), [false, false, false, false, true]);
});

test('a slow first ring does not keep the cover up forever', () => {
  const slow = { ...base, loaded: 1, inflight: 4, pending: 50, frames: WARM_FRAMES };
  assert.equal(loadState({ ...slow, streamMs: 1000 }).done, false);
  assert.equal(loadState({ ...slow, streamMs: MAX_STREAM_MS }).done, true);
});

test('most of the first ring is enough', () => {
  assert.equal(loadState({ ...base, loaded: 95, pending: 5, frames: WARM_FRAMES }).done, true);
  assert.equal(loadState({ ...base, loaded: 50, pending: 50, frames: WARM_FRAMES }).done, false);
});

test('progress bar never moves backwards and hide is idempotent', () => {
  const bar = { style: { width: '' } }, msg = { textContent: '' };
  const removed = [];
  const el = { querySelector: (q) => (q === '.bar i' ? bar : msg), classList: { add() {} }, remove: () => removed.push(1) };
  globalThis.location ??= { search: '' };
  const s = new LoadingScreen(el);
  s.update(0.6, 'a');
  s.update(0.3, 'b');
  assert.equal(bar.style.width, '60%');
  assert.equal(msg.textContent, 'b');
  s.hide(true); s.hide(true);
  assert.equal(removed.length, 1);
  s.update(0.9);
  assert.equal(bar.style.width, '60%');
});

test('start screen tips are short and about the game', async () => {
  const { TIPS } = await import('../src/loading.js');
  assert.ok(TIPS.length >= 5);
  for (const t of TIPS) assert.ok(t.length < 90 && /[.!?]$/.test(t), t);
  assert.ok(TIPS.some((t) => /back to the map/.test(t)), 'one tip says how to get back to the map');
});
