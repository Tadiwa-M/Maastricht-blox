// Capture the flag: the rules of one room, pure (no sockets, no storage, no clock: `now` is
// passed in, in ms). The room Durable Object (room.js) owns a game object and calls these on
// every message and alarm; it broadcasts the snapshot and events they return. Tested in
// test/ctf.test.mjs. Positions are RD metres (EPSG:28992, [east, north]; the wire carries
// [east, height, north]), so a room doesn't depend on any one world's origin.
//
// Every mutating call returns { events, changed }: events go to every player as { t: 'ev', ... }
// (toasts, knock-downs), changed means the snapshot (publicState) must be re-sent and saved.

export const CTF = {
  version: 1,
  teams: ['blue', 'yellow'],
  // blue defends the Markt (west of the Stadhuis's steps), yellow the Vrijthof (its middle)
  bases: { blue: { name: 'Markt', at: [176380, 317990] }, yellow: { name: 'Vrijthof', at: [176185, 317717] } },
  arenaR: 120, // the arena: within this many metres of the line between the two bases
  flagR: 2.5, // touch a flag
  baseR: 7, // carry the flag into this circle round your own base
  tagR: 1.5, // run into an enemy carrier
  returnS: 20, // a dropped flag goes home after this
  downS: 3, // a knocked-down carrier can't pick up again for this long
  dropLockS: 1.5, // a dropped flag can't be touched for this long (the pieces are still flying)
  matchS: 480,
  winCaps: 3,
  minPlayers: 2,
  maxPlayers: 8,
  graceS: 30, // a dropped connection keeps its place this long
  idleRoomS: 600, // an empty room is closed after this
  jumpM: 30, // a carrier moving farther than this in one update teleported: the flag goes home
  freshMs: 2000, // positions older than this don't tag anyone
};

export const other = (team) => (team === 'blue' ? 'yellow' : 'blue');
const home = (team) => ({ st: 'home', at: [...CTF.bases[team].at], by: 0, since: 0, lock: 0 });
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const result = (events = [], changed = events.length > 0) => ({ events, changed });

/** Distance from point p to the segment a-b (all [x, z]). */
export function segDist(p, a, b) {
  const dx = b[0] - a[0], dz = b[1] - a[1];
  const L = dx * dx + dz * dz;
  const t = L ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / L)) : 0;
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dz);
}

export const inArena = (p, slack = 0) => segDist(p, CTF.bases.blue.at, CTF.bases.yellow.at) <= CTF.arenaR + slack;

/** What the clients need to draw the arena and run the soft boundary. */
export function arenaConfig() {
  const { version, teams, bases, arenaR, flagR, baseR, tagR, returnS, matchS, winCaps, minPlayers, maxPlayers } = CTF;
  return { version, teams, bases, arenaR, flagR, baseR, tagR, returnS, matchS, winCaps, minPlayers, maxPlayers };
}

