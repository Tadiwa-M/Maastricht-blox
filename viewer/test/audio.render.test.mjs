// The real sound, measured: CitySynth rendered through an OfflineAudioContext in headless
// Chromium (30 s: fade-in, walking, an hour strike, a landing, then rain), checked for level,
// brightness (share of energy above 4 kHz) and clicks (sample-to-sample jumps). Skipped where no
// Chromium is installed (BLOX_CHROMIUM, /opt/pw-browsers/chromium or playwright's own).
// BLOX_AUDIO_PRINT=1 prints the numbers.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ENTRY = `
import { CitySynth } from './synth.js';
import { masterGain, PREFS_DEFAULTS } from './prefs.js';
window.audioRender = { CitySynth, gain: masterGain(PREFS_DEFAULTS) };
`;

/** Runs in the page: render the scenario, return the measurements. */
async function scenario() {
  const RATE = 48000, SECONDS = 30, TICK = 0.1;
  const { CitySynth, gain } = window.audioRender;
  const ac = new OfflineAudioContext(2, RATE * SECONDS, RATE);
  const synth = new CitySynth(ac);
  synth.setVolume(gain, 0.6); // index.js: the first start fades in over ~2 s
  let nextStep = 0.5, struck = false, landed = false;
  const tick = () => {
    const t = ac.currentTime;
    synth.mix({ rain: t > 15 ? 0.5 : 0, day: 1, bells: { level: 0.6, pan: 0.2, cut: 2000 } });
    if (!struck && t >= 2) { struck = true; synth.hourStrike(t + 0.05, 3); }
    if (!landed && t >= 10) { landed = true; synth.thud('cobble', 0.7); }
    while (nextStep <= t) { synth.step('cobble', 0.85, t); nextStep += 0.45; }
  };
  for (let q = 1; q * TICK < SECONDS; q++) ac.suspend(q * TICK).then(() => { tick(); ac.resume(); });
  tick();
  const buf = await ac.startRendering();
  const L = buf.getChannelData(0), R = buf.getChannelData(1), n = L.length;

  let peak = 0, sum = 0, jump = 0;
  for (const d of [L, R]) {
    for (let q = 0; q < n; q++) {
      const v = d[q], a = Math.abs(v);
      if (a > peak) peak = a;
      sum += v * v;
      if (q) { const j = Math.abs(v - d[q - 1]); if (j > jump) jump = j; }
    }
  }
  // energy above 4 kHz: Hann-windowed FFT blocks of the left channel
  const N = 4096, re = new Float64Array(N), im = new Float64Array(N);
  let lo = 0, hi = 0;
  for (let off = 0; off + N <= n; off += N) {
    for (let q = 0; q < N; q++) { re[q] = L[off + q] * (0.5 - 0.5 * Math.cos((2 * Math.PI * q) / N)); im[q] = 0; }
    for (let i = 1, j = 0; i < N; i++) {
      let bit = N >> 1;
      for (; j & bit; bit >>= 1) j ^= bit;
      j ^= bit;
      if (i < j) { const tr = re[i]; re[i] = re[j]; re[j] = tr; }
    }
    for (let len = 2; len <= N; len <<= 1) {
      const ang = (-2 * Math.PI) / len, wr = Math.cos(ang), wi = Math.sin(ang);
      for (let i = 0; i < N; i += len) {
        let cr = 1, ci = 0;
        for (let k = 0; k < len / 2; k++) {
          const a = i + k, b = a + len / 2;
          const xr = re[b] * cr - im[b] * ci, xi = re[b] * ci + im[b] * cr;
          re[b] = re[a] - xr; im[b] = im[a] - xi; re[a] += xr; im[a] += xi;
          const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t;
        }
      }
    }
    for (let k = 1; k < N / 2; k++) {
      const p = re[k] * re[k] + im[k] * im[k];
      if ((k * RATE) / N >= 4000) hi += p; else lo += p;
    }
  }
  const dB = (v) => +(20 * Math.log10(Math.max(v, 1e-9))).toFixed(1);
  return { gain, peak, peakDb: dB(peak), rmsDb: dB(Math.sqrt(sum / (2 * n))), above4k: hi / (hi + lo || 1), maxJump: jump };
}

async function launch() {
  const { chromium } = await import('playwright');
  const fixed = process.env.BLOX_CHROMIUM || (existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);
  return chromium.launch({ executablePath: fixed, args: ['--autoplay-policy=no-user-gesture-required'] });
}

test('render: quiet, warm (little above 4 kHz) and click-free', async (t) => {
  let browser;
  try { browser = await launch(); } catch (e) { t.skip(`no Chromium: ${String(e.message).split('\n')[0]}`); return; }
  try {
    const { build } = await import('esbuild');
    const dir = process.env.BLOX_AUDIO_DIR || fileURLToPath(new URL('../src/audio/', import.meta.url));
    const out = await build({ stdin: { contents: ENTRY, resolveDir: dir }, bundle: true, write: false, format: 'iife', logLevel: 'silent' });
    const page = await browser.newPage();
    await page.addScriptTag({ content: out.outputFiles[0].text });
    const m = await page.evaluate(scenario);
    if (process.env.BLOX_AUDIO_PRINT) console.log(JSON.stringify(m));
    assert.ok(m.peakDb < -18, `peak ${m.peakDb} dBFS`);
    assert.ok(m.rmsDb < -30 && m.rmsDb > -55, `rms ${m.rmsDb} dBFS`);
    assert.ok(m.above4k < 0.01, `energy above 4 kHz ${(m.above4k * 100).toFixed(2)} %`);
    assert.ok(m.maxJump < 0.01, `largest sample-to-sample jump ${m.maxJump}`);
  } finally { await browser.close(); }
});
