// Furniture for university buildings (pure, no three.js): lecture rooms, libraries, entrance
// halls. Same piece frame and part format as kit.js (a = right, y = up, b = toward the FRONT).
// kit.js calls campusKit(shared) and merges the result into KIT, so there is one registry.
//
// Fronts: seat rows and benches face the way a sitter looks; desks, the reception and the
// lectern face the visitors / audience (the user stands or sits behind, on the back side);
// screens, boards and bookcases face the room (their readable / open side); stairs face the
// bottom step (they rise toward the back).

const BOOK_COLS = ['#7A2E3A', '#22385A', '#2F5A3C', '#C8A85A', '#5E2B5A', '#EFE3C2', '#8A3B2A', '#3B5E7A', '#1E1F21', '#B5653F'];
const PAPER_COLS = ['#FFF6C8', '#F6F3EA', '#FFD7D7', '#D8ECFF', '#DFF2D8', '#FFE2A8'];

/** Seats along a row of width w: n = round(w / pitch), centres spread evenly, at b and height h. */
export function rowSeats(w, b, h, pitch = 0.6) {
  const n = Math.max(1, Math.round(w / pitch)), s = w / n;
  return Array.from({ length: n }, (_, q) => ({ a: -w / 2 + s * (q + 0.5), b, h }));
}

/** Bricks of a course along [-w/2, w/2]: running bond (odd courses start half a brick in). */
function courseSpans(w, course, brick = 1.0) {
  const out = [];
  for (let s = course % 2 ? -brick / 2 : 0; s < w; s += brick) {
    const s0 = Math.max(0, s), s1 = Math.min(w, s + brick);
    if (s1 - s0 > 0.02) out.push([s0 - w / 2, s1 - w / 2]);
  }
  return out;
}

/** A fixed pseudo-random 0..1 for (a, b) (deterministic look, no Math.random). */
const pick = (a, b) => { let h = Math.imul(a * 374761393 + b * 668265263, 0x27d4eb2d); h ^= h >>> 15; return (h >>> 0) / 4294967296; };

