// Figure design sheets (src/figure/sheet.js) rendered headless:
//   build/shots/figures/sheet.png  12 variants, front + three-quarter, brick floor and a door
//   build/shots/figures/poses.png  walk, idle, browse at a stall, sitting at a cafe table,
//                                  cycling, parked bike, kid, older person
// Usage: node tools/figure-sheet.mjs [outDir] [figures|poses ...]
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname, extname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { chromium } from 'playwright';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const outDir = resolve(process.argv[2] || join(root, 'build', 'shots', 'figures'));
const kinds = process.argv.slice(3).length ? process.argv.slice(3) : ['figures', 'poses'];
const tmp = await mkdtemp(join(tmpdir(), 'blox-sheet-'));
const entry = join(tmp, 'entry.js');
await writeFile(entry, `import { renderSheet } from ${JSON.stringify(join(here, '..', 'src', 'figure', 'sheet.js'))};
window.renderSheet = (kind, contract) => {
  const palette = new Map(contract.palette.entries.map((e) => [e.idx, e]));
  const types = new Map(contract.catalogue.types.map((t) => [t.id, t]));
  return renderSheet(document.getElementById('c'), { palette, types }, kind);
};`);
await build({ entryPoints: [entry], bundle: true, format: 'esm', outfile: join(tmp, 'sheet.js'), logLevel: 'warning',
  nodePaths: [join(here, '..', 'node_modules')] });
await writeFile(join(tmp, 'index.html'), '<!doctype html><meta charset="utf-8"><body style="margin:0;background:#dfe3e8"><canvas id="c"></canvas><script type="module" src="sheet.js"></script>');
const contract = {
  palette: JSON.parse(await readFile(join(root, 'contract', 'palette.json'), 'utf8')),
  catalogue: JSON.parse(await readFile(join(root, 'contract', 'brick_catalogue.json'), 'utf8')),
};
const server = createServer(async (req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^([/\\])+/, '');
  try {
    const body = await readFile(join(tmp, path || 'index.html'));
    res.writeHead(200, { 'Content-Type': extname(path) === '.js' ? 'text/javascript' : 'text/html' }); res.end(body);
  } catch { res.writeHead(404); res.end(); }
});
await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--use-gl=angle'] });
await mkdir(outDir, { recursive: true });
try {
  for (const kind of kinds) {
    const page = await browser.newPage({ viewport: { width: 1200, height: 600 } });
    page.on('pageerror', (e) => console.log(`pageerror ${e.message}`));
    page.on('console', (m) => { if (m.type() === 'error') console.log(m.text()); });
    await page.goto(`http://127.0.0.1:${server.address().port}/index.html`);
    await page.waitForFunction(() => window.renderSheet, null, { timeout: 60000 });
    const stats = await page.evaluate(([k, c]) => window.renderSheet(k, c), [kind, contract]);
    const url = await page.evaluate(() => document.getElementById('c').toDataURL('image/png'));
    const file = join(outDir, kind === 'figures' ? 'sheet.png' : `${kind}.png`);
    await writeFile(file, Buffer.from(url.split(',')[1], 'base64'));
    console.log(`wrote ${file} ${JSON.stringify(stats)}`);
    await page.close();
  }
} finally { await browser.close(); server.close(); }
