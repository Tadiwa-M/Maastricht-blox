// Loading screen: covers the first seconds (city index, baked silhouette, the first streaming
// ring, shader compile on the first frames) so visitors see progress instead of a stutter.
// The phase logic is pure (loadState) so it is testable without a DOM; LoadingScreen only
// paints it, rotates tips, and once everything is ready waits for a key / tap / gamepad button
// (a console game's title screen: rotating in-game key art while loading, then the live city behind the logo, button prompts that answer
// "how do I get back to the map?"). Skipped for screenshots and automation (?shot=1 or
// navigator.webdriver).

const MSG = {
  index: 'Laying the baseplate…',
  silhouette: 'Raising the skyline…',
  stream: 'Placing bricks around you…',
  warm: 'Starting the buses…',
};
export const TIPS = [
  'Lost while walking? Scroll out, or press M, to fly back to the map.',
  'The blue buses run the real Arriva timetable, stop by stop.',
  'Drag the Sun slider past 19:00 and the windows start to glow.',
  'Plug in a PlayStation or Xbox controller: A to walk, B for the map.',
  'Every one of the ~28,000 buildings is real, built from open Dutch map data.',
  'On Wednesday and Friday mornings there is a market on the Markt.',
  'Click any building to see what it is and when it was built.',
  'The Stadhuis on the Markt was rebuilt brick by brick, by hand.',
];
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
    if (el && (auto || /[?&]shot=1/.test(location.search))) { this.hide(true); return; }
    if (el) { el.ownerDocument?.body.classList.add('title'); this.rotateTips(); this.rotateSlides(); }
  }

  /** Key art slideshow (GTA-style): one slide at a time, crossfading, with its place name. */
  rotateSlides() {
    const all = [...this.el.querySelectorAll?.('.slide') || []], place = this.el.querySelector('.place');
    if (!all.length || typeof Image === 'undefined') return;
    // only slides whose key art actually loads (a site built before tools/keyart.mjs ran has none)
    const ok = [];
    let pending = all.length;
    for (const s of all) {
      const url = /url\(([^)]+)\)/.exec(s.getAttribute('style') || '')?.[1];
      const img = new Image();
      const done = (good) => { if (good) ok.push(s); else s.remove(); if (--pending === 0) this.startSlides(ok, place); };
      img.onload = () => done(true); img.onerror = () => done(false);
      if (url) img.src = url; else done(false);
    }
  }

  startSlides(slides, place) {
    if (!slides.length || this.done) return;
    slides.sort((a, b) => [...a.parentNode.children].indexOf(a) - [...b.parentNode.children].indexOf(b));
    let q = 0;
    const show = () => {
      slides.forEach((s, k) => s.classList.toggle('on', k === q % slides.length));
      if (place) place.textContent = slides[q % slides.length].dataset.place || '';
      q++;
    };
    show();
    this.slideTimer = setInterval(show, 6000);
  }

  rotateTips() {
    const tip = this.el.querySelector('.tip');
    if (!tip) return;
    let q = Math.floor(Math.random() * TIPS.length);
    tip.textContent = TIPS[q++ % TIPS.length];
    this.tipTimer = setInterval(() => { // crossfade
      tip.classList.add('out');
      setTimeout(() => { tip.textContent = TIPS[q++ % TIPS.length]; tip.classList.remove('out'); }, 350);
    }, 5500);
  }

  /** The skyline is in: clear the backdrop so the live city plays behind the title. */
  live() { if (this.el && !this.done) this.el.classList.add('live'); }

  /** Everything is loaded: wait for a key, click, tap or gamepad button, like a game's start screen. */
  ready() {
    if (!this.el || this.done || this.waiting) return;
    this.waiting = true;
    const el = this.el, btn = el.querySelector('.start');
    const touch = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
    if (btn) btn.textContent = touch ? 'TAP TO START' : 'PRESS ANY KEY';
    el.classList.add('ready');
    const go = (e) => {
      e?.preventDefault?.(); e?.stopImmediatePropagation?.(); // the start key must not also act in the game
      window.removeEventListener('keydown', go, true);
      el.removeEventListener('pointerdown', go);
      this.hide();
    };
    window.addEventListener('keydown', go, true);
    el.addEventListener('pointerdown', go);
    const pad = () => {
      if (this.done) return;
      for (const g of navigator.getGamepads?.() || []) if (g?.buttons.some((b) => b.pressed)) return go();
      requestAnimationFrame(pad);
    };
    requestAnimationFrame(pad);
  }

  update(frac, msg) {
    if (!this.el || this.done) return;
    this.frac = Math.max(this.frac, frac); // never moves backwards
    this.el.querySelector('.bar i').style.width = `${Math.round(this.frac * 100)}%`;
    if (msg) this.el.querySelector('.msg').textContent = msg;
  }

  /** Run fn once the cover is gone (now, if it already is). */
  whenGone(fn) { if (!this.el || this.done) fn(); else (this.after ??= []).push(fn); }

  hide(now = false) {
    if (!this.el || this.done) return;
    this.done = true;
    clearInterval(this.tipTimer); clearInterval(this.slideTimer);
    for (const fn of this.after || []) fn();
    this.after = null;
    this.el.ownerDocument?.body.classList.remove('title');
    const el = this.el;
    if (now) { el.remove(); return; }
    el.classList.add('gone');
    setTimeout(() => el.remove(), 800);
  }

  error(text) {
    if (!this.el) return;
    this.done = true;
    clearInterval(this.tipTimer);
    this.el.querySelector('.msg').textContent = text;
    this.el.classList.add('failed');
  }
}

let shared = null;
/** The page's one loading screen (city mode and the embedded diorama share it). */
export function loadingScreen() { return (shared ??= new LoadingScreen()); }
