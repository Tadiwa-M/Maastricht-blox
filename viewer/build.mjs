// Build the viewer. Two outputs:
//
//   embed (default)  dist/{index.html, viewer.js, world.js}: the world dir base64-embedded in
//                    world.js (plus contract/models/*.json). Self-contained, works from file://.
//                    For small worlds, samples and the artifact.
//   --site <outDir>  a static web site that streams the world: outDir/{index.html, viewer.js,
//                    stream-worker.js, world.js (just window.BLOX_SITE)} and outDir/world/ with
//                    the world files (hard links when possible, else copies), index.json (stream
//                    index: chunk boxes, island world boxes), models.json, and far/ (whole-city
//                    baked far meshes, tools/bake-far.mjs). Serve it with any static server.
//
// Usage: node build.mjs [worldDir] [--site outDir] [--around markt|vrijthof|brug|station|bonnefanten|<cx>,<cy>] [--radius chunks]
// --around keeps only the chunks within --radius (default 3, i.e. 7x7 chunks = 224 m square) of a
// place (embed mode; a full 2x2 km world is too big for one embedded page).
import { build } from 'esbuild';
import { mkdir, readFile, readdir, writeFile, copyFile, link, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { placeChunk } from './src/places.js';
import { bakeFar } from './tools/bake-far.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const RELAY_URL = 'https://blox-relay.tmata1907.workers.dev'; // deployed by the owner, scripts/relay.ps1
const args = process.argv.slice(2);
const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args.splice(i, 2)[1] : undefined; };
const around = opt('--around');
const site = opt('--site');
const radius = Number(opt('--radius') ?? 3);
const worldDir = resolve(args[0] || join(here, '..', 'build', 'testscene'));

/** Chunk filter for --around, or null to embed everything. Places are RD points converted with
 * the world's own origin (src/places.js), so they work for any slice. */
function chunkFilter(manifest) {
  if (!around) return null;
  const chunkM = (manifest.chunkStuds || 64) * (manifest.studM || 0.5);
  const c = placeChunk(around, manifest.originRD || [175700, 316500], chunkM) ?? around.split(',').map(Number);
  if (c.length !== 2 || c.some(Number.isNaN)) throw new Error(`--around: unknown place '${around}'`);
  return (cx, cy) => Math.abs(cx - c[0]) <= radius && Math.abs(cy - c[1]) <= radius;
}
const dist = join(here, 'dist');

async function readJson(p) { return JSON.parse(await readFile(p, 'utf8')); }

/** Brick models (CONTRACT 7.1) from contract/models/*.json, keyed by file name. */
async function readModels() {
  const dir = join(here, '..', 'contract', 'models');
  const models = {};
  let files = [];
  try { files = (await readdir(dir)).filter((f) => f.endsWith('.json')); } catch { /* none yet */ }
  for (const f of files) models[f.replace(/\.json$/, '')] = await readJson(join(dir, f));
  console.log(`models: ${files.length ? Object.keys(models).join(', ') : 'none (viewer uses placeholders)'}`);
  return models;
}

/**
 * Life export of a world (`blox life --out <world>`, Track L): life/index.json lists its files
 * ({ files: { transit: 'transit.json', ... } }). Returns { names: [file names], data: { index,
 * transit, ... } } or null when the world has none.
 */
async function readLife() {
  const dir = join(worldDir, 'life');
  if (!existsSync(join(dir, 'index.json'))) return null;
  const index = await readJson(join(dir, 'index.json'));
  const data = { index }, names = ['index.json'];
  for (const [k, f] of Object.entries(index.files || {})) {
    if (!existsSync(join(dir, f))) { console.warn(`life: ${f} listed but missing`); continue; }
    data[k] = await readJson(join(dir, f));
    names.push(f);
  }
  return { names, data };
}

