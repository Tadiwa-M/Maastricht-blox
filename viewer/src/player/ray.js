// Ray march through the city query API: the first solid point along a ray (for "walk here"
// under the cursor). Works with any isSolid (chunks + islands, or the streaming city):
// steps of 0.1 m (half a plate), then bisection to ~1 mm. 'unknown' never counts as a hit.

/** origin, dir: [x, y, z] three.js (dir normalised). Returns { point, t } or null. */
export function raycastCity(city, origin, dir, maxT = 800, step = 0.1) {
  const at = (t) => [origin[0] + dir[0] * t, origin[1] + dir[1] * t, origin[2] + dir[2] * t];
  const solid = (t) => city.isSolid(...at(t)) === true;
  for (let t = step; t <= maxT; t += step) {
    if (!solid(t)) continue;
    let lo = t - step, hi = t;
    for (let q = 0; q < 12; q++) { const m = (lo + hi) / 2; if (solid(m)) hi = m; else lo = m; }
    return { point: at(lo), t: lo };
  }
  return null;
}

/** Feet position to spawn at for a ray hit: backed off the surface toward the viewer. */
export function spawnPoint(hit, dir, back = 0.35) {
  const h = Math.hypot(dir[0], dir[2]) || 1;
  return [hit.point[0] - (dir[0] / h) * back, hit.point[1] + 0.05, hit.point[2] - (dir[2] / h) * back];
}
