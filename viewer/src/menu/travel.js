// Fast travel as a small state machine (pure: the game is reached through callbacks, so it is
// tested with fakes). fade in -> try to stand there -> (not loaded yet: move the map camera there,
// ask the streamer to load it, retry) -> fade out.
//
// hooks: place(x, z, yaw) -> boolean (stood the player there), prepare(x, z) (the area is not
// loaded: point the map and the streamer at it), giveUp(x, z) (still not loaded at the
// timeout: stay on the map there), fade(alpha 0..1, text).

export const FADE_IN_S = 0.25;
export const FADE_OUT_S = 0.4;
export const RETRY_S = 0.4;
export const GIVE_UP_S = 45;

export class Travel {
  constructor(hooks) {
    this.h = hooks;
    this.phase = 'idle'; // idle | in | wait | out
    this.t = 0; this.k = 0; this.target = null; this.result = null;
  }

  get busy() { return this.phase !== 'idle'; }

  /** target: { x, z (Unity metres), yaw (compass radians), name } */
  start(target) {
    if (this.busy) return false;
    this.target = target; this.phase = 'in'; this.t = 0; this.result = null;
    this.h.fade(0, '');
    return true;
  }

  step(dt) {
    const g = this.target;
    if (this.phase === 'in') {
      this.t += dt;
      this.h.fade(Math.min(1, this.t / FADE_IN_S), '');
      if (this.t < FADE_IN_S) return;
      if (this.h.place(g.x, g.z, g.yaw)) return this.finish('placed');
      this.h.prepare(g.x, g.z);
      this.phase = 'wait'; this.t = 0; this.k = 0;
      this.h.fade(1, `Travelling to ${g.name || 'there'}…`);
    } else if (this.phase === 'wait') {
      this.t += dt; this.k += dt;
      if (this.k >= RETRY_S - 1e-6) {
        this.k = 0;
        if (this.h.place(g.x, g.z, g.yaw)) return this.finish('placed');
      }
      if (this.t >= GIVE_UP_S) { this.h.giveUp(g.x, g.z); this.finish('gave-up'); }
    } else if (this.phase === 'out') {
      this.t += dt;
      this.h.fade(Math.max(0, 1 - this.t / FADE_OUT_S), '');
      if (this.t >= FADE_OUT_S) { this.phase = 'idle'; this.h.done?.(this.result, g); }
    }
  }

  finish(result) { this.result = result; this.phase = 'out'; this.t = 0; }
}
