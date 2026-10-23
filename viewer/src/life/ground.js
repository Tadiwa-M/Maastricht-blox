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

/**
 * Returns groundAt(x, z) -> y for Unity metres (x east, z north). Answers from the city are
 * cached on a 0.5 m grid; unknown areas are asked again later.
 */
export function makeGround(ctx, world = ctx.world) {
  const S = world?.studM ?? 0.5, P = world?.plateM ?? 0.2;
  const flat = world?.groundK !== undefined ? world.groundK * P : 0;
  const cache = new Map();
  const fromWorld = (x, z) => {
    if (!world?.topK) return flat;
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
