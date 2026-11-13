// Capture the flag: the rules of one room, pure (no sockets, no storage, no clock: `now` is
// passed in, in ms). The room Durable Object (room.js) owns a game object and calls these on
// every message and alarm; it broadcasts the snapshot and events they return. Tested in
// test/ctf.test.mjs. Positions are RD metres (EPSG:28992, [east, north]; the wire carries
// [east, height, north]), so a room doesn't depend on any one world's origin.
//
// Every mutating call returns { events, changed }: events go to every player as { t: 'ev', ... }
// (toasts, knock-downs), changed means the snapshot (publicState) must be re-sent and saved.

export const CTF = {
  version: 2,
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
  // shooting: clients claim hits (they know the walls), the room checks who, how often and where
  hp: 100,
  respawnS: 4, // knocked out this long, then back at the base
  shotRangeM: 170,
  shotSlackM: 2.5, // a claimed hit must pass this close to where the room last saw the target
  pickupBackS: 20, // a taken weapon lies there again after this
  pickupReachM: 36, // clients move a spot to open street nearby (up to 30 m), so the room is generous
  shotFromM: 8, // and start this close to where it last saw the shooter
  // shotgun: damage per pellet that hit (msg.n of 8), short range; knife: one hit, arm's length
  weapons: { rifle: { body: 24, head: 48, minMs: 80 }, scout: { body: 75, head: 150, minMs: 850 },
    shotgun: { body: 15, head: 20, minMs: 650, pellets: 8, rangeM: 45 }, knife: { body: 1000, head: 1000, minMs: 450, rangeM: 3.5, melee: true } },
};

export const other = (team) => (team === 'blue' ? 'yellow' : 'blue');
const home = (g, team) => ({ st: 'home', at: [...g.bases[team].at], by: 0, since: 0, lock: 0 });
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const result = (events = [], changed = events.length > 0) => ({ events, changed });

/** Distance from point p to the segment a-b (all [x, z]). */
export function segDist(p, a, b) {
  const dx = b[0] - a[0], dz = b[1] - a[1];
  const L = dx * dx + dz * dz;
  const t = L ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / L)) : 0;
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dz);
}

export const inArena = (p, slack = 0, bases = CTF.bases) => segDist(p, bases.blue.at, bases.yellow.at) <= CTF.arenaR + slack;

// Places a base can stand: open ground at a landmark (RD metres), by side of the Maas (a pair is
// always on one side, so the arena never needs a bridge).
export const PLACES = [
  { name: 'Markt', at: [176380, 317990], side: 'w' }, { name: 'Vrijthof', at: [176185, 317717], side: 'w' },
  { name: 'Onze Lieve Vrouweplein', at: [176547, 317557], side: 'w' }, { name: 'Dinghuis', at: [176495, 317826], side: 'w' },
  { name: 'Dominicanen', at: [176293, 317844], side: 'w' }, { name: 'Helpoort', at: [176639, 317365], side: 'w' },
  { name: 'Stadspark', at: [176680, 317292], side: 'w' }, { name: 'Bisschopsmolen', at: [176522, 317427], side: 'w' },
  { name: 'Kruisherenklooster', at: [175884, 317636], side: 'w' },
  { name: 'Centre Céramique', at: [177065, 317415], side: 'e' }, { name: 'Station', at: [177380, 317790], side: 'e' },
  { name: 'Bonnefanten', at: [177122, 316999], side: 'e' },
];
export const BASE_GAP_M = [250, 550];

/**
 * Where weapons lie in a round (the same maths as the client's mp/weapons.js pickupSpots): four
 * spots mirrored about the middle of the line between the bases. -> [{ at: [east, north], w }]
 */
export function pickupSpots(bases) {
  const a = bases.blue.at, b = bases.yellow.at, L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
  const f = [(b[0] - a[0]) / L, (b[1] - a[1]) / L], n = [-f[1], f[0]];
  const at = (t, side) => [Math.round(a[0] + f[0] * L * t + n[0] * side), Math.round(a[1] + f[1] * L * t + n[1] * side)];
  return [{ at: at(0.5, 38), w: 'scout' }, { at: at(0.5, -38), w: 'shotgun' }, { at: at(0.22, -24), w: 'shotgun' }, { at: at(0.78, 24), w: 'shotgun' }];
}

