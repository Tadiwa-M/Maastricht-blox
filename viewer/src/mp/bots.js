// Computer players for the local games (mp/localroom.js): capture-the-flag bots and the night
// raid's raiders. Each one reads the room's game state (relay/src/ctf.js), decides where to go
// and whom to fight, walks the pedestrian graph there (nav.path) and sends the same messages a
// person's client sends (position, shot), so the same rules judge them. Pure apart from `nav`
// (routes, ground height, line of sight), tested in test/bots.test.mjs. Positions: RD metres
// [east, north] (heights separate), like the room.
import { spawnSpot, yawTo } from './arena.js';

export const BOT = {
  speed: 4.4, carrySpeed: 4.0, raiderSpeed: 3.8, raiderCarry: 3.0,
  sight: 42, // metres: an enemy closer than this (and in view) gets shot at
  raiderSight: 16, // raiders go for a person this close, otherwise for the banner
  shotEvery: [0.32, 0.6], // seconds between a bot's rifle shots (it does not hold the trigger down)
  hitAt: [0.7, 0.18], // chance a shot hits at 0 m and at the sight range
  headShare: 0.12,
  meleeM: 2.1, meleeEvery: 0.9, meleeHit: 0.75, meleePellets: 2, // a raider's swipe: 2 shotgun pellets of damage
  repathS: 2.5, repathM: 8, patrolS: 7,
};

const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const other = (t) => (t === 'blue' ? 'yellow' : 'blue');

function carriedBy(g, id) {
  for (const t of ['blue', 'yellow']) if (g.flags[t].st === 'carried' && g.flags[t].by === id) return t;
  return null;
}

/** Where a capture-the-flag bot wants to be now (RD), from the flags and its role. */
export function ctfGoal(g, p, bot, now, rand = Math.random) {
  const mine = p.team, theirs = other(mine), own = g.flags[mine], enemy = g.flags[theirs];
  if (carriedBy(g, p.id)) return g.bases[mine].at; // run it home
  if (own.st === 'carried') { const c = g.players[own.by]; if (c?.at) return c.at; } // run into their carrier
  if (own.st === 'dropped') return own.at; // touch it to send it home
  if (bot.role === 'attack') {
    if (enemy.st === 'carried') return g.bases[mine].at; // a teammate has it: go home with them
    return enemy.at;
  }
  // defend: chase an enemy near the base, else stand around it
  const base = g.bases[mine].at;
  for (const q of Object.values(g.players)) if (q.team !== mine && q.at && q.down <= now && dist(q.at, base) < 30) return q.at;
  if (!bot.patrol || now >= bot.patrolUntil) {
    const a = rand() * Math.PI * 2, r = 4 + rand() * 12;
    bot.patrol = [base[0] + Math.cos(a) * r, base[1] + Math.sin(a) * r];
    bot.patrolUntil = now + BOT.patrolS * 1000;
  }
  return bot.patrol;
}

/** Where a raider wants to be: a person close by, else the banner (blue flag), else out with it. */
export function raidGoal(g, p, now, see) {
  if (carriedBy(g, p.id)) return { at: g.bases.yellow.at };
  let prey = null, pd = BOT.raiderSight;
  for (const q of Object.values(g.players)) {
    if (q.team === p.team || !q.at || q.down > now) continue;
    const d = dist(q.at, p.at);
    if (d < pd && see(p, q)) { pd = d; prey = q; }
  }
  if (prey) return { at: prey.at, prey };
  const banner = g.flags.blue;
  if (banner.st === 'carried') { const c = g.players[banner.by]; return { at: c?.at || g.bases.yellow.at }; } // escort
  return { at: banner.at };
}

/** The nearest living enemy this player can see within range, or null. */
export function pickTarget(g, p, now, see, range = BOT.sight) {
  let best = null, bd = range;
  for (const q of Object.values(g.players)) {
    if (q.team === p.team || !q.at || q.down > now || (q.safe || 0) > now) continue;
    const d = dist(q.at, p.at);
    if (d < bd && see(p, q)) { bd = d; best = q; }
  }
  return best;
}

/** Hit chance for a bot's rifle shot at distance d (m). */
export const hitChance = (d) => BOT.hitAt[0] + (BOT.hitAt[1] - BOT.hitAt[0]) * Math.min(1, d / BOT.sight);

/**
 * One bot: think, walk, fight. step() returns the messages to put through the room rules as
 * this player: [{ t: 'p', ... }, { t: 'shot', ... }].
 */