async function embedWorld() {
  const manifest = await readJson(join(worldDir, 'manifest.json'));
  const palette = await readJson(join(worldDir, manifest.palette || 'palette.json'));
  const catalogue = await readJson(join(worldDir, manifest.catalogue || 'brick_catalogue.json'));
  let features = { features: [] };
  try { features = await readJson(join(worldDir, manifest.features || 'features.json')); } catch { /* optional */ }
  let files = manifest.chunks?.length
    ? manifest.chunks.map((c) => c.file)
    : (await readdir(join(worldDir, 'chunks'))).filter((f) => f.endsWith('.bxc')).map((f) => `chunks/${f}`);
  const keep = chunkFilter(manifest);
  if (keep) {
    files = files.filter((f) => { const m = /c_(\d+)_(\d+)\.bxc$/.exec(f); return m && keep(+m[1], +m[2]); });
    if (manifest.chunks) manifest.chunks = manifest.chunks.filter((c) => keep(c.cx, c.cy));
    if (!files.length) throw new Error(`--around ${around}: no chunks in range`);
  }
  const chunks = {};
  let bytes = 0;
  for (const f of files) {
    const buf = await readFile(join(worldDir, f));
    bytes += buf.length;
    chunks[f.split('/').pop()] = buf.toString('base64');
  }
  // islands (CONTRACT 5.1): listed in the manifest; --around keeps those whose owning chunk is in range
  let islandList = manifest.islands || [];
  if (keep) islandList = manifest.islands = islandList.filter((e) => keep(e.cx, e.cy));
  const islands = {};
  let islandBytes = 0;
  for (const e of islandList) {
    const buf = await readFile(join(worldDir, e.file));
    islandBytes += buf.length;
    islands[e.file.split('/').pop()] = buf.toString('base64');
  }
  const models = await readModels();
  // the gallery shows the contract's catalogue, which may be newer than the world's copy
  const contract = {
    catalogue: await readJson(join(here, '..', 'contract', 'brick_catalogue.json')),
    palette: await readJson(join(here, '..', 'contract', 'palette.json')),
  };
  const life = await readLife(); // null = no life export (life/ then skips fetching)
  console.log(`life: ${life ? life.names.join(', ') : 'none'}`);
  const js = `window.BLOX_WORLD = ${JSON.stringify({ manifest, palette, catalogue, features, chunks, islands, models, contract, life: life?.data ?? null })};\n`;
  await writeFile(join(dist, 'world.js'), js);
  console.log(`world.js: ${files.length} chunks (${(bytes / 1024).toFixed(1)} KiB), ${islandList.length} islands `
    + `(${(islandBytes / 1024).toFixed(1)} KiB) from ${worldDir}`);
}

/**
 * esbuild plugin: the other tracks' entry modules (src/life/index.js, src/player/index.js) are
 * optional. When one doesn't exist yet the dynamic import in main.js gets an empty module.
 */
const optionalModules = {
  name: 'optional-modules',
  setup(b) {
    b.onResolve({ filter: /^\.\/(life|player)\/index\.js$/ }, (a) => {
      const path = join(a.resolveDir, a.path);
      return existsSync(path) ? { path } : { path: a.path, namespace: 'optional-empty' };
    });
    b.onLoad({ filter: /.*/, namespace: 'optional-empty' }, () => ({ contents: 'export {};', loader: 'js' }));
  },
};

async function bundle(out) {
  const common = { bundle: true, target: 'es2022', minify: true, sourcemap: false, logLevel: 'warning' };
  await build({ ...common, entryPoints: [join(here, 'src', 'main.js')], format: 'esm', outfile: join(out, 'viewer.js'), plugins: [optionalModules] });
  await build({ ...common, entryPoints: [join(here, 'src', 'stream-worker.js')], format: 'iife', outfile: join(out, 'stream-worker.js') });
  await copyFile(join(here, 'src', 'index.html'), join(out, 'index.html'));
  // title-screen key art (rendered from the city by tools/keyart.mjs)
  const art = join(here, 'src', 'title');
  if (existsSync(art)) {
    await mkdir(join(out, 'title'), { recursive: true });
    for (const f of await readdir(art)) if (/\.(jpe?g|webp)$/.test(f)) await copyFile(join(art, f), join(out, 'title', f));
  }
}

