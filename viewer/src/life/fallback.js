// Life without an export (samples, the look-test town): a walk graph from the world's own
// paved top cells (the demo bus loop and boat in src/demo.js stay). Pure on a World-like object
// ({ bounds, groundK, topK, brickAt, palette, color, studM }), tested in test/life.walkers.test.mjs.

const PAVED = { cobble_grey: 4, pavement: 2, mergel_light: 2, light_grey: 1.5, sand_red: 2, mergel: 1.5 };

function topName(world, I, J) {
  const n = world.brickAt(I, J, world.topK(I, J) - 1);
  return n < 0 ? '' : world.palette.get(world.color[n])?.name || '';
}

/**
 * Walkways doc (same shape as life/walkways.json) from paved columns at ground level, on a
 * lattice of `step` studs, linked to their 8 neighbours when both ends are paved.
 */
export function walkwaysFromWorld(world, { step = 4, maxRise = 2 } = {}) {
  const { I0, J0, I1, J1 } = world.bounds, S = world.studM;
  const ni = Math.floor((I1 - I0) / step), nj = Math.floor((J1 - J0) / step);
  const id = new Int32Array(ni * nj).fill(-1);
  const nodes = [], weights = [], edges = [];
  for (let a = 0; a < ni; a++) for (let b = 0; b < nj; b++) {
    const I = I0 + a * step + (step >> 1), J = J0 + b * step + (step >> 1);
    if (Math.abs(world.topK(I, J) - world.groundK) > maxRise) continue;
    const w = PAVED[topName(world, I, J)];
    if (!w) continue;
    id[a * nj + b] = nodes.length / 2;
    nodes.push((I + 0.5) * S, (J + 0.5) * S);
    weights.push(Math.round(w * 2));
  }
  for (let a = 0; a < ni; a++) for (let b = 0; b < nj; b++) {
    const p = id[a * nj + b];
    if (p < 0) continue;
    for (const [da, db] of [[1, 0], [0, 1], [1, 1], [1, -1]]) {
      const A = a + da, B = b + db;
      if (A >= ni || B < 0 || B >= nj) continue;
      const q = id[A * nj + B];
      if (q < 0) continue;
      if (da && db && (id[A * nj + b] < 0 || id[a * nj + B] < 0)) continue; // no corner cutting
      edges.push(p, q);
    }
  }
  return { version: 1, kind: 'walkways', meta: { source: 'world' }, nodes, weights, edges };
}
