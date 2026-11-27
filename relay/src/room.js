// One multiplayer room: a Durable Object (binding ROOMS, class BloxRoom, named by the room's
// 4-letter code) holding the WebSockets of its players with the hibernation API, authoritative
// for flags and score (rules in ctf.js). Clients send positions ~10 Hz; each one is relayed to
// the others at once and runs the rules. The game is saved to storage whenever the snapshot
// changes, so an evicted object picks up where it was; positions are not saved (clients resend).
// An alarm runs the timers (flag returns, match clock, dropped connections, closing the room).
//
// Requests (forwarded by rooms.js):
//   POST /create?code=ABCD   start a fresh room here (409 while one is in use)
//   GET  /                   { code, phase, players, full } or 404
//   GET  / (Upgrade: websocket) ?pid=&name=&look=   join; 404 no room, 409 full
// Messages, client -> room (JSON): { t: 'p', p: [east, height, north] RD metres, r: yaw, s: speed }, { t: 'start' },
// { t: 'shot', w, o, e, hit, head } (ctf.js shoot), { t: 'take', i } (a weapon pickup),
// { t: 'leave' }; the text 'ping' is answered 'pong' without waking the object.
// Room -> client: { t: 'welcome', you, rejoin, config, ...state }, { t: 'state', ... },
// { t: 'p', i: id, p, r, s }, { t: 'ev', k, ... }, { t: 'error', error }.
import { CTF, newGame, join, disconnect, remove, start, move, shoot, take, guard, tick, nextDeadline, expired, publicState,
  arenaConfig, isEmpty, playerByPid } from './ctf.js';

const MAX_MSG = 2000;
const MIN_POS_MS = 50; // at most 20 position updates a second per player

const jsonResponse = (data, status = 200) => new Response(JSON.stringify(data), { status,
  headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });

export class BloxRoom {
  constructor(state, env) {
    this.state = state; this.env = env;
    this.game = null; this.alarmAt = 0; this.lastPos = new Map();
    this.ready = state.blockConcurrencyWhile
      ? state.blockConcurrencyWhile(async () => { this.game = (await state.storage.get('game')) || null; if (this.game && !this.game.bases) this.game.bases = CTF.bases; /* saved before bases moved */ })
      : Promise.resolve();
    if (typeof WebSocketRequestResponsePair !== 'undefined') {
      state.setWebSocketAutoResponse?.(new WebSocketRequestResponsePair('ping', 'pong'));
    }
  }

  sockets() { return this.state.getWebSockets(); }
  idOf(ws) { try { return ws.deserializeAttachment()?.id || 0; } catch { return 0; } }
  setId(ws, id) { try { ws.serializeAttachment({ id }); } catch { /* closed */ } }

  send(ws, msg) { try { ws.send(typeof msg === 'string' ? msg : JSON.stringify(msg)); } catch { /* closing */ } }
  broadcast(msg, except = null) {
    const text = JSON.stringify(msg);
    for (const ws of this.sockets()) if (ws !== except && this.idOf(ws)) this.send(ws, text);
  }

  /** After a rules call: re-send and save the snapshot if it changed, send events, set the alarm. */
  async commit(res, now) {
    if (!this.game) return;
    if (res.changed) {
      this.broadcast(publicState(this.game, now));
      await this.state.storage.put('game', this.game);
    }
    for (const e of res.events) this.broadcast({ t: 'ev', ...e });
    await this.schedule();
  }

  async schedule() {
    const at = this.game ? nextDeadline(this.game, Date.now()) : 0;
    if (at && at !== this.alarmAt) { this.alarmAt = at; await this.state.storage.setAlarm(at); }
  }

  async close() {
    for (const ws of this.sockets()) try { ws.close(4004, 'room closed'); } catch { /* gone */ }
    this.game = null; this.alarmAt = 0;
    await this.state.storage.deleteAll();
  }

  async fetch(req) {
    await this.ready;
    const url = new URL(req.url);
    const now = Date.now();
    if (req.method === 'POST' && url.pathname === '/create') return this.create(url.searchParams.get('code'), now);
    if (!this.game) return jsonResponse({ error: 'no room with that code' }, 404);
    if (req.headers.get('Upgrade') !== 'websocket') {
      const g = this.game, n = Object.keys(g.players).length;
      return jsonResponse({ code: g.code, phase: g.phase, players: n, full: n >= CTF.maxPlayers });
    }
    const p = url.searchParams;
    const who = { pid: p.get('pid'), name: p.get('name'), look: p.get('look') };
    const check = this.admits(who);
    if (check) return jsonResponse({ error: check.error }, check.status);
    const [client, server] = Object.values(new WebSocketPair());
    await this.connect(server, who, now);
    return new Response(null, { status: 101, webSocket: client });
  }

