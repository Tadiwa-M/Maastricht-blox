// Islands (CONTRACT 5.1): .bxi reader against the golden file, the pose against the shared
// vectors (contract/test_vectors/islands.json) through a real THREE.Group, picking in island
// space, LOD wiring, and the committed town fixture: each island stands on its paved plot.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { deflateRawSync } from 'node:zlib';
import * as THREE from 'three';
import { parseBxi, parseBxiHeader } from '../src/bxi.js';
import { World } from '../src/world.js';
import { applyIslandPose, islandWorld, localToWorld, worldToLocalThree, islandWorldBox, mainFacing } from '../src/island.js';
import { pickNearest } from '../src/picking.js';
import { parseBxc } from '../src/bxc.js';
import { MaterialSet } from '../src/materials.js';
import { worldContext } from '../src/bricks.js';
import { ChunkLOD } from '../src/lod.js';

const root = new URL('../../', import.meta.url);
const golden = new URL('pipeline/tests/fixtures/golden/', root);
const town = new URL('pipeline/tests/fixtures/town_world/', root);
const json = async (u) => JSON.parse(await readFile(u, 'utf8'));
const vectors = await json(new URL('contract/test_vectors/islands.json', root));
const near = (a, b, eps = 1e-4) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);

test('golden island: header and records (compressed and raw)', async () => {
  const g = await json(new URL('golden_island.json', golden));
  for (const [name, spec] of Object.entries(g.files)) {
    const bytes = new Uint8Array(await readFile(new URL(name, golden)));
    assert.equal(bytes.length, spec.size);
    const { header: h, records: r } = await parseBxi(bytes);
    for (const [k, val] of Object.entries(spec.header)) {
      if (typeof val === 'number' && !Number.isInteger(val)) near(h[k], val);
      else assert.equal(h[k], val, k);
    }
    assert.equal(Buffer.from(bytes.subarray(0, 40)).toString('hex'), spec.headerHex);
    g.records.forEach((e, q) => {
      assert.deepEqual([r.i[q], r.j[q], r.k[q], r.type[q], r.color[q], r.rotFlags[q], r.feature[q]],
        [e.i, e.j, e.k, e.typeId, e.colorIdx, e.rotFlags, e.featureId]);
      // 'world' = the record's local min corner through the pose, in Unity metres
      const [x, z] = localToWorld([h.originX, h.originZ], h.yawDeg, e.i * 0.5, e.j * 0.5);
      near(x, e.world[0], 1e-3); near(e.k * 0.2, e.world[1], 1e-9); near(z, e.world[2], 1e-3);
    });
  }
});

test('bxi rejects a chunk file, bad versions and truncated bodies', async () => {
  const bytes = new Uint8Array(await readFile(new URL('i_000001.bxi', golden)));
  const chunk = bytes.slice(); chunk.set([66, 88, 67, 49], 0); // "BXC1"
  assert.throws(() => parseBxiHeader(chunk), /magic/);
  const v2 = bytes.slice(); v2[4] = 2;
  assert.throws(() => parseBxiHeader(v2), /version/);
  await assert.rejects(parseBxi(bytes.subarray(0, bytes.length - 1)));
  const body = deflateRawSync(Buffer.alloc(11)); // not a whole record
  const h = Buffer.from(bytes.subarray(0, 40)); h.writeUInt32LE(1, 32); h.writeUInt32LE(body.length, 36);
  await assert.rejects(parseBxi(new Uint8Array(Buffer.concat([h, body]))), /body/);
});

test('pose: localToWorld and the three.js group both pass contract/test_vectors/islands.json', () => {
  for (const c of vectors.cases) {
    const g = applyIslandPose(new THREE.Group(), c.origin, c.yawDeg);
    for (const [u, v, x, z] of c.points) {
      const [wx, wz] = localToWorld(c.origin, c.yawDeg, u, v);
      near(wx, x); near(wz, z);
      // island-local three.js point (u, y, -v) -> world three.js (x, y, -z)
      const p = new THREE.Vector3(u, 7, -v).applyMatrix4(g.matrixWorld);
      near(p.x, x); near(p.y, 7); near(p.z, -z);
      // and back (picking moves rays into island space)
      const l = worldToLocalThree({ origin: c.origin, yawDeg: c.yawDeg }, p);
      near(l.x, u); near(l.z, -v);
    }
    // local +j points to (sin yaw, cos yaw) in (east, north)
    const dir = new THREE.Vector3(0, 0, -1).transformDirection(g.matrixWorld);
    const r = c.yawDeg * Math.PI / 180;
    near(dir.x, Math.sin(r)); near(-dir.z, Math.cos(r));
  }
});