export class Bot {
  constructor(id, { kind = 'ctf', role = 'attack', rand = Math.random } = {}) {
    Object.assign(this, { id, kind, role, rand });
    this.at = null; this.y = 0; this.yaw = 0; this.path = []; this.goal = null; this.pathAt = 0;
    this.nextShot = 0; this.wasDown = false; this.slot = 0;
  }

  /** Stand at a spot (RD) facing yaw. */
  place(at, yaw, nav) { this.at = [...at]; this.yaw = yaw; this.y = nav.height(this.at); this.path = []; this.goal = null; }

  step(g, now, dt, nav) {
    const p = g.players[this.id];
    if (!p) return [];
    if (!this.at) this.place(p.at || g.bases[p.team].at, 0, nav);
    const out = [];
    // knocked out: wait, then start again at the base (as a person's client does)
    if (p.down > now) { this.wasDown = true; return out; }
    if (this.wasDown) {
      this.wasDown = false;
      if (this.kind === 'ctf' && g.phase === 'play') { const s = spawnSpot({ bases: g.bases }, p.team, this.slot); this.place([s.x, s.z], s.yaw, nav); }
    }
    if (g.phase !== 'play') return [this.posMsg(0)];
    const see = (a, b) => nav.los([...a.at], a.y ?? 0, [...b.at], b.y ?? 0);
    let goal, prey = null, speed;
    const me = { ...p, at: this.at, y: this.y };
    if (this.kind === 'raider') {
      const r = raidGoal(g, me, now, see);
      goal = r.at; prey = r.prey || null;
      speed = carriedBy(g, p.id) ? BOT.raiderCarry : BOT.raiderSpeed;
    } else {
      goal = ctfGoal(g, p, this, now, this.rand);
      speed = carriedBy(g, p.id) ? BOT.carrySpeed : BOT.speed;
    }
    // walk: along the graph, straight when it is close (a chase across a square)
    const d = dist(this.at, goal);
    if (d < 14 || !nav.path) this.path = [goal];
    else if (!this.goal || dist(this.goal, goal) > BOT.repathM || now - this.pathAt > BOT.repathS * 1000 || !this.path.length) {
      this.path = nav.path(this.at, goal) || [goal];
      this.goal = [...goal]; this.pathAt = now;
    }
    let left = speed * dt, moved = 0;
    while (left > 0 && this.path.length) {
      const wp = this.path[0], L = dist(this.at, wp);
      if (L <= left) { this.at = [...wp]; left -= L; moved += L; this.path.shift(); continue; }
      this.at = [this.at[0] + ((wp[0] - this.at[0]) / L) * left, this.at[1] + ((wp[1] - this.at[1]) / L) * left];
      moved += left; left = 0;
      this.yaw = yawTo(this.at, wp);
    }
    this.y = nav.height(this.at);
    // fight
    if (this.kind === 'raider') {
      if (prey && dist(this.at, prey.at) <= BOT.meleeM) {
        this.yaw = yawTo(this.at, prey.at);
        if (now >= this.nextShot) {
          this.nextShot = now + BOT.meleeEvery * 1000;
          const hit = this.rand() < BOT.meleeHit;
          out.push({ t: 'shot', w: 'shotgun', n: BOT.meleePellets, o: [this.at[0], this.y + 1.3, this.at[1]],
            e: [prey.at[0], (prey.y || 0) + 1.1, prey.at[1]], hit: hit ? prey.id : 0, head: false, melee: true });
        }
      }
    } else {
      const t = pickTarget(g, me, now, see);
      if (t) {
        this.yaw = yawTo(this.at, t.at);
        if (now >= this.nextShot) {
          const [a, b] = BOT.shotEvery;
          this.nextShot = now + (a + (b - a) * this.rand()) * 1000;
          const td = dist(this.at, t.at), hit = this.rand() < hitChance(td);
          const miss = hit ? [0, 0] : [(this.rand() - 0.5) * 5, (this.rand() - 0.5) * 5];
          out.push({ t: 'shot', w: 'rifle', o: [this.at[0], this.y + 1.45, this.at[1]],
            e: [t.at[0] + miss[0], (t.y || 0) + 1.2, t.at[1] + miss[1]], hit: hit ? t.id : 0, head: hit && this.rand() < BOT.headShare });
        }
      }
    }
    out.unshift(this.posMsg(dt > 0 ? moved / dt : 0));
    return out;
  }

  posMsg(speed) { return { t: 'p', p: [this.at[0], this.y, this.at[1]], r: this.yaw, s: Math.min(speed, 12) }; }
}
