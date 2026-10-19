// Make a big synthetic world for viewer performance tests: copy every chunk of a world dir
// into an N x N grid of chunks (only the chunk header's cx/cy change).
// Usage: node tools/tile-world.mjs <srcWorld> <outWorld> [n=7]
// e.g.   node tools/tile-world.mjs ../build/testscene ../build/tiled7   (7x7 = 49 chunks)
import { mkdir, readFile, writeFile, copyFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';

const [src, out, nArg] = process.argv.slice(2);
if (!src || !out) throw new Error('usage: node tools/tile-world.mjs <srcWorld> <outWorld> [n]');
const n = Number(nArg ?? 7);
const srcDir = resolve(src), outDir = resolve(out);
const manifest = JSON.parse(await readFile(join(srcDir, 'manifest.json'), 'utf8'));
const files = manifest.chunks?.length ? manifest.chunks.map((c) => c.file)
  : (await readdir(join(srcDir, 'chunks'))).map((f) => `chunks/${f}`);
await mkdir(join(outDir, 'chunks'), { recursive: true });
for (const f of await readdir(srcDir)) if (f.endsWith('.json') && f !== 'manifest.json') await copyFile(join(srcDir, f), join(outDir, f));

const srcChunks = await Promise.all(files.map(async (f) => readFile(join(srcDir, f))));
const cx0 = Math.min(...srcChunks.map((b) => b.readInt32LE(8)));
const cy0 = Math.min(...srcChunks.map((b) => b.readInt32LE(12)));
const span = (key) => Math.max(...srcChunks.map((b) => b.readInt32LE(key))) - (key === 8 ? cx0 : cy0) + 1;
const sx = span(8), sy = span(12);
const half = Math.floor(n / 2);
const chunks = [];
for (let gy = 0; gy < n; gy++)
  for (let gx = 0; gx < n; gx++)
    for (const buf of srcChunks) {
      const b = Buffer.from(buf);
      const cx = b.readInt32LE(8) + (gx - half) * sx, cy = b.readInt32LE(12) + (gy - half) * sy;
      b.writeInt32LE(cx, 8);
      b.writeInt32LE(cy, 12);
      const file = `chunks/c_${cx}_${cy}.bxc`;
      await writeFile(join(outDir, file), b);
      chunks.push({ cx, cy, file, bricks: b.readUInt32LE(16), minK: b.readUInt16LE(20), maxK: b.readUInt16LE(22),
        sha1: createHash('sha1').update(b).digest('hex') });
    }
manifest.chunks = chunks;
await writeFile(join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 1));
console.log(`${outDir}: ${chunks.length} chunks, ${chunks.reduce((s, c) => s + c.bricks, 0)} bricks`);
