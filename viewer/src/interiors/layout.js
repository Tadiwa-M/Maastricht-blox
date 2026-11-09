// Where an interior sits and what it is made of (pure, no three.js).
//
// The room is built as a small separate region DEPTH metres straight below its door: same x/z
// as the building, so the city streamer and the far-detail levels around the door stay loaded
// (leaving is instant), nothing in the city overlaps it (the buildings are hollow shells whose
// size seldom matches the real room), and its walls, floor and ceiling enclose the camera, so
// nothing of the city shows from inside. volume.js makes the region solid where the room is.
//
// Frames: room metres (format.js: x from the left wall, z from the door's wall inward), Unity
// metres (x east, z north; CONTRACT 1) and three.js (x east, y up, z = -north). The room's "N"
// (inward) is the door's facing turned round; every turn goes through src/rotation.js.
import { facingToRot, frontDir, rotatedExtent, FACING_NAMES } from '../rotation.js';
import { KIT } from './kit.js';
import { DOOR_W } from './format.js';

export const DEPTH = 40; // metres below the door's pavement
export const WALL = 0.3; // wall thickness drawn (the solid region goes on beyond it)
export const RECESS = 0.45; // doorway depth: the niche you walk into to leave
export const DOOR_H = 2.2;

/**
 * The room's frame for a parsed place: { roomRot (compass rot of the room's N), toUnity(x, z),
 * toRoom(ux, uz), rotToWorld(facing) (room facing letter -> world rot), yawIn / yawOut (compass
 * radians walking in / out) }.
 */
export function roomFrame(place) {
  const { door } = place;
  const outRot = facingToRot(door.facing);
  const roomRot = (outRot + 2) & 3;
  const F = frontDir(roomRot), R = frontDir((roomRot + 1) & 3); // room +z and +x in Unity (east, north) steps
  return {
    roomRot, outRot,
    toUnity: (x, z) => { const dx = x - door.fromLeft; return [door.x + dx * R[0] + z * F[0], door.z + dx * R[1] + z * F[1]]; },
    toRoom: (ux, uz) => { const dx = ux - door.x, dz = uz - door.z; return [door.fromLeft + dx * R[0] + dz * R[1], dx * F[0] + dz * F[1]]; },
    rotToWorld: (f) => (roomRot + facingToRot(f)) & 3,
    yawIn: (roomRot * Math.PI) / 2,
    yawOut: (outRot * Math.PI) / 2,
  };
}

/** World facing letter of a room facing (for messages and the door helper). */
export function worldFacing(place, f) { return FACING_NAMES[roomFrame(place).rotToWorld(f)]; }

/** A piece's boxes in room metres: [{ min: [x, y, z], max, col, studs, glow, tex }]. */
export function pieceBoxes(prop, roomH) {
  const kit = KIT[prop.kind];
  const rot = facingToRot(prop.facing);
  const F = frontDir(rot), R = frontDir((rot + 1) & 3);
  const y0 = kit.ceiling ? roomH - prop.size[1] : prop.y;
  return kit.parts(prop.size).map((p) => {
    const [a, y, b] = p.c, [w, h, d] = p.s;
    const cx = prop.x + a * R[0] + b * F[0], cz = prop.z + a * R[1] + b * F[1];
    const [ex, ez] = rotatedExtent(w, d, rot);
    const col = p.col === 'main' ? prop.colour : p.col === 'trim' ? prop.trim : p.col;
    return { min: [cx - ex / 2, y0 + y - h / 2, cz - ez / 2], max: [cx + ex / 2, y0 + y + h / 2, cz + ez / 2], col,
      studs: !!p.studs, glow: p.glow || 0, tex: p.tex || null, face: p.tex ? rot : undefined, ...(p.shade ? { shade: p.shade } : {}) };
  });
}

const hash = (a, b, c = 0) => { let h = Math.imul(a * 73856093 ^ b * 19349663 ^ c * 83492791, 0x9e3779b1); h ^= h >>> 15; return (h >>> 0) / 4294967296; };
const shadeOf = (a, b, c) => 0.9 + hash(a, b, c) * 0.16;

/** Bricks of one course along [0, len) with gaps [[s0, s1]] cut out; running bond by course. */
export function courseBricks(len, course, gaps = [], brick = 1.0) {
  const out = [];
  for (let s = course % 2 ? -brick / 2 : 0; s < len; s += brick) {
    let pieces = [[Math.max(0, s), Math.min(len, s + brick)]];
    for (const [g0, g1] of gaps) pieces = pieces.flatMap(([p0, p1]) => (g1 <= p0 || g0 >= p1 ? [[p0, p1]] : [[p0, Math.max(p0, g0)], [Math.min(p1, g1), p1]]));
    for (const [p0, p1] of pieces) if (p1 - p0 > 0.02) out.push([p0, p1]);
  }
  return out;
}

