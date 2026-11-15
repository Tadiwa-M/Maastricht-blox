import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MapView, isTap } from '../src/menu/view.js';
import { mergeStops, segmentTiles, tilesIn, PointGrid, pickMarker, labelLevel, headingFrom } from '../src/menu/mapdata.js';
import { menuItems, moveFocus, PAUSED_SPEED, resumeSpeed } from '../src/menu/items.js';
import { Travel, FADE_IN_S, FADE_OUT_S, RETRY_S, GIVE_UP_S } from '../src/menu/travel.js';

const near = (a, b, e = 1e-9) => assert.ok(Math.abs(a - b) <= e, `${a} vs ${b}`);

test('map view: world <-> screen round trip, north up', () => {
  const v = new MapView({ w: 800, h: 400, cx: 1000, cz: 2000, scale: 2 });
  assert.deepEqual(v.toScreen(1000, 2000), [400, 200]);
  assert.deepEqual(v.toScreen(1010, 2010), [420, 180]); // east is right, north is up
  const [x, z] = v.toWorld(123, 321);
  const [sx, sy] = v.toScreen(x, z);
  near(sx, 123); near(sy, 321);
});

test('map view: pan follows the finger, zoom keeps the point under the cursor', () => {
  const v = new MapView({ w: 800, h: 400, cx: 0, cz: 0, scale: 1 });
  const before = v.toWorld(100, 100);
  v.pan(50, -20);
  const after = v.toScreen(...before);
  near(after[0], 150); near(after[1], 80);
  const p = v.toWorld(600, 300);
  v.zoomAt(600, 300, 3);
  near(v.scale, 3);
  const q = v.toScreen(...p);
  near(q[0], 600, 1e-6); near(q[1], 300, 1e-6);
  v.zoomAt(0, 0, 1e6);
  assert.equal(v.scale, v.max); // clamped
});

test('map view: pinch spreads to zoom and moves with the midpoint', () => {
  const v = new MapView({ w: 400, h: 400, scale: 1 });
  const mid = v.toWorld(200, 200);
  v.pinch([150, 200], [250, 200], [100, 200], [300, 200]); // spread x2 around the centre
  near(v.scale, 2);
  const m = v.toScreen(...mid);
  near(m[0], 200, 1e-6); near(m[1], 200, 1e-6);
  v.pinch([100, 200], [300, 200], [110, 210], [310, 210]); // both fingers move: pan only
  near(v.scale, 2);
  const m2 = v.toScreen(...mid);
  near(m2[0], 210, 1e-6); near(m2[1], 210, 1e-6);
});

test('map view: fit shows a box whole; bounds is the visible box', () => {
  const v = new MapView({ w: 420, h: 220 });
  v.fit(0, 0, 400, 100, 10);
  near(v.scale, 1); // 400 m over 400 px is the tighter side
  assert.deepEqual([v.cx, v.cz], [200, 50]);
  const [x0, z0, x1, z1] = v.bounds();
  near(x0, -10); near(x1, 410); near(z0, -60); near(z1, 160);
});

test('tap or drag', () => {
  assert.ok(isTap({ x: 0, y: 0, t: 0 }, { x: 4, y: 3, t: 200 }));
  assert.ok(!isTap({ x: 0, y: 0, t: 0 }, { x: 40, y: 0, t: 200 }));
  assert.ok(!isTap({ x: 0, y: 0, t: 0 }, { x: 0, y: 0, t: 2000 }));
});

test('stops: platforms of one stop merge, far ones with the same name do not, outside ones drop', () => {
  const stops = [
    { name: 'Vrijthof', x: 100, y: 200 }, { name: 'Vrijthof', x: 120, y: 200 },
    { name: 'Vrijthof', x: 900, y: 200 }, { name: 'Markt', x: 300, y: 300 }, { name: 'Far', x: -5000, y: 0 }, { x: 1, y: 1 },
  ];
  const m = mergeStops(stops, (x) => x >= 0);
  assert.equal(m.length, 3);
  const v = m.find((s) => s.name === 'Vrijthof' && s.n === 2);
  assert.deepEqual([v.x, v.z, v.kind], [110, 200, 'stop']);
});

test('walkway segments are bucketed by tile and found by the view box', () => {
  const doc = { nodes: [10, 10, 300, 10, 600, 600], edges: [0, 1, 1, 2, 0, 9] }; // last edge points nowhere
  const t = segmentTiles(doc, 256);
  assert.deepEqual([...t.keys()].sort(), ['0,0', '1,0']);
  assert.deepEqual([...t.get('0,0')], [10, 10, 300, 10]);
  const keys = tilesIn([0, 0, 100, 100], 256);
  assert.ok(keys.includes('0,0') && keys.includes('-1,-1'));
});

test('point grid: nearest within a radius', () => {
  const g = new PointGrid([0, 0, 50, 50, 51, 49, 400, 400], 32);
  assert.equal(g.nearest(52, 48, 10).i, 2);
  assert.equal(g.nearest(200, 200, 30), null);
  assert.equal(g.nearest(390, 390, 20).i, 3);
});

