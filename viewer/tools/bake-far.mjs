// Bake the whole-city silhouette: far/l<N>/r_X_Y.bin per detail level and region of R x R
// chunks, plus far/index.json (src/farbake.js has the method and the file format). Run by
// `build.mjs --site`; standalone:
//   node tools/bake-far.mjs <worldDir> <outDir> [--region 8]
// writes <outDir>/far/. Also returns chunk facts and the islands' world boxes for the stream index.
//
// Levels (cell = studs x studs x plates): 1 = 2x2x3 (1 m x 0.6 m), 2 = 4x4x5 (2 m x 1 m),
// 3 = 8x8x10 (4 m x 2 m). The viewer keeps level 3 of the whole city resident and streams the
// finer levels by distance (src/farregion.js). Measured on samples/markt_v3 (49 dense chunks +
// 40 islands): 142k / 44k / 13k triangles.
export const LEVELS = [{ level: 1, cellStuds: 2, cellPlates: 3 }, { level: 2, cellStuds: 4, cellPlates: 5 }, { level: 3, cellStuds: 8, cellPlates: 10 }];
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { deflateRawSync } from 'node:zlib';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseBxc } from '../src/bxc.js';
import { parseBxi } from '../src/bxi.js';
import { rotatedExtent } from '../src/rotation.js';
import { classOf } from '../src/matkey.js';
import { bakeRegion, encodeBxf } from '../src/farbake.js';

const DEG = Math.PI / 180;
const readJson = async (p) => JSON.parse(await readFile(p, 'utf8'));

/** World files of a world dir: { manifest, palette, catalogue, chunks: [{cx, cy, file}], islands: [{id, file, cx, cy}] }. */
export async function worldFiles(worldDir) {
  const manifest = await readJson(join(worldDir, 'manifest.json'));
  const palette = await readJson(join(worldDir, manifest.palette || 'palette.json'));
  const catalogue = await readJson(join(worldDir, manifest.catalogue || 'brick_catalogue.json'));
  let chunks = manifest.chunks;
  if (!chunks?.length) {
    const names = (await readdir(join(worldDir, 'chunks'))).filter((f) => f.endsWith('.bxc'));
    chunks = names.map((f) => { const m = /c_(-?\d+)_(-?\d+)\.bxc$/.exec(f); return { cx: +m[1], cy: +m[2], file: `chunks/${f}` }; });
  }
  return { manifest, palette, catalogue, chunks, islands: manifest.islands || [] };
}

/** Local cell (u, v) metres -> Unity [x, z] (CONTRACT 5.1). */
function poseFn(h) {
  const s = Math.sin(h.yawDeg * DEG), c = Math.cos(h.yawDeg * DEG);
  return (u, v) => [h.originX + u * c + v * s, h.originZ - u * s + v * c];
}

function recordBounds(rec, n, types) {
  const b = { I0: Infinity, J0: Infinity, K0: Infinity, I1: -Infinity, J1: -Infinity, K1: -Infinity };
  for (let q = 0; q < n; q++) {
    const t = types.get(rec.type[q]);
    if (!t) continue;
    const [ei, ej] = rotatedExtent(t.w, t.d, rec.rotFlags[q] & 3);
    b.I0 = Math.min(b.I0, rec.i[q]); b.I1 = Math.max(b.I1, rec.i[q] + ei);
    b.J0 = Math.min(b.J0, rec.j[q]); b.J1 = Math.max(b.J1, rec.j[q] + ej);
    b.K0 = Math.min(b.K0, rec.k[q]); b.K1 = Math.max(b.K1, rec.k[q] + t.h);
  }
  return b;
}

/** Ground level of a chunk: the top height covering the largest area (as World.groundK). */
function groundK(rec, n, types) {
  const top = new Map();
  for (let q = 0; q < n; q++) {
    const t = types.get(rec.type[q]);
    if (!t) continue;
    const [ei, ej] = rotatedExtent(t.w, t.d, rec.rotFlags[q] & 3);
    for (let dj = 0; dj < ej; dj++) for (let di = 0; di < ei; di++) {
      const col = rec.i[q] + di + 64 * (rec.j[q] + dj), k = rec.k[q] + t.h;
      if (!(top.get(col) >= k)) top.set(col, k);
    }
  }
  const area = new Map();
  for (const k of top.values()) area.set(k, (area.get(k) || 0) + 1);
  let best = null, bestA = -1;
  for (const [k, a] of area) if (a > bestA) { best = k; bestA = a; }
  return best;
}

