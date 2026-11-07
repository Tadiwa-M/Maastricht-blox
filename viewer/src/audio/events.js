// Sound events from the game state, as pure state machines (tested in test/audio.test.mjs):
// the hour bells from the game clock, footsteps from the distance walked, jump and landing from
// the controller, and a ridden bus's doors from its speed.

const HOUR = 3600;

/**
 * Bell strikes due between two game-clock readings (seconds since Monday 00:00, LifeClock.t).
 * Hours from..to (inclusive) strike their count (1-12) on Sint Servaas; half hours one stroke on
 * Sint Jan; the night stays quiet. A jump of the clock (the "now" button, the sun slider) of more
 * than maxJump seconds strikes nothing. -> [{ kind: 'hour', hour, count } | { kind: 'half', hour }]
 */
export function bellStrikes(prevT, nowT, { from = 7, to = 22, maxJump = 120 } = {}) {
  if (!Number.isFinite(prevT) || !Number.isFinite(nowT)) return [];
  let a = prevT, b = nowT;
  if (b < a) b += 7 * 86400; // Sunday night -> Monday
  if (b - a > maxJump || b === a) return [];
  const out = [];
  for (let k = Math.floor(a / (HOUR / 2)) + 1; k * (HOUR / 2) <= b; k++) {
    const hour = Math.floor((k * (HOUR / 2)) / HOUR) % 24, half = k % 2 === 1;
    if (half ? hour < from || hour >= to : hour < from || hour > to) continue;
    out.push(half ? { kind: 'half', hour } : { kind: 'hour', hour, count: hour % 12 || 12 });
  }
  return out;
}

/** The short tune Sint Jan's small bells play before the hour strikes: [semitones above C6, beat]. */
export const PRELUDE = [[7, 0], [4, 1], [9, 2], [7, 3], [4, 4.5], [2, 5], [0, 6]];
export const STRIKE_GAP_S = 2.4; // between the hour bell's strokes
export const PRELUDE_BEAT_S = 0.3;

/**
 * Footsteps from the distance walked: one step per stride (m, by speed; the figure's gait,
 * figure/gait.js strideAt). update(distance this frame, speed m/s, grounded) -> steps taken (0, 1..).
 * Standing still resets the phase so the first step lands soon after starting off.
 */
export class StepClock {
  constructor(stride = () => 0.75) { this.stride = stride; this.acc = 0.6; }
  update(dist, speed, grounded) {
    if (!grounded || speed < 0.3 || !(dist > 0)) { if (speed < 0.3) this.acc = 0.6; return 0; }
    this.acc += dist / Math.max(0.3, this.stride(speed));
    const n = Math.floor(this.acc);
    this.acc -= n;
    return Math.min(n, 2);
  }
}

/** Jump and landing: update(grounded, vy) -> null | { kind: 'jump' } | { kind: 'land', strength 0..1 }. */
export class AirWatch {
  constructor() { this.grounded = true; this.minVy = 0; this.airT = 0; }
  update(grounded, vy = 0, dt = 0) {
    let ev = null;
    if (!grounded) {
      if (this.grounded && vy > 0.5) ev = { kind: 'jump' };
      this.minVy = Math.min(this.minVy, vy);
      this.airT += dt;
    } else if (!this.grounded) {
      // a step down a kerb is not a landing: only a real fall (> ~0.15 s or > 2 m/s down)
      if (this.airT > 0.15 || this.minVy < -2) ev = { kind: 'land', strength: Math.min(1, Math.max(0.15, -this.minVy / 10)) };
      this.minVy = 0; this.airT = 0;
    }
    this.grounded = grounded;
    return ev;
  }
}

/**
 * A ridden bus's doors: stopped (slower than 0.15 m/s for 0.4 s) after driving -> 'open' (hiss,
 * chime); moving off again (faster than 0.6 m/s) -> 'close'. update(v, dt) -> null | 'open' | 'close'.
 */
export class DoorWatch {
  constructor() { this.state = 'moving'; this.still = 0; }
  update(v, dt) {
    const s = Math.abs(v || 0);
    if (this.state === 'moving') {
      this.still = s < 0.15 ? this.still + dt : 0;
      if (this.still >= 0.4) { this.state = 'open'; return 'open'; }
    } else if (s > 0.6) { this.state = 'moving'; this.still = 0; return 'close'; }
    return null;
  }
  reset() { this.state = 'moving'; this.still = 0; }
}

/** Events due in a tick of dt seconds for a Poisson rate (per s), with rand() in [0, 1). */
export function eventsInTick(rate, dt, rand = Math.random) {
  let n = 0, p = rate * dt;
  while (p > 0 && n < 4) { if (rand() < Math.min(1, p)) n++; p -= 1; }
  return n;
}