  async create(code, now) {
    if (!/^[A-Z]{4}$/.test(code || '')) return jsonResponse({ error: 'bad code' }, 400);
    if (this.game && !expired(this.game, now)) return jsonResponse({ error: 'in use' }, 409);
    if (this.game) await this.close();
    this.game = newGame(code, now);
    await this.state.storage.put('game', this.game);
    await this.schedule();
    return jsonResponse({ code }, 201);
  }

  /** null when this player may join, else { status, error }. */
  admits(who) {
    if (!this.game) return { status: 404, error: 'no room with that code' };
    if (!playerByPid(this.game, who.pid) && Object.keys(this.game.players).length >= CTF.maxPlayers) return { status: 409, error: 'room is full' };
    return null;
  }

  /** Accept a socket (the room's end of a WebSocketPair) and join its player. */
  async connect(ws, who, now) {
    const r = join(this.game, who, now);
    if (!r.ok) { this.state.acceptWebSocket(ws); this.send(ws, { t: 'error', error: r.error }); ws.close(4009, r.error); return; }
    // the same player on an older socket (a half-dead connection): replace it
    for (const old of this.sockets()) if (this.idOf(old) === r.id) {
      this.setId(old, 0);
      try { old.close(4000, 'replaced'); } catch { /* gone */ }
    }
    this.state.acceptWebSocket(ws);
    this.setId(ws, r.id);
    this.send(ws, { ...publicState(this.game, now), t: 'welcome', you: r.id, rejoin: r.rejoin, config: arenaConfig(this.game) });
    await this.commit({ events: r.events, changed: true }, now);
  }

  async webSocketMessage(ws, data) {
    await this.ready;
    if (!this.game) { try { ws.close(4004, 'room closed'); } catch { /* gone */ } return; }
    const id = this.idOf(ws);
    if (!id || typeof data !== 'string' || data.length > MAX_MSG) return;
    let msg;
    try { msg = JSON.parse(data); } catch { return; }
    if (!msg || typeof msg !== 'object') return;
    const now = Date.now();
    const g = this.game;
    let res = { events: [], changed: false };
    if (msg.t === 'p') {
      if (now - (this.lastPos.get(id) || 0) < MIN_POS_MS) return;
      this.lastPos.set(id, now);
      res = move(g, id, msg, now);
      if (g.players[id]) this.broadcast({ t: 'p', i: id, p: msg.p, r: +msg.r || 0, s: +msg.s || 0 }, ws);
    } else if (msg.t === 'shot') {
      res = shoot(g, id, msg, now);
    } else if (msg.t === 'take') {
      res = take(g, id, msg, now);
    } else if (msg.t === 'guard') {
      res = guard(g, id, now);
    } else if (msg.t === 'start') {
      res = start(g, id, now);
      if (!res.ok) this.send(ws, { t: 'error', error: res.error });
    } else if (msg.t === 'leave') {
      res = remove(g, id, now);
      this.setId(ws, 0);
      try { ws.close(1000, 'bye'); } catch { /* gone */ }
    } else return;
    const t = tick(g, now);
    await this.commit({ events: [...res.events, ...t.events], changed: res.changed || t.changed }, now);
  }

  async webSocketClose(ws) {
    try { ws.close(1000, 'bye'); } catch { /* already closed */ }
    await this.dropped(ws);
  }
  async webSocketError(ws) { await this.dropped(ws); }

  async dropped(ws) {
    await this.ready;
    const id = this.idOf(ws);
    if (!this.game || !id) return;
    this.setId(ws, 0);
    if (this.sockets().some((w) => w !== ws && this.idOf(w) === id)) return; // reconnected already
    await this.commit(disconnect(this.game, id, Date.now()), Date.now());
  }

  async alarm() {
    await this.ready;
    this.alarmAt = 0;
    if (!this.game) return;
    const now = Date.now();
    if (expired(this.game, now)) { await this.close(); return; }
    await this.commit(tick(this.game, now), now);
    if (this.game && isEmpty(this.game) && expired(this.game, now)) await this.close();
  }
}
