// A game room run in this browser instead of on the relay: the same rules (relay/src/ctf.js,
// imported as they are), the same messages, so the rest of the client (model, view, combat) can't
// tell the difference. Two modes:
//   'bots'  capture the flag against computer players (mp/bots.js): you and 3 bots against 4
//   'raid'  the night raid, "Defend Maastricht": the raiders come out of the caves through the
//           Helpoort in waves and try to carry the city's banner (the blue flag on the Markt)
//           out of town; you knock them out. Survive RAID.waves waves; lose the banner
//           CTF.winCaps times and Maastricht falls.
// It has the Connection interface of net.js (send, live, stop, leave) and answers through
// onMessage like a socket would (a microtask later). Tested in test/localroom.test.mjs.
import { CTF, newGame, join, start, move, shoot, take, tick, remove, publicState, arenaConfig, pickupSpots } from '../../../relay/src/ctf.js';
import { Bot } from './bots.js';

export const RAID = {
  bases: { blue: { name: 'Markt', at: [176380, 317990] }, yellow: { name: 'Helpoort', at: [176639, 317365] } },
  waves: 8,
  size: (wave) => Math.min(14, 2 + wave * 2), // raiders in wave 1, 2, ...
  breakS: [4, 9], // seconds before the first wave, between waves
  removeS: 1.6, // a knocked-out raider crumbles away after this
  emerge: 0.2, // raiders come out this far along the way from the Markt to the Helpoort (~135 m: half a minute away)
  look: 'raider', // view.js draws these as raiders
};
const BOT_NAMES = ['Sjeng', 'Mieke', 'Joep', 'Fenna', 'Bram', 'Lotte', 'Teun', 'Noor', 'Huub', 'Ilse'];
const TICK_MS = 100;

export class LocalRoom {
  /**
   * mode 'bots' | 'raid'; who() -> { pid, name, look }; nav: { path, height, los, spawnNear } (index.js);
   * onMessage(msg); onStatus(status); clock: () => ms (Date.now; tests pass their own).
   */
  constructor({ mode = 'bots', who, onMessage, onStatus = () => {}, nav, clock = () => Date.now(), auto = true, rand = Math.random }) {
    Object.assign(this, { mode, onMessage, onStatus, nav, clock, rand });
    this.live = true; this.bots = new Map(); this.outbox = []; this.raid = null;
    const now = clock();
    const g = newGame('SOLO', now);
    if (mode === 'raid') { g.bases = structuredClone(RAID.bases); g.flags = { blue: homeFlag(g, 'blue'), yellow: homeFlag(g, 'yellow') }; }
    this.g = g;
    const r = join(g, who(), now);
    this.me = r.id;
    if (mode === 'bots') {
      for (let k = 0; k < 7; k++) this.addBot(`${BOT_NAMES[k]}`, k);
      start(g, this.me, now, () => 0); // Markt against Vrijthof
      let slot = { blue: 0, yellow: 0 };
      for (const q of Object.values(g.players)) { const b = this.bots.get(q.id); if (b) { b.slot = ++slot[q.team]; b.role = slot[q.team] % 2 ? 'attack' : 'defend'; } }
    } else {
      this.raid = { wave: 0, kills: 0, nextAt: now + RAID.breakS[0] * 1000, crumble: new Map() };
      this.startRaid(now);
    }
    this.post({ ...this.state(now), t: 'welcome', you: this.me, rejoin: false, config: arenaConfig(g) });
    queueMicrotask(() => this.onStatus('on'));
    if (auto) this.timer = setInterval(() => this.step(TICK_MS / 1000), TICK_MS);
  }

  /** A capture-the-flag bot (join balances the teams as for people). */
  addBot(name, k) {
    const r = join(this.g, { pid: `bot${String(k).padStart(6, '0')}x`, name, look: '' }, this.clock());
    const b = new Bot(r.id, { kind: 'ctf', role: k % 2 ? 'defend' : 'attack', rand: this.rand });
    this.bots.set(r.id, b);
    return b;
  }