export async function bakeFar(worldDir, outDir, { regionChunks = 8, levels = LEVELS, log = console.log } = {}) {
  const t0 = Date.now();
  const wf = await worldFiles(worldDir);
  const S = wf.manifest.studM || 0.5, CS = wf.manifest.chunkStuds || 64;
  const types = new Map(wf.catalogue.types.map((t) => [t.id, t]));
  const palette = new Map(wf.palette.entries.map((e) => [e.idx, e]));
  const glassIdx = wf.palette.entries.find((e) => classOf(e) === 'glass')?.idx ?? 0;
  const extent = (t, rot) => rotatedExtent(t.w, t.d, rot);

  // every file, parsed once (records are typed arrays: ~13 B per brick)
  const chunks = new Map();
  for (const c of wf.chunks) {
    const { header: h, records } = await parseBxc(new Uint8Array(await readFile(join(worldDir, c.file))));
    if (!h.brickCount) continue;
    const I0 = h.cx * CS, J0 = h.cy * CS;
    const I = new Int32Array(h.brickCount), J = new Int32Array(h.brickCount);
    for (let q = 0; q < h.brickCount; q++) { I[q] = I0 + records.i[q]; J[q] = J0 + records.j[q]; }
    chunks.set(`${h.cx},${h.cy}`, { cx: h.cx, cy: h.cy, file: c.file, bytes: h.bodyBytes + 32, minK: h.minK, maxK: h.maxK,
      ground: groundK(records, h.brickCount, types),
      bricks: { count: h.brickCount, I, J, K: records.k, type: records.type, color: records.color, rotFlags: records.rotFlags } });
  }
  const islands = [];
  for (const e of wf.islands) {
    const bytes = new Uint8Array(await readFile(join(worldDir, e.file)));
    const { header: h, records } = await parseBxi(bytes);
    if (!h.brickCount) continue;
    const b = recordBounds(records, h.brickCount, types);
    const toUnity = poseFn(h);
    const rect = [Infinity, Infinity, -Infinity, -Infinity]; // Unity metres x0, z0, x1, z1
    for (const [u, v] of [[b.I0, b.J0], [b.I1, b.J0], [b.I0, b.J1], [b.I1, b.J1]]) {
      const [x, z] = toUnity(u * S, v * S);
      rect[0] = Math.min(rect[0], x); rect[1] = Math.min(rect[1], z); rect[2] = Math.max(rect[2], x); rect[3] = Math.max(rect[3], z);
    }
    islands.push({ id: h.islandId, file: e.file, cx: h.cx, cy: h.cy, bytes: bytes.length, rect, minK: b.K0, maxK: b.K1,
      toWorld: (u, v) => { const [x, z] = toUnity(u * S, v * S); return [x / S, z / S]; },
      bricks: { count: h.brickCount, I: records.i, J: records.j, K: records.k, type: records.type, color: records.color, rotFlags: records.rotFlags } });
  }
  const voteColor = (b) => (n) => {
    const kind = types.get(b.type[n])?.kind;
    return (kind === 'window' || kind === 'door') && glassIdx ? glassIdx : b.color[n];
  };

  const regions = new Map();
  const rkey = (cx, cy) => `${Math.floor(cx / regionChunks)},${Math.floor(cy / regionChunks)}`;
  for (const c of chunks.values()) { const k = rkey(c.cx, c.cy); if (!regions.has(k)) regions.set(k, { chunks: [], islands: [] }); regions.get(k).chunks.push(c); }
  for (const i of islands) { const k = rkey(i.cx, i.cy); if (!regions.has(k)) regions.set(k, { chunks: [], islands: [] }); regions.get(k).islands.push(i); }

  const index = { version: 1, regionChunks, chunkStuds: CS, studM: S, plateM: wf.manifest.plateM || 0.2, levels: [] };
  for (const { level, cellStuds, cellPlates } of levels) {
  await mkdir(join(outDir, 'far', `l${level}`), { recursive: true });
  const lv = { level, cellStuds, cellPlates, regions: [] };
  index.levels.push(lv);
  let quads = 0, bytesOut = 0;
  const tl = Date.now();
  for (const [k, reg] of regions) {
    const [rx, ry] = k.split(',').map(Number);
    // extent in world cells: the region, grown by its own islands, plus one coarse cell
    let I0 = rx * regionChunks * CS, J0 = ry * regionChunks * CS, I1 = I0 + regionChunks * CS, J1 = J0 + regionChunks * CS;
    for (const i of reg.islands) {
      I0 = Math.min(I0, Math.floor(i.rect[0] / S)); J0 = Math.min(J0, Math.floor(i.rect[1] / S));
      I1 = Math.max(I1, Math.ceil(i.rect[2] / S)); J1 = Math.max(J1, Math.ceil(i.rect[3] / S));
    }
    const box = { gi0: Math.floor(I0 / cellStuds) - 1, gj0: Math.floor(J0 / cellStuds) - 1, gi1: Math.ceil(I1 / cellStuds) + 1, gj1: Math.ceil(J1 / cellStuds) + 1 };
    const inBox = (a0, b0, a1, b1) => a1 > box.gi0 * cellStuds && a0 < box.gi1 * cellStuds && b1 > box.gj0 * cellStuds && b0 < box.gj1 * cellStuds;
    const ctxChunks = [...chunks.values()].filter((c) => inBox(c.cx * CS, c.cy * CS, (c.cx + 1) * CS, (c.cy + 1) * CS));
    const ctxIslands = islands.filter((i) => inBox(i.rect[0] / S, i.rect[1] / S, i.rect[2] / S, i.rect[3] / S));
    let K0 = Infinity, K1 = -Infinity;
    for (const x of [...ctxChunks, ...ctxIslands]) { K0 = Math.min(K0, x.minK); K1 = Math.max(K1, x.maxK); }
    box.gk0 = Math.floor(K0 / cellPlates) - 1; box.gk1 = Math.ceil(K1 / cellPlates) + 1;
    // owners: the region's chunks, plus owning chunks of its islands that have no chunk file
    const owners = [], ownerOf = new Map();
    const own = (cx, cy) => { const key = `${cx},${cy}`; if (!ownerOf.has(key)) { owners.push({ cx, cy }); ownerOf.set(key, owners.length); } return ownerOf.get(key); };
    for (const c of reg.chunks) own(c.cx, c.cy);
    for (const i of reg.islands) own(i.cx, i.cy);
    const sources = [
      ...ctxChunks.map((c) => ({ bricks: c.bricks, types, extent, voteColor: voteColor(c.bricks), owner: ownerOf.get(`${c.cx},${c.cy}`) && reg.chunks.includes(c) ? ownerOf.get(`${c.cx},${c.cy}`) : 0 })),
      ...ctxIslands.map((i) => ({ bricks: i.bricks, types, extent, voteColor: voteColor(i.bricks), toWorld: i.toWorld, owner: reg.islands.includes(i) ? ownerOf.get(`${i.cx},${i.cy}`) : 0 })),
    ];
    const r = bakeRegion({ rx, ry, box, sources, owners, palette, cellStuds, cellPlates });
    const bytes = encodeBxf(r, (b) => new Uint8Array(deflateRawSync(b, { level: 9 })));
    const file = `far/l${level}/r_${rx}_${ry}.bin`;
    await writeFile(join(outDir, file), bytes);
    quads += r.quads.length; bytesOut += bytes.length;
    lv.regions.push({ rx, ry, file, quads: r.quads.length, bytes: bytes.length });
  }
  log(`far bake level ${level} (${cellStuds}x${cellStuds}x${cellPlates}): ${lv.regions.length} regions, `
    + `${(quads * 2).toLocaleString()} triangles, ${(bytesOut / 1048576).toFixed(2)} MiB, ${((Date.now() - tl) / 1000).toFixed(1)} s`);
  }
  // per-chunk ground level (K) for cameras and spawns: [cx, cy, K]
  index.ground = [...chunks.values()].map((c) => [c.cx, c.cy, c.ground]);
  await writeFile(join(outDir, 'far', 'index.json'), JSON.stringify(index));
  log(`far bake: ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  return {
    index,
    chunks: [...chunks.values()].map(({ cx, cy, file, bytes, minK, maxK }) => ({ cx, cy, file, bytes, minK, maxK })),
    islands: islands.map(({ id, file, cx, cy, bytes, rect, minK, maxK }) => ({ id, file, cx, cy, bytes, rect, minK, maxK })),
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const opt = (name, d) => { const i = args.indexOf(name); return i >= 0 ? Number(args.splice(i, 2)[1]) : d; };
  const regionChunks = opt('--region', 8);
  const [world, out] = args;
  if (!world || !out) throw new Error('usage: node tools/bake-far.mjs <worldDir> <outDir> [--region 8]');
  await bakeFar(resolve(world), resolve(out), { regionChunks });
}
