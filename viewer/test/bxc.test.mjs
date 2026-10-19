// node --test test/  (parses the test-scene chunk and checks rotation helpers)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { deflateRawSync } from 'node:zlib';
import { parseBxc } from '../src/bxc.js';
import { footprintCell, extent } from '../src/world.js';

function makeChunk(records, compress) {
  const body = Buffer.alloc(records.length * 12);
  records.forEach((r, n) => {
    const o = n * 12;
    body.writeUInt8(r.i, o); body.writeUInt8(r.j, o + 1); body.writeUInt16LE(r.k, o + 2);
    body.writeUInt8(r.type, o + 4); body.writeUInt8(r.color, o + 5); body.writeUInt8(r.rot, o + 6);
    body.writeUInt32LE(r.feature, o + 8);
  });
  const payload = compress ? deflateRawSync(body) : body;
  const h = Buffer.alloc(32);
  h.write('BXC1', 0, 'ascii'); h.writeUInt16LE(1, 4); h.writeUInt16LE(compress ? 1 : 0, 6);
  h.writeInt32LE(22, 8); h.writeInt32LE(47, 12); h.writeUInt32LE(records.length, 16);
  h.writeUInt16LE(90, 20); h.writeUInt16LE(93, 22); h.writeUInt32LE(payload.length, 24);
  return new Uint8Array(Buffer.concat([h, payload]));
}

const recs = [
  { i: 1, j: 2, k: 90, type: 9, color: 4, rot: 1 | 4, feature: 17 },
  { i: 63, j: 0, k: 300, type: 29, color: 13, rot: 2, feature: 0 },
];

for (const compress of [false, true]) {
  test(`round-trips records (compressed=${compress})`, async () => {
    const { header, records } = await parseBxc(makeChunk(recs, compress));
    assert.equal(header.cx, 22); assert.equal(header.cy, 47); assert.equal(header.brickCount, 2);
    assert.deepEqual([...records.i], [1, 63]); assert.deepEqual([...records.k], [90, 300]);
    assert.deepEqual([...records.rotFlags], [5, 2]); assert.deepEqual([...records.feature], [17, 0]);
  });
}

test('rejects bad magic', async () => {
  const b = makeChunk(recs, false); b[0] = 88;
  await assert.rejects(parseBxc(b));
});

test('parses the generated test scene when present', async (t) => {
  let man;
  try { man = JSON.parse(await readFile(new URL('../../build/testscene/manifest.json', import.meta.url))); }
  catch { t.skip('no build/testscene'); return; }
  for (const c of man.chunks) {
    const bytes = await readFile(new URL(`../../build/testscene/${c.file}`, import.meta.url));
    const { header } = await parseBxc(new Uint8Array(bytes));
    assert.equal(header.brickCount, c.bricks);
  }
});

test('rotation is clockwise from above and anchored at the min corner', () => {
  const t = { w: 2, d: 3 };
  assert.deepEqual(extent(t, 1), [3, 2]);
  // rot 1: +j (b) maps to +i; the a=0 column ends up at the high-j side
  assert.deepEqual(footprintCell(t, 1, 0, 0), [0, 1]);
  assert.deepEqual(footprintCell(t, 1, 0, 2), [2, 1]);
  assert.deepEqual(footprintCell(t, 2, 0, 0), [1, 2]);
  assert.deepEqual(footprintCell(t, 3, 0, 0), [2, 0]);
});