  /** The raid starts (start() would rebalance the raiders onto my team, so this is done here). */
  startRaid(now) {
    const g = this.g;
    g.phase = 'play'; g.round = 1; g.winner = null; g.taken = {}; g.score = { blue: 0, yellow: 0 };
    g.endsAt = now + 6 * 3600 * 1000; // no clock: waves decide
    for (const p of Object.values(g.players)) Object.assign(p, { hp: CTF.hp, down: 0, kills: 0, deaths: 0, safe: now + CTF.spawnSafeS * 1000 });
    this.events([{ k: 'start', round: 1 }, { k: 'raid', text: 'Night falls. They are coming through the Helpoort: guard the banner on the Markt!', big: true }]);
  }

  spawnWave(now) {
    const g = this.g, R = this.raid;
    R.wave++;
    const n = RAID.size(R.wave), a = g.bases.blue.at, b = g.bases.yellow.at;
    const gate = [a[0] + (b[0] - a[0]) * RAID.emerge, a[1] + (b[1] - a[1]) * RAID.emerge];
    for (let k = 0; k < n; k++) {
      const id = g.nextId++;
      const at = this.nav.spawnNear?.(gate, 8 + k * 2.5) || [gate[0] + (this.rand() - 0.5) * 20, gate[1] + (this.rand() - 0.5) * 20];
      g.players[id] = { id, pid: `raider${id}`, name: 'Raider', look: RAID.look, team: 'yellow', on: true, goneAt: 0, at, y: 0, t: now,
        caps: 0, tags: 0, down: 0, hp: Math.round(CTF.hp * (1 + R.wave * 0.08)), kills: 0, deaths: 0, shotAt: 0, raider: true };
      const b = new Bot(id, { kind: 'raider', rand: this.rand });
      b.place(at, 0, this.nav);
      this.bots.set(id, b);
    }
    this.events([{ k: 'raid', text: R.wave === RAID.waves ? `Last wave: ${n} of them!` : `Wave ${R.wave}: ${n} raiders`, big: true }], true);
  }

  raidStep(now, events) {
    const g = this.g, R = this.raid;
    for (const e of events) if (e.k === 'kill' && g.players[e.id]?.raider) { R.kills++; R.crumble.set(e.id, now + RAID.removeS * 1000); }
    for (const [id, at] of R.crumble) if (now >= at) { R.crumble.delete(id); this.bots.delete(id); remove(g, id, now); this.changed = true; }
    if (g.phase !== 'play') return;
    const alive = Object.values(g.players).some((p) => p.raider && !R.crumble.has(p.id));
    if (!alive && !R.nextAt) {
      if (R.wave >= RAID.waves) { // dawn
        g.phase = 'over'; g.winner = 'blue';
        this.events([{ k: 'over', winner: 'blue' }], true);
        return;
      }
      R.nextAt = now + RAID.breakS[1] * 1000;
      if (R.wave) this.events([{ k: 'raid', text: `Wave ${R.wave} stopped. More are coming...` }]);
    }
    if (R.nextAt && now >= R.nextAt) { R.nextAt = 0; this.spawnWave(now); }
  }

