// City sound: the pure mix (levels, pan, birds, surfaces, rain), the event state machines
// (bells, steps, landing, doors), the remembered prefs and the sound places (src/audio/).
import test from 'node:test';
import assert from 'node:assert/strict';
import { att, earFrom, placeOf, busyLevel, addLevels, heightFade, curveAt, birdCurve, greenAt, birdRate, surfaceAt, rainLevel, engineVoice, SURFACES } from '../src/audio/mix.js';
import { bellStrikes, StepClock, AirWatch, DoorWatch, eventsInTick, PRELUDE } from '../src/audio/events.js';
import { loadPrefs, savePrefs, masterGain, PREFS_KEY, PREFS_DEFAULTS } from '../src/audio/prefs.js';
import { audioPlaces, DEFAULT_ORIGIN_RD } from '../src/audio/places.js';

const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `${a} != ${b}`);
const H = 3600, MON = 0, SUN = 6 * 86400;

test('falloff: 1 at the source, 1/2 at ref, monotonic', () => {
  near(att(0, 10), 1); near(att(10, 10), 0.5);
  assert.ok(att(100, 10) < att(50, 10));
});

test('ear on the street at the player, or at the camera with its height', () => {
  const right = [1, 0, 0]; // camera looking north: right is east
  const walk = earFrom([0, 50, 0], right, 0, [10, 2, -20]);
  assert.deepEqual([walk.x, walk.z, walk.h], [10, 20, 1.6]);
  const map = earFrom([5, 300, -7], right, 20);
  assert.deepEqual([map.x, map.z, map.h], [5, 7, 280]);
});

test('pan: east of a north-facing ear is right, behind-left is left, overhead is centred', () => {
  const ear = earFrom([0, 1.6, 0], [1, 0, 0], 0);
  assert.ok(placeOf(ear, 20, 0).pan > 0.7);
  assert.ok(placeOf(ear, -20, -5).pan < -0.6);
  near(placeOf(ear, 0, 0).pan, 0);
  const facingEast = earFrom([0, 1.6, 0], [0, 0, 1], 0); // three.js +z = south: right is south
  assert.ok(placeOf(facingEast, 0, -30).pan > 0.7);
});

test('busy level: more and nearer sources are louder, bounded, panned toward them', () => {
  const ear = earFrom([0, 1.6, 0], [1, 0, 0], 0);
  const one = busyLevel(ear, [{ x: 10, z: 0 }], () => 1, 10);
  const many = busyLevel(ear, Array.from({ length: 20 }, (_, q) => ({ x: 10, z: q - 10 })), () => 1, 10);
  const far = busyLevel(ear, [{ x: 400, z: 0 }], () => 1, 10);
  assert.ok(many.level > one.level && one.level > far.level && many.level < 1);
  assert.ok(one.pan > 0.5);
  assert.deepEqual(busyLevel(ear, [], () => 1, 10), { level: 0, pan: 0, near: 0 });
  near(addLevels(0.3, 0.4), 0.5);
});

test('street detail fades with height', () => {
  near(heightFade(1.6), 1);
  assert.ok(heightFade(300) < 0.2 && heightFade(300) > 0.1);
});

test('birds: dawn chorus, quiet day, silent night; wrapped curve', () => {
  assert.equal(birdCurve(2), 0);
  assert.equal(birdCurve(23), 0);
  assert.ok(birdCurve(6.5) > birdCurve(13));
  assert.ok(birdCurve(13) > 0);
  near(curveAt([[0, 0], [12, 1], [24, 0]], 30), 0.5);
});

test('bird rate: more in the green, none in the rain or at night, less over traffic', () => {
  const park = birdRate({ hours: 7, green: 1 }), street = birdRate({ hours: 7, green: 0 });
  assert.ok(park > 4 * street && street > 0);
  assert.equal(birdRate({ hours: 7, green: 1, rain: 1 }), 0);
  assert.equal(birdRate({ hours: 1, green: 1 }), 0);
  assert.ok(birdRate({ hours: 7, green: 1, traffic: 1 }) < park);
});

