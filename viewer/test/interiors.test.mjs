// Interiors: place-file format, room frame, collision volume, doors, people, the build copy.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, writeFileSync, readdirSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parsePlace, footprint } from '../src/interiors/format.js';
import { KIT, KIT_KINDS } from '../src/interiors/kit.js';
import { roomFrame, roomBoxes, solidBoxes, seatsOf, entrySpot, exitSpot, courseBricks, windows, DEPTH } from '../src/interiors/layout.js';
import { roomVolume, installVolumes } from '../src/interiors/volume.js';
import { doorCheck, nearestDoor, exitCheck, Fader, angleGap, facingFromYaw, doorHere } from '../src/interiors/door.js';
import { roomPeople, peoplePoses, strHash } from '../src/interiors/people.js';
import { copyPlaces } from '../src/interiors/copy-data.mjs';
import { studCentres } from '../src/interiors/mesh.js';
import { loadPlaces } from '../src/interiors/index.js';
import { CharacterController } from '../src/player/controller.js';
import { MODE } from '../src/figure/rig.js';

const here = dirname(fileURLToPath(import.meta.url));
const DATA = join(here, '..', 'src', 'interiors', 'data');
const raw = (f) => JSON.parse(readFileSync(join(DATA, f), 'utf8'));
const files = readdirSync(DATA).filter((f) => f.endsWith('.json'));
const examples = files.filter((f) => raw(f).example === true);

/** A small valid place for edits in tests. */
function mini(over = {}) {
  return { format: 'blox-interior', version: 1, id: 'test-room', name: 'Test Room',
    door: { x: 100, z: 200, facing: 'N', fromLeft: 2 }, room: { width: 5, depth: 6, height: 3 },
    props: [{ kind: 'table', x: 3.5, z: 4 }, { kind: 'chair', x: 2.9, z: 4, facing: 'E' }], ...over };
}
const parse = (r) => parsePlace(r, 't.json').place;

test('every place file parses without warnings; the two templates are marked as examples', () => {
  assert.deepEqual(examples.sort(), ['cafe-de-steen.json', 'lounge-22.json']);
  for (const f of files) {
    const { place, warnings } = parsePlace(raw(f), f);
    assert.deepEqual(warnings, [], f);
    assert.equal(place.example, examples.includes(f), `${f}: example flag`);
    assert.ok(place.props.length > 10 && seatsOf(place).length >= 6, f);
  }
});

test('parsePlace fills defaults and rejects bad files with the field named', () => {
  const p = parse(mini());
  assert.equal(p.room.floor, 0);
  assert.equal(p.props[0].facing, 'N');
  assert.deepEqual(p.props[0].size, KIT.table.size);
  assert.equal(p.people.share, 0.6);
  assert.equal(p.sign.text, 'Test Room');
  const bad = [
    [{ format: 'x' }, /format/],
    [{ version: 2 }, /version/],
    [{ id: 'Bad Id' }, /id must/],
    [{ door: { x: 1, z: 2, fromLeft: 2 } }, /door.facing is required/],
    [{ door: { x: 1, z: 2, facing: 'Q' } }, /door.facing must be N, E, S or W/],
    [{ room: { width: 50, depth: 6 } }, /room.width = 50/],
    [{ props: [{ kind: 'piano', x: 1, z: 1 }] }, /not in the kit/],
    [{ props: [{ kind: 'table', x: 4.8, z: 3 }] }, /sticks out of the room/],
    [{ props: [{ kind: 'table', x: 2, z: 0.8 }] }, /blocks the way in/],
    [{ props: [{ kind: 'table', x: 2, z: 3, colour: 'red' }] }, /colour/],
    [{ props: [{ kind: 'shelf', x: 2, z: 3, size: [1, 4, 0.3] }] }, /taller than the room/],
    [{ look: { pattern: 'stripes' } }, /pattern/],
  ];
  for (const [o, re] of bad) assert.throws(() => parse(mini(o)), re, JSON.stringify(o));
  const w = parsePlace(mini({ bagId: '123', props: [{ kind: 'table', x: 3, z: 3 }, { kind: 'table', x: 3.2, z: 3 }] }), 't.json').warnings;
  assert.equal(w.length, 2); // bad BAG id, overlapping tables
});

