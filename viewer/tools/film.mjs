// Film the city: scripted camera shots rendered frame by frame (fixed time step, every frame
// fully streamed in before it is captured), then encoded to one MP4 with ffmpeg. Frame-perfect
// at any GPU speed, so the video is smooth even when the browser itself is not.
// Also writes a still of each shot (the middle frame) as PNG: the screenshots for posts.
//
// Usage: node tools/film.mjs --site <site dir> [out=../build/film] [--only city,markt] [--fps 30]
//          [--size 1920x1080] [--quick] [--headless] [--encode-only]
//   --quick       a short test cut: 0.25x duration at 10 fps
//   --headless    no visible window (software rendering: slow, for CI/cloud tests); the default
//                 opens a browser window so the real GPU renders the frames
//   --encode-only skip capture, just encode frames already in <out>/frames
// Needs ffmpeg for the MP4 (on PATH, or `npm i --no-save ffmpeg-static` in viewer/); without it
// the PNG frames stay in <out>/frames and the command to encode them is printed.
import { mkdir, rm, writeFile, readdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';
import { serve, siteArg } from './serve.mjs';

/**
 * The shot list. kind: orbit (turn `deg` around the preset target, distance x `zoom`),
 * move (fly from preset `from` to preset `to`), with `hours` [from, to] for a sun time-lapse.
 * `hash` sets the scene: t = clock/sun hours, day = mon..sun (fri = market day on the Markt).
 */
export const SHOTS = [
  { name: 'city', hash: 't=18&day=sat', kind: 'orbit', view: 'city', deg: 30, zoom: 1.0, seconds: 7 },
  { name: 'dive', hash: 't=17.5&day=sat', kind: 'move', from: 'city', to: 'markt', seconds: 6 },
  { name: 'markt', hash: 't=11.5&day=fri', kind: 'orbit', view: 'markt', deg: 45, zoom: 0.55, seconds: 8 },
  { name: 'street', hash: 't=11.5&day=fri', kind: 'orbit', view: 'street', deg: 25, zoom: 1.0, seconds: 6 },
  { name: 'station', hash: 't=8.5&day=tue', kind: 'orbit', view: 'station', deg: 35, zoom: 0.5, seconds: 6 },
  { name: 'bosscherweg', hash: 't=17&day=sat', kind: 'orbit', view: 'bosscherweg', deg: 30, zoom: 0.6, seconds: 5 },
  { name: 'enci', hash: 't=17.5&day=sat', kind: 'orbit', view: 'enci', deg: 30, zoom: 1.4, seconds: 5 },
  { name: 'night', hash: 't=17&day=sat', kind: 'orbit', view: 'markt', deg: 30, zoom: 0.8, hours: [17, 22], seconds: 8 },
];

const ease = (u) => u * u * (3 - 2 * u); // smoothstep: soft start and stop
const lerp = (a, b, u) => a.map((v, i) => v + (b[i] - v) * u);

/** Camera { cam, target, fov } at u in 0..1 of a shot, from the page's presets (three.js coords). */
export function shotPose(shot, presets, u) {
  const e = ease(u);
  if (shot.kind === 'move') {
    const a = presets[shot.from], b = presets[shot.to];
    // fly high in the middle so the move reads as a dive, not a slide through roofs
    const cam = lerp(a.cam, b.cam, e);
    cam[1] += 4 * e * (1 - e) * 0.15 * Math.hypot(a.cam[0] - b.cam[0], a.cam[2] - b.cam[2]);
    return { cam, target: lerp(a.target, b.target, e), fov: a.fov + (b.fov - a.fov) * e };
  }
  const p = presets[shot.view];
  const off = p.cam.map((v, i) => (v - p.target[i]) * (shot.zoom ?? 1));
  const a = ((shot.deg ?? 0) * (e - 0.5) * Math.PI) / 180; // centred on the preset angle
  const c = Math.cos(a), s = Math.sin(a);
  const cam = [p.target[0] + off[0] * c - off[2] * s, p.target[1] + off[1], p.target[2] + off[0] * s + off[2] * c];
  return { cam, target: p.target, fov: p.fov };
}

function ffmpegPath() {
  if (spawnSync('ffmpeg', ['-version']).status === 0) return 'ffmpeg';
  return import('ffmpeg-static').then((m) => m.default).catch(() => null);
}

async function main() {
  const argv = process.argv.slice(2);
  const flag = (f) => { const i = argv.indexOf(f); if (i < 0) return false; argv.splice(i, 1); return true; };
  const opt = (f, d) => { const i = argv.indexOf(f); if (i < 0) return d; const v = argv[i + 1]; argv.splice(i, 2); return v; };
  const root = siteArg(argv, null);
  const quick = flag('--quick'), headless = flag('--headless'), encodeOnly = flag('--encode-only');
  const fps = +opt('--fps', quick ? 10 : 30);
  const [W, H] = opt('--size', '1920x1080').split('x').map(Number);
  const only = opt('--only', null)?.split(',');
  const out = resolve(argv[0] || '../build/film');
  const frames = join(out, 'frames');
  const shots = SHOTS.filter((s) => !only || only.includes(s.name));
  if (!encodeOnly) {
    if (!root) throw new Error('--site <dir> is required (a scripts/site build)');
    await rm(frames, { recursive: true, force: true });
    await mkdir(frames, { recursive: true });
    await mkdir(join(out, 'stills'), { recursive: true });
    await capture({ root, out, frames, shots, fps, W, H, quick, headless });
  }
  await encode(out, frames, fps);
}

async function capture({ root, out, frames, shots, fps, W, H, quick, headless }) {
  const { server, url } = await serve(root);
  const args = headless ? ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--use-gl=angle'] : ['--ignore-gpu-blocklist'];
  const browser = await chromium.launch({ headless, args });
  let n = 0;
  try {
    for (const shot of shots) {
      const page = await browser.newPage({ viewport: { width: W, height: H } });
      page.on('pageerror', (e) => console.log(`[${shot.name}] pageerror ${e.message}`));
      await page.goto(`${url}index.html?film=1#quality=high&view=${shot.view || shot.from}&${shot.hash}`);
      await page.waitForFunction(() => window.__bloxFilm || window.__bloxError, null, { timeout: 600000 });
      const err = await page.evaluate(() => window.__bloxError);
      if (err) throw new Error(err);
      const presets = await page.evaluate(() => window.__bloxFilm.presets());
      const need = [shot.view, shot.from, shot.to].filter(Boolean);
      const missing = need.filter((k) => !presets[k]);
      if (missing.length) { console.log(`skip ${shot.name}: no preset ${missing.join(', ')} in this world`); await page.close(); continue; }
      const count = Math.max(2, Math.round(shot.seconds * (quick ? 0.25 : 1) * fps));
      const pose = (u) => shotPose(shot, presets, u);
      const place = (p) => page.evaluate(({ cam, target, fov }) => window.__bloxFilm.pose(cam, target, fov), p);
      // settle the first frame: stream it in, then let traffic and walkers spread out
      await place(pose(0));
      if (shot.hours) await page.evaluate((h) => window.__bloxFilm.time(h), shot.hours[0]);
      await settle(page, 120000);
      for (let q = 0; q < 2 * fps; q++) await page.evaluate((dt) => window.__bloxFilm.step(dt), 1 / fps);
      const t0 = Date.now();
      for (let f = 0; f < count; f++) {
        const u = f / (count - 1);
        await place(pose(u));
        if (shot.hours) await page.evaluate((h) => window.__bloxFilm.time(h), shot.hours[0] + (shot.hours[1] - shot.hours[0]) * ease(u));
        await page.evaluate((dt) => window.__bloxFilm.step(dt), 1 / fps);
        await settle(page, 5000);
        const { url: png } = await page.evaluate(() => window.__bloxCapture());
        const buf = Buffer.from(png.split(',')[1], 'base64');
        await writeFile(join(frames, `${String(++n).padStart(5, '0')}.png`), buf);
        if (f === Math.floor(count / 2)) await writeFile(join(out, 'stills', `${shot.name}.png`), buf);
      }
      console.log(`${shot.name}: ${count} frames in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
      await page.close();
    }
  } finally {
    await browser.close();
    server.close();
  }
}

/** Step zero-length frames until everything in view is streamed in (or the timeout). */
async function settle(page, timeoutMs) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    if (await page.evaluate(() => window.__bloxFilm.settled())) return true;
    await page.evaluate(() => window.__bloxFilm.step(0));
    await new Promise((r) => setTimeout(r, 30));
  }
  return false;
}

async function encode(out, frames, fps) {
  const files = (await readdir(frames).catch(() => [])).filter((f) => f.endsWith('.png'));
  if (!files.length) { console.log('no frames to encode'); return; }
  const mp4 = join(out, 'maastricht-blox.mp4');
  const args = ['-y', '-framerate', String(fps), '-i', join(frames, '%05d.png'), '-c:v', 'libx264', '-pix_fmt', 'yuv420p',
    '-crf', '18', '-preset', 'slow', '-movflags', '+faststart', mp4];
  const ff = await ffmpegPath();
  if (!ff) {
    console.log(`${files.length} frames in ${frames}. No ffmpeg found: run 'npm i --no-save ffmpeg-static' in viewer/ and rerun with --encode-only,`);
    console.log(`or: ffmpeg ${args.map((a) => (/\s/.test(a) ? `"${a}"` : a)).join(' ')}`);
    return;
  }
  const r = spawnSync(ff, args, { stdio: 'inherit' });
  if (r.status !== 0) throw new Error('ffmpeg failed');
  console.log(`wrote ${mp4} (${files.length} frames, ${(files.length / fps).toFixed(1)} s) and stills in ${join(out, 'stills')}`);
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop())) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
