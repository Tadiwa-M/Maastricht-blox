// Water and banks over the city query API (pure, tested in test/activities.test.mjs). All
// coordinates are three.js metres (x east, z = -north) as city.js takes them. Water bricks are
// solid in the API (you could stand on the river), so "water here" means the top cell of the
// column is a water brick.

const TAU = Math.PI * 2;

/** Surface height of the water at (x, z), or null (land, or not loaded). */
export function waterAt(city, x, z) {
  const g = city.groundHeight(x, z);
  if (typeof g !== 'number') return null;
  return city.isWater?.(x, g - 0.05, z) === true ? g : null;
}

/** Distance (m) from (x, z) to the nearest water within maxR (rings of `step` m), or null. */
export function nearestWater(city, x, z, maxR = 7, step = 1) {
  if (waterAt(city, x, z) !== null) return 0;
  for (let r = step; r <= maxR + 1e-9; r += step) {
    const n = Math.max(8, Math.round((TAU * r) / step));
    for (let a = 0; a < n; a++) {
      const t = (a / n) * TAU;
      if (waterAt(city, x + r * Math.cos(t), z + r * Math.sin(t)) !== null) return r;
    }
  }
  return null;
}

/**
 * Somewhere to step ashore near a boat at (x, z): the nearest land column (not water) within
 * maxR whose top is free for a standing body (1 m and 1.7 m up) and open overhead (3 m: not
 * under an arcade or a roof), at most `rise` metres above the water. -> { x, z, y, d } or null.
 */
export function findLanding(city, x, z, { maxR = 44, step = 2, rise = 9, water = null } = {}) {
  const level = water ?? waterAt(city, x, z);
  const free = (px, py, pz) => city.isSolid(px, py, pz) !== true && city.isSolid(px, py, pz) !== 'unknown';
  for (let r = step; r <= maxR + 1e-9; r += step) {
    const n = Math.max(12, Math.min(72, Math.round((TAU * r) / step)));
    let best = null;
    for (let a = 0; a < n; a++) {
      const t = (a / n) * TAU, px = x + r * Math.cos(t), pz = z + r * Math.sin(t);
      const g = city.groundHeight(px, pz);
      if (typeof g !== 'number' || city.isWater?.(px, g - 0.05, pz) === true) continue;
      if (level !== null && g - level > rise) continue;
      if (![1, 1.7, 3].every((h) => free(px, g + h, pz))) continue;
      if (!best || g < best.y) best = { x: px, z: pz, y: g, d: r }; // the lowest on this ring: the quay, not a wall top
    }
    if (best) return best;
  }
  return null;
}

/** First water point straight ahead (compass yaw, 1..reach m), else the nearest within reach. */
export function waterAhead(city, x, z, yaw, reach = 7) {
  const fx = Math.sin(yaw), fz = -Math.cos(yaw);
  for (let d = 1; d <= reach; d += 0.5) {
    const px = x + fx * d, pz = z + fz * d;
    const y = waterAt(city, px, pz);
    if (y !== null) return { x: px, z: pz, y };
  }
  for (let r = 1; r <= reach; r += 1) {
    for (let a = 0; a < 16; a++) {
      const t = (a / 16) * TAU, px = x + r * Math.cos(t), pz = z + r * Math.sin(t);
      const y = waterAt(city, px, pz);
      if (y !== null) return { x: px, z: pz, y };
    }
  }
  return null;
}