test('every kit piece has parts inside its size and seats where it has seats', () => {
  for (const k of KIT_KINDS) {
    const kit = KIT[k];
    const parts = kit.parts(kit.size);
    assert.ok(parts.length > 0, k);
    for (const p of parts) assert.ok(p.s.every((v) => v > 0), `${k} part size`);
    if (kit.seats) assert.ok(kit.seats(kit.size).length >= 1, k);
  }
  assert.equal(KIT.sofa.seats([1.8, 0.85, 0.85]).length, 2);
});

test('room frame: room <-> Unity round trip for every door facing, inward is the door turned round', () => {
  for (const facing of ['N', 'E', 'S', 'W']) {
    const p = parse(mini({ door: { x: 100, z: 200, facing, fromLeft: 2 } }));
    const fr = roomFrame(p);
    assert.deepEqual(fr.toUnity(2, 0), [100, 200]); // the door
    for (const [x, z] of [[0, 0], [5, 6], [1.3, 4.2]]) {
      const [ux, uz] = fr.toUnity(x, z);
      const [rx, rz] = fr.toRoom(ux, uz);
      assert.ok(Math.abs(rx - x) < 1e-9 && Math.abs(rz - z) < 1e-9, facing);
    }
    // one metre into the room = one metre against the door's facing
    const [ix, iz] = fr.toUnity(2, 1);
    const out = { N: [0, 1], E: [1, 0], S: [0, -1], W: [-1, 0] }[facing];
    assert.deepEqual([ix - 100, iz - 200].map((v) => Math.round(v) + 0), [-out[0] + 0, -out[1] + 0]);
    assert.ok(angleGap(fr.yawIn, fr.yawOut) > 3.1);
    const [ex, ez] = exitSpot(p);
    assert.ok(Math.hypot(ex - 100 - out[0] * 0.6, ez - 200 - out[1] * 0.6) < 1e-9, 'exit on the pavement in front of the door');
  }
});

test('room boxes: walls leave the doorway open, studs on table tops, bricks in running bond', () => {
  const p = parse(mini());
  const boxes = roomBoxes(p);
  assert.ok(boxes.length > 100);
  const inDoor = boxes.filter((b) => b.min[2] < -0.01 && b.max[2] > -0.29 && b.min[0] < 2.4 && b.max[0] > 1.6 && b.min[1] < 2.0 && b.max[1] > 0.1 && b.col === p.look.walls);
  assert.equal(inDoor.length, 0, 'no wall brick in the doorway');
  assert.ok(boxes.some((b) => b.studs && Math.abs(b.max[1] - 0.75) < 1e-6), 'studded table top');
  assert.deepEqual(courseBricks(3, 0), [[0, 1], [1, 2], [2, 3]]);
  assert.deepEqual(courseBricks(3, 1), [[0, 0.5], [0.5, 1.5], [1.5, 2.5], [2.5, 3]]);
  assert.deepEqual(courseBricks(3, 0, [[1.2, 1.8]]), [[0, 1], [1, 1.2], [1.8, 2], [2, 3]]);
  assert.equal(windows(p).length, 1); // left of the door is too narrow for one
  assert.deepEqual(studCentres([0, 0, 0], [0.5, 0.1, 0.25]).length, 2);
});

test('furniture footprints turn with their facing', () => {
  assert.deepEqual(footprint(1, 1, 'N', [2, 1, 0.5]), [0, 0.75, 2, 1.25]);
  assert.deepEqual(footprint(1, 1, 'E', [2, 1, 0.5]), [0.75, 0, 1.25, 2]);
  const p = parse(mini({ props: [{ kind: 'bar', x: 4, z: 3, facing: 'W' }] }));
  const [b] = solidBoxes(p);
  assert.ok(Math.abs(b[3] - b[0] - 0.65) < 1e-9 && Math.abs(b[5] - b[2] - 3.0) < 1e-9);
});

