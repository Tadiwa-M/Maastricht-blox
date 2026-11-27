// Street-life audit of the running game: loads a city site, stands the camera at a few places,
// runs the life simulation for a while (no rendering needed: window.__bloxLife.step) and counts
// what looks broken (src/life/audit.js): people through people, people inside vehicles, people on
// roofs, bikes and cars inside buses, cars through cars. Prints the average per snapshot.
// Usage: node tools/life-audit.mjs --url <site> | --site <dir> [--places markt,vrijthof,station] [--seconds 60]
//        [--quality high] (the crowd size of that quality tier)
// BLOX_CHROMIUM overrides the browser binary (as screenshot.mjs).
import { chromium } from 'playwright';
import { serve, siteArg } from './serve.mjs';

const argv = process.argv.slice(2);
const opt = (f, d) => { const i = argv.indexOf(f); if (i < 0) return d; const v = argv[i + 1]; argv.splice(i, 2); return v; };
const live = opt('--url', null), quality = opt('--quality', 'high'), places = opt('--places', 'markt,vrijthof,station').split(','), seconds = +opt('--seconds', 60);
const root = live ? null : siteArg(argv, null);
if (!root && !live) throw new Error('--url <site> or --site <dir> is required');
const { server, url } = live ? { server: null, url: live.endsWith('/') ? live : `${live}/` } : await serve(root);
const browser = await chromium.launch({ executablePath: process.env.BLOX_CHROMIUM || undefined,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const total = {};
try {
  for (const place of places) {
    const p = await browser.newPage({ viewport: { width: 640, height: 360 } });
    p.on('pageerror', (e) => console.log(`[${place}] ${e.message}`));
    await p.goto(`${url}index.html#view=${place}&t=13&quality=${quality}`);
    await p.waitForFunction(() => window.__bloxLife?.ready && window.__blox?.city, null, { timeout: 300000 });
    // street level at the place, and wait for its streets to stream in
    await p.evaluate(() => { const { controls, stage } = window.__blox; const t = controls.target; stage.camera.position.set(t.x + 25, t.y + 30, t.z + 25); controls.update(); });
    for (let i = 0; i < 40; i++) {
      await p.waitForTimeout(3000);
      if (await p.evaluate(() => window.__blox.lod.stats().stream.inflight === 0 && window.__blox.lod.stats().stream.loaded > 30)) break;
    }
    const sums = {};
    let n = 0;
    for (let s = 0; s < seconds; s++) {
      const a = await p.evaluate(() => { const L = window.__bloxLife; for (let q = 0; q < 10; q++) L.step(0.1); return L.audit(); });
      for (const [k, v] of Object.entries(a)) sums[k] = (sums[k] || 0) + v;
      n++;
    }
    const avg = Object.fromEntries(Object.entries(sums).map(([k, v]) => [k, +(v / n).toFixed(2)]));
    console.log(`${place}: ${JSON.stringify(avg)}`);
    for (const [k, v] of Object.entries(avg)) total[k] = +((total[k] || 0) + v / places.length).toFixed(2);
    await p.close();
  }
  console.log(`average: ${JSON.stringify(total)}`);
} finally {
  await browser.close();
  server?.close();
}
