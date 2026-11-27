// Multiplayer capture the flag, client side (src/mp/): wire format, smoothing, arena, room model.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCode, cleanNick, newPid, wsUrl, posMessage, parseMessage, toThree, rdToUnity, threeToRd, backoff } from '../src/mp/protocol.js';
import { Track, DELAY, SNAP } from '../src/mp/interp.js';
import { segDist, inArena, spawnSpot, yawTo, Boundary } from '../src/mp/arena.js';
import { MatchModel, clock } from '../src/mp/model.js';
import { lookVariant } from '../src/mp/view.js';
import { encodeChoices, defaultChoices } from '../src/figure/custom.js';

const O = [174700, 314000]; // the site world's originRD
const CFG = { bases: { blue: { name: 'Markt', at: [176380, 317990] }, yellow: { name: 'Vrijthof', at: [176185, 317717] } },
  arenaR: 120, baseR: 7, flagR: 2.5, minPlayers: 2, winCaps: 3 };
const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} vs ${b}`);

test('protocol: codes, nicknames, ids, URLs, positions in RD metres', () => {
  assert.equal(parseCode(' abcd'), 'ABCD');
  assert.equal(parseCode('AB0D'), null);
  assert.equal(parseCode('ABCDE'), null);
  assert.equal(cleanNick('  Anna <3   B  '), 'Anna 3 B');
  assert.equal(cleanNick('a'.repeat(20)).length, 12);
  assert.match(newPid(), /^[a-z0-9]{20}$/);
  assert.equal(wsUrl('https://relay.example/', 'ABCD', { pid: 'p1', name: 'A B', look: '' }),
    'wss://relay.example/room/ABCD?pid=p1&name=A+B&look=');
  // three.js feet (x east, z = -north) of the site world <-> RD on the wire
  assert.deepEqual(JSON.parse(posMessage([1680.123, 50.456, -3990.987], 1.23456, 3.97, O)), { t: 'p', p: [176380.12, 50.46, 317990.99], r: 1.235, s: 4 });
  assert.deepEqual(toThree([176380, 50, 317990], O), [1680, 50, -3990]);
  assert.deepEqual(rdToUnity([176380, 317990], O), [1680, 3990]);
  assert.deepEqual(threeToRd([1680, 50, -3990], O), [176380, 317990]);
  assert.deepEqual(rdToUnity([176380, 317990], [175700, 316500]), [680, 1490]); // the Markt sample: same place
  assert.equal(parseMessage('pong'), null);
  assert.equal(parseMessage('{bad'), null);
  assert.deepEqual(parseMessage('{"t":"p","i":2}'), { t: 'p', i: 2 });
  assert.deepEqual([0, 1, 2, 3, 4, 9, 10].map((n) => backoff(n)), [500, 1000, 2000, 4000, 4000, 4000, null]);
});

test('interpolation: drawn DELAY ms in the past, between samples; extrapolates briefly; snaps on teleports', () => {
  const t = new Track();
  assert.equal(t.sample(0), null);
  t.push(1000, 0, 0, 0, 0, 1);
  t.push(1100, 1, 0, 0, Math.PI - 0.1, 1);
  const mid = t.sample(1050 + DELAY);
  near(mid.x, 0.5);
  t.push(1200, 2, 0, 0, -Math.PI + 0.1, 1);
  const wrap = t.sample(1150 + DELAY);
  near(Math.abs(wrap.yaw), Math.PI, 1e-6); // the short way round, not through 0
  near(t.sample(1250 + DELAY).x, 2.5); // carries on 50 ms past the newest
  near(t.sample(5000).x, 4); // ...for at most 200 ms, then holds
  t.push(1300, 2 + SNAP + 5, 0, 0, 0);
  near(t.sample(1300 + DELAY).x, 2 + SNAP + 5); // teleported: no slide across the city
});

test('arena: capsule boundary, spawns in front of the flag facing the enemy, a 5 s warning', () => {
  assert.equal(segDist([5, 5], [0, 0], [10, 0]), 5);
  assert.ok(inArena(CFG, [176280, 317850]));
  assert.ok(!inArena(CFG, [176600, 317850]));
  const s0 = spawnSpot(CFG, 'blue', 0), s1 = spawnSpot(CFG, 'blue', 1);
  near(s0.yaw, yawTo(CFG.bases.blue.at, CFG.bases.yellow.at));
  assert.ok(Math.hypot(s0.x - 176380, s0.z - 317990) > CFG.flagR + 2); // not on the flag
  assert.ok(Math.hypot(s0.x - s1.x, s0.z - s1.z) > 2); // side by side
  assert.ok(Math.hypot(s0.x - 176380, s0.z - 317990) < CFG.baseR + 4);
  const b = new Boundary(5);
  assert.deepEqual(b.update(true, 1), { warn: null, teleport: false });
  assert.deepEqual(b.update(false, 0.5), { warn: 5, teleport: false });
  assert.deepEqual(b.update(false, 3), { warn: 2, teleport: false });
  assert.deepEqual(b.update(true, 0.1), { warn: null, teleport: false }); // back in: the count resets
  b.update(false, 4.9);
  assert.deepEqual(b.update(false, 0.2), { warn: null, teleport: true });
});

const state = (o = {}) => ({ t: 'state', code: 'ABCD', phase: 'lobby', round: 0, host: 1, now: 10_000, endsAt: 0, winner: null,
  score: { blue: 0, yellow: 0 },
  players: [{ id: 1, name: 'Ann', team: 'blue', on: true }, { id: 2, name: 'Bo', team: 'yellow', on: true }, { id: 3, name: 'Cy', team: 'blue', on: true }],
  flags: { blue: { st: 'home', at: [176380, 317990], by: 0 }, yellow: { st: 'home', at: [176185, 317717], by: 0 } }, ...o });

test('room model: welcome, spawn once per round at my slot, events as effects and lines', () => {
  const m = new MatchModel();
  assert.deepEqual(m.apply({ ...state(), t: 'welcome', you: 3, rejoin: false, config: CFG }, 10_000), []);
  assert.deepEqual([m.me, m.team, m.isHost, m.phase], [3, 'blue', false, 'lobby']);
  const fx = m.apply(state({ phase: 'play', round: 1, endsAt: 10_000 + 480_000 }), 10_000);
  assert.equal(fx.length, 1);
  assert.equal(fx[0].k, 'spawn');
  assert.deepEqual(fx[0].at, spawnSpot(CFG, 'blue', 1)); // second blue player
  assert.deepEqual(m.apply(state({ phase: 'play', round: 1, endsAt: 490_000 }), 11_000), []); // same round: no respawn
  assert.equal(clock(m.timeLeft(11_000)), '8:00'); // the room's clock, not mine (1 s apart)
  assert.equal(clock(m.timeLeft(71_000)), '7:00');
  assert.deepEqual(m.apply({ t: 'p', i: 2, p: [1, 2, 3], r: 0.5, s: 3 }), [{ k: 'pos', id: 2, p: [1, 2, 3], yaw: 0.5, speed: 3 }]);
  assert.deepEqual(m.apply({ t: 'p', i: 3, p: [1, 2, 3] }), []); // my own echo, if any
  m.room.flags.yellow = { st: 'carried', by: 3, at: [0, 0] };
  assert.equal(m.carrying(3), 'yellow');
  const tag = m.apply({ t: 'ev', k: 'tag', id: 3, by: 2, team: 'yellow' });
  assert.deepEqual(tag.map((e) => e.k), ['knock', 'toast']);
  assert.equal(tag[1].text, 'Knocked down! You dropped the flag');
  assert.deepEqual(m.apply({ t: 'ev', k: 'tag', id: 2, by: 3 }).map((e) => e.k), ['scatter', 'toast']);
  assert.equal(m.eventText({ k: 'pickup', id: 3, team: 'yellow' }), 'You have the flag! Run back to the Markt');
  assert.equal(m.eventText({ k: 'pickup', id: 2, team: 'blue' }), 'Bo took your flag! Run into them');
  assert.equal(m.eventText({ k: 'capture', id: 1, team: 'blue', score: { blue: 2, yellow: 1 } }), 'Ann scores for Blue! 2-1');
  assert.equal(m.eventText({ k: 'over', winner: 'blue' }), 'Your team wins!');
  assert.equal(m.eventText({ k: 'start' }), 'Go! Bring the yellow flag to the Markt');
  const rejoin = new MatchModel();
  assert.deepEqual(rejoin.apply({ ...state({ phase: 'play', round: 4 }), t: 'welcome', you: 1, rejoin: true, config: CFG }), []);
});

test('remote figures: the creator look from its code, else a stable figure per player', () => {
  const ch = defaultChoices(7);
  assert.deepEqual(lookVariant(encodeChoices(ch), 5).colours, lookVariant(encodeChoices(ch), 9).colours);
  assert.equal(lookVariant('', 4).colours.top, lookVariant('nonsense', 4).colours.top);
});