test('marker pick by screen distance; labels by zoom; heading from a camera', () => {
  const v = new MapView({ w: 200, h: 200, cx: 0, cz: 0, scale: 1 });
  const items = [{ name: 'a', x: 0, z: 0 }, { name: 'b', x: 30, z: 0 }];
  assert.equal(pickMarker(items, 104, 100, v).name, 'a');
  assert.equal(pickMarker(items, 127, 101, v).name, 'b');
  assert.equal(pickMarker(items, 160, 160, v), null);
  assert.deepEqual(labelLevel(0.1), { landmarks: false, stops: false });
  assert.deepEqual(labelLevel(2), { landmarks: true, stops: true });
  // three.js: camera south of the target (z larger = further south) looks north -> yaw 0
  near(headingFrom({ x: 0, z: 10 }, { x: 0, z: 0 }), 0);
  near(headingFrom({ x: 0, z: 0 }, { x: 10, z: 0 }), Math.PI / 2); // looking east
});

test('menu items follow the modules that are there; key hints only without touch', () => {
  const all = menuItems({ has: { player: true, explore: true, trip: true, goals: true, mp: true, music: true } });
  assert.deepEqual(all.map((i) => i.id), ['resume', 'map', 'character', 'journal', 'photo', 'trip', 'goals', 'look', 'music', 'settings', 'help', 'mp']);
  assert.equal(all.find((i) => i.id === 'journal').key, 'J');
  const bare = menuItems({ has: {}, touch: true, goalsOff: true });
  assert.deepEqual(bare.map((i) => i.id), ['resume', 'map', 'look', 'settings']);
  assert.ok(bare.every((i) => i.key === ''));
  assert.equal(menuItems({ has: { goals: true }, goalsOff: true }).find((i) => i.id === 'goals').label, 'Goals: off');
  assert.equal(menuItems({ look: 'Spider-Verse' }).find((i) => i.id === 'look').label, 'Look: Spider-Verse');
});

test('focus moves through a grid and wraps', () => {
  assert.equal(moveFocus(-1, 10, 'down', 2), 0);
  assert.equal(moveFocus(0, 10, 'down', 2), 2);
  assert.equal(moveFocus(0, 10, 'up', 2), 8);
  assert.equal(moveFocus(9, 10, 'right', 2), 0);
  assert.equal(moveFocus(3, 10, 'left', 1), 3); // one column: left/right stay
  assert.equal(moveFocus(0, 0, 'down'), -1);
});

test('the paused clock: restored on resume unless changed meanwhile', () => {
  assert.equal(resumeSpeed(10, PAUSED_SPEED), 10);
  assert.equal(resumeSpeed(10, 60), 60);
});

function fakeTravel({ loadedAfter = 0 } = {}) {
  const log = [], fades = [];
  let tries = 0;
  const t = new Travel({
    fade: (a, text) => fades.push([a, text]),
    place: () => { tries++; return tries > loadedAfter; },
    prepare: (x, z) => log.push(['prepare', x, z]),
    giveUp: () => log.push(['giveUp']),
    done: (r) => log.push(['done', r]),
  });
  return { t, log, fades, tries: () => tries };
}
const run = (t, s, dt = 0.05) => { for (let q = 0; q < Math.round(s / dt); q++) t.step(dt); };

test('travel: loaded ground -> fade in, stand there, fade out', () => {
  const { t, log, fades } = fakeTravel();
  assert.ok(t.start({ x: 1, z: 2, yaw: 0, name: 'Markt' }));
  assert.ok(!t.start({ x: 9, z: 9 })); // one at a time
  run(t, FADE_IN_S + FADE_OUT_S + 0.2);
  assert.deepEqual(log, [['done', 'placed']]);
  assert.ok(!t.busy);
  assert.equal(Math.max(...fades.map((f) => f[0])), 1);
  assert.equal(fades.at(-1)[0], 0);
});

test('travel: not loaded -> prepare once, retry, then stand there', () => {
  const { t, log, tries } = fakeTravel({ loadedAfter: 3 });
  t.start({ x: 5, z: 6, yaw: 0, name: 'Vrijthof' });
  run(t, FADE_IN_S + 0.01);
  assert.deepEqual(log, [['prepare', 5, 6]]);
  run(t, RETRY_S * 3 + 0.1);
  assert.equal(tries(), 4);
  run(t, FADE_OUT_S + 0.1);
  assert.deepEqual(log.at(-1), ['done', 'placed']);
});

test('travel: gives up after the timeout', () => {
  const { t, log } = fakeTravel({ loadedAfter: 1e9 });
  t.start({ x: 0, z: 0, yaw: 0 });
  run(t, FADE_IN_S + GIVE_UP_S + FADE_OUT_S + 1, 0.1);
  assert.deepEqual(log.map((l) => l[0]), ['prepare', 'giveUp', 'done']);
  assert.equal(log.at(-1)[1], 'gave-up');
});