/** The shell: floor, walls (brick courses), ceiling, skirting, the doorway niche, windows. */
export function shellBoxes(place) {
  const { room: { width: W, depth: D, height: H, floor: step }, look, door } = place;
  const out = [], T = WALL, course = 0.24;
  const box = (min, max, col, extra = {}) => out.push({ min, max, col, studs: false, glow: 0, ...extra });
  // floor slab and its surface (planks along z, chequered tiles, or large stone slabs)
  box([-T, -0.3, 0], [W + T, -0.02, D + T], look.trim);
  if (place.look.pattern === 'slabs') {
    for (let x = 0, q = 0; x < W; x += 1.0, q++) for (let z = (q % 2) * -0.5, r = 0; z < D; z += 1.0, r++) {
      box([x, -0.02, Math.max(0, z)], [Math.min(W, x + 1.0), 0, Math.min(D, z + 1.0)], look.floor, { shade: 0.93 + hash(q, r, 7) * 0.1 });
    }
  } else if (place.look.pattern === 'tiles') {
    for (let x = 0; x < W; x += 0.5) for (let z = 0; z < D; z += 0.5) {
      const k = (Math.round(x * 2) + Math.round(z * 2)) % 2;
      box([x, -0.02, z], [Math.min(W, x + 0.5), 0, Math.min(D, z + 0.5)], k ? look.floor : look.trim, { shade: shadeOf(x * 2, z * 2, 1) * 0.5 + 0.5 });
    }
  } else {
    for (let x = 0, q = 0; x < W; x += 0.25, q++) {
      for (let z = (q % 3) * -0.7, r = 0; z < D; z += 2.1, r++) {
        box([x, -0.02, Math.max(0, z)], [Math.min(W, x + 0.25), 0, Math.min(D, z + 2.1)], look.floor, { shade: shadeOf(q, r, 2) });
      }
    }
  }
  // walls: courses of bricks (ends overlap at the corners so no gap shows)
  const dl = door.fromLeft - DOOR_W / 2, dr = door.fromLeft + DOOR_W / 2;
  const win = windows(place), gapTop = Math.ceil(DOOR_H / course - 1e-6) * course;
  for (let c = 0, y = 0; y < H; c++, y += course) {
    const y1 = Math.min(H, y + course);
    const gapsFront = y < DOOR_H - 1e-6 ? [[dl + T, dr + T]] : [];
    for (const [s0, s1] of courseBricks(W + 2 * T, c, gapsFront)) box([s0 - T, y, -T], [s1 - T, y1, 0], look.walls, { shade: shadeOf(c, s0 * 2, 3) });
    for (const [s0, s1] of courseBricks(W + 2 * T, c + 1)) box([s0 - T, y, D], [s1 - T, y1, D + T], look.walls, { shade: shadeOf(c, s0 * 2, 4) });
    for (const [s0, s1] of courseBricks(D, c + 1)) box([-T, y, s0], [0, y1, s1], look.walls, { shade: shadeOf(c, s0 * 2, 5) });
    for (const [s0, s1] of courseBricks(D, c)) box([W, y, s0], [W + T, y1, s1], look.walls, { shade: shadeOf(c, s0 * 2, 6) });
  }
  box([-T, H, -T], [W + T, H + 0.15, D + T], look.ceiling);
  if (place.look.beams) for (let z = 1.2; z < D - 0.3; z += 1.6) box([0, H - 0.16, z - 0.09], [W, H, z + 0.09], look.trim);
  // skirting
  box([0, 0, 0], [dl, 0.1, 0.03], look.trim); box([dr, 0, 0], [W, 0.1, 0.03], look.trim);
  box([0, 0, D - 0.03], [W, 0.1, D], look.trim);
  box([0, 0, 0], [0.03, 0.1, D], look.trim); box([W - 0.03, 0, 0], [W, 0.1, D], look.trim);
  // the doorway niche: floor (a step when the room floor is above or below the pavement), sides,
  // lintel, and the closed street door at its back with a lit glass panel
  box([dl, -0.3, -RECESS - 0.05], [dr, -step, 0], look.trim);
  box([dl - 0.08, -0.3, -RECESS], [dl, gapTop, 0.03], look.trim);
  box([dr, -0.3, -RECESS], [dr + 0.08, gapTop, 0.03], look.trim);
  box([dl - 0.08, DOOR_H, -RECESS], [dr + 0.08, gapTop, 0.03], look.trim);
  box([dl, -step, -RECESS - 0.06], [dr, DOOR_H, -RECESS], look.door);
  box([dl + 0.15, 0.9 - step, -RECESS + 0.005], [dr - 0.15, DOOR_H - 0.15, -RECESS + 0.02], look.windows, { glow: 0.3 });
  // street windows in the front wall (lit panels; the room is underground, the light sells it)
  for (const [x0, x1] of win) {
    box([x0, 0.95, 0], [x1, 2.25, 0.02], look.windows, { glow: 0.3 });
    box([x0 - 0.06, 0.89, 0], [x1 + 0.06, 0.95, 0.12], look.trim); // sill
    box([(x0 + x1) / 2 - 0.03, 0.95, 0], [(x0 + x1) / 2 + 0.03, 2.25, 0.04], look.trim); // mullion
    box([x0 - 0.06, 2.25, 0], [x1 + 0.06, 2.31, 0.04], look.trim);
  }
  return out;
}

