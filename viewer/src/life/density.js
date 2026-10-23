// How busy the city is: counts by quality tier, day curves for people, bikes and cars, the
// weekend, terrace occupancy and the market schedule. Pure, tested in test/life.density.test.mjs.

export const FIGURES_BY_TIER = { high: 900, medium: 500, low: 200 }; // walkers within ~200 m of the camera
export const CYCLISTS_BY_TIER = { high: 140, medium: 80, low: 30 };
export const CARS_BY_TIER = { high: 110, medium: 65, low: 25 };

function curve(pts, h) {
  h = ((h % 24) + 24) % 24;
  for (let q = 1; q < pts.length; q++) {
    const [h0, v0] = pts[q - 1], [h1, v1] = pts[q];
    if (h <= h1) return v0 + (v1 - v0) * ((h - h0) / (h1 - h0 || 1));
  }
  return pts[pts.length - 1][1];
}

const PEOPLE = [[0, 0.12], [5, 0.05], [7, 0.3], [9, 0.6], [11, 0.95], [12, 1], [17, 1], [19, 0.8], [22, 0.4], [24, 0.12]];
const TRAFFIC = [[0, 0.08], [5, 0.05], [7, 0.55], [8, 1], [9.5, 0.7], [12, 0.75], [16, 0.85], [17.5, 1], [19, 0.6], [22, 0.3], [24, 0.08]];
const TERRACE = [[0, 0.05], [2, 0], [9, 0.1], [10.5, 0.4], [12.5, 0.85], [14.5, 0.6], [16.5, 0.7], [19, 0.95], [21.5, 0.8], [23.5, 0.3], [24, 0.05]];

/** Share of the walkers out at an hour (0..24) on a day (0 = Monday .. 6 = Sunday). */
export function crowdFactor(hours, day = 2) {
  let f = curve(PEOPLE, hours);
  if (day === 5) f *= 1.25; // Saturday: shopping day
  else if (day === 6) f *= hours < 11.5 ? 0.55 : 1.05; // Sunday: late start (shops 12-17)
  else if (day === 3 && hours > 17) f *= 1.1; // Thursday late-night shopping
  return Math.min(1.3, f);
}

/** Share of cars and cyclists on the roads: rush hours, quieter weekends. */
export function trafficFactor(hours, day = 2) {
  const f = curve(TRAFFIC, hours);
  return day >= 5 ? f * (day === 5 ? 0.75 : 0.55) + 0.1 * curve(PEOPLE, hours) : f;
}

/** Share of terrace chairs taken (sun or not: Maastricht terraces are full). */
export function terraceFactor(hours, day = 2) {
  return Math.min(1, curve(TERRACE, hours) * (day >= 4 ? 1.15 : 1));
}

/** Market state: 'off' | 'setup' (an hour before) | 'open' | 'packing' (an hour after). */
export function marketState(market, day, sec) {
  if (!market || !market.days?.includes(day)) return 'off';
  if (sec >= market.open && sec < market.close) return 'open';
  if (sec >= market.open - 3600 && sec < market.open) return 'setup';
  if (sec >= market.close && sec < market.close + 3600) return 'packing';
  return 'off';
}

/** Point in polygon [x, z, x, z, ...] (even-odd). */
export function inPoly(poly, x, z) {
  let inside = false;
  const n = poly.length / 2;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = poly[2 * i], zi = poly[2 * i + 1], xj = poly[2 * j], zj = poly[2 * j + 1];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

/**
 * Spawn weights of a walk graph for the moment: base weights, x `marketBoost` inside the
 * market polygon while it is open, x `squareBoost` for busy squares by day (nodes with the
 * highest base weight). Returns a Float32Array (same length as base).
 */
export function liveWeights(base, xs, zs, { market = null, open = false, hours = 12, marketBoost = 3, squareBoost = 1.6 } = {}) {
  const out = Float32Array.from(base);
  let top = 0;
  for (const w of base) top = Math.max(top, w);
  const day = hours >= 9 && hours <= 19;
  for (let q = 0; q < out.length; q++) {
    if (day && base[q] >= top * 0.75) out[q] *= squareBoost;
    if (open && market && inPoly(market.poly, xs[q], zs[q])) out[q] *= marketBoost;
  }
  return out;
}
