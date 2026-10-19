// Occupancy grid + exterior air: which empty cells can be reached from outside the world.
//
// Why: the pipeline culls building interiors (CONTRACT section 4, "Hollow"), so a stud
// whose cell above is interior air sits inside a closed building and can never be seen;
// the far LOD mesh (src/farmesh.js) also drops faces that look into interior air.
// v2 data marks hidden studs with the hide_studs flag; this flood fill is the fallback for
// older data. It runs once at load over the world bounds grown by one cell on every side.
//
// The grid is one byte per cell: AIR_IN (air not reachable from outside), AIR_OUT, or a
// brick code from the caller's codeOf(n) (>= 2). It is filled from the bricks (not by
// asking the cell map for every cell), so a 7x7-chunk world takes well under a second.
const MAX_CELLS = 96e6; // skip (everything counts as exterior) rather than allocate an absurd grid
export const AIR_IN = 0, AIR_OUT = 1;

/**
 * Occupancy grid of a World. codeOf(n) -> 2..255 for brick n (default 2).
 * Returns { code(I, J, K), exterior(I, J, K) } or null when the world is too big.
 */
export function occupancyGrid(world, codeOf = () => 2) {
  const { I0, J0, K0, I1, J1, K1 } = world.bounds;
  const x0 = I0 - 1, y0 = J0 - 1, z0 = K0 - 1;
  const nx = I1 - I0 + 2, ny = J1 - J0 + 2, nz = K1 - K0 + 2;
  if (!(nx > 0) || nx * ny * nz > MAX_CELLS) return null;
  const grid = new Uint8Array(nx * ny * nz);
  const sxy = nx * ny;
  for (let n = 0; n < world.count; n++) {
    const t = world.typeOf(n);
    if (!t) continue;
    const [ei, ej] = world.extentOf(n);
    const c = codeOf(n);
    const bx = world.I[n] - x0, by = world.J[n] - y0, bz = world.K[n] - z0;
    for (let k = 0; k < t.h; k++)
      for (let dj = 0; dj < ej; dj++) {
        const row = bx + nx * (by + dj) + sxy * (bz + k);
        grid.fill(c, row, row + ei);
      }
  }
  floodOutside(grid, nx, ny, nz);
  const inside = (x, y, z) => x >= 0 && y >= 0 && z >= 0 && x < nx && y < ny && z < nz;
  return {
    code(I, J, K) {
      const x = I - x0, y = J - y0, z = K - z0;
      return inside(x, y, z) ? grid[x + nx * (y + ny * z)] : AIR_OUT;
    },
    exterior(I, J, K) {
      const x = I - x0, y = J - y0, z = K - z0;
      return !inside(x, y, z) || grid[x + nx * (y + ny * z)] === AIR_OUT;
    },
  };
}

/** Breadth-first fill of AIR_IN cells from the (always empty) corner; growable ring queue. */
function floodOutside(grid, nx, ny, nz) {
  let cap = 1 << 20, queue = new Int32Array(cap), head = 0, size = 0;
  const sxy = nx * ny;
  const push = (q) => {
    if (grid[q] !== AIR_IN) return;
    grid[q] = AIR_OUT;
    if (size === cap) { // grow: unroll the ring into a buffer twice as big
      const next = new Int32Array(cap * 2);
      for (let s = 0; s < size; s++) next[s] = queue[(head + s) % cap];
      queue = next; head = 0; cap *= 2;
    }
    queue[(head + size++) % cap] = q;
  };
  push(0);
  while (size) {
    const q = queue[head];
    head = (head + 1) % cap; size--;
    const x = q % nx, y = Math.floor(q / nx) % ny, z = Math.floor(q / sxy);
    if (x + 1 < nx) push(q + 1);
    if (x > 0) push(q - 1);
    if (y + 1 < ny) push(q + nx);
    if (y > 0) push(q - nx);
    if (z + 1 < nz) push(q + sxy);
    if (z > 0) push(q - sxy);
  }
}

/** Returns isExterior(I, J, K): true for air reachable from outside, or outside the bounds. */
export function exteriorAir(world, grid = occupancyGrid(world)) {
  return grid ? grid.exterior : () => true;
}
