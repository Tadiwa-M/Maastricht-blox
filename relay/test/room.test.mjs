// The room Durable Object with a fake state (storage + hibernatable sockets) and fake sockets:
// what the Workers runtime does, minus the network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BloxRoom } from '../src/room.js';
import { rooms } from '../src/rooms.js';
import { CTF } from '../src/ctf.js';

function fakeState(saved = new Map()) {
  const sockets = [];
  return {
    sockets, saved, alarm: 0,
    storage: {
      get: async (k) => structuredClone(saved.get(k)),
      put: async (k, v) => { saved.set(k, structuredClone(v)); },
      deleteAll: async () => { saved.clear(); },
      setAlarm: async function (t) { this.owner.alarm = t; },
    },
    blockConcurrencyWhile: (fn) => fn(),
    acceptWebSocket(ws) { sockets.push(ws); },
    getWebSockets() { return sockets.filter((w) => !w.closed); },
  };
}
const state = (s = fakeState()) => { s.storage.owner = s; return s; };

class FakeSocket {
  constructor() { this.sent = []; this.closed = false; this.att = null; }
  send(t) { if (this.closed) throw new Error('closed'); this.sent.push(JSON.parse(t)); }
  close(code) { this.closed = true; this.code = code; }
  serializeAttachment(a) { this.att = structuredClone(a); }
  deserializeAttachment() { return this.att; }
  last(t) { return this.sent.filter((m) => m.t === t).at(-1); }
  events() { return this.sent.filter((m) => m.t === 'ev').map((m) => m.k); }
}

async function room() {
  const st = state();
  const r = new BloxRoom(st, {});
  await r.ready;
  const res = await r.fetch(new Request('https://room/create?code=ABCD', { method: 'POST' }));
  assert.equal(res.status, 201);
  return { r, st };
}

async function player(r, q) {
  const ws = new FakeSocket();
  await r.connect(ws, { pid: `player-${q}-xyz`, name: `P${q}`, look: 'a0000000000000' }, Date.now());
  return ws;
}

const say = (r, ws, msg) => r.webSocketMessage(ws, JSON.stringify(msg));

test('room: create once, 404 without a room, info and full', async () => {
  const { r } = await room();
  const again = await r.fetch(new Request('https://room/create?code=ABCD', { method: 'POST' }));
  assert.equal(again.status, 409);
  const empty = new BloxRoom(state(), {});
  await empty.ready;
  assert.equal((await empty.fetch(new Request('https://room/'))).status, 404);
  for (let q = 0; q < CTF.maxPlayers; q++) await player(r, q);
  const info = await (await r.fetch(new Request('https://room/'))).json();
  assert.deepEqual([info.code, info.players, info.full], ['ABCD', 8, true]);
  assert.equal(r.admits({ pid: 'someone-new' }).status, 409);
  assert.equal(r.admits({ pid: 'player-3-xyz' }), null); // a returning player still fits
});

test('room: welcome, roster to everyone, positions relayed to the others only', async () => {
  const { r } = await room();
  const a = await player(r, 1), b = await player(r, 2);
  const w = a.last('welcome');
  assert.deepEqual([w.you, w.rejoin, w.config.winCaps, w.phase], [1, false, 3, 'lobby']);
  assert.equal(a.last('state').players.length, 2);
  await say(r, a, { t: 'p', p: [176400, 50, 317990], r: 1.5, s: 4 });
  assert.deepEqual(b.last('p'), { t: 'p', i: 1, p: [176400, 50, 317990], r: 1.5, s: 4 });
  assert.equal(a.last('p'), undefined);
  await say(r, b, { t: 'start' });
  assert.equal(b.last('error').error, 'only the host can start');
  await say(r, a, { t: 'start' });
  assert.equal(b.last('state').phase, 'play');
  assert.deepEqual(b.events().slice(-1), ['start']);
});

test('room: authoritative pickup and capture reach every player; saved for after eviction', async () => {
  const { r, st } = await room();
  const a = await player(r, 1), b = await player(r, 2);
  await say(r, a, { t: 'start' });
  const [Y, B] = [CTF.bases.yellow.at, CTF.bases.blue.at];
  r.game.players[1].at = [Y[0] + 2, Y[1]]; // blue 1 at the Vrijthof
  await say(r, a, { t: 'p', p: [Y[0], 50, Y[1]], r: 0, s: 4 });
  assert.ok(b.events().includes('pickup'));
  assert.equal(b.last('state').flags.yellow.st, 'carried');
  const reborn = new BloxRoom(st, {}); // the object was evicted: the game comes back from storage
  await reborn.ready;
  assert.equal(reborn.game.flags.yellow.by, 1);
  r.game.players[1].at = [B[0] + 3, B[1]];
  r.lastPos.clear();
  await say(r, a, { t: 'p', p: [B[0], 50, B[1]], r: 0, s: 4 });
  assert.ok(b.events().includes('capture'));
  assert.deepEqual(b.last('state').score, { blue: 1, yellow: 0 });
  assert.ok(st.alarm > 0); // the match clock
});

test('room: a dropped socket keeps the place; reconnecting replaces it; leaving frees it', async () => {
  const { r } = await room();
  const a = await player(r, 1), b = await player(r, 2);
  a.closed = true;
  await r.webSocketClose(a);
  assert.equal(b.last('state').players.find((p) => p.id === 1).on, false);
  const a2 = await player(r, 1);
  assert.deepEqual([a2.last('welcome').you, a2.last('welcome').rejoin], [1, true]);
  assert.equal(b.last('state').players.find((p) => p.id === 1).on, true);
  await say(r, b, { t: 'leave' });
  assert.ok(b.closed);
  assert.deepEqual(a2.last('state').players.map((p) => p.id), [1]);
  await say(r, a2, { t: 'leave' });
  r.game.created = 0; // long ago
  await r.alarm();
  assert.equal(r.game, null); // closed: the code is free again
});

test('rooms routes: 404 without the binding (the site says "coming soon"), feature check with it', async () => {
  const url = (p) => new URL(`https://relay${p}`);
  assert.equal((await rooms(new Request('https://relay/room'), {}, url('/room'), {})).status, 404);
  const env = { ROOMS: { idFromName: (n) => n, get: () => ({ fetch: async () => new Response('{}', { status: 201 }) }) } };
  const ok = await rooms(new Request('https://relay/room'), env, url('/room'), {});
  assert.deepEqual(await ok.json(), { rooms: true, version: CTF.version });
  const made = await rooms(new Request('https://relay/room', { method: 'POST' }), env, url('/room'), {});
  assert.match((await made.json()).code, /^[A-Z]{4}$/);
  assert.equal((await rooms(new Request('https://relay/room/AB1'), env, url('/room/AB1'), {})).status, 404);
  const evil = new Request('https://relay/room/ABCD', { headers: { Upgrade: 'websocket', Origin: 'https://evil.example' } });
  assert.equal((await rooms(evil, { ...env, SITE_ORIGINS: 'https://tadiwa-m.github.io' }, url('/room/ABCD'), {})).status, 403);
});
