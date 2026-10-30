// Title-screen key art: render fixed views of the real city (film mode: full streaming, still
// frame) and save them as JPEGs for the title screen's slideshow (src/title/, copied to the site by
// build.mjs). The views recreate classic Maastricht postcard angles in bricks.
// Usage: node tools/keyart.mjs --site <city site dir> [outDir=src/title] [--only maas,brug] [--headless]
// Without --headless a browser window opens so the GPU renders. Needs ffmpeg (or ffmpeg-static) for JPEG.
import { writeFile, mkdir, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { serve, siteArg } from './serve.mjs';

/** cam / target: [three.js x, metres above the ground there, three.js z] (x = I * 0.5, z = -J * 0.5). */
export const VIEWS = [
  { name: 'vrijthof', place: 'Vrijthof', t: 16.2, day: 'sat', cam: [1532, 6, -3728], target: [1440, 24, -3688], fov: 55 },
  { name: 'stadhuis', place: 'Stadhuis · Markt', t: 9.5, day: 'wed', cam: [1668, 1.7, -3915], target: [1722, 16, -3990], fov: 60 },
  { name: 'maas', place: 'De Maas', t: 17.8, day: 'fri', cam: [2320, 170, -3640], target: [1760, 0, -3860], fov: 45 },
];
// Bridges (Sint Servaasbrug, Wilhelminabrug) are left out until they are modelled properly.

async function main() {
  const argv = process.argv.slice(2);
  const flag = (f) => { const i = argv.indexOf(f); if (i < 0) return false; argv.splice(i, 1); return true; };
  const opt = (f) => { const i = argv.indexOf(f); if (i < 0) return null; const v = argv[i + 1]; argv.splice(i, 2); return v; };
  const root = siteArg(argv, null);
  if (!root) throw new Error('--site <dir> is required (a scripts/site build of the city)');
  const headless = flag('--headless'), only = opt('--only')?.split(',');
  const out = resolve(argv[0] || join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'title'));
  await mkdir(out, { recursive: true });
  const ff = spawnSync('ffmpeg', ['-version']).status === 0 ? 'ffmpeg' : await import('ffmpeg-static').then((m) => m.default).catch(() => null);
  const { server, url } = await serve(root);
  const browser = await chromium.launch({ headless,
    args: headless ? ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] : ['--ignore-gpu-blocklist'] });
  try {
    for (const v of VIEWS.filter((x) => !only || only.includes(x.name))) {
      const p = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
      p.on('pageerror', (e) => console.log(`[${v.name}] ${e.message}`));
      await p.goto(`${url}index.html?film=1#quality=high&view=markt&t=${v.t}&day=${v.day}`);
      await p.waitForFunction(() => window.__bloxFilm || window.__bloxError, null, { timeout: 600000 });
      const ground = (x, z) => p.evaluate(([x, z]) => {
        const h = window.__blox.city.groundHeight(x, z);
        return typeof h === 'number' ? h : window.__blox.city.approxGround(x, z);
      }, [x, z]);
      const pose = async () => {
        const cam = [v.cam[0], (await ground(v.cam[0], v.cam[2])) + v.cam[1], v.cam[2]];
        const target = [v.target[0], (await ground(v.target[0], v.target[2])) + v.target[1], v.target[2]];
        await p.evaluate(([c, t, f]) => window.__bloxFilm.pose(c, t, f), [cam, target, v.fov]);
      };
      await pose();
      await p.evaluate((h) => window.__bloxFilm.time(h), v.t);
      for (let q = 0; q < 400; q++) { // stream the view in; re-aim once the real ground is known
        await p.evaluate(() => window.__bloxFilm.step(0));
        if (q % 20 === 0) await pose();
        if (q > 40 && await p.evaluate(() => window.__bloxFilm.settled())) break;
      }
      await pose();
      for (let q = 0; q < 30; q++) await p.evaluate(() => window.__bloxFilm.step(1 / 30)); // people and boats move in
      const { url: png } = await p.evaluate(() => window.__bloxCapture());
      const pngFile = join(out, `${v.name}.png`);
      await writeFile(pngFile, Buffer.from(png.split(',')[1], 'base64'));
      if (ff) {
        const r = spawnSync(ff, ['-y', '-loglevel', 'error', '-i', pngFile, '-q:v', '4', join(out, `${v.name}.jpg`)]);
        if (r.status === 0) await rm(pngFile);
      }
      console.log(`wrote ${v.name} (${v.place})`);
      await p.close();
    }
  } finally {
    await browser.close();
    server.close();
  }
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop())) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