test('places: the Vrijthof bells at Unity ~(1485, 3717) for the default origin; parks nearby', () => {
  const P = audioPlaces();
  assert.deepEqual(DEFAULT_ORIGIN_RD, [174700, 314000]);
  assert.ok(Math.hypot(P.bells.servaas.x - 1485, P.bells.servaas.z - 3717) < 120);
  assert.ok(Math.hypot(P.bells.jan.x - P.bells.servaas.x, P.bells.jan.z - P.bells.servaas.z) < 100);
  const stadspark = P.parks.find((p) => p.name === 'stadspark');
  assert.ok(Math.hypot(stadspark.x - 1485, stadspark.z - 3717) < 800); // south of the Vrijthof
  const other = audioPlaces([175700, 316500]);
  near(other.bells.servaas.x, P.bells.servaas.x - 1000); near(other.bells.servaas.z, P.bells.servaas.z - 2500);
  assert.deepEqual(audioPlaces(null).bells, P.bells);
});

test('green and surfaces: gravel in a park, cobbles in the old town, paving elsewhere', () => {
  const P = audioPlaces();
  const sp = P.parks.find((p) => p.name === 'stadspark');
  assert.equal(greenAt(sp.x, sp.z, P.parks), 1);
  assert.equal(greenAt(sp.x + 5000, sp.z, P.parks), 0);
  assert.equal(surfaceAt(sp.x, sp.z, P), 'gravel');
  assert.equal(surfaceAt(P.oldTown.x + 30, P.oldTown.z + 200, P), 'cobble');
  assert.equal(surfaceAt(P.oldTown.x + 3000, P.oldTown.z + 3000, P), 'stone');
  assert.equal(surfaceAt(0, 0, null), 'cobble');
  for (const s of Object.values(SURFACES)) assert.ok(s.f > 0 && s.len > 0 && s.vol > 0);
});

test('rain: a weather source first, else #rain= from the URL, clamped', () => {
  assert.equal(rainLevel(null, '#view=city&rain=0.6'), 0.6);
  assert.equal(rainLevel(null, '#rain=4'), 1);
  assert.equal(rainLevel(null, '#rain=abc'), 0);
  assert.equal(rainLevel(null, ''), 0);
  assert.equal(rainLevel({ rain: 0.3 }, '#rain=1'), 0.3);
});

test('engine: faster buses are higher, brighter and louder', () => {
  const idle = engineVoice(0), fast = engineVoice(12);
  assert.ok(fast.freq > idle.freq && fast.cut > idle.cut && fast.loud > idle.loud);
  assert.deepEqual(engineVoice(-12), fast);
});

test('bells: the hour strikes its count, half hours once, nights quiet', () => {
  assert.deepEqual(bellStrikes(MON + 9 * H - 1, MON + 9 * H + 1), [{ kind: 'hour', hour: 9, count: 9 }]);
  assert.deepEqual(bellStrikes(MON + 15 * H - 1, MON + 15 * H), [{ kind: 'hour', hour: 15, count: 3 }]);
  assert.deepEqual(bellStrikes(MON + 12 * H - 1, MON + 12 * H + 1), [{ kind: 'hour', hour: 12, count: 12 }]);
  assert.deepEqual(bellStrikes(MON + 10.5 * H - 1, MON + 10.5 * H + 1), [{ kind: 'half', hour: 10 }]);
  assert.deepEqual(bellStrikes(MON + 3 * H - 1, MON + 3 * H + 1), []);
  assert.deepEqual(bellStrikes(MON + 22.5 * H - 1, MON + 22.5 * H + 1), []);
  assert.deepEqual(bellStrikes(MON + 22 * H - 1, MON + 22 * H + 1), [{ kind: 'hour', hour: 22, count: 10 }]);
  assert.deepEqual(bellStrikes(MON + 9 * H + 1, MON + 9 * H + 50), []); // nothing crossed
});

