// Interiors for Maastricht University: the campus kit, the faculty place files, their doors on
// the real facades, the bigger signs, the people cap.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parsePlace, footprint, MAX_PEOPLE } from '../src/interiors/format.js';
import { KIT } from '../src/interiors/kit.js';
import { rowSeats } from '../src/interiors/kit-campus.js';
import { roomFrame, roomBoxes, pieceBoxes, seatsOf, entrySpot, signBoard, wrapWords } from '../src/interiors/layout.js';
import { roomVolume } from '../src/interiors/volume.js';
import { roomPeople } from '../src/interiors/people.js';
import { CharacterController } from '../src/player/controller.js';
import { MODE } from '../src/figure/rig.js';

const here = dirname(fileURLToPath(import.meta.url));
const DATA = join(here, '..', 'src', 'interiors', 'data');
const load = (f) => parsePlace(JSON.parse(readFileSync(join(DATA, f), 'utf8')), f);
const FACULTY_FILES = readdirSync(DATA).filter((f) => f.startsWith('um-') && f.endsWith('.json'));

/**
 * Where each door must be (Unity metres, city world originRD [174700, 314000]): the facade it
 * faces, as an edge of the building's BAG footprint (3D BAG LoD0), and a point inside the
 * building (its BAG address point). Doors were placed from OpenStreetMap entrance nodes where
 * mapped (UCM) and otherwise on the street side of the footprint at the address point.
 */
const FACADES = {
  'um-sbe': { bag: '0935100000016380', seg: [[1270.02, 3324.32], [1267.27, 3322.81]], inside: [1268.0, 3298.4] },
  'um-law': { bag: '0935100000017557', seg: [[1483.16, 3551.71], [1479.55, 3536.49]], inside: [1484.3, 3542.9] },
  'um-fasos': { bag: '0935100000016707', seg: [[1312.78, 3820.31], [1330.27, 3836.95]], inside: [1313.3, 3824.0] },
  'um-ucm': { bag: '0935100000018018', seg: [[1554.21, 3196.4], [1547.83, 3219.53]], inside: [1519.9, 3222.3] },
  'um-fse': { bag: '0935100000031395', seg: [[3452.39, 2696.79], [3392.82, 2698.62]], inside: [3411.1, 2692.7] },
  'um-uns40': { bag: '0935100000104271', seg: [[3498.13, 2390.42], [3494.25, 2390.49]], inside: [3495.1, 2380.2] },
  'um-inner-city-library': { bag: '0935100000018774', seg: [[1624.64, 3297.49], [1615.27, 3289.39]], inside: [1621.3, 3290.2] },
  'um-randwyck-library': { bag: '0935100000030569', seg: [[3537.1, 2188.0], [3537.1, 2203.0]], inside: [3529.6, 2189.4] },
};

/** Signed side of point p relative to the line a -> b, and the distance to the segment. */
function sideAndDist(p, [a, b]) {
  const dx = b[0] - a[0], dz = b[1] - a[1], L = Math.hypot(dx, dz);
  const side = (dx * (p[1] - a[1]) - dz * (p[0] - a[0])) / L;
  const u = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / (L * L);
  const c = Math.max(0, Math.min(1, u));
  return { side, u, dist: Math.hypot(p[0] - a[0] - c * dx, p[1] - a[1] - c * dz) };
}

test('eight faculty places, all valid, no warnings, real (not examples)', () => {
  assert.equal(FACULTY_FILES.length, 8);
  assert.deepEqual(Object.keys(FACADES).sort(), FACULTY_FILES.map((f) => f.replace('.json', '')).sort());
  for (const f of FACULTY_FILES) {
    const { place, warnings } = load(f);
    assert.deepEqual(warnings, [], f);
    assert.equal(place.example, false, f);
    assert.equal(`${place.id}.json`, f, 'file named after its id');
    assert.ok(place.address && place.bagId && place.notes, f);
    assert.ok(place.room.width >= 12 && place.room.width <= 20 && place.room.depth <= 20, `${f}: modest room`);
    const kinds = new Set(place.props.map((p) => p.kind));
    assert.ok(kinds.has('reception'), `${f}: a reception / loan desk`);
    if (/library/.test(place.id)) assert.ok(place.props.filter((p) => p.kind === 'bookcase').length >= 8, `${f}: book stacks`);
    else assert.ok(kinds.has('screen') && (kinds.has('seatrow') || kinds.has('studytable')), `${f}: a lecture or tutorial room`);
    assert.ok(kinds.has('studytable'), `${f}: study tables`);
    const seats = seatsOf(place).length, people = roomPeople(place);
    assert.ok(seats >= 25, `${f}: ${seats} seats`);
    assert.ok(people.length <= MAX_PEOPLE && people.some((p) => p.staff) && people.filter((p) => p.mode === MODE.SIT).length >= 10, f);
    assert.ok(roomBoxes(place).length < 8000, `${f}: box budget`);
  }
});

