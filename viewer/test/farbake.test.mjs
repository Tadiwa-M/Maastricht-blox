// Baked far regions (src/farbake.js, src/farregion.js): coarse voxels, culling, greedy quads,
// owner ranges, the BXF1 file round trip, and the bake tool on the town fixture.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deflateRawSync, inflateRawSync } from 'node:zlib';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bakeRegion, encodeBxf, decodeBxf, parseBxfHeader } from '../src/farbake.js';
import { regionArrays } from '../src/farregion.js';
import { rotatedExtent } from '../src/rotation.js';
import { bakeFar } from '../tools/bake-far.mjs';

const palette = new Map([
  [1, { idx: 1, name: 'red', srgb: '#ff0000', material: 'solid' }],
  [2, { idx: 2, name: 'paving', srgb: '#999999', material: 'solid' }],
  [3, { idx: 3, name: 'water', srgb: '#2255aa', material: 'trans' }],
  [4, { idx: 4, name: 'glass', srgb: '#223344', material: 'glass' }],
]);
const types = new Map([[1, { id: 1, kind: 'brick', w: 1, d: 1, h: 3 }], [2, { id: 2, kind: 'plate', w: 1, d: 1, h: 1 }]]);
const inflate = async (b) => new Uint8Array(inflateRawSync(b));

/** Source of 1x1 bricks/plates: [[I, J, K, type, color]]. */
function src(list, owner = 1) {
  const n = list.length, col = (q) => Int32Array.from(list.map((r) => r[q]));
  const bricks = { count: n, I: col(0), J: col(1), K: col(2), type: Uint8Array.from(list.map((r) => r[3])),
    color: Uint8Array.from(list.map((r) => r[4])), rotFlags: new Uint8Array(n) };
  return { bricks, types, extent: (t, rot) => rotatedExtent(t.w, t.d, rot), voteColor: (q) => bricks.color[q], owner };
}
const box = { gi0: -1, gj0: -1, gk0: -1, gi1: 6, gj1: 6, gk1: 6 };
const bake = (sources, owners = [{ cx: 0, cy: 0 }]) => bakeRegion({ rx: 0, ry: 0, box, sources, owners, palette });

/** A solid block of bricks: I, J in [0, n), K in [0, h) (steps of 3 plates). */
const block = (n, h, color = 1) => {
  const out = [];
  for (let I = 0; I < n; I++) for (let J = 0; J < n; J++) for (let K = 0; K < h; K += 3) out.push([I, J, K, 1, color]);
  return out;
};

test('a 4 x 4 stud x 6 plate block becomes one 2 x 2 x 2 coarse box: 6 merged quads', () => {
  const r = bake([src(block(4, 6))]);
  assert.equal(r.quads.length, 6);
  for (const q of r.quads) assert.equal(q.w * q.h, 4);
  assert.deepEqual(r.owners, [{ cx: 0, cy: 0, quads: 6 }]);
});

test('top faces take the colour of the highest fine level (paving on top of earth)', () => {
  const recs = block(4, 3, 1); // 2 x 2 coarse cells, 3 plates: brick (red)...
  for (let I = 0; I < 4; I++) for (let J = 0; J < 4; J++) recs.push([I, J, 3, 2, 2]); // ...one paving plate above
  const r = bake([src(recs)]);
  const tops = r.quads.filter((q) => q.dir === 4);
  assert.deepEqual(tops.map((q) => q.color), [2]);
  assert.ok(r.quads.filter((q) => q.dir !== 4).some((q) => q.color === 1), 'sides keep the majority colour');
});

test('context sources hide faces but emit nothing; owners split quads and keep order', () => {
  const left = src(block(2, 3), 1), right = src(block(2, 3).map(([I, J, K, t, c]) => [I + 2, J, K, t, c]), 2);
  const r = bake([left, right], [{ cx: 0, cy: 0 }, { cx: 1, cy: 0 }]);
  assert.equal(r.owners[0].quads, 5); // the face toward the other owner is culled
  assert.equal(r.owners[1].quads, 5);
  assert.ok(r.quads.slice(0, 5).every((q) => q.owner === 1) && r.quads.slice(5).every((q) => q.owner === 2));
  const ctx = bake([left, { ...right, owner: 0 }], [{ cx: 0, cy: 0 }]);
  assert.equal(ctx.quads.length, 5);
});