/** The bases of a round: Markt and Vrijthof first, then a random fair pair (same side, 250-550 m apart). */
export function pickBases(round, rand = Math.random) {
  const pairs = [];
  for (const a of PLACES) for (const b of PLACES) {
    const d = dist(a.at, b.at);
    if (a !== b && a.side === b.side && d >= BASE_GAP_M[0] && d <= BASE_GAP_M[1]) pairs.push([a, b]);
  }
  const [a, b] = round <= 1 ? [PLACES[0], PLACES[1]] : pairs[Math.min(pairs.length - 1, Math.floor(rand() * pairs.length))];
  return { blue: { name: a.name, at: [...a.at] }, yellow: { name: b.name, at: [...b.at] } };
}

/** What the clients need to draw the arena and run the soft boundary. */
export function arenaConfig(g) {
  const bases = g?.bases || CTF.bases;
  const { version, teams, arenaR, flagR, baseR, tagR, returnS, matchS, winCaps, minPlayers, maxPlayers, hp, respawnS, shotRangeM } = CTF;
  return { version, teams, bases, arenaR, flagR, baseR, tagR, returnS, matchS, winCaps, minPlayers, maxPlayers, hp, respawnS, shotRangeM };
}

export const cleanName = (s) => String(s ?? '').replace(/[^\p{L}\p{N} _.'-]/gu, '').replace(/\s+/g, ' ').trim().slice(0, 12) || 'Player';
export const cleanLook = (s) => (/^[a-z0-9]{1,24}$/.test(String(s ?? '')) ? String(s) : '');
export const validPid = (s) => /^[A-Za-z0-9_-]{8,40}$/.test(String(s ?? ''));

export function newGame(code, now) {
  const g = { bases: pickBases(1) };
  return { ...g, code, created: now, phase: 'lobby', round: 0, host: 0, nextId: 1, players: {},
    flags: { blue: home(g, 'blue'), yellow: home(g, 'yellow') }, score: { blue: 0, yellow: 0 }, endsAt: 0, winner: null };
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
    on: true, goneAt: 0, at: null, y: 0, t: 0, caps: 0, tags: 0, down: 0, hp: CTF.hp, kills: 0, deaths: 0, shotAt: 0 };
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
    Object.assign(g.flags[f], { st: 'dropped', at: [...(p.at || g.bases[f].at)], by: 0, since: now, lock: now });
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
export function start(g, id, now, rand = Math.random) {
  if (id !== g.host) return { ok: false, error: 'only the host can start', ...result() };
  if (g.phase === 'play') return { ok: false, error: 'already playing', ...result() };
  if (list(g).filter((p) => p.on).length < CTF.minPlayers) return { ok: false, error: `needs ${CTF.minPlayers} players`, ...result() };
  rebalance(g);
  g.bases = pickBases(g.round + 1, rand); // a new part of town every round after the first
  g.flags = { blue: home(g, 'blue'), yellow: home(g, 'yellow') };
  g.score = { blue: 0, yellow: 0 };
  for (const p of list(g)) { p.caps = 0; p.tags = 0; p.down = 0; p.hp = CTF.hp; p.kills = 0; p.deaths = 0; p.shotAt = 0; }
  g.phase = 'play'; g.round++; g.winner = null; g.taken = {};
  g.endsAt = now + CTF.matchS * 1000;
  return { ok: true, ...result([{ k: 'start', round: g.round }]) };
}

function end(g, winner, events) {
  g.phase = 'over'; g.winner = winner;
  g.flags = { blue: home(g, 'blue'), yellow: home(g, 'yellow') };
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
  if (carried(g, id) && ((prev && dist(prev, p.at) > CTF.jumpM) || !inArena(p.at, 10, g.bases))) {
    g.flags[theirs] = home(g, theirs);
    events.push({ k: 'return', team: theirs, why: 'out', id });
  }
  const up = p.down <= now;
  const enemy = g.flags[theirs], own = g.flags[mine];
  if (up && enemy.st !== 'carried' && enemy.lock <= now && dist(p.at, enemy.at) <= CTF.flagR) {
    Object.assign(enemy, { st: 'carried', by: id, lock: 0 });
    events.push({ k: 'pickup', team: theirs, id });
  }
  if (own.st === 'dropped' && own.lock <= now && dist(p.at, own.at) <= CTF.flagR) {
    g.flags[mine] = home(g, mine);
    events.push({ k: 'return', team: mine, why: 'touch', id });
  }
  if (carried(g, id) === theirs && g.flags[mine].st === 'home' && dist(p.at, g.bases[mine].at) <= CTF.baseR) {
    g.score[mine]++; p.caps++;
    g.flags[theirs] = home(g, theirs);
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

/** Take the weapon at spot i: the first living player near it gets it; everyone hears it is gone for a while. */
export function take(g, id, msg, now) {
  const p = g.players[id], i = Math.floor(+msg?.i), spot = pickupSpots(g.bases)[i];
  if (!p || !spot || g.phase !== 'play' || !p.at || p.down > now || dist(p.at, spot.at) > CTF.pickupReachM) return result();
  g.taken = g.taken || {};
  if ((g.taken[i] || 0) > now) return result();
  g.taken[i] = now + CTF.pickupBackS * 1000;
  return result([{ k: 'take', i, id, w: spot.w, s: CTF.pickupBackS }], false);
}

const vec3 = (v) => Array.isArray(v) && v.length === 3 && v.every((n) => Number.isFinite(n) && Math.abs(n) < 1e7);

/**
 * A shot: msg { w: 'rifle' | 'scout', o: [east, height, north] where it left, e: where it ended,
 * hit: player id | 0, head: bool }. Everyone gets a 'shot' event (tracers). A claimed hit counts
 * when the target is a living enemy the room saw recently near the shot's line; at 0 health the
 * target is knocked out (drops a carried flag, back at the base after respawnS).
 */
export function shoot(g, id, msg, now) {
  const p = g.players[id], w = CTF.weapons[msg?.w];
  if (!p || !w || g.phase !== 'play' || !p.at || p.down > now || !vec3(msg.o) || !vec3(msg.e)) return result();
  if (now - (p.shotAt || 0) < w.minMs) return result();
  const o = [msg.o[0], msg.o[2]], e = [msg.e[0], msg.e[2]];
  if (dist(o, p.at) > CTF.shotFromM || dist(o, e) > CTF.shotRangeM) return result();
  p.shotAt = now;
  const events = [{ k: 'shot', by: id, w: msg.w, o: msg.o, e: msg.e }];
  const q = g.players[msg.hit];
  if (!q || q.team === p.team || !fresh(q, now) || q.down > now || segDist(q.at, o, e) > CTF.shotSlackM) return result(events, false);
  if (w.rangeM && dist(w.melee ? p.at : o, q.at) > w.rangeM + (w.melee ? 0 : CTF.shotSlackM)) return result(events, false);
  const head = !!msg.head;
  const n = w.pellets ? Math.max(1, Math.min(w.pellets, Math.floor(+msg.n) || 1)) : 1;
  q.hp = Math.max(0, (q.hp ?? CTF.hp) - (head ? w.head : w.body) * n);
  events.push({ k: 'hit', id: q.id, by: id, hp: q.hp, head });
  if (q.hp > 0) return result(events, false);
  q.hp = CTF.hp; q.deaths = (q.deaths || 0) + 1; p.kills = (p.kills || 0) + 1;
  q.down = now + CTF.respawnS * 1000;
  const f = carried(g, q.id);
  if (f) {
    Object.assign(g.flags[f], { st: 'dropped', at: [...q.at], by: 0, since: now, lock: now + CTF.dropLockS * 1000 });
    events.push({ k: 'drop', team: f, id: q.id });
  }
  events.push({ k: 'kill', id: q.id, by: id, head, w: msg.w, at: [...q.at] });
  return result(events, true);
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
      g.flags[t] = home(g, t);
      events.push({ k: 'return', team: t, why: 'time' });
    } else if (g.phase === 'play' && f.st === 'dropped' && f.lock <= now) {
      // a teammate already standing on it when the drop lock ends (standing still sends little)
      const q = list(g).find((p) => p.team === t && fresh(p, now) && dist(p.at, f.at) <= CTF.flagR);
      if (q) { g.flags[t] = home(g, t); events.push({ k: 'return', team: t, why: 'touch', id: q.id }); }
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
  const players = list(g).map(({ id, name, look, team, on, caps, tags, kills, deaths }) => ({ id, name, look, team, on, caps, tags, kills: kills || 0, deaths: deaths || 0 }));
  const flags = {};
  for (const t of CTF.teams) { const f = g.flags[t]; flags[t] = { st: f.st, at: f.at, by: f.by }; }
  return { t: 'state', bases: g.bases, code: g.code, phase: g.phase, round: g.round, host: g.host, players, flags,
    score: { ...g.score }, endsAt: g.endsAt, winner: g.winner, now };
}
