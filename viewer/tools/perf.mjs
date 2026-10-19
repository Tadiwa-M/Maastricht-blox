// Load dist/ in headless Chromium and report what one frame costs: draw calls and triangles
// from renderer.info (all passes: shadow, AO normals, main), plus brick/stud counts and load time.
// Usage: node tools/perf.mjs [views=hero,map] [extraHash e.g. "quality=high"]
// SwiftShader fps means nothing; the triangle and draw-call counts are what transfer to a GPU.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, dirname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const dist = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist');
const views = (process.argv[2] || 'hero').split(',');
const extra = process.argv[3] ? `&${process.argv[3]}` : '';
const TYPES = { '.html': 'text/html', '.js': 'text/javascript' };
const server = createServer(async (req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^([/\\])+/, '');
  try {
    const body = await readFile(join(dist, path || 'index.html'));
    res.writeHead(200, { 'Content-Type': TYPES[extname(path)] || 'application/octet-stream' });
    res.end(body);
  } catch { res.writeHead(404); res.end(); }
});
await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
const browser = await chromium.launch({
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--use-gl=angle'],
});
try {
  for (const view of views) {
    const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
    page.on('pageerror', (e) => console.log(`[${view}] pageerror ${e.message}`));
    const t0 = Date.now();
    await page.goto(`http://127.0.0.1:${server.address().port}/index.html?shot=1#view=${view}${extra}`);
    await page.waitForFunction(() => window.__bloxReady === true || window.__bloxError, null, { timeout: 1800000 });
    const err = await page.evaluate(() => window.__bloxError);
    if (err) throw new Error(err);
    const s = await page.evaluate(() => {
      const b = window.__blox;
      const info = b.stage.renderer.info.render;
      return { calls: info.calls, triangles: info.triangles, bricks: b.built.bricks, studs: b.built.studs,
        tier: b.quality?.describe?.() ?? null, lod: b.lod?.stats?.() ?? null };
    });
    console.log(`${view}${extra}: ${JSON.stringify(s)} (ready after ${((Date.now() - t0) / 1000).toFixed(1)} s)`);
    await page.close();
  }
} finally {
  await browser.close();
  server.close();
}
