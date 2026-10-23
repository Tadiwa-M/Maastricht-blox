// Streaming scheduler (src/stream.js): priority, concurrency, abort, unload, retry, many eyes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { StreamScheduler, boxDistance, READY, IDLE } from '../src/stream.js';

/** Items in a row along x, 10 m apart, each a 1 m box. */
const row = (n) => Array.from({ length: n }, (_, q) => ({ key: `k${q}`, box: { min: { x: q * 10, y: 0, z: 0 }, max: { x: q * 10 + 1, y: 1, z: 1 } } }));
const tick = () => new Promise((r) => setTimeout(r, 0));

/** Scheduler whose loads resolve when the test says so. */
function manual(items, opts = {}) {
  const pending = new Map(), unloaded = [], started = [];
  const s = new StreamScheduler(items, {
    load: (it, signal) => new Promise((res, rej) => {
      started.push(it.key);
      pending.set(it.key, res);
      signal?.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' })));
    }),
    unload: (it, payload) => unloaded.push([it.key, payload]),
    ...opts,
  });
  return { s, pending, unloaded, started, finish: async (key) => { pending.get(key)(`payload ${key}`); await tick(); } };
}

test('boxDistance is 0 inside and euclidean outside', () => {
  const b = { min: { x: 0, y: 0, z: 0 }, max: { x: 2, y: 2, z: 2 } };
  assert.equal(boxDistance(b, { x: 1, y: 1, z: 1 }), 0);
  assert.equal(boxDistance(b, { x: 5, y: 6, z: 1 }), 5);
});

test('loads nearest first, never more than `concurrency` at once, only within loadRadius', async () => {
  const { s, started, finish } = manual(row(10), { loadRadius: 45, concurrency: 2 });
  s.update({ x: 31, y: 0, z: 0 }); // k3 (x 30..31) is at distance 0, k4 9 m, k2 10 m
  assert.deepEqual(started, ['k3', 'k4']);
  assert.equal(s.inflight, 2);
  s.update({ x: 31, y: 0, z: 0 });
  assert.equal(started.length, 2, 'concurrency limit');
  await finish('k3');
  s.update({ x: 31, y: 0, z: 0 });
  assert.deepEqual(started, ['k3', 'k4', 'k2']);
  assert.equal(s.get('k3').state, READY);
  assert.equal(s.get('k3').payload, 'payload k3');
  // nothing beyond 45 m is ever started: items 0..7 are within (k8 is 49 m away)
  for (const k of ['k4', 'k2']) await finish(k);
  for (let q = 0; q < 10; q++) { s.update({ x: 31, y: 0, z: 0 }); for (const k of [...started]) if (s.get(k).state !== READY) await finish(k); }
  assert.ok(!started.includes('k8') && !started.includes('k9'));
  assert.ok(s.settled());
});

test('items in view get priority over items behind the camera', () => {
  const { s, started } = manual(row(5), { loadRadius: 100, concurrency: 1 });
  s.update({ x: 20.5, y: 0, z: 0 }, (b) => b.min.x > 20); // only k3, k4 are "in view"
  assert.deepEqual(started, ['k2']); // distance 0 beats everything
  const m = manual(row(5), { loadRadius: 100, concurrency: 2 });
  m.s.update({ x: 25, y: 0, z: 0 }, (b) => b.min.x > 25); // k2 (4 m, behind) vs k3 (5 m, in view)
  assert.deepEqual(m.started, ['k3', 'k2']);
});

test('a load that falls far behind is aborted; its late result is unloaded, not used', async () => {
  const { s, pending, unloaded } = manual(row(3), { loadRadius: 15, concurrency: 3 });
  s.update({ x: 0, y: 0, z: 0 }); // k0, k1
  assert.equal(s.inflight, 2);
  s.update({ x: 1000, y: 0, z: 0 }); // both beyond 15 * 1.25
  assert.equal(s.inflight, 0);
  assert.equal(s.stats.aborted, 2);
  assert.equal(s.get('k0').state, IDLE);
  pending.get('k0')('late'); await tick();
  assert.equal(s.get('k0').payload, null);
  assert.equal(s.get('k0').state, IDLE);
});

test('ready items beyond unloadRadius are unloaded; maxLoaded drops the farthest', async () => {
  const { s, unloaded, finish } = manual(row(6), { loadRadius: 60, unloadRadius: 80, concurrency: 10, maxLoaded: 4 });
  s.update({ x: 0, y: 0, z: 0 });
  for (let q = 0; q < 6; q++) await finish(`k${q}`);
  s.update({ x: 0, y: 0, z: 0 }); // 6 loaded > 4: the two farthest go
  assert.equal(s.loadedCount, 4);
  assert.deepEqual(unloaded.map(([k]) => k).sort(), ['k4', 'k5']);
  s.update({ x: -200, y: 0, z: 0 }); // everything beyond 80 m
  assert.equal(s.loadedCount, 0);
  assert.deepEqual(unloaded.map(([k, p]) => p).filter((p) => p === 'payload k0'), ['payload k0']);
});

test('failed loads retry after retryMs; several eyes count the nearest', async () => {
  let now = 0, calls = 0;
  const s = new StreamScheduler(row(1), { loadRadius: 10, now: () => now, retryMs: 100,
    load: () => { calls++; return calls === 1 ? Promise.reject(new Error('net')) : Promise.resolve('ok'); } });
  s.update({ x: 0, y: 0, z: 0 }); await tick();
  assert.equal(s.stats.failed, 1);
  s.update({ x: 0, y: 0, z: 0 }); assert.equal(calls, 1, 'not before retryMs');
  now = 200; s.update({ x: 0, y: 0, z: 0 }); await tick();
  assert.equal(s.get('k0').state, READY);
  const m = manual(row(10), { loadRadius: 5, concurrency: 10 });
  m.s.update([{ x: 0, y: 0, z: 0 }, { x: 90, y: 0, z: 0 }]);
  assert.deepEqual(m.started.sort(), ['k0', 'k9']);
});
