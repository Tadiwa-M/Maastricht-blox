// The network side of multiplayer: the relay's room routes (relay/src/rooms.js) and one room's
// WebSocket, reconnecting on brief drops (the room keeps a dropped player's place for 30 s and
// knows them again by their player id). Browser only; the formats are in protocol.js.
import { wsUrl, parseMessage, backoff } from './protocol.js';

const PING_MS = 15000, DEAD_MS = 35000;

async function call(relay, path, init = {}, timeoutMs = 8000) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const r = await fetch(`${relay}${path}`, { ...init, signal: ac.signal });
    const data = await r.json().catch(() => ({}));
    return { status: r.status, data };
  } finally { clearTimeout(timer); }
}

/** Does the relay have rooms? -> 'ok' | 'soon' (404: not deployed yet) | 'offline'. */
export async function probe(relay) {
  if (!relay) return 'soon';
  try {
    const r = await call(relay, '/room');
    return r.status === 200 && r.data.rooms ? 'ok' : r.status === 404 ? 'soon' : 'offline';
  } catch { return 'offline'; }
}

/** A fresh room -> { code } or { error }. */
export async function createRoom(relay) {
  try {
    const r = await call(relay, '/room', { method: 'POST' });
    return r.status === 201 ? { code: r.data.code } : { error: r.data.error || `the relay said ${r.status}` };
  } catch { return { error: 'The game server cannot be reached' }; }
}

/** Is there room for me in `code`? -> { ok } or { error }. */
export async function checkRoom(relay, code) {
  try {
    const r = await call(relay, `/room/${code}`);
    if (r.status === 404) return { error: `No room ${code}: check the code` };
    if (r.status !== 200) return { error: r.data.error || `the relay said ${r.status}` };
    return { ok: true, full: r.data.full };
  } catch { return { error: 'The game server cannot be reached' }; }
}

/**
 * One room's socket. who() -> { pid, name, look } (read on every (re)connect); onMessage(msg);
 * onStatus('connecting' | 'on' | 'reconnecting' | 'lost' | 'closed', reason?).
 */
export class Connection {
  constructor({ relay, code, who, onMessage, onStatus }) {
    Object.assign(this, { relay, code, who, onMessage, onStatus });
    this.ws = null; this.attempt = 0; this.done = false; this.lastIn = 0;
    this.timer = setInterval(() => this.watch(), 5000);
    this.open();
  }

  get live() { return this.ws?.readyState === 1; }

  open() {
    this.onStatus(this.attempt ? 'reconnecting' : 'connecting');
    const ws = new WebSocket(wsUrl(this.relay, this.code, this.who()));
    this.ws = ws;
    ws.onopen = () => { this.attempt = 0; this.lastIn = Date.now(); this.onStatus('on'); };
    ws.onmessage = (e) => {
      this.lastIn = Date.now();
      const m = parseMessage(e.data);
      if (m) this.onMessage(m);
    };
    ws.onclose = (e) => {
      if (ws !== this.ws || this.done) return;
      if (e.code === 4004 || e.code === 4009) { this.stop(); this.onStatus('closed', e.reason || 'The room closed'); return; }
      this.retry();
    };
  }

  retry() {
    const wait = backoff(this.attempt++);
    if (wait === null) { this.stop(); this.onStatus('lost'); return; }
    this.onStatus('reconnecting');
    this.ws = null;
    setTimeout(() => { if (!this.done) this.open(); }, wait);
  }

  /** Ping now and then; a socket that has said nothing for DEAD_MS is dead (a phone woke up). */
  watch() {
    if (this.done || !this.ws) return;
    if (this.live) {
      if (Date.now() - this.lastIn > DEAD_MS) { const ws = this.ws; this.ws = null; try { ws.close(); } catch { /* */ } this.retry(); return; }
      if (Date.now() - this.lastIn > PING_MS) this.ws.send('ping');
    }
  }

  send(msg) { if (this.live) this.ws.send(typeof msg === 'string' ? msg : JSON.stringify(msg)); }

  stop() { this.done = true; clearInterval(this.timer); }

  /** Leave the room for good. */
  leave() {
    this.send({ t: 'leave' });
    this.stop();
    const ws = this.ws;
    this.ws = null;
    setTimeout(() => { try { ws?.close(1000); } catch { /* */ } }, 100);
  }
}