test('faculty doors sit on the pavement just outside their own building, facing the street', () => {
  const OUT = { N: [0, 1], E: [1, 0], S: [0, -1], W: [-1, 0] };
  for (const f of FACULTY_FILES) {
    const { place } = load(f);
    const fx = FACADES[place.id];
    assert.equal(place.bagId, `NL.IMBAG.Pand.${fx.bag}`, f);
    const door = [place.door.x, place.door.z];
    const d = sideAndDist(door, fx.seg), inside = sideAndDist(fx.inside, fx.seg);
    assert.ok(Math.sign(d.side) !== Math.sign(inside.side), `${f}: door on the street side of the facade`);
    assert.ok(d.dist >= 0.5 && d.dist <= 2.0, `${f}: door ${d.dist.toFixed(2)} m from the facade`);
    assert.ok(d.u > -0.3 && d.u < 1.3, `${f}: door in front of that facade`);
    assert.ok(Math.hypot(door[0] - fx.inside[0], door[1] - fx.inside[1]) < 40, `${f}: near its address point`);
    // the door's facing is the compass direction nearest the facade's outward normal
    const [a, b] = fx.seg, len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    let n = [(b[1] - a[1]) / len, -(b[0] - a[0]) / len];
    if (Math.sign(n[0] * (door[0] - a[0]) + n[1] * (door[1] - a[1])) < 0) n = [-n[0], -n[1]];
    const best = Object.entries(OUT).sort((p, q) => (q[1][0] * n[0] + q[1][1] * n[1]) - (p[1][0] * n[0] + p[1][1] * n[1]))[0][0];
    assert.equal(place.door.facing, best, `${f}: facing`);
    // walking straight at the facade still counts as walking in (door.js cone 50 degrees)
    const yawFacade = Math.atan2(-n[0], -n[1]);
    const gap = Math.abs(((yawFacade - roomFrame(place).yawIn + 3 * Math.PI) % (2 * Math.PI)) - Math.PI);
    assert.ok(gap < (50 * Math.PI) / 180, `${f}: facade ${((gap * 180) / Math.PI).toFixed(0)} degrees off the door's facing`);
  }
});

test('signs: faculty names on a bigger board, wrapped in balanced lines; cafes keep the small one', () => {
  assert.deepEqual(wrapWords('Faculty of Arts and Social Sciences', 19), ['Faculty of Arts and', 'Social Sciences']);
  assert.deepEqual(wrapWords('a verylongwordindeed b', 5), ['a', 'verylongwordindeed', 'b']);
  const sbe = load('um-sbe.json').place;
  assert.deepEqual(signBoard(sbe).title, ['School of Business', 'and Economics']);
  assert.ok(signBoard(sbe).w > 1 && signBoard(sbe).lines[0] === 'Maastricht University');
  assert.deepEqual(signBoard(load('um-fasos.json').place).title, ['Faculty of Arts and', 'Social Sciences']);
  const uns = signBoard(load('um-uns40.json').place);
  assert.deepEqual(uns.title, ['UNS40']);
  assert.equal(uns.lines.length, 3);
  const cafe = signBoard(load('cafe-de-steen.json').place);
  assert.deepEqual(cafe, { w: 0.95, h: 0.5, title: ['Café De Steen'], lines: [] });
  for (const f of FACULTY_FILES) { const t = signBoard(load(f).place).title; assert.ok(t.length <= 3 && t.every((l) => l.length <= 24), f); }
});

