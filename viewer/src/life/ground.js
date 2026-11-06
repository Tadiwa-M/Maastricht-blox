// Where movers stand. Asks the city query API (src/city.js: groundHeight(x, z, fromY) in
// three.js metres, z = -north) when there is one; it may answer 'unknown' (not loaded yet) or
// null (no brick). fromY = the column's approximate ground + 2.5 m, so a tree crown or an
// arcade roof over the pavement is not taken for the ground. Otherwise: the embedded World's
// column tops near the flat ground level; otherwise flat ground at the world's ground level.

/** ctx.city may be the API object or a function returning it (it can appear later). */
export function cityOf(ctx) {
  const c = typeof ctx.city === 'function' ? ctx.city() : ctx.city;
  return c || (typeof window !== 'undefined' ? window.__blox?.city : null) || null;
}

export const HEADROOM_M = 2.5;
export const DECK_M = 25; // bridge decks are at most this far above the water

/**
 * Returns groundAt(x, z) -> y for Unity metres (x east, z north). Answers from the city are
 * cached on a 0.5 m grid; unknown areas are asked again later.
 */
export function makeGround(ctx, world = ctx.world) {
  const S = world?.studM ?? 0.5, P = world?.plateM ?? 0.2;
  const flat = world?.groundK !== undefined ? world.groundK * P : 0;
  const cache = new Map();
  const fromWorld = (x, z) => {
    if (!(world?.count > 0)) return flat;
    const top = world.topK(Math.floor(x / S), Math.floor(z / S)) * P;
    return Math.abs(top - flat) <= 1.6 ? top : flat; // ignore roofs, trees, awnings
  };
  const groundAt = (x, z) => {
    const key = Math.floor(x * 2) * 65536 + Math.floor(z * 2);
    const hit = cache.get(key);
    if (hit !== undefined) return hit;
    const city = cityOf(ctx);
    let y = null, keep = true;
    if (city?.groundHeight) {
      const approx = city.approxGround?.(x, -z);
      const fromY = Number.isFinite(approx) ? approx + HEADROOM_M : (world ? fromWorld(x, z) + HEADROOM_M : Infinity);
      const v = city.groundHeight(x, -z, fromY);
      if (Number.isFinite(v)) y = v;
      else keep = v !== 'unknown';
      // over the river the area's ground is the water, so a high bridge deck sits above fromY and
      // the water under it was taken: look again higher up for a dry deck
      if (y !== null && city.isWater?.(x, y - 0.05, -z) === true) {
        const up = city.groundHeight(x, -z, y + DECK_M);
        if (Number.isFinite(up) && up > y + 1.5 && city.isWater(x, up - 0.05, -z) !== true) y = up;
      }
    }
    if (y === null) y = fromWorld(x, z);
    if (keep) {
      if (cache.size > 200000) cache.clear();
      cache.set(key, y);
    }
    return y;
  };
  groundAt.flat = flat;
  groundAt.reset = () => cache.clear();
  return groundAt;
}

/**
 * Bridge snapping for vehicles: a route line (GTFS shape) can run a few metres beside a bridge
 * deck, and then over the water. deckAt(x, z, yawDeg) -> { x, z } of the nearest deck column
 * across the direction of travel (within `reach` m), or null when (x, z) is not over water (or the
 * area isn't loaded). Unity metres. Cached on a 1 m grid per heading (10 degree steps).
 */
export function makeDeck(ctx, { reach = 14 } = {}) {
  const cache = new Map();
  return (x, z, yawDeg) => {
    const city = cityOf(ctx);
    if (!city?.isWater || !city.groundHeight) return null;
    const key = `${Math.round(x)},${Math.round(z)},${Math.round(yawDeg / 10)}`;
    if (cache.has(key)) return cache.get(key);
    const top = (px, pz) => { const g = city.groundHeight(px, -pz); return Number.isFinite(g) ? g : null; };
    const wet = (px, pz, g) => city.isWater(px, g - 0.05, -pz) === true;
    const g0 = top(x, z);
    if (g0 === null) return null; // not loaded: ask again later
    let out = null;
    if (wet(x, z, g0)) {
      const r = (yawDeg * Math.PI) / 180, rx = Math.cos(r), rz = -Math.sin(r); // right of the heading (Unity)
      for (let d = 1; d <= reach && !out; d++) {
        for (const s of [1, -1]) {
          const px = x + rx * d * s, pz = z + rz * d * s, g = top(px, pz);
          if (g !== null && g > g0 + 1.5 && !wet(px, pz, g)) { out = { x: px, z: pz }; break; }
        }
      }
    }
    if (cache.size > 50000) cache.clear();
    cache.set(key, out);
    return out;
  };
}
