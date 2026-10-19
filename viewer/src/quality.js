// Quality tiers: what the viewer spends per frame, picked from the world size and the
// measured frame time. Pure logic (no three.js), tested in test/quality.test.mjs.
//
//   high    the look-development settings: full-res AO, bloom, 4096 shadows, device pixel
//           ratio up to 2; with one chunk every brick is drawn bevelled with studs (no LOD)
//   medium  per-chunk LOD (bevelled + studs only near the camera, one bevel segment
//           instead of two), half-res AO, pixel ratio 1, bloom only at night, 2048 shadows
//   low     LOD with a small near zone, AO off, pixel ratio 1, bloom only at night
//
// 'auto' starts at high for a single-chunk world and medium for anything bigger, then steps
// down while the measured frame time stays high. It never steps back up by itself (that
// oscillates on machines right at the edge); pick 'high' in the HUD to force it.
export const TIERS = Object.freeze({
  high: { name: 'high', nearDetail: 'full', pixelRatio: 2, ao: 'full', bloom: 'always', shadowMap: 4096, nearDist: 70, maxNear: 9, studCap: 80000 },
  medium: { name: 'medium', nearDetail: 'lite', pixelRatio: 1, ao: 'half', bloom: 'night', shadowMap: 2048, nearDist: 45, maxNear: 4, studCap: 25000 },
  low: { name: 'low', nearDetail: 'lite', pixelRatio: 1, ao: 'off', bloom: 'night', shadowMap: 2048, nearDist: 22, maxNear: 2, studCap: 8000 },
});
export const MODES = ['auto', 'high', 'medium', 'low'];
const ORDER = ['high', 'medium', 'low'];

/** Small worlds (one chunk) are drawn without LOD at high quality. */
export function isSmallWorld({ chunks, bricks }) {
  return chunks <= 1 && bricks <= 20000;
}

/** Starting tier name for a mode ('auto' | tier name) and world size. */
export function initialTier(mode, world) {
  if (TIERS[mode]) return mode;
  return isSmallWorld(world) ? 'high' : 'medium';
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
  constructor(tier, { slowMs = 40, windowMs = 2000, settleMs = 3000 } = {}) {
    Object.assign(this, { tier, slowMs, windowMs, settleMs });
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
    if (avg > this.slowMs && i < ORDER.length - 1) {
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
