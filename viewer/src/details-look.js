// Geometry for the look-v2 pieces (CONTRACT 2.1, ids 48-56, palette v3), from the owner's Markt
// photos: tall many-paned sash windows, shop windows with lettering, wrought-iron balconies,
// french-window railings, pediments, double-lantern lamp posts, cast-iron bollards with
// chains and cellar vents.
//
// They reuse existing kinds (window, fence, arch, tile_grille) so older renderers still load
// the catalogue and fall back to that kind's generic shape; here they are picked by NAME.
// Same local frame as every piece (src/shapes.js): centred footprint, +x = +i, y up, FRONT
// toward -z (= +j at rot 0). Each builder returns { body, glass? }.
import * as THREE from 'three';
import { INSET, merge, slab, extrudeFront, post } from './shapes.js';

const BAR = 0.06;       // outer frame bar (contract, as the v2 windows)
const PANE_BACK = 0.1;  // panes sit this far behind the front face
const PANE_T = 0.012;
const GB = 0.022;       // glazing bar width

function pane(x0, x1, y0, y1, D) {
  const z = -D / 2 + PANE_BACK;
  return slab(x0, x1, y0, y1, z - PANE_T / 2, z + PANE_T / 2);
}

function outerFrame(W, H, D) {
  const z0 = -D / 2 + INSET, z1 = D / 2 - INSET, r = 0.01;
  return [
    slab(-W / 2 + INSET, -W / 2 + BAR, INSET, H - INSET, z0, z1, r),
    slab(W / 2 - BAR, W / 2 - INSET, INSET, H - INSET, z0, z1, r),
    slab(-W / 2 + BAR, W / 2 - BAR, H - BAR, H - INSET, z0, z1, r),
    slab(-W / 2 + BAR, W / 2 - BAR, INSET, BAR, z0, z1, r),
  ];
}

/** Glazing bars dividing [x0,x1] x [y0,y1] into cols x rows panes, just in front of the glass. */
function glazing(x0, x1, y0, y1, cols, rows, zf, t = GB) {
  const out = [];
  for (let c = 1; c < cols; c++) {
    const x = x0 + ((x1 - x0) * c) / cols;
    out.push(slab(x - t / 2, x + t / 2, y0, y1, zf - 0.025, zf));
  }
  for (let r = 1; r < rows; r++) {
    const y = y0 + ((y1 - y0) * r) / rows;
    out.push(slab(x0, x1, y - t / 2, y + t / 2, zf - 0.025, zf));
  }
  return out;
}

/** Tall sash window: two sashes of 2 x 3 panes under a transom of small panes. */
function tallWindow(W, H, D) {
  const zf = -D / 2 + PANE_BACK - PANE_T / 2;
  const yT = H * 0.78, m = 0.026;
  const x0 = -W / 2 + BAR, x1 = W / 2 - BAR;
  const parts = [...outerFrame(W, H, D),
    slab(-m, m, BAR, H - BAR, zf - 0.045, zf),                       // mullion (meeting stiles)
    slab(x0, x1, yT - 0.03, yT + 0.03, zf - 0.05, zf),                // transom
  ];
  for (const [a, b] of [[x0, -m], [m, x1]]) {
    parts.push(...glazing(a, b, BAR, yT - 0.03, 2, 3, zf));
    parts.push(...glazing(a, b, yT + 0.03, H - BAR, 2, 1, zf));
    parts.push(slab(a, b, (BAR + yT) / 2 - 0.018, (BAR + yT) / 2 + 0.018, zf - 0.035, zf)); // meeting rail
  }
  return { body: merge(parts), glass: pane(x0, x1, BAR, H - BAR, D) };
}