test('volume: walls, floor, ceiling and furniture are solid; the room, the niche are free', () => {
  const p = parse(mini());
  const v = roomVolume(p, -20);
  const fr = roomFrame(p);
  const at = (x, y, z) => { const [ux, uz] = fr.toUnity(x, z); return v.isSolid(ux, -20 + y, -uz); };
  assert.equal(at(1, 1, 2), false);
  assert.equal(at(-0.2, 1, 2), true); // left wall
  assert.equal(at(1, -0.1, 2), true); // floor
  assert.equal(at(1, 3.1, 2), true); // ceiling
  assert.equal(at(3.5, 0.5, 4), true); // table
  assert.equal(at(3.5, 0.9, 4), false); // above it
  assert.equal(at(2, 1, -0.2), false); // the doorway niche
  assert.equal(at(2, 1, -0.6), true); // the street door at its back
  assert.equal(v.isSolid(500, 0, 0), undefined, 'outside the region: not ours');
  const [ux, uz] = fr.toUnity(3.5, 4);
  assert.ok(Math.abs(v.groundHeight(ux, -uz, -20 + 2) - (-20 + 0.75)) < 1e-9, 'stands on the table top');
  assert.ok(Math.abs(v.groundHeight(...(() => { const [a, b] = fr.toUnity(1, 1); return [a, -b]; })()) + 20) < 1e-9, 'floor');
});

test('installVolumes: only the active room changes answers, once installed it stays one wrapper', () => {
  const calls = [];
  const city = { isSolid: (x, y, z) => { calls.push([x, y, z]); return y < 0; }, groundHeight: () => 0, isWater: () => true };
  const vols = installVolumes(city);
  assert.equal(installVolumes(city), vols);
  const p = parse(mini());
  const v = roomVolume(p, -40);
  const [ux, uz] = roomFrame(p).toUnity(1, 2);
  assert.equal(city.isSolid(ux, -39, -uz), true); // base: below 0 is solid
  vols.set(v);
  assert.equal(city.isSolid(ux, -39, -uz), false); // the room is air there
  assert.equal(city.isWater(ux, -39, -uz), false);
  assert.ok(Math.abs(city.groundHeight(ux, -uz) + 40) < 1e-9);
  assert.equal(city.isSolid(ux + 100, 5, -uz), false); // elsewhere: the city
  vols.set(null);
  assert.equal(city.isSolid(ux, -39, -uz), true);
});

test('the player controller walks in the room and stops at walls and furniture', () => {
  const p = parse(mini());
  const floorY = -30;
  const v = roomVolume(p, floorY);
  const city = { isSolid: (x, y, z) => v.isSolid(x, y, z) ?? 'unknown', groundHeight: (x, z, f) => v.groundHeight(x, z, f) ?? 'unknown' };
  const fr = roomFrame(p);
  const s = entrySpot(p);
  const [ux, uz] = fr.toUnity(s.x, s.z);
  const c = new CharacterController(city);
  c.spawn(ux, floorY + 0.05, -uz, fr.yawIn);
  for (let q = 0; q < 30; q++) c.update(1 / 30, {}, fr.yawIn);
  assert.ok(c.grounded && Math.abs(c.pos[1] - floorY) < 0.02, 'stands on the floor');
  for (let q = 0; q < 300; q++) c.update(1 / 30, { move: [0, 1], speed: 4 }, fr.yawIn); // run at the back wall
  const [, rz] = fr.toRoom(c.pos[0], -c.pos[2]);
  assert.ok(rz < 6 - 0.3 && rz > 5, `stopped at the back wall (z ${rz.toFixed(2)})`);
  // walk east into the table (x 3.1..3.9, z 3.6..4.4)
  const c2 = new CharacterController(city);
  const [tx, tz] = fr.toUnity(1.2, 4);
  c2.spawn(tx, floorY + 0.05, -tz, fr.yawIn);
  const east = (fr.roomRot + 1) * Math.PI / 2;
  for (let q = 0; q < 200; q++) c2.update(1 / 30, { move: [0, 1], speed: 1.4 }, east);
  const [rx2] = fr.toRoom(c2.pos[0], -c2.pos[2]);
  assert.ok(rx2 < 2.9, `stopped at the chair/table (x ${rx2.toFixed(2)})`);
});

