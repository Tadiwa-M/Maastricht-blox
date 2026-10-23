// Make a big synthetic world for viewer performance tests: copy every chunk AND island of a
// world dir into an N x N grid of tiles (only cx/cy, island ids and island origins change).
// Tiles are laid out from the map corner inward and must fit the 64 x 64 chunk map.
// Usage: node tools/tile-world.mjs <srcWorld> <outWorld> [n=7]
// e.g.   node tools/tile-world.mjs ../samples/markt_v3 ../build/tiled8 8   (8x8 x 49 = 3136 chunks, 2560 islands)
import { mkdir, readFile, writeFile, copyFile, readdir, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';

const [src, out, nArg] = process.argv.slice(2);
if (!src || !out) throw new Error('usage: node tools/tile-world.mjs <srcWorld> <outWorld> [n]');
const n = Number(nArg ?? 7);
const srcDir = resolve(src), outDir = resolve(out);
const manifest = JSON.parse(await readFile(join(srcDir, 'manifest.json'), 'utf8'));
const files = manifest.chunks?.length ? manifest.chunks.map((c) => c.file)
  : (await readdir(join(srcDir, 'chunks'))).map((f) => `chunks/${f}`);
await rm(outDir, { recursive: true, force: true });
await mkdir(join(outDir, 'chunks'), { recursive: true });
await mkdir(join(outDir, 'islands'), { recursive: true });
for (const f of await readdir(srcDir)) if (f.endsWith('.json') && f !== 'manifest.json') await copyFile(join(srcDir, f), join(outDir, f));

const srcChunks = await Promise.all(files.map(async (f) => readFile(join(srcDir, f))));
const srcIslands = await Promise.all((manifest.islands || []).map(async (e) => readFile(join(srcDir, e.file))));
const cx0 = Math.min(...srcChunks.map((b) => b.readInt32LE(8)));
const cy0 = Math.min(...srcChunks.map((b) => b.readInt32LE(12)));
const span = (key, lo) => Math.max(...srcChunks.map((b) => b.readInt32LE(key))) - lo + 1;
const sx = span(8, cx0), sy = span(12, cy0);
const map = manifest.chunksX || 64;
const bx = Math.floor((map - n * sx) / 2), by = Math.floor((map - n * sy) / 2);
if (bx < 0 || by < 0) throw new Error(`${n} x ${n} tiles of ${sx} x ${sy} chunks do not fit a ${map}-chunk map`);
const chunkM = (manifest.chunkStuds || 64) * (manifest.studM || 0.5);
const sha1 = (b) => createHash('sha1').update(b).digest('hex');
const chunks = [], islands = [];
let nextId = 1;
for (let gy = 0; gy < n; gy++)
  for (let gx = 0; gx < n; gx++) {
    const dcx = bx + gx * sx - cx0, dcy = by + gy * sy - cy0;
    for (const buf of srcChunks) {
      const b = Buffer.from(buf);
      const cx = b.readInt32LE(8) + dcx, cy = b.readInt32LE(12) + dcy;
      b.writeInt32LE(cx, 8);
      b.writeInt32LE(cy, 12);
      const file = `chunks/c_${String(cx).padStart(2, '0')}_${String(cy).padStart(2, '0')}.bxc`;
      await writeFile(join(outDir, file), b);
      chunks.push({ cx, cy, file, bricks: b.readUInt32LE(16), minK: b.readUInt16LE(20), maxK: b.readUInt16LE(22), sha1: sha1(b) });
    }
    for (const buf of srcIslands) {
      const b = Buffer.from(buf);
      const id = nextId++, cx = b.readInt32LE(12) + dcx, cy = b.readInt32LE(16) + dcy;
      b.writeUInt32LE(id, 8);
      b.writeInt32LE(cx, 12);
      b.writeInt32LE(cy, 16);
      b.writeFloatLE(b.readFloatLE(20) + dcx * chunkM, 20);
      b.writeFloatLE(b.readFloatLE(24) + dcy * chunkM, 24);
      const file = `islands/i_${String(id).padStart(6, '0')}.bxi`;
      await writeFile(join(outDir, file), b);
      islands.push({ id, file, cx, cy, bricks: b.readUInt32LE(32), sha1: sha1(b) });
    }
  }
manifest.chunks = chunks;
manifest.islands = islands;
delete manifest.sample;
await writeFile(join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 1));
const bytes = [...srcChunks, ...srcIslands].reduce((s, b) => s + b.length, 0) * n * n;
console.log(`${outDir}: ${chunks.length} chunks, ${islands.length} islands, `
  + `${[...chunks, ...islands].reduce((s, c) => s + c.bricks, 0).toLocaleString()} bricks, ${(bytes / 1048576).toFixed(1)} MiB`);