/** Shop window: big lower lights, a heavy transom, upper lights with an arch and lettering. */
function shopWindow(W, H, D) {
  const zf = -D / 2 + PANE_BACK - PANE_T / 2;
  const yT = H * 0.72, m = 0.028;
  const x0 = -W / 2 + BAR, x1 = W / 2 - BAR;
  const parts = [...outerFrame(W, H, D),
    slab(-m, m, BAR, H - BAR, zf - 0.05, zf),
    slab(x0, x1, yT - 0.035, yT + 0.035, zf - 0.06, zf),
  ];
  const top = H - BAR, yL = yT + (top - yT) * 0.45;
  for (const [a, b] of [[x0, -m], [m, x1]]) {
    parts.push(...glazing(a, b, BAR, yT - 0.035, 1, 3, zf));
    // a round-headed arch in each upper light (half torus, in front of the glass)
    const r = (b - a) / 2 - 0.015, cx = (a + b) / 2;
    const arc = new THREE.TorusGeometry(r, 0.011, 4, 16, Math.PI);
    arc.translate(cx, Math.max(yT + 0.05, top - r - 0.03), zf - 0.012);
    parts.push(arc);
    // lettering: a word of small raised blocks (white like the frame)
    const widths = [0.034, 0.05, 0.03, 0.044, 0.038];
    const total = widths.reduce((s, w) => s + w + 0.012, -0.012);
    let x = cx - total / 2;
    for (const w of widths) {
      parts.push(slab(x, x + w, yL - 0.04, yL + 0.04, zf - 0.016, zf - 0.004));
      x += w + 0.012;
    }
  }
  return { body: merge(parts), glass: pane(x0, x1, BAR, H - BAR, D) };
}

/** Ring of a wrought-iron railing, in the plane facing -z (or turned to face x). */
function ring(x, y, z, r, tube, sideways = false, arc = Math.PI * 2) {
  const g = new THREE.TorusGeometry(r, tube, 3, arc < 6 ? 7 : 12, arc);
  if (sideways) g.rotateY(Math.PI / 2);
  g.translate(x, y, z);
  return g;
}

/** Vase-shaped corner post (lathe). */
function vasePost(x, z, y0, y1, r) {
  const h = y1 - y0, P = (a, b) => new THREE.Vector2(a, b);
  const pts = [P(0, 0), P(r * 0.9, 0), P(r * 0.9, h * 0.06), P(r * 0.55, h * 0.12), P(r, h * 0.45),
    P(r * 0.45, h * 0.8), P(r * 0.7, h * 0.9), P(r * 0.5, h), P(0, h)];
  const g = new THREE.LatheGeometry(pts, 8);
  g.translate(x, y0, z);
  return g;
}

/**
 * Wrought-iron balcony (4 x 2 studs, 5 plates): an iron floor plate, an ornate front of
 * rings, bars and scrolls between rails, vase posts at the front corners and returns at the
 * sides back to the wall (the back face). Black in the data.
 */
function balcony(W, H, D) {
  const zr = -D / 2 + 0.05, xs = W / 2 - 0.05, top = H - 0.05, bot = 0.12;
  const parts = [
    slab(-W / 2 + INSET, W / 2 - INSET, INSET, 0.06, -D / 2 + INSET, D / 2 - INSET, 0.01),       // floor
    slab(-xs, xs, top - 0.04, top + 0.02, zr - 0.03, zr + 0.03, 0.01),                         // handrail
    slab(-xs, xs, bot - 0.03, bot, zr - 0.015, zr + 0.015),                                    // bottom rail
    slab(-xs, xs, top - 0.14, top - 0.12, zr - 0.012, zr + 0.012),                             // frieze rail
  ];
  const yMid = (bot + top - 0.14) / 2, rr = Math.min(0.085, (top - 0.14 - bot) / 2 - 0.02);
  const n = Math.max(3, Math.round((2 * xs) / 0.22));
  for (let q = 0; q < n; q++) {
    const x = -xs + ((q + 0.5) * 2 * xs) / n;
    parts.push(ring(x, yMid, zr, rr, 0.011));                                          // rings
    if (q % 2 === 0) parts.push(ring(x, yMid, zr, rr * 0.45, 0.009));                // inner rosette
    parts.push(ring(x, top - 0.13 + 0.0, zr, 0.045, 0.008, false, Math.PI));          // scrolls in the frieze
    parts.push(post(x - xs / n, zr, 0.009, bot, top - 0.14, 5));                       // bars between rings
  }
  parts.push(post(xs - 0.001, zr, 0.009, bot, top - 0.14, 5));
  for (const sx of [-1, 1]) {
    const x = sx * xs;
    parts.push(vasePost(x, zr, 0.06, top + 0.06, 0.045));
    // side returns to the wall
    parts.push(slab(x - 0.02, x + 0.02, top - 0.04, top + 0.01, zr, D / 2 - INSET, 0.008));
    parts.push(slab(x - 0.012, x + 0.012, bot - 0.03, bot, zr, D / 2 - INSET));
    const zc = (zr + D / 2) / 2;
    parts.push(ring(x, yMid, zc, Math.min(rr, (D / 2 - zr) / 2 - 0.03), 0.01, true));
    parts.push(post(x, D / 2 - 0.03, 0.012, bot, top, 5));
  }
  return { body: merge(parts) };
}

