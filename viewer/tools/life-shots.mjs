// City-life screenshots: serve a built viewer dist (embed build of a world with a life/ export,
// e.g. the synthetic one from `python -m blox_pipeline.life.sample`), set the clock and
// cameras, capture PNGs and print life stats, draw calls and the JS cost of one life step.
// Usage: node tools/life-shots.mjs <distDir> <outDir> "<hash>" <name:cx,cy,cz,tx,ty,tz | name:bus>...
//   cx..tz: three.js camera position and target, y relative to the world's ground level.
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { chromium } from 'playwright';

const [distArg, outArg, hash = 't=11&day=wed', ...views] = process.argv.slice(2);
if (!distArg || !outArg) { console.error('usage: node tools/life-shots.mjs <distDir> <outDir> "<hash>" name:cx,cy,cz,tx,ty,tz ...'); process.exit(2); }
const dist = resolve(distArg), outDir = resolve(outArg);
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json' };
const server = createServer(async (req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^([/\\])+/, '');
  try { const body = await readFile(join(dist, path || 'index.html')); res.writeHead(200, { 'Content-Type': TYPES[extname(path)] || 'application/octet-stream' }); res.end(body); } catch { res.writeHead(404); res.end(); }
});
await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--use-gl=angle'] });
await mkdir(outDir, { recursive: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
page.on('pageerror', (e) => console.log(`pageerror ${e.message}`));
page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) console.log(`[console] ${m.text()}`); });
const stats = () => page.evaluate(() => {
  const L = window.__bloxLife, info = window.__blox.stage.renderer?.info?.render;
  const t0 = performance.now();
  for (let q = 0; q < 10; q++) L.step(1 / 30);
  const stepMs = (performance.now() - t0) / 10;
  return { clock: L.clock.label(), ...L.stats, buses: L.buses?.stats, stepMs: +stepMs.toFixed(2), drawCallsFrame: info?.calls, triangles: info?.triangles };
});
try {
  await page.goto(`http://127.0.0.1:${server.address().port}/index.html?shot=1#${hash}`);
  await page.waitForFunction(() => (window.__bloxReady && window.__bloxLife?.ready) || window.__bloxError, null, { timeout: 300000 });
  const err = await page.evaluate(() => window.__bloxError);
  if (err) throw new Error(err);
  for (const v of views) {
    const [name, nums] = v.split(':');
    await page.evaluate(([nums]) => {
      const { stage, controls, lod } = window.__blox, L = window.__bloxLife;
      if (nums === 'bus') { // the timetable bus nearest the current view, from 14 m ahead-left, 2.5 m up
        const t = controls.target, ps = L.buses.poses(L.clock);
        const b = ps.sort((p, q) => Math.hypot(p.x - t.x, p.z + t.z) - Math.hypot(q.x - t.x, q.z + t.z))[0]; // nearest to the view
        const r = (b.yaw * Math.PI) / 180, fx = Math.sin(r), fz = Math.cos(r);
        stage.camera.position.set(b.x + fx * 14 - fz * 6, b.y + 2.5, -(b.z + fz * 14 + fx * 6));
        controls.target.set(b.x, b.y + 1.5, -b.z);
      } else {
        const [cx, cy, cz, tx, ty, tz] = nums.split(',').map(Number);
        const g = window.__blox.world ? window.__blox.world.groundK * 0.2 : window.__blox.city.approxGround(tx, tz);
        stage.camera.position.set(cx, g + cy, cz); controls.target.set(tx, g + ty, tz);
      }
      stage.camera.lookAt(controls.target); stage.camera.updateMatrixWorld();
      lod.settle?.(stage.camera);
      for (let q = 0; q < 30; q++) L.step(1 / 15); // let people re-spawn around the new target and walk a bit
      L.step(0);
    }, [nums]);
    const { url, ms } = await page.evaluate(() => window.__bloxCapture());
    const file = join(outDir, `${name}.png`);
    await writeFile(file, Buffer.from(url.split(',')[1], 'base64'));
    const st = await stats();
    // one frame with and without city life (renderer.info over all passes of that frame)
    const cost = await page.evaluate(() => {
      const r = window.__blox.stage.renderer, g = window.__blox.stage.scene.getObjectByName('life');
      const frame = () => { r.info.autoReset = false; r.info.reset(); window.__bloxCapture(); const i = r.info.render; r.info.autoReset = true; return { calls: i.calls, triangles: i.triangles }; };
      const on = frame(); g.visible = false; const off = frame(); g.visible = true;
      return { frameCalls: on.calls, frameTriangles: on.triangles, lifeCalls: on.calls - off.calls, lifeTriangles: on.triangles - off.triangles };
    });
    Object.assign(st, cost);
    delete st.drawCallsFrame; delete st.triangles;
    console.log(`wrote ${file} (${ms.toFixed(0)} ms) ${JSON.stringify(st)}`);
  }
} finally { await browser.close(); server.close(); }