test('bells: clock jumps strike nothing; the week wrap still works; first frame is quiet', () => {
  assert.deepEqual(bellStrikes(MON + 8 * H, MON + 14 * H), []);
  assert.deepEqual(bellStrikes(null, MON + 9 * H), []);
  assert.deepEqual(bellStrikes(SUN + 86400 - 10, 5), []); // midnight: night, quiet
  assert.deepEqual(bellStrikes(SUN + 86400 - 10, 5, { from: 0, to: 23 }), [{ kind: 'hour', hour: 0, count: 12 }]);
  assert.ok(PRELUDE.length >= 4);
});

test('steps: one per stride, none standing or in the air, first step soon after starting', () => {
  const s = new StepClock(() => 0.7);
  let n = 0;
  for (let q = 0; q < 100; q++) n += s.update(0.07, 1.4, true); // 7 m
  assert.equal(n, 10);
  assert.equal(s.update(0.5, 4, false), 0);
  assert.equal(s.update(0, 0, true), 0);
  let first = 0, d = 0;
  while (!s.update(0.05, 1.4, true)) { d += 0.05; if (++first > 100) break; }
  assert.ok(d < 0.4, `first step after ${d} m`);
});

test('air: a jump, a landing by fall speed; stepping off a kerb is no landing', () => {
  const a = new AirWatch();
  assert.equal(a.update(true, 0, 0.016), null);
  assert.deepEqual(a.update(false, 5, 0.016), { kind: 'jump' });
  for (let q = 0; q < 30; q++) a.update(false, 5 - q * 0.5, 0.016);
  const land = a.update(true, 0, 0.016);
  assert.equal(land.kind, 'land');
  assert.ok(land.strength > 0.9);
  a.update(false, -0.3, 0.016); // a kerb
  assert.equal(a.update(true, 0, 0.016), null);
});

test('doors: open after stopping, close when moving off, once each', () => {
  const d = new DoorWatch(), evs = [];
  const run = (v, s) => { for (let t = 0; t < s; t += 0.1) { const e = d.update(v, 0.1); if (e) evs.push(e); } };
  run(8, 2); run(0.05, 0.2); assert.deepEqual(evs, []);
  run(0, 3); run(3, 2); run(0, 0.2); run(9, 1);
  assert.deepEqual(evs, ['open', 'close']);
});

test('events per tick: about rate x dt on average', () => {
  let s = 1;
  const rand = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  let n = 0;
  for (let q = 0; q < 10000; q++) n += eventsInTick(2, 0.1, rand);
  assert.ok(n > 1800 && n < 2200, String(n));
  assert.equal(eventsInTick(0, 0.1, rand), 0);
});

test('prefs: defaults, stored values, bad data, throwing storage', () => {
  const m = new Map();
  const store = { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v) };
  assert.deepEqual(loadPrefs(store), PREFS_DEFAULTS);
  assert.ok(savePrefs(store, { volume: 0.3, muted: true }));
  assert.deepEqual(loadPrefs(store), { volume: 0.3, muted: true });
  m.set(PREFS_KEY, '{"volume": 7}');
  assert.deepEqual(loadPrefs(store), { volume: 1, muted: false });
  m.set(PREFS_KEY, 'not json');
  assert.deepEqual(loadPrefs(store), PREFS_DEFAULTS);
  const broken = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); } };
  assert.deepEqual(loadPrefs(broken), PREFS_DEFAULTS);
  assert.equal(savePrefs(broken, PREFS_DEFAULTS), false);
  assert.deepEqual(loadPrefs(null), PREFS_DEFAULTS);
});

test('master gain: muted is silent, the default is moderate', () => {
  assert.equal(masterGain({ volume: 1, muted: true }), 0);
  const g = masterGain(PREFS_DEFAULTS);
  assert.ok(g > 0.2 && g < 0.45);
  assert.ok(masterGain({ volume: 1, muted: false }) <= 1);
});
