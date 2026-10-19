// Build the viewer: bundle src/ (three included) to dist/viewer.js, embed a world dir as
// dist/world.js and copy dist/index.html.  Usage: node build.mjs [worldDir]
import { build } from 'esbuild';
import { mkdir, readFile, readdir, writeFile, copyFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const worldDir = resolve(process.argv[2] || join(here, '..', 'build', 'testscene'));
const dist = join(here, 'dist');

async function readJson(p) { return JSON.parse(await readFile(p, 'utf8')); }

async function embedWorld() {
  const manifest = await readJson(join(worldDir, 'manifest.json'));
  const palette = await readJson(join(worldDir, manifest.palette || 'palette.json'));
  const catalogue = await readJson(join(worldDir, manifest.catalogue || 'brick_catalogue.json'));
  let features = { features: [] };
  try { features = await readJson(join(worldDir, manifest.features || 'features.json')); } catch { /* optional */ }
  const files = manifest.chunks?.length
    ? manifest.chunks.map((c) => c.file)
    : (await readdir(join(worldDir, 'chunks'))).filter((f) => f.endsWith('.bxc')).map((f) => `chunks/${f}`);
  const chunks = {};
  let bytes = 0;
  for (const f of files) {
    const buf = await readFile(join(worldDir, f));
    bytes += buf.length;
    chunks[f.split('/').pop()] = buf.toString('base64');
  }
  const js = `window.BLOX_WORLD = ${JSON.stringify({ manifest, palette, catalogue, features, chunks })};\n`;
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
