import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LANDMARKS, STUDS, UNLOCKS, DATA_ORIGIN_RD } from '../src/explore/data.js';
import {
  shiftTo, emptyState, cellKey, cellCentre, visit, encodeCells, decodeCells, serialize, deserialize,
  loadState, saveState, nearest, plaqueAt, touched, unlocked, newUnlocks, nextUnlock, formatDate, placeName,
  postcardLayout, mapWindow, toMap, PLAQUE_RADIUS, PLAQUE_LEAVE, STORE_KEY, CELL_M,
} from '../src/explore/logic.js';
import { PLACES_RD } from '../src/places.js';

const memStore = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), m }; };

test('content: ids unique, names and short factual lines, finite positions in the city', () => {
  for (const list of [LANDMARKS, STUDS]) {
    const ids = list.map((x) => x.id);
    assert.equal(new Set(ids).size, ids.length);
    for (const it of list) {
      assert.ok(it.at.every(Number.isFinite) && Number.isFinite(it.y), it.id);
      // the city world (originRD 174700, 314000): Maastricht lies within ~6 km of the origin
      assert.ok(it.at[0] > 0 && it.at[0] < 6000 && it.at[1] > 0 && it.at[1] < 6000, it.id);
    }
  }
  assert.ok(LANDMARKS.length >= 20 && STUDS.length >= 38);
  for (const l of LANDMARKS) {
    assert.ok(l.name && l.text.length > 40 && l.text.length <= 220, l.id);
    assert.ok(Array.isArray(l.anchor) && Math.hypot(l.at[0] - l.anchor[0], l.at[1] - l.anchor[1]) < 100, l.id);
    assert.doesNotMatch(l.text + l.name, /lego/i);
  }
  for (const s of STUDS) assert.ok(s.hint, s.id);
});

test('content: plaques sit where the named places are (cross-checked with places.js RD points)', () => {
  const at = (id) => LANDMARKS.find((l) => l.id === id).anchor;
  const rd = (p) => [p[0] - DATA_ORIGIN_RD[0], p[1] - DATA_ORIGIN_RD[1]];
  const near = (a, b, m) => Math.hypot(a[0] - b[0], a[1] - b[1]) < m;
  assert.ok(near(at('stadhuis'), rd(PLACES_RD.markt), 60));
  assert.ok(near(at('servaas'), rd(PLACES_RD.vrijthof), 120));
  assert.ok(near(at('station'), rd(PLACES_RD.station), 60));
  assert.ok(near(at('servaasbrug'), rd(PLACES_RD.brug), 60));
});

test('content: no two plaques share a card and no stud sits on a plaque', () => {
  for (const a of LANDMARKS) {
    for (const b of LANDMARKS) if (a !== b) assert.ok(Math.hypot(a.at[0] - b.at[0], a.at[1] - b.at[1]) > PLAQUE_LEAVE * 1.5, `${a.id}/${b.id}`);
    for (const s of STUDS) assert.ok(Math.hypot(a.at[0] - s.at[0], a.at[1] - s.at[1]) > 4, `${a.id}/${s.id}`);
  }
});

test('unlocks: ascending, reachable, the last one needs every stud', () => {
  const ns = UNLOCKS.map((u) => u.studs);
  assert.deepEqual(ns, [...ns].sort((a, b) => a - b));
  assert.equal(ns.at(-1), STUDS.length);
  assert.deepEqual(unlocked(UNLOCKS, 9), []);
  assert.deepEqual(unlocked(UNLOCKS, 10).map((u) => u.id), ['gold-hat']);
  assert.deepEqual(newUnlocks(UNLOCKS, 24, 25).map((u) => u.id), ['gold-top']);
  assert.deepEqual(newUnlocks(UNLOCKS, 25, 26), []);
  assert.equal(nextUnlock(UNLOCKS, 12).id, 'gold-top');
  assert.equal(nextUnlock(UNLOCKS, STUDS.length), null);
});

test('shiftTo moves Unity positions to another world origin', () => {
  const [l] = shiftTo([{ id: 'a', at: [1720, 3988], anchor: [1700, 3990] }], DATA_ORIGIN_RD, [175700, 316500]);
  assert.deepEqual(l.at, [720, 1488]);
  assert.deepEqual(l.anchor, [700, 1490]);
  assert.deepEqual(shiftTo([{ id: 'b', at: [1, 2] }], DATA_ORIGIN_RD, null)[0].at, [1, 2]);
});

test('cells: key/centre round trip, walking lights a disc of cells', () => {
  for (const [x, z] of [[0, 0], [1720.4, 3988.2], [-300, 15], [5000, 4999]]) {
    const [cx, cz] = cellCentre(cellKey(x, z));
    assert.ok(Math.abs(cx - x) <= CELL_M / 2 && Math.abs(cz - z) <= CELL_M / 2);
  }
  assert.equal(cellKey(1e7, 0), -1);
  const s = emptyState();
  const n = visit(s, 1000, 1000);
  assert.ok(n >= 4 && n <= 12, `lit ${n}`);
  assert.equal(visit(s, 1000, 1000), 0); // same spot: nothing new
  assert.ok(s.cells.has(cellKey(1000, 1000)));
});