/** Simple french-window railing: rails and plain bars at the front, short returns to the wall. */
function railing(W, H, D) {
  const zr = -D / 2 + 0.06, xs = W / 2 - 0.04, top = H - 0.04;
  const parts = [
    slab(-xs, xs, top - 0.035, top + 0.01, zr - 0.025, zr + 0.025, 0.008),
    slab(-xs, xs, 0.06, 0.09, zr - 0.015, zr + 0.015),
  ];
  for (let x = -xs; x <= xs + 1e-6; x += (2 * xs) / 10) parts.push(post(x, zr, 0.008, 0.06, top - 0.03, 5));
  for (const sx of [-1, 1]) {
    parts.push(slab(sx * xs - 0.015, sx * xs + 0.015, top - 0.035, top + 0.01, zr, D / 2 - INSET));
    parts.push(slab(sx * xs - 0.015, sx * xs + 0.015, INSET, top, D / 2 - 0.05, D / 2 - INSET));
  }
  return { body: merge(parts) };
}

/** Classical pediment: a cornice slab, a recessed tympanum and raking cornices. */
function pediment(W, H, D) {
  const base = 0.08, z0 = -D / 2 + INSET, z1 = D / 2 - INSET, e = 0.04;
  const parts = [slab(-W / 2 + INSET, W / 2 - INSET, INSET, base, z0, z1, 0.01)];
  parts.push(extrudeFront([[-W / 2 + e, base], [W / 2 - e, base], [0, H - INSET]], z0 + 0.05, z1));
  const t = 0.05; // raking cornice thickness
  const k = (H - INSET - base) / (W / 2 - e);
  const dy = t * Math.sqrt(1 + k * k);
  for (const s of [-1, 1]) {
    const xa = s * (W / 2 - INSET), xb = 0;
    const ya = base - 0.01, yb = H - INSET;
    parts.push(extrudeFront(s < 0
      ? [[xa, ya], [xb, yb], [xb, yb - dy], [xa + t, ya - 0.0]]
      : [[xa - t, ya], [xb, yb - dy], [xb, yb], [xa, ya]], z0, z0 + 0.06));
  }
  return { body: merge(parts) };
}

/** Lathe from (r, y) pairs. */
function lathe(pts, segments, x = 0, y = 0, z = 0) {
  const g = new THREE.LatheGeometry(pts.map(([r, h]) => new THREE.Vector2(r, h)), segments);
  g.translate(x, y, z);
  return g;
}

/** Lantern standing at (x, y): base, glass body (glass part), corner bars, cap and finial. */
function lantern(x, y, parts, glass) {
  const h = 0.32, w = 0.11;
  parts.push(lathe([[0, 0], [0.05, 0], [0.09, 0.05], [0.12, 0.06], [0, 0.06]], 8, x, y));
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) parts.push(slab(x + sx * w - 0.012, x + sx * w + 0.012, y + 0.06, y + 0.06 + h, sz * w - 0.012, sz * w + 0.012));
  glass.push(slab(x - w + 0.01, x + w - 0.01, y + 0.06, y + 0.06 + h, -w + 0.01, w - 0.01));
  parts.push(lathe([[0, 0], [0.16, 0], [0.16, 0.025], [0.05, 0.14], [0.02, 0.17], [0, 0.17]], 8, x, y + 0.06 + h));
  parts.push(lathe([[0, 0], [0.025, 0.01], [0.03, 0.04], [0.012, 0.08], [0, 0.09]], 8, x, y + 0.23 + h));
}

/** Black cast-iron lamp post with two lanterns on a scrolled cross arm (front: -z). */
function lampDouble(W, H) {
  const parts = [], glass = [];
  const yArm = H - 0.92, xa = Math.min(W / 2 - 0.16, 0.55);
  parts.push(lathe([[0, 0], [0.15, 0], [0.15, 0.08], [0.12, 0.13], [0.1, 0.5], [0.075, 0.56], [0, 0.56]], 12));
  parts.push(post(0, 0, 0.052, 0.55, yArm + 0.12, 10));
  parts.push(lathe([[0, 0], [0.075, 0], [0.075, 0.04], [0, 0.04]], 10, 0, 1.25));            // collar
  parts.push(lathe([[0, 0], [0.07, 0.02], [0.05, 0.08], [0, 0.1]], 10, 0, yArm - 0.08));      // arm boss
  parts.push(slab(-xa, xa, yArm, yArm + 0.04, -0.022, 0.022));
  for (const s of [-1, 1]) {
    parts.push(ring(s * xa * 0.48, yArm - 0.1, 0, 0.1, 0.012, false, Math.PI));               // scroll under the arm
    parts.push(ring(s * xa * 0.8, yArm - 0.05, 0, 0.05, 0.01));
    lantern(s * xa, yArm + 0.04, parts, glass);
  }
  parts.push(lathe([[0, 0], [0.04, 0], [0.05, 0.08], [0.02, 0.2], [0, 0.24]], 8, 0, yArm + 0.12)); // finial
  return { body: merge(parts), glass: merge(glass) };
}

