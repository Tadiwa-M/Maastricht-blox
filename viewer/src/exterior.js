// Occupancy grid + exterior air: which empty cells a camera above the ground could see into.
//
// Why: the pipeline culls building interiors (CONTRACT section 4, "Hollow"), so a stud
// whose cell above is interior air sits inside a closed building and can never be seen;
// the far LOD mesh (src/farmesh.js) also drops faces that look into such air.
// v2 data marks hidden studs with the hide_studs flag; this flood fill is the fallback for
// older data. It runs once at load over the world bounds grown by one cell on every side.
//
// "Outside" air is everything above each column's highest brick, plus whatever air can be
// reached from there sideways or downward (streets under arcades, under bridges, courtyards).
// The flood never enters "bottomless" air: below a column's lowest brick AND below the tops of
// all four neighbouring columns. That is the air under the thin terrain shell of real data,
// which is only reachable from the world's edge and never seen, since the camera stays above
// ground. Arcades and bridges have ground or water below them, and the air under a balcony
// over an empty column is above the street beside it, so those are reached. The grown border itself is outside, so the side of
// the diorama keeps its faces. Seeding from the column tops also means the flood only walks
// the few cells below some neighbour's top, not the whole sky.
//
// The grid is one byte per cell: AIR_IN, AIR_OUT, or a brick code from the caller's
// codeOf(n) (>= 2). It is filled from the bricks, not by asking the cell map for every cell.
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
  const top = new Int32Array(sxy); // first air level above the column's highest brick (0 = empty)
  const bottom = new Int32Array(sxy).fill(nz); // lowest brick level (nz = empty column)
  for (let n = 0; n < world.count; n++) {
    const t = world.typeOf(n);
    if (!t) continue;
    const [ei, ej] = world.extentOf(n);
    const c = codeOf(n);
    const bx = world.I[n] - x0, by = world.J[n] - y0, bz = world.K[n] - z0;
    for (let dj = 0; dj < ej; dj++) {
      const col = bx + nx * (by + dj);
      for (let k = 0; k < t.h; k++) grid.fill(c, col + sxy * (bz + k), col + sxy * (bz + k) + ei);
      for (let di = 0; di < ei; di++) {
        if (top[col + di] < bz + t.h) top[col + di] = bz + t.h;
        if (bottom[col + di] > bz) bottom[col + di] = bz;
      }
    }
  }
  floodOutside(grid, top, bottom, nx, ny, nz);
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

/** Mark the sky (and the grown border) outside, then flood sideways/down from it. */
function floodOutside(grid, top, bottom, nx, ny, nz) {
  const sxy = nx * ny;
  let cap = 1 << 16, queue = new Int32Array(cap), head = 0, size = 0;
  const enqueue = (q) => {
    if (size === cap) { // grow: unroll the ring into a buffer twice as big
      const next = new Int32Array(cap * 2);
      for (let s = 0; s < size; s++) next[s] = queue[(head + s) % cap];
      queue = next; head = 0; cap *= 2;
    }
    queue[(head + size++) % cap] = q;
  };
  for (let y = 0; y < ny; y++)
    for (let x = 0; x < nx; x++) {
      const col = x + nx * y;
      const border = x === 0 || y === 0 || x === nx - 1 || y === ny - 1;
      for (let z = border ? 0 : top[col]; z < nz; z++) grid[col + sxy * z] = AIR_OUT;
      if (border) continue;
      // seeds: own sky cells level with a taller neighbour (they may look under its overhangs)
      const hi = Math.max(top[col - 1], top[col + 1], top[col - nx], top[col + nx]);
      for (let z = top[col]; z < Math.min(hi, nz); z++) enqueue(col + sxy * z);
    }
  const visit = (q) => {
    if (grid[q] !== AIR_IN) return;
    const col = q % sxy;
    if (bottom[col] < nz && q < col + sxy * bottom[col]) { // below the column's lowest brick
      const z = (q - col) / sxy;
      if (z < top[col - 1] && z < top[col + 1] && z < top[col - nx] && z < top[col + nx]) return; // under a shell
    }
    grid[q] = AIR_OUT;
    enqueue(q);
  };
  while (size) {
    const q = queue[head];
    head = (head + 1) % cap; size--;
    const x = q % nx, y = Math.floor(q / nx) % ny, z = Math.floor(q / sxy);
    if (x + 1 < nx) visit(q + 1);
    if (x > 0) visit(q - 1);
    if (y + 1 < ny) visit(q + nx);
    if (y > 0) visit(q - nx);
    if (z + 1 < nz) visit(q + sxy);
    if (z > 0) visit(q - sxy);
  }
}

/** Returns isExterior(I, J, K): true for air reachable from outside, or outside the bounds. */
export function exteriorAir(world, grid = occupancyGrid(world)) {
  return grid ? grid.exterior : () => true;
}
