// The whole-city silhouette must be able to load every coarse region, however many there are:
// with a cap below the region count it never settled, and chunk streaming (which waits for it)
// never started (the whole-Maastricht bake has 1,020 regions; the old cap was 600).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FarRegions } from '../src/farregion.js';

test('the coarsest level keeps all 1,020 regions and settles', async () => {
  const regions = [];
  for (let rx = 0; rx < 34; rx++) for (let ry = 0; ry < 30; ry++) regions.push({ rx, ry, file: `far/l3/r_${rx}_${ry}.bin` });
  const index = { regionChunks: 8, chunkStuds: 64, studM: 0.5, plateM: 0.2, levels: [{ level: 3, cellStuds: 8, cellPlates: 10, regions }] };
  const far = new FarRegions(index, { palette: new Map(), mats: null, fetchBytes: async () => new Uint8Array(0), decode: async () => ({ owners: [], quads: { count: 0 } }), covered: () => false });
  const s = far.schedulers.get(3);
  assert.equal(s.maxLoaded, Infinity);
  for (let q = 0; q < 400 && !far.silhouetteReady(); q++) {
    s.update({ x: 4000, y: 300, z: -4000 });
    await new Promise((r) => setTimeout(r, 0));
  }
  assert.equal(s.loadedCount, 1020);
  assert.ok(far.silhouetteReady(), 'streaming may start');
});