const meta = {
  palette: { entries: [{ idx: 1, name: 'red', srgb: '#ff0000', material: 'solid' }] },
  catalogue: { types: [{ id: 1, name: 'brick_1x1', kind: 'brick', w: 1, d: 1, h: 3, studs: 'all' },
    { id: 40, name: 'window_1x2x2', kind: 'window', w: 2, d: 1, h: 6, studs: 'all' }] },
  features: { features: [{ id: 5, kind: 'building', name: 'Huis' }] },
};
const fakeIsland = (records, origin, yawDeg) => {
  const n = records.length, col = (f) => Uint32Array.from(records, f);
  return islandWorld(meta, { header: { islandId: 3, cx: 0, cy: 0, originX: origin[0], originZ: origin[1], yawDeg, brickCount: n },
    records: { i: col((r) => r.i), j: col((r) => r.j), k: col((r) => r.k), type: col((r) => r.type),
      color: col(() => 1), rotFlags: col((r) => r.rot || 0), feature: col(() => 5) } });
};

test('picking: the ray is moved into island space and the nearest hit wins', () => {
  const isl = fakeIsland([{ i: 4, j: 6, k: 10, type: 1 }], [100, 200], 30);
  // world three.js centre of local cell (4, 6) top
  const [x, z] = localToWorld([100, 200], 30, 4.5 * 0.5, 6.5 * 0.5);
  const targets = [{ world: isl, toLocal: (p, d) => worldToLocalThree(isl.island, p, d) }];
  const down = { x: 0, y: -1, z: 0 };
  const hit = pickNearest(targets, { x, y: 20, z: -z }, down);
  assert.equal(hit.n, 0); assert.equal(hit.I, 4); assert.equal(hit.J, 6);
  near(hit.distance, 20 - 13 * 0.2);
  // the same spot on the world grid (cell under it), lower: the island brick is nearer
  const ground = World.fromRecords(meta, [{ I: Math.floor(x / 0.5), J: Math.floor(z / 0.5), K: 0, type: 1, color: 1 }]);
  const both = pickNearest([{ world: ground }, ...targets], { x, y: 20, z: -z }, down);
  assert.equal(both.target.world, isl);
  // a ray beside the island (world cell next to the turned brick) misses it
  const [x2, z2] = localToWorld([100, 200], 30, 6.5 * 0.5, 6.5 * 0.5);
  assert.equal(pickNearest(targets, { x: x2, y: 20, z: -z2 }, down), null);
});

test('island bounds, world box and street facing', () => {
  const isl = fakeIsland([{ i: 0, j: 0, k: 0, type: 1 }, { i: 9, j: 3, k: 0, type: 1 }, { i: 2, j: 0, k: 3, type: 40, rot: 2 }], [10, 20], 20);
  assert.deepEqual([isl.bounds.I0, isl.bounds.J0, isl.bounds.I1, isl.bounds.J1], [0, 0, 10, 4]);
  assert.equal(mainFacing(isl), 2); // the window faces local -j
  const box = islandWorldBox(isl);
  for (const [u, v] of [[0, 0], [5, 0], [0, 2], [5, 2]]) {
    const [x, z] = localToWorld([10, 20], 20, u, v);
    assert.ok(box.containsPoint(new THREE.Vector3(x, 0.1, -z)), `corner ${u},${v}`);
  }
  // colour variation and studs live in local cells: a brick at local (0, 0) is cell (0, 0)
  assert.equal(isl.brickAt(0, 0, 1), 0);
});