test('doors: near shows the hint, walking into the door enters; inside the niche leaves', () => {
  const p = parse(mini());
  const fr = roomFrame(p);
  const atDoor = { x: 100, y: 0, z: 200.5 };
  let c = doorCheck(p, atDoor, fr.yawIn, 0);
  assert.ok(c.near && c.walkIn);
  c = doorCheck(p, atDoor, fr.yawOut, 0);
  assert.ok(c.near && !c.walkIn, 'facing the street: no');
  assert.ok(!doorCheck(p, { x: 100, y: 5, z: 200.5 }, fr.yawIn, 0).near, 'on a balcony above: no');
  assert.ok(!doorCheck(p, { x: 104, y: 0, z: 200 }, fr.yawIn, 0).near);
  assert.equal(nearestDoor([p], { x: 101, y: 0, z: 201 }, 0, () => 0).place, p);
  assert.equal(nearestDoor([p], { x: 120, y: 0, z: 201 }, 0, () => 0), null);
  const s = entrySpot(p);
  assert.ok(!exitCheck(p, s, fr.yawIn).walkOut, 'spawned inside facing in: stays');
  assert.ok(exitCheck(p, s, fr.yawOut).near);
  assert.ok(exitCheck(p, { x: 2, z: 0.2 }, fr.yawOut).walkOut);
  assert.ok(!exitCheck(p, { x: 4, z: 0.2 }, fr.yawOut).walkOut, 'beside the door: no');
  assert.deepEqual([0, Math.PI / 2, Math.PI, -Math.PI / 2, 2 * Math.PI + 0.1].map(facingFromYaw), ['N', 'E', 'S', 'W', 'N']);
  assert.deepEqual(doorHere({ x: 1.234, z: 5 }, Math.PI), { x: 1.23, z: 5, facing: 'N' });
});

test('fader: out, the callback once at black, hold, back in', () => {
  const f = new Fader({ out: 0.2, hold: 0.1, back: 0.2 });
  let n = 0;
  assert.ok(f.start(() => n++));
  assert.ok(!f.start(() => n++), 'one at a time');
  const ops = [];
  for (let q = 0; q < 12; q++) ops.push(f.update(0.05));
  assert.equal(n, 1);
  assert.ok(ops[0] > 0 && ops[0] < 1 && ops.includes(1));
  assert.equal(ops.at(-1), 0);
  assert.ok(!f.busy);
});

test('people: stable picks of the seats, seated on stools higher, staff standing', () => {
  const p = parse(raw('cafe-de-steen.json'));
  const a = roomPeople(p), b = roomPeople(p);
  assert.deepEqual(a, b);
  const seated = a.filter((x) => x.mode === MODE.SIT);
  assert.ok(seated.length > 0 && seated.length < seatsOf(p).length);
  assert.ok(a.some((x) => x.staff && x.mode === MODE.IDLE));
  const poses = peoplePoses(p, a, -10, 0);
  assert.equal(poses.length, a.length);
  const stool = a.findIndex((x) => x.lift > 0.2);
  if (stool >= 0) assert.ok(poses[stool].y > -10 + 0.2);
  assert.notEqual(strHash('a'), strHash('b'));
  assert.equal(DEPTH > 20, true);
});

test('copyPlaces validates, copies and indexes; a broken file stops the build', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'interiors-'));
  const src = join(dir, 'data'), out = join(dir, 'site', 'interiors');
  mkdirSync(src);
  writeFileSync(join(src, 'a.json'), JSON.stringify(mini()));
  writeFileSync(join(src, 'b.json'), JSON.stringify(mini({ id: 'other-room' })));
  const logs = [];
  assert.deepEqual(await copyPlaces(src, out, (m) => logs.push(m)), ['a.json', 'b.json']);
  assert.deepEqual(JSON.parse(readFileSync(join(out, 'index.json'), 'utf8')), { version: 1, places: ['a.json', 'b.json'] });
  // the runtime loader reads what the build wrote
  const places = await loadPlaces(async (u) => JSON.parse(readFileSync(join(dir, 'site', u), 'utf8')));
  assert.deepEqual(places.map((x) => x.id), ['test-room', 'other-room']);
  writeFileSync(join(src, 'c.json'), JSON.stringify(mini({ id: 'test-room' })));
  await assert.rejects(copyPlaces(src, out, () => {}), /already used/);
  writeFileSync(join(src, 'c.json'), '{ nope');
  await assert.rejects(copyPlaces(src, out, () => {}), /c.json: not valid JSON/);
  assert.deepEqual(await loadPlaces(async () => { throw new Error('404'); }), []);
});
