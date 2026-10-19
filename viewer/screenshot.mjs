// Serve dist/ on a tiny static server, render preset views in headless Chromium and save PNGs.
// Usage: node screenshot.mjs [outDir] [views=hero,map,facade] [extraHash e.g. "t=20"]
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { extname, join, resolve, dirname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const here = dirname(fileURLToPath(import.meta.url));
const dist = join(here, 'dist');
const outDir = resolve(process.argv[2] || join(here, '..', 'build', 'shots'));
const views = (process.argv[3] || 'hero,map,facade').split(',');
const extra = process.argv[4] ? `&${process.argv[4]}` : '';
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png' };

const server = createServer(async (req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^([/\\])+/, '');
  try {
    const body = await readFile(join(dist, path || 'index.html'));
    res.writeHead(200, { 'Content-Type': TYPES[extname(path)] || 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404); res.end('not found');
  }
});
await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
const base = `http://127.0.0.1:${server.address().port}/index.html?shot=1`;

const browser = await chromium.launch({
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--use-gl=angle'],
});
await mkdir(outDir, { recursive: true });
try {
  for (const view of views) {
    const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
    page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.log(`[${view}] ${m.text()}`); });
    page.on('pageerror', (e) => console.log(`[${view}] pageerror ${e.message}`));
    await page.goto(`${base}#view=${view}${extra}`);
    await page.waitForFunction(() => window.__bloxReady === true || window.__bloxError, null, { timeout: 180000 });
    const err = await page.evaluate(() => window.__bloxError);
    if (err) throw new Error(err);
    const file = join(outDir, `${view}${process.argv[4] ? '_' + process.argv[4].replace(/[^a-z0-9]+/gi, '_') : ''}.png`);
    const { url, ms } = await page.evaluate(() => window.__bloxCapture());
    await writeFile(file, Buffer.from(url.split(',')[1], 'base64'));
    console.log(`frame ${ms.toFixed(0)} ms`);
    console.log(`wrote ${file}`);
    await page.close();
  }
} finally {
  await browser.close();
  server.close();
}
