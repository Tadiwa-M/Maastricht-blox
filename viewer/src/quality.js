// Quality tiers: what the viewer spends per frame, picked from the world size and the
// measured frame time. Pure logic (no three.js), tested in test/quality.test.mjs.
//
//   high    the look-development settings: full-res AO, bloom, 4096 shadows, device pixel
//           ratio up to 2; with one chunk every brick is drawn bevelled with studs (no LOD)
//   medium  per-chunk LOD (bevelled + studs only near the camera, one bevel segment
//           instead of two), half-res AO, pixel ratio 1, bloom only at night, 2048 shadows
//   low     LOD with a small near zone, AO off, pixel ratio 1, bloom only at night, 1024 shadows
//   lite    for software rendering (no GPU) or by hand: 0.75 resolution, no shadows, no bloom,
//           a short detail range and fewer people and vehicles. 'auto' never steps down to it
//           on a real GPU (the governor's floor is low there)
//
// 'auto' starts at high for a single-chunk world; a bigger world starts by GPU class (gpu.js:
// software -> lite, integrated -> low, else medium), then steps
// down while the measured frame time stays high. It never steps back up by itself (that
// oscillates on machines right at the edge); pick 'high' in the HUD to force it.
//
// City mode (streamed site build) adds: streamRadius (m: chunks/islands within it are loaded
// in the mid look), farDist ([m, m]: baked far level 1 within the first, level 2 within the
// second, level 3 beyond), aoDist (m: AO only when the orbit target is closer) and nearTriCap
// (triangles of near looks: one big island can hold 30k bricks, so items alone are no budget),
// shadowRange (m: the sun's shadow box never grows past this around the orbit target; the shadow
// pass draws everything inside it a second time, so on the overview it doubled the city's cost).
export const TIERS = Object.freeze({
  high: { name: 'high', nearDetail: 'full', pixelRatio: 2, ao: 'full', bloom: 'always', shadowMap: 4096, nearDist: 70, maxNear: 9, studCap: 80000,
    streamRadius: 300, farDist: [380, 1200], aoDist: 400, nearTriCap: 8e6, shadowRange: 1600 },
  medium: { name: 'medium', nearDetail: 'lite', pixelRatio: 1, ao: 'half', bloom: 'night', shadowMap: 2048, nearDist: 40, maxNear: 3, studCap: 20000,
    streamRadius: 200, farDist: [280, 900], aoDist: 250, nearTriCap: 2.5e6, shadowRange: 1000 },
  low: { name: 'low', nearDetail: 'lite', pixelRatio: 1, ao: 'off', bloom: 'night', shadowMap: 1024, nearDist: 22, maxNear: 2, studCap: 8000,
    streamRadius: 130, farDist: [200, 650], aoDist: 0, nearTriCap: 1.2e6, shadowRange: 450 },
  lite: { name: 'lite', nearDetail: 'lite', pixelRatio: 0.75, ao: 'off', bloom: 'off', shadowMap: 1024, shadows: false, nearDist: 16, maxNear: 1,
    studCap: 4000, streamRadius: 110, farDist: [140, 450], aoDist: 0, nearTriCap: 0.6e6, shadowRange: 0 },
});
export const MODES = ['auto', 'high', 'medium', 'low', 'lite'];
const ORDER = ['high', 'medium', 'low', 'lite'];

/** Small worlds (one chunk) are drawn without LOD at high quality. */
export function isSmallWorld({ chunks, bricks }) {
  return chunks <= 1 && bricks <= 20000;
}

/** Starting tier name for a mode ('auto' | tier name), world size and (auto) the GPU's tier. */
export function initialTier(mode, world, gpuTier = 'medium') {
  if (TIERS[mode]) return mode;
  return isSmallWorld(world) ? 'high' : gpuTier;
}

/** LOD switch for a tier: all near (no LOD) only for a small world at high quality. */
export function useLod(tierName, world) {
  return !(tierName === 'high' && isSmallWorld(world));
}

/**
 * Watches frame times in auto mode and says when to drop a tier.
 * sample(ms) returns the new tier name, or null to stay.
 */
export class FrameGovernor {
  /** floor: the cheapest tier auto may reach ('low' normally; 'lite' only for software GPUs). */
  constructor(tier, { slowMs = 40, windowMs = 1500, settleMs = 1500, floor = 'low' } = {}) {
    Object.assign(this, { tier, slowMs, windowMs, settleMs, floor });
    this.reset();
  }

  reset() { this.sum = 0; this.n = 0; this.span = 0; this.skip = this.settleMs; }

  sample(ms) {
    if (this.skip > 0) { this.skip -= ms; return null; } // ignore hitches right after a change
    this.sum += ms; this.n++; this.span += ms;
    if (this.span < this.windowMs) return null;
    const avg = this.sum / this.n;
    this.sum = 0; this.n = 0; this.span = 0;
    const i = ORDER.indexOf(this.tier);
    if (avg > this.slowMs && i < ORDER.indexOf(this.floor)) {
      this.tier = ORDER[i + 1];
      this.reset();
      return this.tier;
    }
    return null;
  }
}

/** Frames per second and mean frame time over a sliding window of real frame intervals. */
export class FpsMeter {
  constructor(windowMs = 1000) { this.windowMs = windowMs; this.times = []; this.last = null; }

  /** now: performance.now() at the start of a frame. Returns the frame interval in ms (or 0). */
  tick(now) {
    const dt = this.last === null ? 0 : now - this.last;
    this.last = now;
    if (dt > 0) {
      this.times.push(dt);
      let total = this.times.reduce((a, b) => a + b, 0);
      while (this.times.length > 1 && total - this.times[0] >= this.windowMs) total -= this.times.shift();
    }
    return dt;
  }

  get ms() { return this.times.length ? this.times.reduce((a, b) => a + b, 0) / this.times.length : 0; }
  get fps() { return this.ms ? 1000 / this.ms : 0; }

  /** "42 fps (23.8 ms)" with one decimal below 10 fps, so a slow machine never reads "0 fps". */
  label() {
    if (!this.times.length) return '… fps';
    const f = this.fps;
    return `${f < 10 ? f.toFixed(1) : Math.round(f)} fps (${this.ms.toFixed(1)} ms)`;
  }
}
