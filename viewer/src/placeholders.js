// Tiny stand-in brick models used until contract/models/*.json exist (the pipeline owns
// those). Built with the same JSON shape as CONTRACT section 7.1, from plain 1x1 bricks and
// plates, so the movers and the walk cycle can be exercised. Figures are blocky stacks of
// bricks (no minifigure shape).
const BRICK = 1, PLATE = 12, ROUND = 36;
const C = { red: 38, black: 11, glass: 34, white: 8, blue: 21, tan: 18, yellow: 37, grey: 10, cream: 17 };

/** Fill a box of 1x1 cells (k counted in plates; bricks need 3-plate steps). */
function box(out, i0, j0, k0, wi, dj, plates, color, part, type = BRICK) {
  const step = type === PLATE ? 1 : 3;
  for (let k = k0; k < k0 + plates; k += step)
    for (let j = j0; j < j0 + dj; j++)
      for (let i = i0; i < i0 + wi; i++) out.push({ i, j, k, type, color, rot: 0, ...(part ? { part } : {}) });
}

function bus() {
  const b = [];
  box(b, 0, 0, 0, 5, 20, 1, C.black, null, PLATE);          // chassis
  box(b, 0, 0, 1, 5, 20, 3, C.red);                          // lower body
  box(b, 0, 0, 4, 5, 20, 6, C.glass);                        // window band
  box(b, 0, 0, 10, 5, 20, 3, C.red);                         // roof band
  box(b, 0, 0, 13, 5, 20, 1, C.white, null, PLATE);          // roof
  return { name: 'bus', version: 1, size: [5, 20, 14], pivot: [2.5, 10, 0], forward: '+j', parts: {}, bricks: b };
}

function boat() {
  const b = [];
  box(b, 0, 0, 0, 6, 16, 3, C.blue);
  box(b, 1, 16, 0, 4, 2, 3, C.blue);
  box(b, 0, 0, 3, 6, 18, 1, C.tan, null, PLATE);
  box(b, 1, 3, 4, 4, 8, 6, C.white);
  box(b, 1, 3, 10, 4, 8, 1, C.grey, null, PLATE);
  return { name: 'boat', version: 1, size: [6, 18, 11], pivot: [3, 9, 1.5], forward: '+j', parts: {}, bricks: b };
}

function figure(name, shirt) {
  const b = [];
  box(b, 0, 0, 0, 1, 1, 6, C.black, 'leg_l');
  box(b, 1, 0, 0, 1, 1, 6, C.black, 'leg_r');
  box(b, 0, 0, 6, 2, 1, 6, shirt);
  box(b, -1, 0, 7, 1, 1, 5, shirt, 'arm_l', PLATE);
  box(b, 2, 0, 7, 1, 1, 5, shirt, 'arm_r', PLATE);
  b.push({ i: 0, j: 0, k: 12, type: ROUND, color: C.cream, rot: 0 }, { i: 1, j: 0, k: 12, type: ROUND, color: C.cream, rot: 0 });
  return {
    name, version: 1, size: [4, 1, 15], pivot: [2, 0.5, 0], forward: '+j',
    parts: { leg_l: { pivot: [0.5, 0.5, 6] }, leg_r: { pivot: [1.5, 0.5, 6] },
      arm_l: { pivot: [-0.5, 0.5, 11.5] }, arm_r: { pivot: [2.5, 0.5, 11.5] } },
    bricks: b.map((r) => ({ ...r, i: r.i + 1 })),
  };
}

export function placeholderModels() {
  const f1 = figure('walker_a', C.red), f2 = figure('walker_b', C.yellow);
  for (const f of [f1, f2]) for (const p of Object.values(f.parts)) p.pivot[0] += 1;
  return { bus: bus(), boat: boat(), walker_a: f1, walker_b: f2 };
}
