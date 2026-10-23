// Load dist/ (or a site build: --site <dir>) in headless Chromium and report what one frame
// costs: draw calls and triangles from renderer.info (all passes: shadow, AO normals, main),
// streaming/LOD state, load times and memory.
// Usage: node tools/perf.mjs [views=hero,map] [extraHash e.g. "quality=high"] [--site ../build/site]
// SwiftShader fps means nothing; triangles, draw calls, load time and memory are what transfer.
//   load    ms from page start to the whole-city silhouette (site) / first frame, and to
//           "ready" (every wanted chunk/island streamed and near looks built)
//   memory  after a forced full GC (CDP): V8 heap, ArrayBuffer backing stores (typed arrays:
//           records, solid maps, vertex arrays not yet on the GPU), GPU geometries/textures
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { serve, siteArg } from './serve.mjs';

const argv = process.argv.slice(2);
const root = siteArg(argv, join(dirname(fileURLToPath(import.meta.url)), '..', 'dist'));
const views = (argv[0] || 'hero').split(',');
const extra = argv[1] ? `&${argv[1]}` : '';
const { server, url } = await serve(root);
const browser = await chromium.launch({
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--use-gl=angle', '--enable-precise-memory-info'],
});
try {
  for (const view of views) {
    const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
    page.on('pageerror', (e) => console.log(`[${view}] pageerror ${e.message}`));
    page.on('console', (m) => { if (m.type() === 'error') console.log(`[${view}] ${m.text()}`); });
    const t0 = Date.now();
    await page.goto(`${url}index.html?shot=1#view=${view}${extra}`);
    await page.waitForFunction(() => window.__bloxReady === true || window.__bloxError, null, { timeout: 1800000 });
    const err = await page.evaluate(() => window.__bloxError);
    if (err) throw new Error(err);
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('HeapProfiler.enable');
    await cdp.send('HeapProfiler.collectGarbage');
    const heap = await cdp.send('Runtime.getHeapUsage');
    const s = await page.evaluate(() => {
      const b = window.__blox;
      const info = b.stage.renderer.info;
      return { calls: info.render.calls, triangles: info.render.triangles, studs: b.built.studs,
        tier: b.quality?.describe?.() ?? null, lod: b.lod?.stats?.() ?? null, times: window.__bloxTimes ?? null,
        geometries: info.memory.geometries, textures: info.memory.textures };
    });
    s.heapMiB = +(heap.usedSize / 1048576).toFixed(1);
    s.buffersMiB = +(heap.backingStorageSize / 1048576).toFixed(1);
    console.log(`${view}${extra}: ${JSON.stringify(s)} (ready after ${((Date.now() - t0) / 1000).toFixed(1)} s)`);
    await page.close();
  }
} finally {
  await browser.close();
  server.close();
}
