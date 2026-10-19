// Click picking by walking the ray through the occupancy grid (3D DDA, Amanatides & Woo).
//
// Instead of testing the ray against every brick instance, we step from cell to cell
// along the ray, in order, and stop at the first occupied cell. Cost grows with the ray's
// length inside the world, not with the number of bricks, so it stays fast with many
// chunks. The answer is cell-exact (a brick's whole bounding box counts as solid).

/** Ray (three.js origin/direction) -> { n, I, J, K, distance } of the first brick, or null. */
export function pickBrick(world, origin, direction, maxSteps = 20000) {
  const S = world.studM, P = world.plateM;
  // grid space: g = (I, J, K) = (x / S, -z / S, y / P); the ray parameter t is unchanged
  const o = [origin.x / S, -origin.z / S, origin.y / P];
  const d = [direction.x / S, -direction.z / S, direction.y / P];
  const { I0, J0, K0, I1, J1, K1 } = world.bounds;
  const lo = [I0, J0, K0], hi = [I1, J1, K1];
  let tIn = 0, tOut = Infinity;
  for (let a = 0; a < 3; a++) { // clip the ray to the world box (slab test)
    if (Math.abs(d[a]) < 1e-12) { if (o[a] < lo[a] || o[a] >= hi[a]) return null; continue; }
    let t0 = (lo[a] - o[a]) / d[a], t1 = (hi[a] - o[a]) / d[a];
    if (t0 > t1) [t0, t1] = [t1, t0];
    tIn = Math.max(tIn, t0); tOut = Math.min(tOut, t1);
  }
  if (tIn > tOut) return null;
  const start = tIn + 1e-7;
  const cell = [0, 1, 2].map((a) => Math.min(hi[a] - 1, Math.max(lo[a], Math.floor(o[a] + d[a] * start))));
  const step = d.map((v) => (v > 0 ? 1 : v < 0 ? -1 : 0));
  const tDelta = d.map((v) => (v ? Math.abs(1 / v) : Infinity));
  const tMax = d.map((v, a) => {
    if (!v) return Infinity;
    const edge = cell[a] + (v > 0 ? 1 : 0);
    return (edge - o[a]) / v;
  });
  let t = tIn;
  for (let s = 0; s < maxSteps; s++) {
    const n = world.brickAt(cell[0], cell[1], cell[2]);
    if (n >= 0) return { n, I: cell[0], J: cell[1], K: cell[2], distance: t };
    const a = tMax[0] < tMax[1] ? (tMax[0] < tMax[2] ? 0 : 2) : (tMax[1] < tMax[2] ? 1 : 2);
    t = tMax[a];
    if (t > tOut) return null;
    cell[a] += step[a];
    tMax[a] += tDelta[a];
  }
  return null;
}
