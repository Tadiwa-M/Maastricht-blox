// City query API (src/city.js) over streamed chunks and islands: the committed town fixture
// (6 chunks, 2 rotated islands) goes through the real path: tools/bake-far.mjs (index facts),
// CityLoader (src/loader.js) with an in-memory source, src/prepare.js on the main thread.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bakeFar } from '../tools/bake-far.mjs';
import { CityLoader, islandsByChunk } from '../src/loader.js';
import { PreparePool } from '../src/workers.js';
import { parseBxc } from '../src/bxc.js';
import { parseBxi } from '../src/bxi.js';
import { localToWorld } from '../src/island.js';
import { UNKNOWN, CityQuery } from '../src/city.js';
import { SolidMap } from '../src/solidmap.js';

const town = fileURLToPath(new URL('../../pipeline/tests/fixtures/town_world/', import.meta.url));
const json = async (f) => JSON.parse(await readFile(join(town, f), 'utf8'));

async function setup() {
  const tmp = await mkdtemp(join(tmpdir(), 'blox-city-'));
  const baked = await bakeFar(town, tmp, { log: () => {} });
  await rm(tmp, { recursive: true, force: true });
  const m = await json('manifest.json');
  const index = { studM: 0.5, plateM: 0.2, chunkStuds: 64, chunksX: 64, chunksY: 64, chunks: baked.chunks, islands: baked.islands };
  const meta = { manifest: m, palette: await json('palette.json'), catalogue: await json('brick_catalogue.json') };
  const source = { bytes: async (p) => new Uint8Array(await readFile(join(town, p))) };
  const loader = new CityLoader(index, { source, pool: new PreparePool(meta, { size: 0 }), loadRadius: 1e6, concurrency: 16 });
  return { index, loader };
}

async function settle(loader, eye) {
  for (let q = 0; q < 50 && !(loader.update(eye) === 0 && loader.settled()); q++) await new Promise((r) => setTimeout(r, 5));
}

/** three.js centre of a chunk record's cell. */
const chunkCell = (cx, cy, r, q) => [(cx * 64 + r.i[q] + 0.5) * 0.5, (r.k[q] + 0.5) * 0.2, -(cy * 64 + r.j[q] + 0.5) * 0.5];

test('unloaded areas are unknown; loaded chunks and islands answer isSolid / groundHeight', async () => {
  const { index, loader } = await setup();
  const q = loader.query;
  const c0 = index.chunks[0];
  const { header: h, records: r } = await parseBxc(new Uint8Array(await readFile(join(town, c0.file))));
  const [x, y, z] = chunkCell(h.cx, h.cy, r, 0);
  assert.equal(q.isSolid(x, y, z), UNKNOWN);
  assert.equal(q.groundHeight(x, z), UNKNOWN);
  assert.equal(q.isSolid(-10, 5, 10), false, 'outside the chunk map is air');
  await settle(loader, { x, y, z });
  assert.equal(loader.stats().loaded, index.chunks.length + index.islands.length);
  // every chunk record's first cell is solid; a cell 400 plates up is air
  for (const e of index.chunks) {
    const p = await parseBxc(new Uint8Array(await readFile(join(town, e.file))));
    for (const n of [0, p.header.brickCount >> 1, p.header.brickCount - 1]) {
      const [px, py, pz] = chunkCell(p.header.cx, p.header.cy, p.records, n);
      assert.equal(q.isSolid(px, py, pz), true);
      assert.equal(q.isSolid(px, py + 80, pz), false);
      const g = q.groundHeight(px, pz);
      assert.ok(typeof g === 'number' && g >= (p.records.k[n] + 1) * 0.2 - 1e-9, `ground ${g} under a brick at k ${p.records.k[n]}`);
    }
  }
  // islands: a record's local cell centre through the pose (CONTRACT 5.1) is solid
  for (const e of index.islands) {
    const { header: ih, records: ir } = await parseBxi(new Uint8Array(await readFile(join(town, e.file))));
    let hits = 0;
    for (let n = 0; n < ir.i.length; n += 37) {
      const [ux, uz] = localToWorld([ih.originX, ih.originZ], ih.yawDeg, (ir.i[n] + 0.5) * 0.5, (ir.j[n] + 0.5) * 0.5);
      const ky = (ir.k[n] + 0.5) * 0.2;
      if (q.isSolid(ux, ky, -uz) === true) hits++;
      const g = q.groundHeight(ux, -uz, ky);
      assert.ok(typeof g === 'number' && g >= (ir.k[n] + 1) * 0.2 - 1e-9);
    }
    assert.equal(hits, Math.ceil(ir.i.length / 37), `island ${ih.islandId}`);
  }
});

test('an island that is not loaded makes the chunks it overlaps unknown again', async () => {
  const { index, loader } = await setup();
  await settle(loader, { x: 0, y: 0, z: 0 });
  const isl = index.islands[0];
  const over = [...islandsByChunk(index)].filter(([, ids]) => ids.includes(isl.id)).map(([k]) => k.split(',').map(Number));
  assert.ok(over.length >= 1);
  const [cx, cy] = over[0];
  const x = (cx + 0.5) * 32, z = -(cy + 0.5) * 32;
  assert.notEqual(loader.query.isSolid(x, 20, z), UNKNOWN);
  loader.sched.drop(loader.sched.get(`i${isl.id}`));
  assert.equal(loader.query.isSolid(x, 20, z), UNKNOWN);
  assert.equal(loader.query.groundHeight(x, z), UNKNOWN);
});

test('the loader streams nearest first and unloads beyond its radius', async () => {
  const { index, loader } = await setup();
  loader.setRadius(5);
  loader.sched.concurrency = 1;
  const c = index.chunks[3];
  const eye = { x: (c.cx + 0.5) * 32, y: c.maxK * 0.2 + 1, z: -(c.cy + 0.5) * 32 };
  loader.update(eye);
  const first = loader.sched.items.find((it) => it.state === 1);
  assert.equal(first.dist, Math.min(...loader.sched.items.map((it) => it.dist)), 'the nearest item starts first');
  assert.equal(first.dist, 0);
  await settle(loader, eye);
  const loaded = loader.sched.items.filter((it) => it.payload).map((it) => it.key);
  assert.ok(loaded.includes(`c${c.cx},${c.cy}`) && loaded.length < index.chunks.length + index.islands.length);
  loader.update({ x: 5000, y: 0, z: -5000 });
  assert.equal(loader.stats().loaded, 0);
  assert.equal(loader.query.isSolid(eye.x, 10, eye.z), UNKNOWN);
});

test('groundHeight(x, z, fromY) finds the floor under an overhang', () => {
  const m = new SolidMap(0, 0, 0, 4, 4, 40);
  for (let K = 0; K < 2; K++) m.set(1, 1, K);   // floor: top at K 2
  for (let K = 20; K < 22; K++) m.set(1, 1, K); // roof: top at K 22
  const q = new CityQuery({ hasChunk: () => true });
  q.setChunk(0, 0, m);
  const x = 0.75, z = -0.75;
  assert.ok(Math.abs(q.groundHeight(x, z) - 22 * 0.2) < 1e-9);
  assert.ok(Math.abs(q.groundHeight(x, z, 1.0) - 2 * 0.2) < 1e-9);
  assert.equal(q.groundHeight(3, -1.75), null);
  assert.equal(q.isSolid(x, 0.1, z), true);
  assert.equal(q.isSolid(x, 2, z), false);
});