  /** One tick of the room: the bots act, the timers run, the snapshot goes out if it changed. */
  step(dt) {
    if (!this.live) return;
    const now = this.clock(), g = this.g;
    this.changed = false;
    const events = [];
    // I am always "seen recently" here (a slow frame must not make me untouchable: no one to cheat)
    const mine = g.players[this.me];
    if (mine?.at) mine.t = now;
    for (const b of this.bots.values()) {
      if (this.raid?.crumble.has(b.id)) continue;
      for (const m of b.step(g, now, dt, this.nav)) {
        const res = this.rule(b.id, m, now);
        events.push(...res.events); this.changed ||= res.changed;
        if (m.t === 'p' && g.players[b.id]) this.post({ t: 'p', i: b.id, p: m.p, r: m.r, s: m.s });
      }
    }
    // bots keep a body's width apart (golems heaped into one pile)
    const bs = [...this.bots.values()].filter((b) => b.at && !(g.players[b.id]?.down > now));
    for (let i = 0; i < bs.length; i++) for (let j = i + 1; j < bs.length; j++) {
      const a = bs[i].at, b = bs[j].at, dx = b[0] - a[0], dz = b[1] - a[1], d = Math.hypot(dx, dz);
      if (d >= 1.8) continue;
      const push = (1.8 - (d || 0.01)) / 2, ux = d > 1e-3 ? dx / d : 1, uz = d > 1e-3 ? dz / d : 0;
      a[0] -= ux * push; a[1] -= uz * push; b[0] += ux * push; b[1] += uz * push;
    }
    const t = tick(g, now);
    events.push(...t.events); this.changed ||= t.changed;
    if (this.raid) this.raidStep(now, events);
    this.events(events, this.changed);
  }

  rule(id, m, now) {
    if (m.t === 'p') return move(this.g, id, m, now);
    if (m.t === 'shot') {
      const r = shoot(this.g, id, m, now);
      if (m.melee) for (const e of r.events) if (e.k === 'shot') e.melee = true; // a raider's swipe: no tracer, a whoosh
      return r;
    }
    if (m.t === 'take') return take(this.g, id, m, now);
    return { events: [], changed: false };
  }

  /** Send events (and the snapshot first, when it changed). Raiders coming and going are not news. */
  events(list, changed = list.length > 0) {
    const now = this.clock();
    if (changed) this.post(this.state(now));
    for (const e of list) {
      if (this.mode === 'raid' && (e.k === 'leave' || e.k === 'join')) continue;
      this.post({ t: 'ev', ...e });
    }
  }

  state(now) {
    const s = publicState(this.g, now);
    s.mode = this.mode;
    if (this.raid) s.raid = { wave: this.raid.wave, waves: RAID.waves, kills: this.raid.kills, lives: CTF.winCaps - this.g.score.yellow };
    return s;
  }

  post(msg) { this.outbox.push(msg); if (this.outbox.length === 1) queueMicrotask(() => this.flush()); }
  flush() { const out = this.outbox; this.outbox = []; if (this.live) for (const m of out) this.onMessage(m); }

  /** A message from me (the client), as the socket would carry it. */
  send(msg) {
    if (typeof msg === 'string') { if (msg === 'ping') return; try { msg = JSON.parse(msg); } catch { return; } } // (the client sends JSON text, as to a socket)
    if (!this.live || !msg || typeof msg !== 'object') return;
    const now = this.clock(), g = this.g;
    let res = { events: [], changed: false };
    if (msg.t === 'start') {
      if (this.mode === 'raid') { this.restartRaid(now); return; }
      res = start(g, this.me, now);
    } else if (msg.t === 'leave') { this.stop(); return; }
    else res = this.rule(this.me, msg, now);
    const t = tick(g, now), events = [...res.events, ...t.events];
    this.changed = res.changed || t.changed;
    if (this.raid) this.raidStep(now, events); // (my knock-outs count and crumble too)
    this.events(events, this.changed);
  }

  restartRaid(now) {
    for (const id of [...this.bots.keys()]) { this.bots.delete(id); delete this.g.players[id]; }
    this.g.flags = { blue: homeFlag(this.g, 'blue'), yellow: homeFlag(this.g, 'yellow') };
    this.raid = { wave: 0, kills: 0, nextAt: now + RAID.breakS[0] * 1000, crumble: new Map() };
    this.startRaid(now);
  }

  stop() { this.live = false; clearInterval(this.timer); }
  leave() { this.stop(); }
}

const homeFlag = (g, team) => ({ st: 'home', at: [...g.bases[team].at], by: 0, since: 0, lock: 0 });
export { pickupSpots };
