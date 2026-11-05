// Trip guide: follows a planned journey (raptor.js) step by step, like a maps app's navigation:
// walk to the stop (the green line), wait, board when the bus is here, ride and get off at the
// right stop, walk on, arrive. Pure: the caller feeds where the player is, what is running and
// whether they ride; tested in test/plan-trip.test.mjs.

export const ARRIVE_M = 10; // a walk leg ends this close to its target
export const BOARD_M = 30; // the bus and the player both this close to the stop: you can board
export const MISSED_S = 90; // the bus left this long ago and you're not on it: missed

const hhmm = (s) => { const m = Math.floor((((s % 86400) + 86400) % 86400) / 60); return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`; };
const inMin = (s) => (s <= 30 ? 'now' : `in ${Math.round(s / 60)} min`);

export class TripGuide {
  /** journey: a raptor.js summary ({ legs, ... }); toLabel: the destination's name. */
  constructor(journey, toLabel = 'your destination') {
    this.j = journey; this.toLabel = toLabel;
    this.leg = 0; this.boarded = false; this.done = false; this.missed = false;
  }

  get current() { return this.j.legs[this.leg] || null; }

  /** Index of the first bus leg (teleporting jumps here), or -1. */
  firstBus() { return this.j.legs.findIndex((l) => l.mode === 'bus'); }

  /** Jump to a leg (teleport onto its bus). */
  jumpTo(i) { this.leg = i; this.boarded = false; this.missed = false; }

  /**
   * s: { pos: [x, z] Unity metres (the player), sec (clock seconds today), riding (vehicle id or
   * null), vehicles: [{ id, x, z }] }. Returns { phase: walk | wait | ride | missed | done,
   * message, target ([x, z] to guide to, or null), canBoard (vehicle id or null), offK (pattern
   * stop index to get off at, while riding) }.
   */
  update(s) {
    for (let guard = 0; guard < 8; guard++) {
      const L = this.current;
      if (!L) { this.done = true; return { phase: 'done', message: `You have arrived at ${this.toLabel}`, target: null }; }
      if (L.mode === 'walk') {
        const t = [L.to.x, L.to.z], d = Math.hypot(s.pos[0] - t[0], s.pos[1] - t[1]);
        if (d < ARRIVE_M) { this.leg++; continue; }
        const next = this.j.legs[this.leg + 1];
        const where = L.to.name || this.toLabel;
        const bus = next?.mode === 'bus' ? ` · bus ${next.line} at ${hhmm(next.dep)} (${inMin(next.dep - s.sec)})` : '';
        return { phase: 'walk', message: `Walk to ${where} · ${Math.round(d)} m${bus}`, target: t };
      }
      // a bus leg
      if (s.riding === L.vid) {
        this.boarded = true;
        return { phase: 'ride', message: `On bus ${L.line} → ${L.head} · get off at ${L.to.name} (${hhmm(L.arr)})`, target: null, offK: L.toI };
      }
      if (this.boarded) { this.boarded = false; this.leg++; continue; } // got off
      const stop = [L.from.x, L.from.z];
      const v = s.vehicles.find((x) => x.id === L.vid);
      const busHere = v && Math.hypot(v.x - stop[0], v.z - stop[1]) < BOARD_M;
      const meHere = Math.hypot(s.pos[0] - stop[0], s.pos[1] - stop[1]) < BOARD_M;
      if (!busHere && s.sec > L.dep + MISSED_S) {
        this.missed = true;
        return { phase: 'missed', message: `Missed bus ${L.line} (${hhmm(L.dep)}) · plan again from here`, target: null };
      }
      if (busHere && meHere) return { phase: 'wait', message: `Bus ${L.line} → ${L.head} is here · press F to board`, target: stop, canBoard: L.vid };
      return { phase: 'wait', message: `Wait at ${L.from.name} for bus ${L.line} → ${L.head} · ${hhmm(L.dep)} (${inMin(L.dep - s.sec)})`, target: meHere ? null : stop };
    }
    return { phase: 'walk', message: '', target: null };
  }
}