export const cleanName = (s) => String(s ?? '').replace(/[^\p{L}\p{N} _.'-]/gu, '').replace(/\s+/g, ' ').trim().slice(0, 12) || 'Player';
export const cleanLook = (s) => (/^[a-z0-9]{1,24}$/.test(String(s ?? '')) ? String(s) : '');
export const validPid = (s) => /^[A-Za-z0-9_-]{8,40}$/.test(String(s ?? ''));

export function newGame(code, now) {
  return { code, created: now, phase: 'lobby', round: 0, host: 0, nextId: 1, players: {},
    flags: { blue: home('blue'), yellow: home('yellow') }, score: { blue: 0, yellow: 0 }, endsAt: 0, winner: null };
}

const list = (g) => Object.values(g.players);
export const isEmpty = (g) => list(g).length === 0;
export const playerByPid = (g, pid) => list(g).find((p) => p.pid === pid) || null;

export function teamCounts(g) {
  const c = { blue: 0, yellow: 0 };
  for (const p of list(g)) c[p.team]++;
  return c;
}

/** The flag this player carries, or null. */
export function carried(g, id) {
  for (const t of CTF.teams) if (g.flags[t].st === 'carried' && g.flags[t].by === id) return t;
  return null;
}

function pickHost(g) {
  if (g.players[g.host]) return;
  const ids = list(g).map((p) => p.id).sort((a, b) => a - b);
  const on = ids.filter((id) => g.players[id].on);
  g.host = on[0] || ids[0] || 0;
}

/** Join (or rejoin with the same pid). -> { ok, error?, id, rejoin, events, changed } */
export function join(g, { pid, name, look }, now) {
  if (!validPid(pid)) return { ok: false, error: 'bad player id', ...result() };
  const old = playerByPid(g, pid);
  if (old) {
    Object.assign(old, { on: true, goneAt: 0, name: cleanName(name), look: cleanLook(look) });
    pickHost(g);
    return { ok: true, id: old.id, rejoin: true, ...result([{ k: 'back', id: old.id }]) };
  }
  if (list(g).length >= CTF.maxPlayers) return { ok: false, error: 'full', ...result() };
  const c = teamCounts(g);
  const id = g.nextId++;
  g.players[id] = { id, pid, name: cleanName(name), look: cleanLook(look), team: c.yellow < c.blue ? 'yellow' : 'blue',
    on: true, goneAt: 0, at: null, y: 0, t: 0, caps: 0, tags: 0, down: 0 };
  pickHost(g);
  return { ok: true, id, rejoin: false, ...result([{ k: 'join', id }]) };
}

/** A connection dropped: keep the place for graceS (tick removes it after). */
export function disconnect(g, id, now) {
  const p = g.players[id];
  if (!p || !p.on) return result();
  p.on = false; p.goneAt = now;
  return result([], true);
}

/** Leave for good; a carried flag drops where the player was. */
export function remove(g, id, now) {
  const p = g.players[id];
  if (!p) return result();
  const events = [{ k: 'leave', id, name: p.name }];
  const f = carried(g, id);
  if (f) {
    Object.assign(g.flags[f], { st: 'dropped', at: [...(p.at || CTF.bases[f].at)], by: 0, since: now, lock: now });
    events.push({ k: 'drop', team: f, id });
  }
  delete g.players[id];
  pickHost(g);
  return result(events, true);
}

/** Teams within one of each other: the newest players of the bigger team move. */
export function rebalance(g) {
  for (;;) {
    const c = teamCounts(g);
    if (Math.abs(c.blue - c.yellow) <= 1) return;
    const big = c.blue > c.yellow ? 'blue' : 'yellow';
    const p = list(g).filter((q) => q.team === big).sort((a, b) => b.id - a.id)[0];
    p.team = other(big);
  }
}

/** The host starts (or restarts) the match. -> { ok, error?, events, changed } */
export function start(g, id, now) {
  if (id !== g.host) return { ok: false, error: 'only the host can start', ...result() };
  if (g.phase === 'play') return { ok: false, error: 'already playing', ...result() };
  if (list(g).filter((p) => p.on).length < CTF.minPlayers) return { ok: false, error: `needs ${CTF.minPlayers} players`, ...result() };
  rebalance(g);
  g.flags = { blue: home('blue'), yellow: home('yellow') };
  g.score = { blue: 0, yellow: 0 };
  for (const p of list(g)) { p.caps = 0; p.tags = 0; p.down = 0; }
  g.phase = 'play'; g.round++; g.winner = null;
  g.endsAt = now + CTF.matchS * 1000;
  return { ok: true, ...result([{ k: 'start', round: g.round }]) };
}

function end(g, winner, events) {
  g.phase = 'over'; g.winner = winner;
  g.flags = { blue: home('blue'), yellow: home('yellow') };
  events.push({ k: 'over', winner });
}

function tag(g, carrier, tagger, now, events) {
  const f = carried(g, carrier.id);
  Object.assign(g.flags[f], { st: 'dropped', at: [...carrier.at], by: 0, since: now, lock: now + CTF.dropLockS * 1000 });
  carrier.down = now + CTF.downS * 1000;
  tagger.tags++;
  events.push({ k: 'tag', id: carrier.id, by: tagger.id, team: f, at: [...carrier.at] });
}

const fresh = (q, now) => q.on && q.at && now - q.t < CTF.freshMs;

/** A position update: msg { p: [east, height, north] RD metres, r: yaw, s: speed }. Runs the rules. */
export function move(g, id, msg, now) {
  const p = g.players[id];
  const v = msg?.p;
  if (!p || !Array.isArray(v) || v.length !== 3 || !v.every((n) => Number.isFinite(n) && Math.abs(n) < 1e7)) return result();
  const prev = p.at;
  p.at = [v[0], v[2]]; p.y = v[1]; p.t = now;
  if (g.phase !== 'play') return result();
  const events = [];
  const mine = p.team, theirs = other(mine);
  // a carrier who teleported (a jump, a bus, the boundary) or left the arena: the flag goes home
  if (carried(g, id) && ((prev && dist(prev, p.at) > CTF.jumpM) || !inArena(p.at, 10))) {
    g.flags[theirs] = home(theirs);
    events.push({ k: 'return', team: theirs, why: 'out', id });
  }
  const up = p.down <= now;
  const enemy = g.flags[theirs], own = g.flags[mine];
  if (up && enemy.st !== 'carried' && enemy.lock <= now && dist(p.at, enemy.at) <= CTF.flagR) {
    Object.assign(enemy, { st: 'carried', by: id, lock: 0 });
    events.push({ k: 'pickup', team: theirs, id });
  }
  if (own.st === 'dropped' && own.lock <= now && dist(p.at, own.at) <= CTF.flagR) {
    g.flags[mine] = home(mine);
    events.push({ k: 'return', team: mine, why: 'touch', id });
  }
  if (carried(g, id) === theirs && g.flags[mine].st === 'home' && dist(p.at, CTF.bases[mine].at) <= CTF.baseR) {
    g.score[mine]++; p.caps++;
    g.flags[theirs] = home(theirs);
    events.push({ k: 'capture', team: mine, id, score: { ...g.score } });
    if (g.score[mine] >= CTF.winCaps) end(g, mine, events);
  }
  // running into each other: an enemy carrier near me is knocked down, or I am, if I carry
  if (g.phase === 'play') {
    for (const q of list(g)) {
      if (q.team === mine || !fresh(q, now) || dist(p.at, q.at) > CTF.tagR) continue;
      if (up && carried(g, q.id)) { tag(g, q, p, now, events); break; }
      if (carried(g, id) && q.down <= now) { tag(g, p, q, now, events); break; }
    }
  }
  return result(events);
}

/** Timers: dropped flags home (after returnS, or a teammate on it after the lock), the clock, dropped connections. */
export function tick(g, now) {
  const events = [];
  let changed = false;
  for (const p of list(g)) {
    if (!p.on && now - p.goneAt >= CTF.graceS * 1000) {
      const r = remove(g, p.id, now);
      events.push(...r.events);
      changed = true;
    }
  }
  for (const t of CTF.teams) {
    const f = g.flags[t];
    if (f.st === 'dropped' && now - f.since >= CTF.returnS * 1000) {
      g.flags[t] = home(t);
      events.push({ k: 'return', team: t, why: 'time' });
    } else if (g.phase === 'play' && f.st === 'dropped' && f.lock <= now) {
      // a teammate already standing on it when the drop lock ends (standing still sends little)
      const q = list(g).find((p) => p.team === t && fresh(p, now) && dist(p.at, f.at) <= CTF.flagR);
      if (q) { g.flags[t] = home(t); events.push({ k: 'return', team: t, why: 'touch', id: q.id }); }
    }
  }
  if (g.phase === 'play' && now >= g.endsAt) {
    const { blue, yellow } = g.score;
    end(g, blue === yellow ? 'draw' : blue > yellow ? 'blue' : 'yellow', events);
  }
  return { events, changed: changed || events.length > 0 };
}

/** The next time tick() has something to do (ms), or 0; now: drop locks still to end count. */
export function nextDeadline(g, now = Infinity) {
  const ts = [];
  for (const t of CTF.teams) if (g.flags[t].st === 'dropped' && g.flags[t].lock > now) ts.push(g.flags[t].lock);
  if (isEmpty(g)) ts.push(g.created + CTF.idleRoomS * 1000);
  for (const p of list(g)) if (!p.on) ts.push(p.goneAt + CTF.graceS * 1000);
  for (const t of CTF.teams) if (g.flags[t].st === 'dropped') ts.push(g.flags[t].since + CTF.returnS * 1000);
  if (g.phase === 'play') ts.push(g.endsAt);
  return ts.length ? Math.min(...ts) : 0;
}

/** An empty room past its idle time can be closed (its code becomes free). */
export const expired = (g, now) => isEmpty(g) && now - g.created >= CTF.idleRoomS * 1000;

/** The snapshot every client gets (no pids: those let a player reconnect). */
export function publicState(g, now) {
  const players = list(g).map(({ id, name, look, team, on, caps, tags }) => ({ id, name, look, team, on, caps, tags }));
  const flags = {};
  for (const t of CTF.teams) { const f = g.flags[t]; flags[t] = { st: f.st, at: f.at, by: f.by }; }
  return { t: 'state', code: g.code, phase: g.phase, round: g.round, host: g.host, players, flags,
    score: { ...g.score }, endsAt: g.endsAt, winner: g.winner, now };
}