test('cells encode compactly and decode back; junk decodes to what is readable', () => {
  const s = emptyState();
  for (let x = 0; x < 3000; x += 7) visit(s, 1200 + x * 0.3, 3000 + Math.sin(x) * 200);
  const text = encodeCells(s.cells);
  assert.deepEqual([...decodeCells(text)].sort((a, b) => a - b), [...s.cells].sort((a, b) => a - b));
  assert.ok(text.length < s.cells.size * 4, `${text.length} chars for ${s.cells.size} cells`);
  assert.equal(decodeCells('').size, 0);
  assert.equal(decodeCells(null).size, 0);
  assert.deepEqual([...decodeCells('a,1,zz?,!,3')], [10, 11, 1306]);
});

test('state survives storage; unknown ids and bad input are dropped; storage errors are safe', () => {
  const s = emptyState();
  s.places.stadhuis = 1700000000000;
  s.places.gone = 5;
  s.studs.vrijthof = 1700000001000;
  visit(s, 1500, 3760);
  const back = deserialize(serialize(s), new Set(['stadhuis']), new Set(['vrijthof']));
  assert.deepEqual(back.places, { stadhuis: 1700000000000 });
  assert.deepEqual(back.studs, { vrijthof: 1700000001000 });
  assert.equal(back.cells.size, s.cells.size);
  assert.equal(deserialize('{nope').cells.size, 0);
  assert.deepEqual(deserialize('{"v":2,"places":{"a":1}}').places, {});
  assert.deepEqual(deserialize('{"v":1,"places":{"a":"x"},"studs":[]}').places, {});
  const st = memStore();
  assert.equal(saveState(s, st), true);
  assert.ok(st.m.has(STORE_KEY));
  assert.deepEqual(loadState(st).places, s.places);
  const broken = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('full'); } };
  assert.equal(saveState(s, broken), false);
  assert.equal(loadState(broken).cells.size, 0);
  assert.equal(loadState(null).cells.size, 0);
});

test('plaque card: shows within 8 m, stays until 11 m, prefers the nearest, ignores other floors', () => {
  const ls = [{ id: 'a', at: [0, 0], y: 10 }, { id: 'b', at: [30, 0], y: 10 }];
  assert.equal(plaqueAt(ls, PLAQUE_RADIUS + 0.5, 0), null);
  assert.equal(plaqueAt(ls, 7, 0), 'a');
  assert.equal(plaqueAt(ls, 10, 0, 'a'), 'a'); // hysteresis
  assert.equal(plaqueAt(ls, 12, 0, 'a'), null);
  assert.equal(plaqueAt(ls, 24, 0, 'a'), 'b');
  assert.equal(plaqueAt(ls, 2, 0, null, (l) => 20 - l.y), null); // 10 m above it (a bridge, a roof)
  assert.equal(nearest(ls, 16, 0).item.id, 'b');
  assert.equal(nearest(ls, 100, 100, 50), null);
});

test('studs: touched only when close and at about the same height, never twice', () => {
  const ss = [{ id: 'x', at: [5, 5], y: 2 }, { id: 'y', at: [6, 5], y: 2 }, { id: 'z', at: [5, 5], y: 12 }];
  assert.deepEqual(touched(ss, {}, 5.3, 2, 5), ['x', 'y']);
  assert.deepEqual(touched(ss, { x: 1 }, 5, 2, 5), ['y']); // x already collected
  assert.deepEqual(touched(ss, {}, 5, 11.5, 5), ['z']);
  assert.deepEqual(touched(ss, {}, 5, 2, 5, () => 6), []); // the ground moved (settled) away
  assert.deepEqual(touched(ss, {}, 9, 2, 5), []);
});

test('postcard: fixed English date, place name from landmarks or street', () => {
  assert.equal(formatDate(new Date(2026, 10, 7)), '7 November 2026');
  assert.equal(formatDate(new Date(2027, 0, 31)), '31 January 2027');
  const ls = [{ name: 'Helpoort', at: [100, 100] }];
  assert.equal(placeName(ls, 150, 100), 'Helpoort');
  assert.equal(placeName(ls, 400, 100, 'Grote Staat'), 'Grote Staat, Maastricht');
  assert.equal(placeName(ls, 400, 100), 'Maastricht');
});

test('postcard layout: photo inside a border with a caption band, capped width', () => {
  const L = postcardLayout(3200, 1800);
  assert.equal(L.photo.w, 1600);
  assert.equal(L.photo.h, 900);
  assert.equal(L.W, L.photo.w + 2 * L.pad);
  assert.ok(L.H > L.photo.h + 2 * L.pad);
  assert.equal(L.caption.y, L.photo.y + L.photo.h);
  assert.ok(L.title > L.small && L.small >= 10);
  const tiny = postcardLayout(200, 100);
  assert.equal(tiny.photo.w, 200);
  assert.ok(tiny.pad >= 8 && tiny.caption.h >= 36);
});

test('map window covers the old town, grows to walked cells, projects north up', () => {
  const s = emptyState();
  const base = [1000, 2900, 2800, 4300];
  const w0 = mapWindow(s.cells, [], base);
  assert.ok(w0.x0 <= 1000 && w0.z0 <= 2900 && w0.x0 + w0.size >= 2800 && w0.z0 + w0.size >= 4300);
  visit(s, 1900, 800); // the Sint-Pietersberg, south of the base window
  const w1 = mapWindow(s.cells, [], base);
  assert.ok(w1.z0 < 800 && w1.size > w0.size);
  const [px, py] = toMap(w1, 500, w1.x0, w1.z0 + w1.size);
  assert.deepEqual([px, py], [0, 0]); // north-west corner = top left
  const [, south] = toMap(w1, 500, w1.x0, w1.z0);
  assert.equal(south, 500);
});
