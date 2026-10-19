// Exterior air: which empty cells can be reached from outside the world (flood fill).
//
// Why: the pipeline culls building interiors (CONTRACT section 4, "Hollow"), so a stud
// whose cell above is interior air sits inside a closed building and can never be seen.
// v2 data marks such bricks with the hide_studs flag; this flood fill is the fallback for
// older data. It runs once at load over the world bounds grown by one cell on every side.
const MAX_CELLS = 64e6; // skip (draw every stud) rather than allocate an absurd grid

/** Returns isExterior(I, J, K): true for air reachable from outside, or outside the bounds. */
export function exteriorAir(world) {
  const { I0, J0, K0, I1, J1, K1 } = world.bounds;
  const x0 = I0 - 1, y0 = J0 - 1, z0 = K0 - 1;
  const nx = I1 - I0 + 2, ny = J1 - J0 + 2, nz = K1 - K0 + 2;
  if (!(nx > 0) || nx * ny * nz > MAX_CELLS) return () => true;
  const OPEN = 1, SEEN = 2;
  const grid = new Uint8Array(nx * ny * nz);
  const idx = (x, y, z) => x + nx * (y + ny * z);
  for (let z = 0; z < nz; z++)
    for (let y = 0; y < ny; y++)
      for (let x = 0; x < nx; x++)
        if (!world.occupied(x + x0, y + y0, z + z0)) grid[idx(x, y, z)] = OPEN;
  // breadth-first from the (always empty) corner of the grown box
  const queue = new Int32Array(grid.length);
  let head = 0, tail = 0;
  const visit = (x, y, z) => {
    if (x < 0 || y < 0 || z < 0 || x >= nx || y >= ny || z >= nz) return;
    const q = idx(x, y, z);
    if (grid[q] !== OPEN) return;
    grid[q] = SEEN;
    queue[tail++] = q;
  };
  visit(0, 0, 0);
  while (head < tail) {
    const q = queue[head++];
    const x = q % nx, y = Math.floor(q / nx) % ny, z = Math.floor(q / (nx * ny));
    visit(x + 1, y, z); visit(x - 1, y, z); visit(x, y + 1, z);
    visit(x, y - 1, z); visit(x, y, z + 1); visit(x, y, z - 1);
  }
  return (I, J, K) => {
    const x = I - x0, y = J - y0, z = K - z0;
    if (x < 0 || y < 0 || z < 0 || x >= nx || y >= ny || z >= nz) return true;
    return grid[idx(x, y, z)] === SEEN;
  };
}
