// Serve dist/ (or a site build: --site <dir>) on a tiny static server, render preset views in
// headless Chromium and save PNGs.
// Usage: node screenshot.mjs [outDir] [views=hero,map,facade] [extraHash e.g. "t=20"] [--site ../build/site]
// Views are any #view= preset (city mode: city, hero, street, map, markt, ...).
import { writeFile, mkdir } from 'node:fs/promises';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { serve, siteArg } from './tools/serve.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const root = siteArg(argv, join(here, 'dist'));
const outDir = resolve(argv[0] || join(here, '..', 'build', 'shots'));
const views = (argv[1] || 'hero,map,facade').split(',');
const extra = argv[2] ? `&${argv[2]}` : '';
const { server, url } = await serve(root);
const base = `${url}index.html?shot=1`;

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
    await page.waitForFunction(() => window.__bloxReady === true || window.__bloxError, null, { timeout: 600000 });
    const err = await page.evaluate(() => window.__bloxError);
    if (err) throw new Error(err);
    const file = join(outDir, `${view}${argv[2] ? '_' + argv[2].replace(/[^a-z0-9]+/gi, '_') : ''}.png`);
    const { url: png, ms } = await page.evaluate(() => window.__bloxCapture());
    await writeFile(file, Buffer.from(png.split(',')[1], 'base64'));
    console.log(`frame ${ms.toFixed(0)} ms`);
    console.log(`wrote ${file}`);
    await page.close();
  }
} finally {
  await browser.close();
  server.close();
}
