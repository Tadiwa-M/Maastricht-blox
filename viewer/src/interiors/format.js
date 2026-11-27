// Place files (src/interiors/data/*.json, docs/guide/19-interiors.md): one interior each.
// parsePlace checks a file and fills in the defaults; it throws an Error naming the file and the
// field on anything it cannot use, so a broken file stops the site build (copy-data.mjs) instead
// of shipping a room the player falls out of. Pure (no three.js, no DOM).
//
// Room coordinates: metres, seen standing in the doorway looking in. x = from the LEFT wall
// toward the right wall (0..width), z = from the FRONT wall (the door's wall) toward the back
// wall (0..depth). Facing inside the room: N = toward the back wall, S = toward the door, E =
// right, W = left (the room is its own little grid, like an island: CONTRACT 5.1).
import { facingToRot, rotatedExtent } from '../rotation.js';
import { KIT, KIT_KINDS } from './kit.js';

export const FORMAT = 'blox-interior';
export const VERSION = 1;
export const LIMITS = { width: [3, 30], depth: [3, 30], height: [2.4, 6], floor: [-0.4, 0.4] };
export const DOOR_W = 1.0; // the doorway opening (m)
export const MAX_PEOPLE = 72; // figures drawn in one room at most (people.js keeps the first ones)
export const PATTERNS = ['planks', 'tiles', 'slabs'];
const HEX = /^#[0-9a-fA-F]{6}$/;
export const LOOK_DEFAULTS = { walls: '#C9A27E', floor: '#6E4A33', ceiling: '#EFE6D6', trim: '#3B2A20', windows: '#FFE9B8', door: '#5C3A24' };

function fail(file, msg) { throw new Error(`${file || 'place'}: ${msg}`); }

function num(file, v, name, [lo, hi] = [-Infinity, Infinity], def) {
  if (v === undefined && def !== undefined) return def;
  if (typeof v !== 'number' || !Number.isFinite(v)) fail(file, `${name} must be a number`);
  if (v < lo || v > hi) fail(file, `${name} = ${v} is outside ${lo}..${hi}`);
  return v;
}

function facing(file, v, name, def = 'N') {
  if (v === undefined) return def; // def null: required
  try { facingToRot(v); } catch { fail(file, `${name} must be N, E, S or W (got ${JSON.stringify(v)})`); }
  return String(v).toUpperCase();
}

function colour(file, v, name, def) {
  if (v === undefined) return def;
  if (typeof v !== 'string' || !HEX.test(v)) fail(file, `${name} must be a colour like "#8F6A48"`);
  return v.toUpperCase();
}

function str(file, v, name, max, def) {
  if (v === undefined || v === null) return def;
  if (typeof v !== 'string' || !v.trim() || v.length > max) fail(file, `${name} must be text of at most ${max} characters`);
  return v.trim();
}

/** Footprint [x0, z0, x1, z1] (room metres) of a piece at (x, z) facing f with size [w, h, d]. */
export function footprint(x, z, f, [w, , d]) {
  const [ex, ez] = rotatedExtent(w, d, facingToRot(f));
  return [x - ex / 2, z - ez / 2, x + ex / 2, z + ez / 2];
}

/** Where the player stands just inside the door (room metres): must stay free of furniture. */
export function entryZone(room, door) { return [door.fromLeft - 0.55, 0, door.fromLeft + 0.55, 1.5]; }

const overlaps = (a, b) => a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];

function point(file, p, name, room) {
  if (!p || typeof p !== 'object') fail(file, `${name} must be an object`);
  const x = num(file, p.x, `${name}.x`, [0, room.width]);
  const z = num(file, p.z, `${name}.z`, [0, room.depth]);
  return { x, z, facing: facing(file, p.facing, `${name}.facing`) };
}

/**
 * raw: the parsed JSON; file: its name (for messages). -> { place, warnings: [text] }.
 * place = { id, name, address, bagId, example, notes, door: { x, z, facing, fromLeft },
 *   room: { width, depth, height, floor }, look: { walls, floor, ceiling, trim, windows, door, pattern, beams },
 *   props: [{ kind, x, z, facing, size, colour, trim, y }], seats: [{ x, z, facing, height }],
 *   people: { share, staff: [{ x, z, facing }], standing: [...] }, menu: [text], slide: [text],
 *   sign: { text, lines: [text], colour } }
 */
