// Geometry for the v2 detail pieces (CONTRACT section 2.1, ids 38+).
//
// Same local frame as every piece (src/shapes.js): centred footprint, +x = +i, y up,
// FRONT toward -z (= +j at rot 0). Each builder returns { body, glass? }: `body` uses the
// record colour, `glass` (window and door panes) always uses the glass material.
import { INSET, merge, slab, brickBox, latheRound, extrudeFront, post } from './shapes.js';
import { lookGeometry } from './details-look.js';

const BAR = 0.06;       // frame bar width (contract)
const PANE_BACK = 0.1;  // panes sit this far behind the front face (contract)
const PANE_T = 0.012;   // pane thickness

/** Arch: a brick with an elliptical opening through it, open at the bottom. */
function arch(W, H, D, spanStuds, S) {
  const rx = (spanStuds * S) / 2;
  const lintel = Math.max(0.1, H / 6);
  const crown = H - lintel;              // 1x4: 0.5 m, 1x6: 1.0 m (5 plates)
  const ry = Math.min(rx, crown / 2);
  const side = crown - ry;               // straight part of the opening's sides
  const x0 = -W / 2 + INSET, x1 = W / 2 - INSET;
  const pts = [[x0, INSET], [-rx, INSET], [-rx, side]];
  for (let s = 1; s < 24; s++) {
    const a = Math.PI - (s / 24) * Math.PI; // left -> over the top -> right
    pts.push([rx * Math.cos(a), side + ry * Math.sin(a)]);
  }
  pts.push([rx, side], [rx, INSET], [x1, INSET], [x1, H - INSET], [x0, H - INSET]);
  return { body: extrudeFront(pts, -D / 2 + INSET, D / 2 - INSET) };
}

/** Outer frame: two side bars, a top bar and (optionally) a sill, all full depth. */
function frame(W, H, D, withSill) {
  const z0 = -D / 2 + INSET, z1 = D / 2 - INSET, r = 0.01;
  const parts = [
    slab(-W / 2 + INSET, -W / 2 + BAR, INSET, H - INSET, z0, z1, r),
    slab(W / 2 - BAR, W / 2 - INSET, INSET, H - INSET, z0, z1, r),
    slab(-W / 2 + BAR, W / 2 - BAR, H - BAR, H - INSET, z0, z1, r),
  ];
  if (withSill) parts.push(slab(-W / 2 + BAR, W / 2 - BAR, INSET, BAR, z0, z1, r));
  return parts;
}

/** One pane (no seams: the whole opening is one sheet of glass). */
function pane(x0, x1, y0, y1, D) {
  const z = -D / 2 + PANE_BACK;
  return slab(x0, x1, y0, y1, z - PANE_T / 2, z + PANE_T / 2);
}

/** Window: frame, vertical mullion, transom at 2/3 height, glass set back 0.1 m. */
function windowPiece(W, H, D) {
  const zf = -D / 2 + PANE_BACK - PANE_T / 2; // glazing bars sit just in front of the pane
  const yT = BAR + (H - 2 * BAR) * (2 / 3);
  const body = merge([
    ...frame(W, H, D, true),
    slab(-0.02, 0.02, BAR, H - BAR, zf - 0.03, zf),
    slab(-W / 2 + BAR, W / 2 - BAR, yT - 0.02, yT + 0.02, zf - 0.03, zf),
  ]);
  return { body, glass: pane(-W / 2 + BAR, W / 2 - BAR, BAR, H - BAR, D) };
}

/** Door: frame, leaf 0.06 m back with 4 raised panels, glass fanlight in the top 2 plates. */
function door(W, H, D, P) {
  const yF = H - 2 * P;                    // bottom of the fanlight zone
  const z0 = -D / 2 + INSET, z1 = D / 2 - INSET;
  const lx0 = -W / 2 + BAR, lx1 = W / 2 - BAR, leafW = lx1 - lx0;
  const lz = -D / 2 + 0.06;                // leaf front face
  const parts = [...frame(W, H, D, false), slab(lx0, lx1, yF, yF + BAR, z0, z1, 0.01)];
  parts.push(slab(lx0, lx1, INSET, yF, lz, lz + 0.05));
  const m = 0.06, gap = 0.06, pw = (leafW - 2 * m - gap) / 2;
  const avail = yF - 2 * m - gap, rows = [[m, m + avail * 0.42], [m + avail * 0.42 + gap, yF - m]];
  for (const [y0, y1] of rows)
    for (const x of [lx0 + m, lx0 + m + pw + gap]) parts.push(slab(x, x + pw, y0, y1, lz - 0.018, lz + 0.01, 0.008));
  parts.push(slab(lx1 - 0.1, lx1 - 0.07, yF * 0.48, yF * 0.52, lz - 0.04, lz)); // handle
  parts.push(slab(-0.015, 0.015, yF + BAR, H - BAR, lz + 0.02, lz + 0.04)); // fanlight bar
  return { body: merge(parts), glass: pane(lx0, lx1, yF + BAR, H - BAR, D) };
}

/** Fence: half-plate rails top and bottom (studs go on the top rail), round spindles. */
function fence(W, H, D) {
  const z0 = -D / 2 + INSET, z1 = D / 2 - INSET, rail = 0.1;
  const parts = [slab(-W / 2 + INSET, W / 2 - INSET, H - rail, H - INSET, z0, z1, 0.015),
    slab(-W / 2 + INSET, W / 2 - INSET, INSET, rail, z0, z1, 0.015)];
  for (let x = -W / 2 + 0.125; x < W / 2; x += 0.25) parts.push(post(x, 0, 0.04, rail - 0.01, H - rail + 0.01));
  return { body: merge(parts) };
}

/** Grille tile: a tile with 3 grooves running along w on top. */
function grille(W, H, D) {
  const g = 0.04, depth = 0.04, ribs = 4;
  const zA = -D / 2 + INSET, rib = (D - 2 * INSET - 3 * g) / ribs;
  const parts = [brickBox(W, H - depth, D, 0.015)];
  for (let r = 0; r < ribs; r++) {
    const z = zA + r * (rib + g);
    parts.push(slab(-W / 2 + INSET, W / 2 - INSET, H - depth - 0.01, H - INSET, z, z + rib, 0.008));
  }
  return { body: merge(parts) };
}

/** Geometry for a detail kind, or null if `t.kind` is not a detail piece. */
export function detailGeometry(t, S, P) {
  const look = lookGeometry(t, S, P); // look-v2 pieces (ids 48+) are picked by name
  if (look) return look;
  const W = t.w * S, D = t.d * S, H = t.h * P;
  switch (t.kind) {
    case 'arch': return arch(W, H, D, t.w - 2, S);
    case 'window': return windowPiece(W, H, D);
    case 'door': return door(W, H, D, P);
    case 'fence': return fence(W, H, D);
    case 'round_tile': return { body: latheRound(Math.min(W, D) / 2 - 0.012, H - INSET, 0.02, 24, true) };
    case 'jumper': return { body: brickBox(W, H, D) };
    case 'tile_grille': return grille(W, H, D);
    default: return null;
  }
}
