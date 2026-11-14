// Shooting in capture the flag, client side (src/mp/weapons.js): the guns' timing, spread, hits, the heat map.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WEAPONS, Gun, spreadDir, raySphere, hitTest, wallT, heatProject, meleeTarget, pickupSpots } from '../src/mp/weapons.js';
import { MatchModel } from '../src/mp/model.js';
import { pickupSpots as roomSpots } from '../../relay/src/ctf.js';

test('rifle: automatic at its fire rate, reloads by itself when empty', () => {
  const g = new Gun();
  let shots = 0;
  for (let t = 0; t < 1; t += 0.01) if (g.step(0.01, { fire: true }).shot) shots++;
  assert.ok(shots >= 9 && shots <= 11, `${shots} shots in a second`);
  while (g.ammo.rifle > 0) g.step(0.1, { fire: true });
  assert.ok(g.reloading);
  assert.equal(g.step(0.1, { fire: true }).shot, false, 'no shots while reloading');
  let done = false;
  for (let t = 0; t < WEAPONS.rifle.reloadS + 0.2; t += 0.1) done = g.step(0.1, {}).reloaded || done;
  assert.ok(done);
  assert.equal(g.ammo.rifle, WEAPONS.rifle.mag);
});

test('scout: one shot per pull, slow bolt; swapping keeps each magazine', () => {
  const g = new Gun();
  assert.ok(g.step(0.01, { swap: true }).swapped);
  assert.equal(g.w, 'knife', 'nothing picked up yet: rifle, then knife');
  assert.equal(g.give('rifle'), false);
  assert.ok(g.give('scout'));
  assert.equal(g.w, 'scout');
  g.step(0.5, {});
  assert.ok(g.step(0.01, { fire: true }).shot);
  for (let t = 0; t < 3; t += 0.05) assert.equal(g.step(0.05, { fire: true }).shot, false, 'holding the trigger does not fire again');
  g.step(0.05, {});
  assert.ok(g.step(0.05, { fire: true }).shot);
  g.step(0.01, { slot: 0 });
  assert.equal(g.w, 'rifle');
  assert.equal(g.ammo.scout, 3);
  assert.equal(g.ammo.rifle, 30);
});

test('spread: tight when aiming, wider from the hip, when running, in the air and while spraying', () => {
  const g = new Gun();
  const hip = g.spread(0), aim = g.spread(1);
  assert.ok(aim < hip / 4);
  assert.ok(g.spread(0, 5) > hip && g.spread(0, 0, true) > hip);
  for (let n = 0; n < 8; n++) { g.step(0.1, { fire: true }); }
  assert.ok(g.spread(0) > hip, 'bloom');
  const d = [0, 0, -1];
  for (let n = 0; n < 50; n++) {
    const v = spreadDir(d, 0.02);
    assert.ok(Math.abs(Math.hypot(...v) - 1) < 1e-9);
    assert.ok(Math.acos(Math.min(1, -v[2])) <= 0.0201);
  }
  assert.deepEqual(spreadDir(d, 0), d);
});

test('hits: head or body, the nearest figure, nothing behind a wall', () => {
  const o = [0, 1.5, 0], targets = [{ id: 7, pos: [0, 0, -20] }, { id: 8, pos: [0, 0, -40] }];
  assert.ok(Math.abs(raySphere(o, [0, 0, -1], [0, 1.5, -10], 1) - 9) < 1e-9);
  assert.equal(raySphere(o, [0, 0, 1], [0, 1.5, -10], 1), null);
  const head = hitTest(o, [0, 0, -1], targets);
  assert.deepEqual([head.id, head.head], [7, true]);
  const dn = [0, -0.035, -1], L = Math.hypot(...dn);
  const body = hitTest(o, dn.map((v) => v / L), targets);
  assert.deepEqual([body.id, body.head], [7, false]);
  assert.equal(hitTest(o, [1, 0, 0], targets), null);
  const city = { isSolid: (x, y, z) => z < -10 && z > -11 };
  const wall = wallT(city, o, [0, 0, -1], 100);
  assert.ok(wall > 9.9 && wall < 10.3);
  assert.equal(hitTest(o, [0, 0, -1], targets, wall), null, 'the wall stops the shot');
  assert.equal(wallT({ isSolid: () => 'unknown' }, o, [0, 0, -1], 50), 50);
});

