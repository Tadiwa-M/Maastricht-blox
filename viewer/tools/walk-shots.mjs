// Walk-mode screenshots and a real-data collision probe (player track).
// Serves dist/ (build it first: node build.mjs ../samples/markt_v3 --around markt), opens
// #mode=walk&at=x,z, drives the character controller in-page (fixed 1/60 s steps, no real
// time needed under software GL), and saves PNGs.
// Usage: node tools/walk-shots.mjs [outDir] [x,z]   (Unity metres; default: the Markt)
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { extname, join, resolve, dirname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const here = dirname(fileURLToPath(import.meta.url));
const dist = join(here, '..', 'dist');
const outDir = resolve(process.argv[2] || join(here, '..', '..', 'build', 'shots', 'player'));
const at = process.argv[3] || '700,1505';
const TYPES = { '.html': 'text/html', '.js': 'text/javascript' };
const server = createServer(async (req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^([/\\])+/, '');
  try { res.writeHead(200, { 'Content-Type': TYPES[extname(path)] || 'application/octet-stream' }); res.end(await readFile(join(dist, path || 'index.html'))); }
  catch { res.writeHead(404); res.end(); }
});
await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--use-gl=angle'] });
await mkdir(outDir, { recursive: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
page.on('pageerror', (e) => console.log(`pageerror ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error') console.log(m.text()); });
const shot = async (name) => {
  const { url } = await page.evaluate(() => { window.__blox.lod.settle(window.__blox.stage.camera); return window.__bloxCapture(); });
  const file = join(outDir, `${name}.png`);
  await writeFile(file, Buffer.from(url.split(',')[1], 'base64'));
  console.log(`wrote ${file}`);
};
try {
  await page.goto(`http://127.0.0.1:${server.address().port}/index.html?shot=1#mode=walk&at=${at}&yaw=0`);
  await page.waitForFunction(() => (window.__bloxReady && window.__bloxPlayer) || window.__bloxError, null, { timeout: 300000 });
  console.log('start', JSON.stringify(await page.evaluate(() => window.__bloxPlayer.state())));
  await shot('walk_start');
  // probe: walk toward each of the nearest islands' centres; the body must stop outside
  const probe = await page.evaluate(() => {
    const P = window.__bloxPlayer, { islands } = window.__blox, c = P.ctrl;
    const start = [...c.pos];
    const out = [];
    const near = islands.map((w) => {
      const b = w.bounds, S = w.studM, yaw = (w.island.yawDeg * Math.PI) / 180;
      const u = ((b.I0 + b.I1) / 2) * S, v = ((b.J0 + b.J1) / 2) * S;
      const x = w.island.origin[0] + u * Math.cos(yaw) + v * Math.sin(yaw), n = w.island.origin[1] - u * Math.sin(yaw) + v * Math.cos(yaw);
      return { id: w.island.id, yawDeg: w.island.yawDeg, x, z: -n, d: Math.hypot(x - start[0], -n - start[2]) };
    }).sort((a, b) => a.d - b.d).slice(0, 6);
    for (const isl of near) {
      c.spawn(...start, 0);
      const heading = Math.atan2(isl.x - start[0], -(isl.z - start[2]));
      let inside = 0;
      for (let q = 0; q < 60 * 40; q++) {
        c.update(1 / 60, { move: [0, 1], speed: 4 }, heading);
        for (let a = 0; a < 8; a++) {
          const x = c.pos[0] + Math.cos(a * 0.785) * 0.2, z = c.pos[2] + Math.sin(a * 0.785) * 0.2;
          for (const h of [0.5, 1.2, 1.8]) if (P.city.isSolid(x, c.pos[1] + h, z) === true) inside++;
        }
      }
      out.push({ ...isl, end: c.pos.map((v) => +v.toFixed(2)), left: +Math.hypot(isl.x - c.pos[0], isl.z - c.pos[2]).toFixed(1), insideSamples: inside, grounded: c.grounded });
    }
    c.spawn(...start, 0);
    return out;
  });
  console.table(probe);
  // a few shots: walk toward the nearest island, turn the camera
  const target = probe[0];
  await page.evaluate((t) => {
    const P = window.__bloxPlayer, c = P.ctrl;
    const heading = Math.atan2(t.x - c.pos[0], -(t.z - c.pos[2]));
    P.follow.yaw = heading;
    for (let q = 0; q < 60 * 6; q++) c.update(1 / 60, { move: [0, 1], speed: 1.4 }, heading);
  }, target);
  await page.evaluate(() => window.__bloxCapture()); // let the camera follow (one tick)
  await shot('walk_to_island');
  await page.evaluate(() => { const P = window.__bloxPlayer; P.follow.yaw += 2.4; P.follow.pitch = 0.1; });
  await page.evaluate(() => window.__bloxCapture());
  await shot('walk_turned');
  console.log('end', JSON.stringify(await page.evaluate(() => window.__bloxPlayer.state())));
} finally {
  await browser.close();
  server.close();
}