export function parsePlace(raw, file = '') {
  const warnings = [];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) fail(file, 'not a JSON object');
  if (raw.format !== FORMAT) fail(file, `format must be "${FORMAT}"`);
  if (raw.version !== VERSION) fail(file, `version must be ${VERSION} (this viewer reads version ${VERSION})`);
  const id = raw.id;
  if (typeof id !== 'string' || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(id)) fail(file, 'id must be lower-case letters, digits and dashes, e.g. "cafe-de-steen"');
  const name = str(file, raw.name, 'name', 48);
  if (!name) fail(file, 'name is required');
  const bagId = str(file, raw.bagId, 'bagId', 40, null);
  if (bagId && !/^NL\.IMBAG\.Pand\.\d{16}$/.test(bagId)) warnings.push(`${file}: bagId "${bagId}" does not look like NL.IMBAG.Pand.<16 digits>`);

  const r = raw.room || fail(file, 'room is required');
  const room = { width: num(file, r.width, 'room.width', LIMITS.width), depth: num(file, r.depth, 'room.depth', LIMITS.depth),
    height: num(file, r.height, 'room.height', LIMITS.height, 3), floor: num(file, r.floor, 'room.floor', LIMITS.floor, 0) };

  const d = raw.door || fail(file, 'door is required');
  const door = { x: num(file, d.x, 'door.x'), z: num(file, d.z, 'door.z'), facing: facing(file, d.facing, 'door.facing', null),
    fromLeft: num(file, d.fromLeft, 'door.fromLeft', [DOOR_W / 2 + 0.1, room.width - DOOR_W / 2 - 0.1], room.width / 2) };
  if (!door.facing) fail(file, 'door.facing is required (the way the door looks out to the street: N, E, S or W)');

  const look = {};
  for (const [k, def] of Object.entries(LOOK_DEFAULTS)) look[k] = colour(file, raw.look?.[k], `look.${k}`, def);
  look.pattern = raw.look?.pattern ?? 'planks';
  if (!PATTERNS.includes(look.pattern)) fail(file, `look.pattern must be ${PATTERNS.map((p) => `"${p}"`).join(', ')}`);
  const lookColour = (c) => (typeof c === 'string' && c.startsWith('@') ? look[c.slice(1)] : c); // kit defaults like '@walls'
  look.beams = raw.look?.beams === true;

  const entry = entryZone(room, door);
  const props = (raw.props || []).map((p, q) => {
    const tag = `props[${q}]`;
    const kit = KIT[p?.kind];
    if (!kit) fail(file, `${tag}.kind "${p?.kind}" is not in the kit (${KIT_KINDS.join(', ')})`);
    const { x, z, facing: f } = point(file, p, tag, room);
    let size = kit.size;
    if (p.size !== undefined) {
      if (!Array.isArray(p.size) || p.size.length !== 3) fail(file, `${tag}.size must be [width, height, depth] in metres`);
      size = p.size.map((v, k) => num(file, v, `${tag}.size[${k}]`, [0.02, 30]));
    }
    const y = num(file, p.y, `${tag}.y`, [0, room.height], kit.y ?? 0);
    const fp = footprint(x, z, f, size);
    if (fp[0] < -0.01 || fp[1] < -0.01 || fp[2] > room.width + 0.01 || fp[3] > room.depth + 0.01) fail(file, `${tag} (${p.kind}) sticks out of the room`);
    if (!kit.ceiling && y + size[1] > room.height) fail(file, `${tag} (${p.kind}) is taller than the room`);
    if (kit.solid && y < 1.9 && overlaps(fp, entry)) fail(file, `${tag} (${p.kind}) blocks the way in at the door`);
    return { kind: p.kind, x, z, facing: f, size, y, colour: colour(file, p.colour, `${tag}.colour`, lookColour(kit.colour)),
      trim: colour(file, p.trim, `${tag}.trim`, lookColour(kit.trim)) };
  });
  for (let a = 0; a < props.length; a++) for (let b = a + 1; b < props.length; b++) {
    const A = props[a], B = props[b];
    if (!KIT[A.kind].solid || !KIT[B.kind].solid || A.y + A.size[1] <= B.y || B.y + B.size[1] <= A.y) continue;
    const fa = footprint(A.x, A.z, A.facing, A.size), fb = footprint(B.x, B.z, B.facing, B.size);
    const shrink = (f) => [f[0] + 0.05, f[1] + 0.05, f[2] - 0.05, f[3] - 0.05];
    if (overlaps(shrink(fa), shrink(fb))) warnings.push(`${file}: props[${a}] (${A.kind}) and props[${b}] (${B.kind}) overlap`);
  }

  const seats = (raw.seats || []).map((s, q) => ({ ...point(file, s, `seats[${q}]`, room),
    height: num(file, s.height, `seats[${q}].height`, [0.2, 1.2], 0.46) }));
  const pe = raw.people || {};
  const people = { share: num(file, pe.share, 'people.share', [0, 1], 0.6),
    staff: (pe.staff || []).map((s, q) => point(file, s, `people.staff[${q}]`, room)),
    standing: (pe.standing || []).map((s, q) => point(file, s, `people.standing[${q}]`, room)) };
  const menu = (raw.menu || []).slice(0, 14).map((m, q) => str(file, m, `menu[${q}]`, 34));
  const slide = (raw.slide || []).slice(0, 8).map((m, q) => str(file, m, `slide[${q}]`, 40));
  const sign = { text: str(file, raw.sign?.text, 'sign.text', 48, name), colour: colour(file, raw.sign?.colour, 'sign.colour', '#1F2B24'),
    lines: (raw.sign?.lines || []).slice(0, 3).map((m, q) => str(file, m, `sign.lines[${q}]`, 48)) };
  return {
    place: { id, name, address: str(file, raw.address, 'address', 80, ''), bagId, example: raw.example === true,
      notes: typeof raw.notes === 'string' ? raw.notes : '', door, room, look, props, seats, people, menu, slide, sign },
    warnings,
  };
}