/** Cast-iron bollard: flared foot, fluted shaft (8 facets), collar with chain eyes, ball top. */
function bollard(W, H) {
  const r = Math.min(W, 0.5) / 2;
  const parts = [lathe([[0, 0], [r * 0.72, 0], [r * 0.72, 0.05], [r * 0.52, 0.11], [r * 0.46, 0.15],
    [r * 0.42, H * 0.7], [r * 0.5, H * 0.73], [r * 0.5, H * 0.79], [r * 0.4, H * 0.81], [r * 0.4, H * 0.86],
    [r * 0.3, H * 0.9], [0, H * 0.9]], 8)];
  parts.push(new THREE.SphereGeometry(r * 0.24, 10, 6).translate(0, H * 0.9 + r * 0.2, 0));
  for (const s of [-1, 1]) parts.push(ring(s * r * 0.58, H * 0.76, 0, 0.032, 0.01, true));
  return { body: merge(parts) };
}

/** Chain hanging between two bollards one stud beyond each end (links along a catenary). */
function chain(W, H) {
  const xe = W / 2 + 0.11, yEnd = 0.76 * 1.0 - 0.4, sag = 0.24, n = 22;
  const parts = [];
  for (let q = 0; q <= n; q++) {
    const x = -xe + (2 * xe * q) / n;
    const u = x / xe, y = yEnd - sag * (1 - u * u);
    const slope = (2 * sag * u) / xe;
    const g = new THREE.TorusGeometry(0.036, 0.009, 3, 6);
    g.scale(1.45, 1, 1);
    if (q % 2) g.rotateX(Math.PI / 2);
    g.rotateZ(Math.atan(slope));
    g.translate(x, Math.min(H - 0.03, Math.max(0.03, y)), 0);
    parts.push(g);
  }
  return { body: merge(parts) };
}

/** Cellar vent: a stone-coloured frame round a recess of vertical bars. */
function vent(W, H, D) {
  const z0 = -D / 2 + INSET, z1 = D / 2 - INSET, f = 0.06, rec = 0.05;
  const parts = [
    slab(-W / 2 + INSET, W / 2 - INSET, INSET, H - INSET, z0 + rec, z1, 0.01),
    slab(-W / 2 + INSET, -W / 2 + f, INSET, H - INSET, z0, z0 + rec + 0.01),
    slab(W / 2 - f, W / 2 - INSET, INSET, H - INSET, z0, z0 + rec + 0.01),
    slab(-W / 2 + f, W / 2 - f, H - f, H - INSET, z0, z0 + rec + 0.01),
    slab(-W / 2 + f, W / 2 - f, INSET, f, z0, z0 + rec + 0.01),
  ];
  for (let x = -W / 2 + f + 0.04; x < W / 2 - f - 0.02; x += 0.055) parts.push(slab(x - 0.012, x + 0.012, f, H - f, z0 + 0.012, z0 + rec + 0.01));
  return { body: merge(parts) };
}

const BUILDERS = {
  window_1x2x4: tallWindow,
  shop_window_1x2x4: shopWindow,
  balcony_2x4: balcony,
  railing_1x2: railing,
  pediment_1x4: pediment,
  lamp_double_1x3: (W, H) => lampDouble(W, H),
  bollard_1x1: (W, H) => bollard(W, H),
  chain_1x4: (W, H) => chain(W, H),
  vent_1x2: vent,
};

/** { body, glass? } for a look-v2 piece by name, or null. */
export function lookGeometry(t, S, P) {
  const make = BUILDERS[t.name];
  return make ? make(t.w * S, t.h * P, t.d * S) : null;
}

export const LOOK_PIECES = Object.keys(BUILDERS);