const mini = (over = {}) => ({ format: 'blox-interior', version: 1, id: 'campus-test', name: 'Campus Test',
  door: { x: 50, z: 60, facing: 'E', fromLeft: 2 }, room: { width: 10, depth: 10, height: 3.6 },
  look: { walls: '#AA5533', trim: '#112233', pattern: 'slabs' }, props: [], ...over });

test('format: slabs floor, slide lines, sign lines, kit colours from the look', () => {
  const p = parsePlace(mini({ props: [{ kind: 'partition', x: 5, z: 5, size: [4, 3.6, 0.2] }],
    slide: ['Lecture 1', 'Hello'], sign: { text: 'A long faculty name for the test sign', lines: ['Maastricht University'] } }), 't.json').place;
  assert.equal(p.look.pattern, 'slabs');
  assert.equal(p.props[0].colour, '#AA5533');
  assert.equal(p.props[0].trim, '#112233');
  assert.deepEqual(p.slide, ['Lecture 1', 'Hello']);
  assert.deepEqual(p.sign.lines, ['Maastricht University']);
  assert.ok(roomBoxes(p).some((b) => b.col === '#AA5533' && b.shade && b.min[0] > 2.9 && b.max[0] < 7.1), 'partition bricks, shaded');
  assert.ok(roomBoxes(p).filter((b) => b.col === '#BFB7AA' || b.max[1] === 0).length > 50, 'floor slabs');
  assert.throws(() => parsePlace(mini({ slide: ['x'.repeat(41)] }), 't.json'), /slide\[0\]/);
  assert.throws(() => parsePlace(mini({ sign: { text: 'x', lines: [''] } }), 't.json'), /sign.lines\[0\]/);
  assert.throws(() => parsePlace(mini({ look: { pattern: 'carpet' } }), 't.json'), /pattern must be "planks", "tiles", "slabs"/);
});

test('campus kit: parts stay inside the piece, seat rows seat one per 0.6 m, every kind turns', () => {
  for (const k of ['seatrow', 'tier', 'lectern', 'desk', 'reception', 'studytable', 'screen', 'noticeboard', 'bookcase', 'stairs', 'coffeebar', 'partition', 'glasswall', 'monitor', 'bench']) {
    const kit = KIT[k];
    assert.ok(kit, k);
    const [w, h, d] = kit.size;
    for (const p of kit.parts(kit.size)) {
      assert.ok(p.s.every((v) => v > 0), `${k} part size`);
      assert.ok(Math.abs(p.c[0]) + p.s[0] / 2 <= w / 2 + 0.05 && Math.abs(p.c[2]) + p.s[2] / 2 <= d / 2 + 0.07, `${k} part inside the footprint`);
      assert.ok(p.c[1] - p.s[1] / 2 >= -1e-9 && p.c[1] + p.s[1] / 2 <= h + 0.45, `${k} part height`);
    }
    for (const f of ['N', 'E', 'S', 'W']) {
      const fp = footprint(5, 5, f, kit.size);
      const boxes = pieceBoxes({ kind: k, x: 5, z: 5, facing: f, size: kit.size, y: kit.y ?? 0, colour: '#111111', trim: '#222222' }, 6);
      for (const b of boxes) assert.ok(b.min[0] >= fp[0] - 0.08 && b.max[0] <= fp[2] + 0.08 && b.min[2] >= fp[1] - 0.08 && b.max[2] <= fp[3] + 0.08, `${k} ${f}`);
    }
  }
  assert.equal(KIT.seatrow.seats(KIT.seatrow.size).length, 6);
  assert.deepEqual(rowSeats(1.2, 0, 0.46).map((s) => +s.a.toFixed(6)), [-0.3, 0.3]);
  assert.equal(KIT.bench.seats([1.6, 0.46, 0.4]).length, 3);
  const both = KIT.bookcase.parts([2, 2, 0.6]), one = KIT.bookcase.parts([2, 2, 0.38]);
  assert.ok(both.length > one.length * 1.6, 'a deep bookcase has books on both faces');
});