/** Short hash of the code commit (shown in reports), or '' outside a git checkout. */
function gitShort() {
  try { return execSync('git rev-parse --short HEAD', { cwd: here, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch { return ''; }
}

/** Hard link (fast, no extra disk) or copy when linking fails (other drive, Windows rules). */
async function place(src, dst) {
  await rm(dst, { force: true });
  try { await link(src, dst); } catch { await copyFile(src, dst); }
}

/** Static streaming site: see the header. */
async function buildSite(outDir) {
  const t0 = Date.now();
  await mkdir(outDir, { recursive: true });
  await bundle(outDir);
  const wdir = join(outDir, 'world');
  await rm(wdir, { recursive: true, force: true });
  await mkdir(join(wdir, 'chunks'), { recursive: true });
  await mkdir(join(wdir, 'islands'), { recursive: true });
  const manifest = await readJson(join(worldDir, 'manifest.json'));
  for (const f of ['manifest.json', manifest.palette || 'palette.json', manifest.catalogue || 'brick_catalogue.json', manifest.features || 'features.json']) {
    if (existsSync(join(worldDir, f))) await place(join(worldDir, f), join(wdir, f.replace(/^.*\//, '')));
  }
  if (!existsSync(join(wdir, 'features.json'))) await writeFile(join(wdir, 'features.json'), '{"features":[]}');
  const baked = await bakeFar(worldDir, wdir);
  let bytes = 0;
  for (const e of [...baked.chunks, ...baked.islands]) {
    await place(join(worldDir, e.file), join(wdir, e.file));
    bytes += e.bytes;
  }
  const index = {
    version: 1, studM: manifest.studM || 0.5, plateM: manifest.plateM || 0.2, chunkStuds: manifest.chunkStuds || 64,
    chunksX: manifest.chunksX || 64, chunksY: manifest.chunksY || 64,
    originRD: manifest.originRD || [175700, 316500],
    chunks: baked.chunks.map(({ cx, cy, file, minK, maxK, bytes: b }) => ({ cx, cy, file, minK, maxK, bytes: b })),
    islands: baked.islands.map(({ id, file, cx, cy, rect, minK, maxK, bytes: b }) => ({ id, file, cx, cy, rect: rect.map((v) => +v.toFixed(2)), minK, maxK, bytes: b })),
  };
  await writeFile(join(wdir, 'index.json'), JSON.stringify(index));
  const contract = {
    catalogue: await readJson(join(here, '..', 'contract', 'brick_catalogue.json')),
    palette: await readJson(join(here, '..', 'contract', 'palette.json')),
  };
  await writeFile(join(wdir, 'models.json'), JSON.stringify({ models: await readModels(), contract }));
  const life = await readLife();
  if (life) {
    await mkdir(join(wdir, 'life'), { recursive: true });
    for (const f of life.names) await place(join(worldDir, 'life', f), join(wdir, 'life', f));
  }
  console.log(`life: ${life ? life.names.join(', ') : 'none'}`);
  // life: whether world/life/ exists, so the page doesn't fetch (and 404) when it doesn't
  // relay: the Cloudflare Worker for live buses and map reports (relay/README.md); BLOX_RELAY
  // overrides the deployed one, BLOX_RELAY=none builds without (PowerShell can't set an empty variable)
  const relayEnv = process.env.BLOX_RELAY;
  const siteCfg = { base: 'world/', life: !!life, relay: relayEnv === 'none' ? '' : relayEnv || RELAY_URL, build: gitShort(),
    originRD: index.originRD || null };
  await writeFile(join(outDir, 'world.js'), `window.BLOX_SITE = ${JSON.stringify(siteCfg)};\n`);
  console.log(`site: ${index.chunks.length} chunks + ${index.islands.length} islands (${(bytes / 1048576).toFixed(1)} MiB) `
    + `from ${worldDir} -> ${outDir} in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
}

if (site) {
  await buildSite(resolve(site));
} else {
  await mkdir(dist, { recursive: true });
  await bundle(dist);
  await embedWorld();
  console.log(`built ${dist}`);
}