export function campusKit({ seatH, table }) {
  // a row of fixed lecture seats with a writing ledge in front of them
  function seatrow([w, h, d]) {
    const seatD = 0.42, sb = -d / 2 + 0.05 + seatD / 2;
    const out = [
      { c: [0, seatH - 0.03, sb], s: [w, 0.06, seatD], col: 'main' },
      { c: [0, seatH + (h - seatH) / 2, -d / 2 + 0.03], s: [w, h - seatH, 0.06], col: 'main' },
      { c: [0, 0.74, d / 2 - 0.16], s: [w, 0.04, 0.32], col: 'trim', studs: true }, // writing ledge
      { c: [0, 0.36, d / 2 - 0.02], s: [w, 0.72, 0.04], col: 'trim' }, // front panel under the ledge
      { c: [-w / 2 + 0.025, 0.375, 0], s: [0.05, 0.75, d], col: 'trim' },
      { c: [w / 2 - 0.025, 0.375, 0], s: [0.05, 0.75, d], col: 'trim' },
    ];
    const seats = rowSeats(w, sb, seatH);
    for (let q = 1; q < seats.length; q++) {
      const a = (seats[q - 1].a + seats[q].a) / 2;
      out.push({ c: [a, seatH + 0.14, sb], s: [0.04, 0.05, seatD * 0.8], col: 'trim' }); // armrests
    }
    return out;
  }

  // a riser for a tiered lecture room: walk up on it (keep each step <= 0.4 m above the next)
  function tier([w, h, d]) {
    return [{ c: [0, h / 2, 0], s: [w, h, d], col: 'main' },
      { c: [0, h - 0.02, d / 2 - 0.03], s: [w, 0.04, 0.06], col: 'trim' }]; // nosing
  }

  function lectern([w, h, d]) {
    return [{ c: [0, 0.03, 0], s: [w, 0.06, d], col: 'trim' },
      { c: [0, (h - 0.1) / 2, 0.03], s: [w * 0.75, h - 0.1, d * 0.7], col: 'main' },
      { c: [0, h - 0.04, -0.03], s: [w, 0.08, d], col: 'trim' },
      { c: [w * 0.3, h + 0.02, -0.12], s: [0.12, 0.04, 0.08], col: '#FFE2A8', glow: 0.6 }]; // reading light
  }

  // a desk with a modesty panel on its front (the visitors' / audience side)
  function desk([w, h, d]) {
    const top = 0.05;
    return [{ c: [0, h - top / 2, 0], s: [w, top, d], col: 'main', studs: true },
      { c: [0, (h - top) / 2 + 0.05, d / 2 - 0.03], s: [w - 0.04, h - top - 0.1, 0.04], col: 'trim' },
      { c: [-w / 2 + 0.03, (h - top) / 2, 0], s: [0.05, h - top, d - 0.04], col: 'trim' },
      { c: [w / 2 - 0.03, (h - top) / 2, 0], s: [0.05, h - top, d - 0.04], col: 'trim' }];
  }

  // reception: a high counter on the visitors' side, a desk-height worktop behind it
  function reception([w, h, d]) {
    return [{ c: [0, (h - 0.05) / 2, d / 2 - 0.12], s: [w, h - 0.05, 0.24], col: 'main' },
      { c: [0, h - 0.025, d / 2 - 0.16], s: [w + 0.06, 0.05, 0.34], col: 'trim', studs: true },
      { c: [0, 0.74, -0.08], s: [w - 0.1, 0.04, d - 0.3], col: 'trim' },
      { c: [-w / 2 + 0.04, 0.37, -0.08], s: [0.06, 0.74, d - 0.3], col: 'main' },
      { c: [w / 2 - 0.04, 0.37, -0.08], s: [0.06, 0.74, d - 0.3], col: 'main' },
      { c: [0, 0.05, d / 2 - 0.1], s: [w - 0.04, 0.1, 0.2], col: '#2A2522' }, // kick plate
      { c: [-w / 4, 0.95, -0.12], s: [0.5, 0.34, 0.04], col: '#9FC4E8', glow: 0.55 }, // monitors
      { c: [w / 4, 0.95, -0.12], s: [0.5, 0.34, 0.04], col: '#9FC4E8', glow: 0.55 }];
  }

  // a long study table: studded top, legs, a low power strip along its middle
  function studytable(size) {
    const [w, h] = size;
    return [...table(size), { c: [0, h + 0.05, 0], s: [w - 0.3, 0.1, 0.08], col: '#1E1F21' }];
  }

  // a wall screen with the place's slide on it (mesh.js draws the text on its front face)
  function screen([w, h, d]) {
    return [{ c: [0, h / 2, 0], s: [w, h, d], col: 'trim' },
      { c: [0, h / 2, d / 2 + 0.005], s: [w - 0.1, h - 0.1, 0.01], col: 'main', tex: 'slide', glow: 0.35 }];
  }

  // a cork board with notes pinned on it
  function noticeboard([w, h, d]) {
    const out = [{ c: [0, h / 2, 0], s: [w, h, d], col: 'trim' },
      { c: [0, h / 2, d / 2 + 0.003], s: [w - 0.06, h - 0.06, 0.006], col: 'main' }];
    const nx = Math.max(1, Math.floor((w - 0.06) / 0.3)), ny = Math.max(1, Math.floor((h - 0.06) / 0.3));
    for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) {
      if (pick(i, j) < 0.25) continue;
      const pw = 0.16 + pick(j, i) * 0.06, ph = 0.2 + pick(i + 7, j) * 0.05;
      const a = -w / 2 + (i + 0.5) * (w / nx) + (pick(i, j + 3) - 0.5) * 0.06;
      const y = (j + 0.5) * (h / ny) + (pick(i + 2, j) - 0.5) * 0.06;
      out.push({ c: [a, y, d / 2 + 0.008], s: [pw, ph, 0.006], col: PAPER_COLS[(i * 3 + j) % PAPER_COLS.length] });
    }
    return out;
  }

  // a tall bookcase; 0.55 m deep or more = a double-sided library stack (books on both faces)
  function bookcase([w, h, d]) {
    const both = d >= 0.55;
    const out = [{ c: [-w / 2 + 0.02, h / 2, 0], s: [0.04, h, d], col: 'main' },
      { c: [w / 2 - 0.02, h / 2, 0], s: [0.04, h, d], col: 'main' },
      { c: [0, h / 2, both ? 0 : -d / 2 + 0.015], s: [w - 0.04, h, 0.03], col: 'trim' }];
    const rows = Math.max(2, Math.round(h / 0.38));
    for (let r = 0; r <= rows; r++) {
      const y = Math.min(h - 0.02, 0.04 + (r * (h - 0.06)) / rows);
      out.push({ c: [0, y, 0], s: [w - 0.04, 0.04, d], col: 'main', studs: r === rows });
      if (r === rows) break;
      const room = (h - 0.06) / rows - 0.06;
      for (const side of both ? [1, -1] : [1]) {
        const bd = both ? d / 2 - 0.05 : d - 0.06, bb = both ? side * (d / 4 + 0.005) : 0.015;
        for (let a = -w / 2 + 0.06, q = 0; a < w / 2 - 0.08; q++) {
          const bw = 0.06 + pick(q, r * 2 + side) * 0.05;
          if (a + bw > w / 2 - 0.05) break;
          if (pick(q + 11, r + side) > 0.08) { // a few gaps
            const bh = Math.min(room, 0.2 + pick(r, q) * 0.12);
            out.push({ c: [a + bw / 2, y + 0.02 + bh / 2, bb], s: [bw - 0.006, bh, bd], col: BOOK_COLS[Math.floor(pick(q, r + 5 * side) * BOOK_COLS.length)] });
          }
          a += bw;
        }
      }
    }
    return out;
  }

  // a straight flight rising toward the back (-b), the bottom step at the front; decorative: the
  // whole piece is solid (you cannot climb it), with a stepped handrail on its right side
  function stairs([w, h, d]) {
    const n = Math.max(3, Math.round(h / 0.18)), rise = h / n, run = d / n;
    const out = [];
    for (let q = 0; q < n; q++) {
      const top = rise * (q + 1), b = d / 2 - run * (q + 0.5);
      out.push({ c: [0, top / 2, b], s: [w, top, run], col: 'main' });
      out.push({ c: [0, top - 0.015, b + run / 2 - 0.03], s: [w, 0.03, 0.06], col: 'trim' }); // nosing
      if (q % 2 === 0) out.push({ c: [w / 2 - 0.04, top + 0.45, b], s: [0.04, 0.9, 0.04], col: 'trim' }); // baluster
      out.push({ c: [w / 2 - 0.04, top + 0.9, b], s: [0.06, 0.05, run + 0.01], col: 'trim' }); // rail
    }
    return out.filter((p) => p.c[1] + p.s[1] / 2 <= h + 1e-6);
  }

  // coffee counter: a bar body, a lit glass case with pastries at its left end, cups on the right
  function coffeebar([w, h, d]) {
    const cw = Math.min(1.0, w * 0.35), ca = -w / 2 + cw / 2 + 0.05;
    const out = [{ c: [0, (h - 0.06) / 2, -0.03], s: [w, h - 0.06, d - 0.06], col: 'main' },
      { c: [0, h - 0.03, 0], s: [w + 0.04, 0.06, d + 0.04], col: 'trim', studs: true },
      { c: [0, 0.05, -0.02], s: [w - 0.02, 0.1, d - 0.08], col: '#2A2522' },
      { c: [ca, h + 0.18, 0.05], s: [cw, 0.36, d * 0.6], col: '#DDEFF5', glow: 0.35 }];
    for (let q = 0; q < 4; q++) out.push({ c: [ca - cw / 2 + 0.15 + q * (cw - 0.3) / 3, h + 0.05, 0.05], s: [0.14, 0.06, 0.14], col: q % 2 ? '#C8A85A' : '#7A4A2A' });
    for (let q = 0; q < 3; q++) out.push({ c: [w / 2 - 0.2 - q * 0.14, h + 0.05, -0.12], s: [0.08, 0.1, 0.08], col: '#F6F3EA' });
    return out;
  }

  // an inner wall in the room's own brick (colour defaults to the walls); set its size to fit
  function partition([w, h, d]) {
    const out = [], course = 0.24;
    for (let c = 0, y = 0; y < h - 1e-6; c++, y += course) {
      const y1 = Math.min(h, y + course);
      for (const [s0, s1] of courseSpans(w, c)) out.push({ c: [(s0 + s1) / 2, (y + y1) / 2, 0], s: [s1 - s0, y1 - y, d], col: 'main', shade: 0.9 + pick(c, Math.round(s0 * 2)) * 0.16 });
    }
    return out;
  }

  // a glazed inner wall: frame, mullions every ~1.2 m, pale lit panes
  function glasswall([w, h, d]) {
    const n = Math.max(1, Math.round(w / 1.2)), pw = w / n;
    const out = [{ c: [0, 0.05, 0], s: [w, 0.1, d], col: 'trim' }, { c: [0, h - 0.04, 0], s: [w, 0.08, d], col: 'trim' },
      { c: [0, (h - 0.18) / 2 + 0.1, 0], s: [w - 0.02, h - 0.18, d * 0.3], col: 'main', glow: 0.12 }];
    for (let q = 0; q <= n; q++) out.push({ c: [Math.max(-w / 2 + 0.03, Math.min(w / 2 - 0.03, -w / 2 + q * pw)), h / 2, 0], s: [0.06, h, d], col: 'trim' });
    return out;
  }

  function monitor([w, h, d]) {
    return [{ c: [0, 0.01, 0], s: [w * 0.4, 0.02, d], col: 'trim' }, { c: [0, 0.1, -0.02], s: [0.05, 0.2, 0.04], col: 'trim' },
      { c: [0, h * 0.62, 0.02], s: [w, h * 0.7, 0.04], col: 'trim' },
      { c: [0, h * 0.62, 0.045], s: [w - 0.04, h * 0.7 - 0.04, 0.01], col: 'main', glow: 0.6 }];
  }

  function bench([w, h, d]) {
    return [{ c: [0, h - 0.03, 0], s: [w, 0.06, d], col: 'main', studs: true },
      ...[[-1], [1]].map(([s]) => ({ c: [s * (w / 2 - 0.12), (h - 0.06) / 2, 0], s: [0.08, h - 0.06, d - 0.06], col: 'trim' }))];
  }

  return {
    seatrow: { size: [3.6, 0.9, 0.85], colour: '#22385A', trim: '#8F6A48', parts: seatrow, solid: true,
      seats: ([w, , d]) => rowSeats(w, -d / 2 + 0.26, seatH) },
    tier: { size: [6.0, 0.3, 0.95], colour: '#5A4636', trim: '#C8A85A', parts: tier, solid: true },
    lectern: { size: [0.7, 1.15, 0.55], colour: '#8F6A48', trim: '#3B2A20', parts: lectern, solid: true },
    desk: { size: [1.6, 0.76, 0.75], colour: '#C9B48A', trim: '#3B3F45', parts: desk, solid: true },
    reception: { size: [3.0, 1.1, 0.85], colour: '#EFE6D6', trim: '#3B3F45', parts: reception, solid: true },
    studytable: { size: [3.2, 0.75, 1.2], colour: '#C9B48A', trim: '#3B3F45', parts: studytable, solid: true },
    screen: { size: [3.2, 1.8, 0.06], colour: '#F4F6F8', trim: '#1E1F21', parts: screen, solid: true, y: 0.95 },
    noticeboard: { size: [1.4, 0.9, 0.04], colour: '#B08A5A', trim: '#5C3A24', parts: noticeboard, solid: true, y: 1.1 },
    bookcase: { size: [1.0, 2.2, 0.38], colour: '#8F6A48', trim: '#5C3A24', parts: bookcase, solid: true },
    stairs: { size: [1.2, 3.0, 4.6], colour: '#B9BCC4', trim: '#3B3F45', parts: stairs, solid: true },
    coffeebar: { size: [2.6, 1.08, 0.7], colour: '#3B3F45', trim: '#8F6A48', parts: coffeebar, solid: true },
    partition: { size: [4.0, 3.0, 0.2], colour: '@walls', trim: '@trim', parts: partition, solid: true },
    glasswall: { size: [4.0, 3.0, 0.1], colour: '#CFE3EA', trim: '#3B3F45', parts: glasswall, solid: true },
    monitor: { size: [0.55, 0.42, 0.18], colour: '#9FC4E8', trim: '#1E1F21', parts: monitor, solid: true, y: 0.75 },
    bench: { size: [1.6, 0.46, 0.4], colour: '#8F6A48', trim: '#3B3F45', parts: bench, solid: true,
      seats: ([w, h]) => rowSeats(w, 0, h) },
  };
}
