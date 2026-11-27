// The furniture kit for interiors (pure, no three.js): each kind is a few boxes in the piece's
// own frame, built like a brick model. Piece frame: a = metres to the piece's right, y = up from
// the floor, b = toward its FRONT (the side a sitter faces, the open side of a shelf, the
// customers' side of a bar). The piece origin is the centre of its footprint on the floor.
// layout.js turns pieces by their facing through the rotation helpers (src/rotation.js).
//
// A part: { c: [a, y, b] centre, s: [w, h, d] size, col: 'main' | 'trim' | '#rrggbb',
//           studs?: true (studs on its top face), glow?: 0..1 (lit: lamp shades, screens),
//           tex?: 'menu' | 'slide' (the place's menu / slide drawn on its front face),
//           shade?: brightness factor (brick courses) }
// The university pieces (lecture rooms, libraries, halls) live in kit-campus.js and are merged
// in below. A kind's default colour or trim '@walls' / '@trim' means "the room's look colour".
import { campusKit } from './kit-campus.js';

/** Seat height (m) of the figure rig's sitting pose (figure/rig.js SEAT_H). */
export const RIG_SEAT_H = 0.46;

const leg = (a, b, h, t = 0.06, col = 'trim') => ({ c: [a, h / 2, b], s: [t, h, t], col });
const corners = (w, d, inset) => [[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([sa, sb]) => [sa * (w / 2 - inset), sb * (d / 2 - inset)]);

function table([w, h, d]) {
  const top = 0.06;
  return [{ c: [0, h - top / 2, 0], s: [w, top, d], col: 'main', studs: true },
    ...corners(w, d, 0.07).map(([a, b]) => leg(a, b, h - top))];
}

function chair([w, h, d]) {
  const seat = RIG_SEAT_H - 0.02, back = 0.05;
  return [{ c: [0, seat - 0.03, 0], s: [w, 0.06, d], col: 'main' },
    { c: [0, seat + (h - seat) / 2, -d / 2 + back / 2], s: [w, h - seat, back], col: 'main' },
    ...corners(w, d, 0.04).map(([a, b]) => leg(a, b, seat - 0.06, 0.05))];
}

function stool([w, h, d]) {
  return [{ c: [0, h - 0.03, 0], s: [w, 0.06, d], col: 'main', studs: true },
    { c: [0, (h - 0.06) / 2, 0], s: [0.07, h - 0.06, 0.07], col: 'trim' },
    { c: [0, 0.28, 0], s: [w * 0.8, 0.03, d * 0.8], col: 'trim' }, // foot ring
    { c: [0, 0.015, 0], s: [w * 0.9, 0.03, d * 0.9], col: 'trim' }];
}

function bar([w, h, d]) {
  return [{ c: [0, (h - 0.06) / 2, -0.03], s: [w, h - 0.06, d - 0.06], col: 'main' },
    { c: [0, h - 0.03, 0], s: [w + 0.04, 0.06, d + 0.04], col: 'trim', studs: true },
    { c: [0, 0.2, d / 2 + 0.06], s: [w - 0.1, 0.04, 0.04], col: '#C8A85A' }, // foot rail
    { c: [0, 0.05, -0.02], s: [w - 0.02, 0.1, d - 0.08], col: '#2A2522' }]; // kick plate
}

const ITEM_COLS = ['#C8102E', '#2F5A3C', '#F2A900', '#22385A', '#EFE3C2', '#7A4A2A', '#9AC0D8', '#5E2B5A'];

function shelf([w, h, d]) {
  const out = [{ c: [0, h / 2, -d / 2 + 0.02], s: [w, h, 0.04], col: 'main' },
    { c: [-w / 2 + 0.02, h / 2, 0], s: [0.04, h, d], col: 'main' },
    { c: [w / 2 - 0.02, h / 2, 0], s: [0.04, h, d], col: 'main' }];
  const rows = Math.max(2, Math.round(h / 0.45));
  for (let r = 0; r <= rows; r++) {
    const y = Math.min(h - 0.02, 0.06 + (r * (h - 0.08)) / rows);
    out.push({ c: [0, y, 0], s: [w - 0.04, 0.04, d], col: 'trim', studs: r === rows });
    if (r === rows) break;
    // bottles and jars: a deterministic row of small coloured blocks
    const n = Math.max(2, Math.floor((w - 0.1) / 0.16));
    for (let q = 0; q < n; q++) {
      if ((q * 7 + r * 3) % 5 === 4) continue; // gaps
      const ih = 0.14 + (((q * 13 + r * 5) % 4) * 0.05);
      const a = -w / 2 + 0.1 + (q * (w - 0.2)) / Math.max(1, n - 1);
      out.push({ c: [a, y + 0.02 + ih / 2, 0], s: [0.09, ih, 0.09], col: ITEM_COLS[(q * 3 + r) % ITEM_COLS.length] });
    }
  }
  return out;
}

function plant([w, h, d]) {
  const pot = Math.min(0.42, h * 0.35);
  const out = [{ c: [0, pot / 2, 0], s: [w * 0.8, pot, d * 0.8], col: 'trim' }];
  // leaves: a stepped pile of green blocks, wide at the bottom (a brick-built shrub)
  const tiers = 3, lh = (h - pot) / tiers;
  for (let t = 0; t < tiers; t++) {
    const k = 1 - t * 0.25;
    out.push({ c: [0, pot + lh * (t + 0.5), 0], s: [w * k, lh, d * k], col: 'main', studs: t === tiers - 1 });
  }
  return out;
}

function lamp([w, h, d]) {
  return [{ c: [0, 0.02, 0], s: [w * 0.7, 0.04, d * 0.7], col: 'trim' },
    { c: [0, (h - 0.3) / 2, 0], s: [0.04, h - 0.3, 0.04], col: 'trim' },
    { c: [0, h - 0.15, 0], s: [w, 0.3, d], col: 'main', glow: 0.5 }];
}

// a ceiling lamp: the piece's y origin is moved to the ceiling by layout.js (hangs down from it)
function pendant([w, h, d]) {
  return [{ c: [0, h - (h - 0.22) / 2, 0], s: [0.02, h - 0.22, 0.02], col: '#1E1F21' },
    { c: [0, 0.11, 0], s: [w, 0.22, d], col: 'main', glow: 0.55 }];
}

function sofa([w, h, d]) {
  const seat = 0.42, arm = 0.16;
  return [{ c: [0, seat / 2, 0.02], s: [w - 2 * arm, seat, d - 0.04], col: 'main', studs: true },
    { c: [0, seat + (h - seat) / 2, -d / 2 + 0.1], s: [w, h - seat, 0.2], col: 'main' },
    { c: [-w / 2 + arm / 2, 0.31, 0], s: [arm, 0.62, d], col: 'trim' },
    { c: [w / 2 - arm / 2, 0.31, 0], s: [arm, 0.62, d], col: 'trim' }];
}

function menu([w, h, d]) {
  return [{ c: [0, h / 2, 0], s: [w + 0.08, h + 0.08, d], col: 'trim' },
    { c: [0, h / 2, d / 2 + 0.005], s: [w, h, 0.01], col: 'main', tex: 'menu', glow: 0.25 }];
}

function rug([w, h, d]) { return [{ c: [0, h / 2, 0], s: [w, h, d], col: 'main' }]; }

function machine([w, h, d]) {
  return [{ c: [0, h / 2, 0], s: [w, h, d], col: 'main', studs: true },
    { c: [0, h * 0.35, d / 2 + 0.03], s: [w * 0.6, 0.06, 0.06], col: 'trim' },
    { c: [w * 0.3, h * 0.75, d / 2 + 0.005], s: [0.08, 0.05, 0.01], col: '#7CFF9A', glow: 1 }];
}

/**
 * kind -> { size: [w, h, d] default (m), colour, trim (defaults), parts(size) -> parts,
 *           solid (blocks walking), seats(size) -> [{ a, b, h }] (seat centres, seat height),
 *           y (default elevation above the floor), ceiling (hangs from the ceiling) }
 */
export const KIT = {
  table: { size: [0.8, 0.75, 0.8], colour: '#8F6A48', trim: '#3B2A20', parts: table, solid: true },
  longtable: { size: [1.6, 0.75, 0.8], colour: '#8F6A48', trim: '#3B2A20', parts: table, solid: true },
  lowtable: { size: [1.0, 0.42, 0.6], colour: '#6E4A33', trim: '#2A1D16', parts: table, solid: true },
  chair: { size: [0.45, 0.9, 0.45], colour: '#5C3A24', trim: '#2A1D16', parts: chair, solid: true,
    seats: () => [{ a: 0, b: 0, h: RIG_SEAT_H }] },
  stool: { size: [0.38, 0.72, 0.38], colour: '#C8102E', trim: '#1E1F21', parts: stool, solid: true,
    seats: ([, h]) => [{ a: 0, b: 0, h }] },
  bar: { size: [3.0, 1.08, 0.65], colour: '#6E4A33', trim: '#2A1D16', parts: bar, solid: true },
  shelf: { size: [1.4, 2.0, 0.35], colour: '#5C3A24', trim: '#8F6A48', parts: shelf, solid: true },
  plant: { size: [0.5, 1.2, 0.5], colour: '#2F7A3C', trim: '#B5532A', parts: plant, solid: true },
  lamp: { size: [0.4, 1.6, 0.4], colour: '#FFE2A8', trim: '#1E1F21', parts: lamp, solid: true },
  pendant: { size: [0.4, 0.7, 0.4], colour: '#FFD98A', trim: '#1E1F21', parts: pendant, solid: false, ceiling: true },
  sofa: { size: [1.8, 0.85, 0.85], colour: '#7A2E3A', trim: '#4A1A22', parts: sofa, solid: true,
    seats: ([w]) => { const n = Math.max(1, Math.round((w - 0.32) / 0.62)); const s = (w - 0.32) / n;
      return Array.from({ length: n }, (_, q) => ({ a: -(w - 0.32) / 2 + s * (q + 0.5), b: 0.05, h: 0.44 })); } },
  armchair: { size: [0.85, 0.85, 0.8], colour: '#2F4A5A', trim: '#1B2A33', parts: sofa, solid: true,
    seats: () => [{ a: 0, b: 0.05, h: 0.44 }] },
  menu: { size: [1.0, 0.8, 0.06], colour: '#1F2B24', trim: '#5C3A24', parts: menu, solid: true, y: 1.3 },
  rug: { size: [2.0, 0.02, 1.4], colour: '#8A3B2A', trim: '#8A3B2A', parts: rug, solid: false },
  machine: { size: [0.6, 0.45, 0.45], colour: '#B9BCC4', trim: '#1E1F21', parts: machine, solid: true, y: 1.08 },
  ...campusKit({ seatH: RIG_SEAT_H, table }),
};

export const KIT_KINDS = Object.freeze(Object.keys(KIT));
