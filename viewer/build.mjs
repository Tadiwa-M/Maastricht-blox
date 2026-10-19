// Build the viewer: bundle src/ (three included) to dist/viewer.js, embed a world dir as
// dist/world.js (plus contract/models/*.json brick models) and copy dist/index.html.
// Usage: node build.mjs [worldDir] [--around markt|vrijthof|brug|station|bonnefanten|<cx>,<cy>] [--radius chunks]
// A full 2x2 km world is too big for one browser page: --around embeds only the chunks within
// --radius (default 3, i.e. 7x7 chunks = 224 m square) of a place.
import { build } from 'esbuild';
import { mkdir, readFile, readdir, writeFile, copyFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args.splice(i, 2)[1] : undefined; };
const around = opt('--around');
const radius = Number(opt('--radius') ?? 3);
const worldDir = resolve(args[0] || join(here, '..', 'build', 'testscene'));

// Places in chunk coordinates: chunk = floor((RD - origin) / 32 m), origin RD (175700, 316500).
const PLACES = { markt: [22, 47], vrijthof: [15, 38], brug: [32, 40], station: [53, 40], bonnefanten: [41, 18] };

/** Chunk filter for --around, or null to embed everything. */
function chunkFilter() {
  if (!around) return null;
  const c = PLACES[around.toLowerCase()] ?? around.split(',').map(Number);
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

async function embedWorld() {
  const manifest = await readJson(join(worldDir, 'manifest.json'));
  const palette = await readJson(join(worldDir, manifest.palette || 'palette.json'));
  const catalogue = await readJson(join(worldDir, manifest.catalogue || 'brick_catalogue.json'));
  let features = { features: [] };
  try { features = await readJson(join(worldDir, manifest.features || 'features.json')); } catch { /* optional */ }
  let files = manifest.chunks?.length
    ? manifest.chunks.map((c) => c.file)
    : (await readdir(join(worldDir, 'chunks'))).filter((f) => f.endsWith('.bxc')).map((f) => `chunks/${f}`);
  const keep = chunkFilter();
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
  const models = await readModels();
  // the gallery shows the contract's catalogue, which may be newer than the world's copy
  const contract = {
    catalogue: await readJson(join(here, '..', 'contract', 'brick_catalogue.json')),
    palette: await readJson(join(here, '..', 'contract', 'palette.json')),
  };
  const js = `window.BLOX_WORLD = ${JSON.stringify({ manifest, palette, catalogue, features, chunks, models, contract })};\n`;
  await writeFile(join(dist, 'world.js'), js);
  console.log(`world.js: ${files.length} chunks (${(bytes / 1024).toFixed(1)} KiB) from ${worldDir}`);
}

await mkdir(dist, { recursive: true });
await build({
  entryPoints: [join(here, 'src', 'main.js')],
  bundle: true,
  format: 'esm',
  target: 'es2022',
  minify: true,
  sourcemap: false,
  outfile: join(dist, 'viewer.js'),
  logLevel: 'warning',
});
await copyFile(join(here, 'src', 'index.html'), join(dist, 'index.html'));
await embedWorld();
console.log(`built ${dist}`);