test('a tiered lecture room: sitters lifted by their tier, the player walks up the tiers, not up the stairs', () => {
  const tiers = [0.25, 0.5, 0.75];
  const raw = mini({ room: { width: 12, depth: 10, height: 3.6 }, door: { x: 50, z: 60, facing: 'N', fromLeft: 1.0 },
    props: [
      { kind: 'seatrow', x: 6, z: 7.5, size: [6, 0.9, 0.85] },
      ...tiers.flatMap((y, k) => [{ kind: 'tier', x: 6, z: 6.55 - k * 0.95, size: [8.4, y, 0.95] },
        { kind: 'seatrow', x: 6, z: 6.55 - k * 0.95, y, size: [6, 0.9, 0.85] }]),
      { kind: 'stairs', x: 11.3, z: 6, facing: 'S', size: [1.2, 3.6, 4.0] },
    ],
    people: { share: 1 } });
  const { place, warnings } = parsePlace(raw, 't.json');
  assert.deepEqual(warnings, []);
  const people = roomPeople(place);
  assert.equal(people.length, 40);
  assert.deepEqual([...new Set(people.map((p) => +p.lift.toFixed(2)))].sort(), [0, 0.25, 0.5, 0.75]);
  // walk along the aisle beside the rows (x 2.4) toward the door: up the tiers' ends, a step at a time
  const floorY = -40, v = roomVolume(place, floorY), fr = roomFrame(place);
  const city = { isSolid: (x, y, z) => v.isSolid(x, y, z) ?? false, groundHeight: (x, z, f) => v.groundHeight(x, z, f) ?? null };
  const c = new CharacterController(city);
  const [sx, sz] = fr.toUnity(2.4, 7.6);
  c.spawn(sx, floorY + 0.05, -sz, fr.yawOut);
  for (let q = 0; q < 20; q++) c.update(1 / 30, {}, fr.yawOut);
  let top = -Infinity, topZ = null;
  for (let q = 0; q < 150; q++) {
    c.update(1 / 30, { move: [0, 1], speed: 1.4 }, fr.yawOut);
    if (c.grounded && c.pos[1] - floorY > top) { top = c.pos[1] - floorY; topZ = fr.toRoom(c.pos[0], -c.pos[2])[1]; }
  }
  assert.ok(Math.abs(top - 0.75) < 0.02 && topZ < 5.6 && topZ > 4.0, `stood on the top tier (y ${top.toFixed(2)}, z ${topZ?.toFixed(2)})`);
  assert.ok(fr.toRoom(c.pos[0], -c.pos[2])[1] < 4.0 && c.pos[1] - floorY < 0.02, 'and stepped down off its back');
  // the stairs are scenery: walking into their bottom step stops at it
  const c2 = new CharacterController(city);
  const [tx, tz] = fr.toUnity(11.3, 1.5);
  c2.spawn(tx, floorY + 0.05, -tz, fr.yawIn);
  for (let q = 0; q < 150; q++) c2.update(1 / 30, { move: [0, 1], speed: 1.4 }, fr.yawIn);
  const [, rz2] = fr.toRoom(c2.pos[0], -c2.pos[2]);
  assert.ok(rz2 < 4.0 && c2.pos[1] - floorY < 0.05, `stopped at the stairs (z ${rz2.toFixed(2)})`);
});

test('people: at most MAX_PEOPLE, staff and standing always in, seated fill the rest in seat order', () => {
  const props = [];
  for (let k = 0; k < 8; k++) props.push({ kind: 'seatrow', x: 6, z: 2.5 + k * 1.0, size: [10.8, 0.9, 0.85] });
  const place = parsePlace(mini({ room: { width: 12, depth: 12, height: 3.6 }, door: { x: 50, z: 60, facing: 'N', fromLeft: 0.8 }, props,
    people: { share: 1, staff: [{ x: 1, z: 11, facing: 'S' }], standing: [{ x: 11, z: 11, facing: 'S' }] } }), 't.json').place;
  assert.equal(seatsOf(place).length, 144);
  const people = roomPeople(place);
  assert.equal(people.length, MAX_PEOPLE);
  assert.ok(people[0].staff && people[1].mode === MODE.IDLE && people[2].mode === MODE.SIT);
  assert.equal(roomPeople(place, 10).length, 10);
  assert.ok(entrySpot(place).z > 0);
});
