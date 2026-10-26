// Loading screen: covers the first seconds (city index, baked silhouette, the first streaming
// ring, shader compile on the first frames) so visitors see progress instead of a stutter.
// The phase logic is pure (loadState) so it is testable without a DOM; LoadingScreen only
// paints it. Skipped for screenshots and automation (?shot=1 or navigator.webdriver).

const MSG = {
  index: 'Laying the baseplate…',
  silhouette: 'Raising the skyline…',
  stream: 'Placing bricks around you…',
  warm: 'Starting the buses…',
};
export const WARM_FRAMES = 8; // frames drawn behind the cover: shaders compile on the first ones
export const MAX_STREAM_MS = 8000; // never wait longer than this for the first ring
export const RING_DONE = 0.9; // share of the first ring that counts as loaded

/**
 * s: { index, silhouette, loaded, inflight, pending, settled, frames, streamMs }
 * -> { frac 0..1, msg, done }
 */
export function loadState(s) {
  if (!s.index) return { frac: 0.05, msg: MSG.index, done: false };
  if (!s.silhouette) return { frac: 0.2, msg: MSG.silhouette, done: false };
  const want = s.loaded + s.inflight + s.pending;
  const ring = s.settled || want === 0 ? 1 : s.loaded / want;
  const streamed = s.settled || ring >= RING_DONE || s.streamMs >= MAX_STREAM_MS;
  const warm = Math.min(s.frames, WARM_FRAMES) / WARM_FRAMES;
  if (!streamed) return { frac: 0.4 + 0.45 * ring, msg: MSG.stream, done: false };
  return { frac: 0.85 + 0.15 * warm, msg: MSG.warm, done: s.frames >= WARM_FRAMES };
}

export class LoadingScreen {
  constructor(el = typeof document !== 'undefined' ? document.getElementById('loading') : null) {
    this.el = el;
    this.done = false;
    this.frac = 0;
    const auto = typeof navigator !== 'undefined' && navigator.webdriver;
    if (el && (auto || /[?&]shot=1/.test(location.search))) this.hide(true);
  }

  update(frac, msg) {
    if (!this.el || this.done) return;
    this.frac = Math.max(this.frac, frac); // never moves backwards
    this.el.querySelector('.bar i').style.width = `${Math.round(this.frac * 100)}%`;
    if (msg) this.el.querySelector('.msg').textContent = msg;
  }

  hide(now = false) {
    if (!this.el || this.done) return;
    this.done = true;
    const el = this.el;
    if (now) { el.remove(); return; }
    el.classList.add('gone');
    setTimeout(() => el.remove(), 800);
  }

  error(text) {
    if (!this.el) return;
    this.done = true;
    this.el.querySelector('.msg').textContent = text;
    this.el.classList.add('failed');
  }
}

let shared = null;
/** The page's one loading screen (city mode and the embedded diorama share it). */
export function loadingScreen() { return (shared ??= new LoadingScreen()); }
