// When to say something: the first-minute prompt and the pacing of goal offers. Pure (no DOM,
// no clock of its own: the caller passes dt). Tested in test/goals.flow.test.mjs.
//
// First minute: once the title screen is gone and the player sits at the map view, one gentle
// prompt ("Double-tap the Markt to walk there"), the first time ever only. It goes away when they
// walk, or after PROMPT_S. The first offer comes FIRST_OFFER_S of walking after the first walk;
// later offers wait a few minutes after the last goal ends (longer after a "Not now").

export const PROMPT_DELAY_S = 1.5, PROMPT_S = 14;
export const FIRST_OFFER_S = 20, AFTER_GOAL_S = 150, AFTER_DECLINE_S = 300, OFFER_S = 30;

export class Flow {
  /** prompted: the first-minute prompt was shown in an earlier visit. off: no offers at all. */
  constructor({ prompted = false, off = false, rand = Math.random } = {}) {
    this.prompted = prompted;
    this.off = off;
    this.rand = rand;
    this.promptT = null; // seconds the prompt has been up (null: not up)
    this.mapT = 0; // seconds at the map after the title
    this.walked = false;
    this.next = null; // seconds of walking until the next offer (null: not before the first walk)
    this.offerT = null; // seconds the current offer has been up
  }

  /**
   * One frame. s: { dt, title (title screen up), mode ('map' | 'walk'), riding, busy (a goal is
   * running) }. Returns the events this frame: 'prompt', 'unprompt', 'offer', 'unoffer'.
   */
  update({ dt, title = false, mode = 'map', riding = false, busy = false }) {
    const ev = [];
    if (title) return ev;
    // the first-minute prompt
    if (!this.prompted && !this.walked && mode === 'map' && !riding) {
      this.mapT += dt;
      if (this.mapT >= PROMPT_DELAY_S) { this.prompted = true; this.promptT = 0; ev.push('prompt'); }
    } else if (this.promptT !== null) {
      this.promptT += dt;
      if (mode === 'walk' || riding || this.promptT >= PROMPT_S) { this.promptT = null; ev.push('unprompt'); }
    }
    if (mode === 'walk' && !this.walked) { this.walked = true; this.next = FIRST_OFFER_S; }
    // an offer up: it times out quietly
    if (this.offerT !== null) {
      this.offerT += dt;
      if (this.offerT >= OFFER_S || busy) { this.offerT = null; this.later(AFTER_DECLINE_S * 0.6); ev.push('unoffer'); }
      return ev;
    }
    // counting down to the next offer: only while walking freely
    if (this.off || busy || this.next === null || riding || mode !== 'walk') return ev;
    this.next -= dt;
    if (this.next <= 0) { this.next = null; this.offerT = 0; ev.push('offer'); }
    return ev;
  }

  /** The offer was taken (the goal starts) or nothing could be offered right now. */
  taken() { this.offerT = null; this.next = null; }
  /** "Not now". */
  declined() { this.offerT = null; this.later(AFTER_DECLINE_S); }
  /** A goal ended (done, dropped or run out). */
  ended() { this.later(AFTER_GOAL_S); }
  /** Nothing to offer here: try again a little later. */
  retry(s = 25) { this.offerT = null; this.next = s; }
  /** Schedule the next offer about `s` seconds of walking from now (+-20 %). */
  later(s) { this.next = s * (0.8 + 0.4 * this.rand()); }
}