test('model: shots, hits and knock-outs become effects; the heat map keeps the spots', () => {
  const m = new MatchModel();
  const cfg = { bases: { blue: { name: 'Markt', at: [176380, 317990] }, yellow: { name: 'Vrijthof', at: [176185, 317717] } }, arenaR: 120 };
  const players = [{ id: 1, name: 'A', team: 'blue', on: true }, { id: 2, name: 'B', team: 'yellow', on: true }];
  m.apply({ t: 'welcome', you: 1, config: cfg, phase: 'play', round: 1, players, flags: {}, score: {}, host: 1 });
  assert.deepEqual(m.apply({ t: 'ev', k: 'shot', by: 1, w: 'rifle', o: [0, 0, 0], e: [1, 1, 1] }), [], 'my own shot is already drawn');
  assert.equal(m.apply({ t: 'ev', k: 'shot', by: 2, w: 'rifle', o: [0, 0, 0], e: [1, 1, 1] })[0].k, 'shot');
  assert.deepEqual(m.apply({ t: 'ev', k: 'hit', id: 1, by: 2, hp: 52 }), [{ k: 'hurt', hp: 52, by: 2 }]);
  assert.deepEqual(m.apply({ t: 'ev', k: 'hit', id: 2, by: 1, hp: 0, head: true }), [{ k: 'hitmark', head: true, kill: true }]);
  const out = m.apply({ t: 'ev', k: 'kill', id: 1, by: 2, at: [176300, 317900] });
  assert.equal(out[0].k, 'killed');
  assert.match(out[1].text, /B knocked you out/);
  assert.equal(m.kills.length, 1);
  const at = heatProject(cfg.bases, cfg.arenaR, 200);
  for (const t of ['blue', 'yellow']) for (const v of at(cfg.bases[t].at)) assert.ok(v > 20 && v < 180);
  assert.ok(at(cfg.bases.blue.at)[1] < at(cfg.bases.yellow.at)[1], 'north is up');
  // bases move with the next round's state, and the heat map starts again
  m.apply({ t: 'state', phase: 'play', round: 2, players, flags: {}, score: {}, host: 1, bases: { blue: { name: 'Helpoort', at: [1, 2] }, yellow: cfg.bases.yellow } });
  assert.equal(m.baseName('blue'), 'Helpoort');
  assert.equal(m.kills.length, 0);
});

test('knife: no ammo, a pause between stabs, reaches only who stands close in front', () => {
  const g = new Gun();
  g.step(0.01, { slot: 2 }); g.step(0.5, {});
  assert.equal(g.w, 'knife');
  assert.ok(g.step(0.01, { fire: true }).shot);
  g.step(0.01, {});
  assert.equal(g.step(0.01, { fire: true }).shot, false, 'too soon');
  g.step(0.6, {});
  assert.ok(g.step(0.01, { fire: true }).shot);
  assert.ok(!g.reloading);
  const me = [0, 0, 0], north = [0, 0, -1];
  assert.equal(meleeTarget(me, north, [{ id: 1, pos: [0.3, 0, -1.6] }]).id, 1);
  assert.equal(meleeTarget(me, north, [{ id: 1, pos: [0, 0, -3] }]), null, 'out of reach');
  assert.equal(meleeTarget(me, north, [{ id: 1, pos: [0, 0, 1.6] }]), null, 'behind me');
  assert.equal(meleeTarget(me, north, [{ id: 1, pos: [0, 4, -1] }]), null, 'a floor up');
  assert.equal(meleeTarget(me, north, [{ id: 1, pos: [0, 0, -2] }, { id: 2, pos: [0, 0, -1] }]).id, 2);
});

test('pickups: four weapons mirrored about the middle, the same distance from each base', () => {
  const bases = { blue: { at: [176380, 317990] }, yellow: { at: [176185, 317717] } };
  const spots = pickupSpots(bases), d = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1]);
  assert.equal(spots.length, 4);
  assert.ok(spots.some((s) => s.w === 'scout') && spots.some((s) => s.w === 'shotgun'));
  for (const s of spots.slice(0, 2)) assert.ok(Math.abs(d(s.at, bases.blue.at) - d(s.at, bases.yellow.at)) < 2);
  assert.ok(Math.abs(d(spots[2].at, bases.blue.at) - d(spots[3].at, bases.yellow.at)) < 2, 'each team has a shotgun as near');
  for (const s of spots) assert.ok(d(s.at, bases.blue.at) > 30 && d(s.at, bases.yellow.at) > 30);
  assert.deepEqual(spots, roomSpots(bases), 'the room and the client agree on the spots');
});

test('how to play: the tip names the controls of the device in hand', async () => {
  const { controlsTip } = await import('../src/mp/combat.js');
  for (const w of ['Left mouse', 'right mouse', 'reload', 'knife', 'yellow pad']) assert.ok(controlsTip(false).includes(w), w);
  for (const w of ['FIRE', 'AIM', 'SWAP', 'KNIFE', 'yellow pad']) assert.ok(controlsTip(true).includes(w), w);
  assert.ok(!controlsTip(true).includes('mouse'));
});

