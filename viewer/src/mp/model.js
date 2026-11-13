// The client's view of a room: the room's latest snapshot plus who I am, folded from its
// messages (protocol.js). apply() returns effects for the game to act on: spawn at my base,
// knocked down, a toast, another player's position. Pure (no DOM, no three.js, no sockets),
// tested in test/mp.test.mjs. The room (relay/src/room.js) decides everything; this only reads.
import { spawnSpot, otherTeam } from './arena.js';

export const TEAM_NAMES = { blue: 'Blue', yellow: 'Yellow' };
export const TEAM_HEX = { blue: '#2F6FD6', yellow: '#F2C200' };

export class MatchModel {
  constructor() { this.me = 0; this.config = null; this.room = null; this.offset = 0; this.round = 0; this.kills = []; }

  get phase() { return this.room?.phase || 'none'; }
  get players() { return this.room?.players || []; }
  player(id) { return this.players.find((p) => p.id === id) || null; }
  name(id) { return id === this.me ? 'You' : this.player(id)?.name || 'Someone'; }
  get mine() { return this.player(this.me); }
  get team() { return this.mine?.team || null; }
  get isHost() { return !!this.room && this.room.host === this.me; }
  /** The team whose flag a player carries, or null. */
  carrying(id) {
    for (const t of ['blue', 'yellow']) if (this.room?.flags?.[t]?.st === 'carried' && this.room.flags[t].by === id) return t;
    return null;
  }
  /** Milliseconds left in the match (local clock `now`, Date.now()). */
  timeLeft(now) { return this.phase === 'play' ? Math.max(0, this.room.endsAt - (now + this.offset)) : 0; }
  baseName(team) { return this.config?.bases?.[team]?.name || team; }

  /** Where I start this round: { x, z, yaw } RD metres (or null before I'm on a team). */
  spawn() {
    if (!this.config || !this.team) return null;
    const mates = this.players.filter((p) => p.team === this.team).map((p) => p.id).sort((a, b) => a - b);
    return spawnSpot(this.config, this.team, Math.max(0, mates.indexOf(this.me)));
  }

  /** Fold one room message in; now = Date.now(). -> [{ k: 'spawn' | 'knock' | 'toast' | 'pos' | 'over', ... }] */
  apply(msg, now = Date.now()) {
    const out = [];
    if (msg.t === 'welcome' || msg.t === 'state') {
      const first = msg.t === 'welcome';
      if (first) { this.me = msg.you; this.config = msg.config; }
      this.room = msg;
      if (msg.bases && this.config) this.config = { ...this.config, bases: msg.bases }; // bases move between rounds
      this.offset = (msg.now || now) - now;
      const fresh = msg.phase === 'play' && msg.round !== this.round;
      if (fresh) { this.round = msg.round; this.kills = []; }
      if (fresh && !(first && msg.rejoin)) out.push({ k: 'spawn', at: this.spawn() });
    } else if (msg.t === 'p') {
      if (msg.i !== this.me && Array.isArray(msg.p)) out.push({ k: 'pos', id: msg.i, p: msg.p, yaw: +msg.r || 0, speed: +msg.s || 0 });
    } else if (msg.t === 'ev') {
      if (msg.k === 'tag' && msg.id === this.me) out.push({ k: 'knock', by: msg.by });
      if (msg.k === 'tag' && msg.id !== this.me) out.push({ k: 'scatter', id: msg.id, by: msg.by });
      if (msg.k === 'over') out.push({ k: 'over', winner: msg.winner });
      if (msg.k === 'shot' && msg.by !== this.me) out.push({ k: 'shot', by: msg.by, w: msg.w, o: msg.o, e: msg.e });
      if (msg.k === 'hit' && msg.id === this.me) out.push({ k: 'hurt', hp: msg.hp, by: msg.by });
      if (msg.k === 'hit' && msg.by === this.me) out.push({ k: 'hitmark', head: !!msg.head, kill: msg.hp <= 0 });
      if (msg.k === 'take') out.push({ k: 'take', i: msg.i, mine: msg.id === this.me, w: msg.w, s: msg.s });
      if (msg.k === 'kill') {
        this.kills.push({ at: msg.at, team: this.player(msg.by)?.team || null }); // the after-match heat map
        out.push(msg.id === this.me ? { k: 'killed', by: msg.by } : { k: 'scatter', id: msg.id, by: msg.by });
      }
      const text = this.eventText(msg);
      if (text) out.push({ k: 'toast', text, big: ['capture', 'over', 'start'].includes(msg.k) });
    } else if (msg.t === 'error') out.push({ k: 'toast', text: msg.error });
    return out;
  }

  /** The line shown for a room event, or '' for none. */
  eventText(e) {
    const me = this.me, my = this.team, T = (t) => TEAM_NAMES[t] || t;
    switch (e.k) {
      case 'join': return e.id === me ? '' : `${this.name(e.id)} joined`;
      case 'leave': return `${e.name || 'Someone'} left`;
      case 'start': return my ? `Go! Bring the ${otherTeam(my)} flag to the ${this.baseName(my)}` : 'Go!';
      case 'pickup':
        if (e.id === me) return `You have the flag! Run back to the ${this.baseName(my)}`;
        if (e.team === my) return `${this.name(e.id)} took your flag! Run into them`;
        return `${this.name(e.id)} has the ${e.team} flag`;
      case 'tag':
        if (e.id === me) return 'Knocked down! You dropped the flag';
        if (e.by === me) return `You knocked down ${this.name(e.id)}!`;
        return `${this.name(e.by)} knocked down ${this.name(e.id)}`;
      case 'kill':
        if (e.id === me) return `${this.name(e.by)} knocked you out`;
        if (e.by === me) return e.head ? `Headshot! ${this.name(e.id)} is out` : `You knocked out ${this.name(e.id)}`;
        return `${this.name(e.by)} knocked out ${this.name(e.id)}`;
      case 'drop': return `The ${e.team} flag was dropped`;
      case 'return':
        if (e.why === 'out' && e.id === me) return 'Out of bounds: the flag went home';
        if (e.why === 'touch') return e.id === me ? 'You brought your flag home' : `${this.name(e.id)} returned the ${e.team} flag`;
        return `The ${e.team} flag went home`;
      case 'capture': {
        const s = e.score || this.room?.score || {};
        return `${e.id === me ? 'You score' : `${this.name(e.id)} scores`} for ${T(e.team)}! ${s.blue ?? 0}-${s.yellow ?? 0}`;
      }
      case 'over':
        if (e.winner === 'draw') return 'Time! It is a draw';
        return e.winner === my ? 'Your team wins!' : `${T(e.winner)} wins`;
      default: return '';
    }
  }
}

/** 7:42 */
export function clock(ms) {
  const s = Math.ceil(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