test('the river bed shows through water; glass faces are never merged', () => {
  const bed = block(4, 3, 1), water = [];
  for (let I = 0; I < 4; I++) for (let J = 0; J < 4; J++) water.push([I, J, 3, 1, 3]);
  const r = bake([src([...bed, ...water])]);
  const up = r.quads.filter((q) => q.dir === 4).map((q) => q.color).sort();
  assert.deepEqual(up, [1, 3], 'bed top under the water and the water surface');
  const g = bake([src(block(4, 3, 4))]);
  assert.equal(g.quads.length, 4 + 8 + 4, 'one quad per glass cell face: 2 x 2 top, 4 sides x 2, 2 x 2 bottom');
});

test('BXF1 round trip (raw and deflated) and geometry with per-owner ranges', async () => {
  const r = bake([src(block(4, 6), 1), src(block(2, 3).map(([I, J, K, t, c]) => [I, J + 6, K, t, 4]), 2)],
    [{ cx: 3, cy: -2 }, { cx: 4, cy: 5 }]);
  for (const deflate of [null, (b) => new Uint8Array(deflateRawSync(b))]) {
    const bytes = encodeBxf(r, deflate);
    const h = parseBxfHeader(bytes);
    assert.deepEqual([h.rx, h.ry, h.gi0, h.gj0, h.gk0, h.cellStuds, h.cellPlates, h.quadCount], [0, 0, -1, -1, -1, 2, 3, r.quads.length]);
    const d = await decodeBxf(bytes, inflate);
    assert.deepEqual(d.owners.map(({ cx, cy, quads }) => ({ cx, cy, quads })), r.owners);
    r.quads.forEach((q, n) => assert.deepEqual([d.quads.x[n], d.quads.y[n], d.quads.z[n], d.quads.w[n], d.quads.h[n], d.quads.dir[n], d.quads.color[n]],
      [q.x, q.y, q.z, q.w, q.h, q.dir, q.color]));
    const a = regionArrays(d, palette);
    assert.equal(a.triangles, r.quads.length * 2);
    const opaque = a.families.get('opaque');
    assert.equal(opaque.ranges.reduce((s, x) => s + x.count, 0), opaque.arrays.index.length);
    assert.equal(opaque.ranges[0].count, r.owners[0].quads * 6);
    // glass quads glow at night for about 60 % of windows; plastic has shine 0, glass 255
    const ex = opaque.arrays.extra;
    assert.ok([...ex].some((v, q) => q % 4 === 3 && v === 255));
  }
  const bad = encodeBxf(r);
  bad[0] = 0x41;
  assert.throws(() => parseBxfHeader(bad), /magic/);
  await assert.rejects(decodeBxf(encodeBxf(r).subarray(0, 50), inflate));
});

test('bake tool on the town fixture: 3 levels, coarser levels have fewer quads, islands boxed', async () => {
  const town = fileURLToPath(new URL('../../pipeline/tests/fixtures/town_world/', import.meta.url));
  const out = await mkdtemp(join(tmpdir(), 'blox-bake-'));
  try {
    const res = await bakeFar(town, out, { log: () => {} });
    const idx = JSON.parse(await readFile(join(out, 'far', 'index.json'), 'utf8'));
    assert.deepEqual(idx.levels.map((l) => l.level), [1, 2, 3]);
    const quads = idx.levels.map((l) => l.regions.reduce((s, r) => s + r.quads, 0));
    assert.ok(quads[0] > quads[1] && quads[1] > quads[2] && quads[2] > 0, String(quads));
    assert.equal(res.islands.length, 2);
    for (const i of res.islands) assert.ok(i.rect[2] > i.rect[0] && i.rect[3] > i.rect[1] && i.maxK > i.minK);
    assert.equal(idx.ground.length, 6);
    const d = await decodeBxf(new Uint8Array(await readFile(join(out, idx.levels[0].regions[0].file))), inflate);
    assert.equal(d.quads.count, idx.levels[0].regions[0].quads);
  } finally {
    await rm(out, { recursive: true, force: true });
  }
});