test('hit direction: the arc points at the shooter whatever way I look', async () => {
  const { hitAngle } = await import('../src/mp/combat.js');
  const me = [10, 0, 10], near = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} vs ${b}`);
  near(hitAngle(me, [10, 0], 0), 0); // shooter to the north (three.js -z), looking north: straight ahead
  near(hitAngle(me, [20, 10], 0), Math.PI / 2); // to the east: on my right
  near(Math.abs(hitAngle(me, [10, 20], 0)), Math.PI); // behind
  near(hitAngle(me, [0, 10], 0), -Math.PI / 2); // to the west: on my left
  near(hitAngle(me, [20, 10], Math.PI / 2), 0); // looking east at a shooter in the east: ahead again
  near(hitAngle(me, [10, 0], Math.PI / 2), -Math.PI / 2);
});

test('haptics: a buzz on phones, rumble on gamepads, nothing (and no error) where neither exists', async () => {
  const { haptic, HAPTICS } = await import('../src/mp/combat.js');
  const buzz = [], rumble = [];
  const nav = { vibrate: (p) => { buzz.push(p); return true; },
    getGamepads: () => [null, { connected: true, vibrationActuator: { playEffect: (type, o) => { rumble.push([type, o]); return Promise.resolve(); } } }, { connected: true }] };
  assert.equal(haptic('shotgun', nav), true);
  assert.deepEqual(buzz, [HAPTICS.shotgun[0]]);
  assert.deepEqual(rumble, [['dual-rumble', { startDelay: 0, duration: 160, weakMagnitude: 0.8, strongMagnitude: 1 }]]);
  assert.equal(haptic('nothing', nav), false);
  assert.equal(haptic('hurt', {}), false, 'a desktop without either');
  assert.equal(haptic('hurt', { vibrate: () => { throw new Error('blocked'); } }), false);
  assert.equal(haptic('hurt', null), false);
  // a shot is a tick, being hit is clearly more, a knock-out the most
  const ms = (k) => [].concat(HAPTICS[k][0]).reduce((a, b) => a + b, 0);
  assert.ok(ms('rifle') < ms('hurt') && ms('hurt') < ms('down'));
  for (const k of ['rifle', 'scout', 'shotgun', 'knife']) assert.ok(HAPTICS[k], k);
});

test('objective strip: ahead is the middle, to the side slides, behind pins to an end with an arrow', async () => {
  const { stripMark, STRIP_HALF } = await import('../src/mp/combat.js');
  assert.deepEqual(stripMark(0), { x: 0, side: 0 });
  assert.deepEqual(stripMark(STRIP_HALF / 2), { x: 0.5, side: 0 });
  assert.deepEqual(stripMark(-STRIP_HALF / 2), { x: -0.5, side: 0 });
  assert.deepEqual(stripMark(2.5), { x: 1, side: 1 });
  assert.deepEqual(stripMark(-3), { x: -1, side: -1 });
});

test('ammo cue under the crosshair: quiet with a full magazine, low, reloading with progress, never for the knife', async () => {
  const { ammoCue } = await import('../src/mp/combat.js');
  const g = new Gun();
  assert.equal(ammoCue(g), null);
  g.ammo.rifle = 7;
  assert.deepEqual(ammoCue(g), { text: 'LOW · 7 · R', level: 'warn', progress: null });
  assert.equal(ammoCue(g, true).text, 'LOW · 7', 'no key hint on a phone');
  g.ammo.rifle = 8;
  assert.equal(ammoCue(g), null);
  g.ammo.rifle = 1; g.step(0.2, { fire: true }); // the last round: the reload starts by itself
  const r = ammoCue(g);
  assert.equal(r.text, 'RELOADING');
  assert.ok(r.progress >= 0 && r.progress < 0.2);
  g.give('scout'); g.ammo.scout = 1;
  assert.equal(ammoCue(g).level, 'warn', 'a five-round magazine is low at one');
  g.step(0.01, { slot: 2 });
  assert.equal(ammoCue(g), null, 'the knife needs no ammo');
});

test('rumble: the older Firefox actuator works too; a pad without motors is reported as such', async () => {
  const { rumble, canRumble } = await import('../src/mp/combat.js');
  const pulses = [];
  const ff = { hapticActuators: [{ pulse: (v, ms) => { pulses.push([v, ms]); return Promise.resolve(); } }] };
  assert.equal(rumble(ff, { ms: 90, weak: 0.3, strong: 0.7 }), true);
  assert.deepEqual(pulses, [[0.7, 90]]);
  assert.ok(canRumble(ff));
  assert.equal(rumble({ id: 'pad' }, { ms: 90, weak: 1, strong: 1 }), false);
  assert.ok(!canRumble({ id: 'pad' }) && !canRumble(null));
  const trig = { vibrationActuator: { effects: ['trigger-rumble'], playEffect: () => Promise.resolve() } };
  assert.equal(rumble(trig, { ms: 90, weak: 1, strong: 1 }), false, 'only a kind it cannot play');
});