/** Window spans [x0, x1] on the front wall either side of the door, where there is room. */
export function windows(place) {
  const { room: { width: W }, door } = place;
  const out = [], dl = door.fromLeft - DOOR_W / 2, dr = door.fromLeft + DOOR_W / 2;
  for (const [a, b] of [[0.4, dl - 0.4], [dr + 0.4, W - 0.4]]) {
    if (b - a < 0.8) continue;
    const w = Math.min(2.4, b - a), c = (a + b) / 2;
    out.push([c - w / 2, c + w / 2]);
  }
  return out;
}

/** Every visible box of the room (shell + furniture), room metres. */
export function roomBoxes(place) {
  return [...shellBoxes(place), ...place.props.flatMap((p) => pieceBoxes(p, place.room.height))];
}

/** Furniture that blocks walking: [x0, y0, z0, x1, y1, z1] room metres (one box per piece). */
export function solidBoxes(place) {
  const out = [];
  for (const p of place.props) {
    const kit = KIT[p.kind];
    if (!kit.solid) continue;
    const [ex, ez] = rotatedExtent(p.size[0], p.size[2], facingToRot(p.facing));
    out.push([p.x - ex / 2, p.y, p.z - ez / 2, p.x + ex / 2, p.y + p.size[1], p.z + ez / 2]);
  }
  return out;
}

/** Seats: those of chairs, stools, sofas and armchairs plus the file's own `seats`. */
export function seatsOf(place) {
  const out = [];
  for (const p of place.props) {
    const kit = KIT[p.kind];
    if (!kit.seats) continue;
    const rot = facingToRot(p.facing), F = frontDir(rot), R = frontDir((rot + 1) & 3);
    for (const s of kit.seats(p.size)) out.push({ x: p.x + s.a * R[0] + s.b * F[0], z: p.z + s.a * R[1] + s.b * F[1], facing: p.facing, height: p.y + s.h, kind: p.kind });
  }
  for (const s of place.seats) out.push({ ...s, kind: 'seat' });
  return out;
}

/** Words of `text` wrapped into lines of at most `max` characters (a longer word stays whole). */
export function wrapWords(text, max) {
  const out = [];
  for (const word of String(text).split(/\s+/).filter(Boolean)) {
    const last = out.length - 1;
    if (last >= 0 && out[last].length + 1 + word.length <= max) out[last] += ` ${word}`;
    else out.push(word);
  }
  return out;
}

/**
 * The blade sign outside the door: { w (board length out from the facade), h (m), title (lines),
 * lines (smaller lines under it) }. Short names keep the small cafe board; long names (a
 * faculty) get a bigger board with the name over two or three lines.
 */
export function signBoard(place) {
  const { text, lines = [] } = place.sign;
  if (text.length <= 16 && !lines.length) return { w: 0.95, h: 0.5, title: [text], lines: [] };
  // as few lines as a 22-character width needs (3 at most), balanced: the narrowest width that fits
  const n = Math.min(3, wrapWords(text, 22).length);
  let max = Math.ceil(text.length / n), title;
  while ((title = wrapWords(text, max)).length > n) max++;
  return { w: 1.5, h: lines.length || title.length > 2 ? 0.9 : 0.75, title, lines };
}

/** Room spot just inside the door (walking in) and Unity spot on the pavement (walking out). */
export function entrySpot(place) { return { x: place.door.fromLeft, z: 1.0 }; }
export function exitSpot(place) { return roomFrame(place).toUnity(place.door.fromLeft, -0.6); }