/** Committed pipeline world with a rotated terrace (+20 deg) and a turned house (-30 deg). */
async function townWorld() {
  const m = { manifest: await json(new URL('manifest.json', town)), palette: await json(new URL('palette.json', town)),
    catalogue: await json(new URL('brick_catalogue.json', town)), features: await json(new URL('features.json', town)) };
  const w = new World(m);
  const parsed = [];
  for (const f of await readdir(new URL('chunks/', town))) parsed.push(await parseBxc(new Uint8Array(await readFile(new URL(`chunks/${f}`, town)))));
  w.allocate(parsed.reduce((s, p) => s + p.header.brickCount, 0));
  let o = 0;
  for (const { header: h, records: r } of parsed)
    for (let q = 0; q < h.brickCount; q++, o++) {
      w.I[o] = h.cx * 64 + r.i[q]; w.J[o] = h.cy * 64 + r.j[q]; w.K[o] = r.k[q];
      w.type[o] = r.type[q]; w.color[o] = r.color[q]; w.rotFlags[o] = r.rotFlags[q]; w.feature[o] = r.feature[q];
    }
  w.finish();
  const islands = [];
  for (const e of m.manifest.islands) islands.push(islandWorld(m, await parseBxi(new Uint8Array(await readFile(new URL(e.file, town))))));
  return { w, islands };
}

test('town fixture: every island plinth stands on its paved plot (pose sign and offset)', async () => {
  const { w, islands } = await townWorld();
  assert.equal(islands.length, 2);
  const topColor = (I, J) => { const n = w.brickAt(I, J, w.topK(I, J) - 1); return n < 0 ? -1 : w.color[n]; };
  for (const iw of islands) {
    const { origin, yawDeg } = iw.island;
    const hist = new Map();
    let cells = 0;
    for (let n = 0; n < iw.count; n++) {
      if (iw.K[n] > iw.bounds.K0 + 1) continue; // plinth layer only
      const [ei, ej] = iw.extentOf(n);
      for (let a = 0; a < ei; a++) for (let b = 0; b < ej; b++) {
        const [x, z] = localToWorld(origin, yawDeg, (iw.I[n] + a + 0.5) * 0.5, (iw.J[n] + b + 0.5) * 0.5);
        const c = topColor(Math.floor(x / 0.5), Math.floor(z / 0.5));
        hist.set(c, (hist.get(c) || 0) + 1); cells++;
      }
    }
    const [plot, under] = [...hist].sort((a, b) => b[1] - a[1])[0];
    assert.equal(w.palette.get(plot).name, 'pavement', `island ${iw.island.id}`);
    // the footprint is grown by half a stud over a staircased plot: ~90 % on paving; a wrong
    // yaw sign puts < 25 % there
    assert.ok(under / cells > 0.85, `island ${iw.island.id}: ${under}/${cells} plinth cells on the plot`);
  }
});

test('LOD: each island is one posed source with near and far looks built in local cells', async () => {
  const { w, islands } = await townWorld();
  const mats = new MaterialSet();
  const lod = new ChunkLOD(w, mats, worldContext(w, mats), islands.map((iw) => ({ world: iw, ctx: worldContext(iw, mats) })));
  assert.equal(lod.chunks.length, 6 + 2);
  assert.equal(lod.sources.length, 3);
  lod.setTier({ lod: true, nearDist: 30, maxNear: 9 });
  for (const [q, iw] of islands.entries()) {
    const src = lod.sources[q + 1], c = lod.chunks.find((ch) => ch.src === src);
    assert.equal(c.list.length, iw.count);
    assert.ok(c.box.equals(islandWorldBox(iw)));
    assert.ok(c.farTris > 0, 'far look built');
    near(src.parent.rotation.y, -iw.island.yawDeg * Math.PI / 180);
    // camera right next to the island: its near look is built under the posed group, with studs
    const cam = new THREE.PerspectiveCamera();
    c.box.getCenter(cam.position);
    lod.settle(cam);
    assert.ok(c.isNear && c.near.group.parent === src.parent);
    assert.ok(c.studs > 0, 'studs exposed within the island');
  }
});
