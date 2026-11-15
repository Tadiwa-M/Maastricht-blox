// The comic look reacting to the game, the way the film cuts and recolours on the action
// (render/verse.js draws it; only in the painted looks). A game event fires comicFx(kind, at):
//   hit     my shot lands: action lines burst from the target, a ring of halftone dots, the colour
//           plates jump apart for a moment
//   head    a headshot: stronger, and a small sound word (PATS!)
//   kill    a knock-out: the lines and dots, a two-colour flash (magenta and violet), the camera
//           tilts a few degrees, a held impact frame, a big sound word (KNAL! BOEM! KRAK!)
//   hurt    I am hit: the plates jump, a red flash
//   down    I am knocked out: a long red-violet flash and tilt
//   knock   I ran someone over: a dot burst, a few short lines, a jolt of the plates, a small word
//   land    a hard landing: the plates jolt
//   shove   I brushed someone aside: a slight jolt
//   shot    I fired: the plates twitch (the shotgun more)
//   wave    a raid wave comes: the palette swings to deep red-violet and settles
//   capture a flag or the banner is carried home: a flash
// at: three.js position of the impact (or null: the middle of the screen). Sound words are
// Dutch comic onomatopoeia, our own lettering.
import * as THREE from 'three';

export const FX = {
  hit: { impact: 0.55, split: 0.5 },
  head: { impact: 0.8, split: 0.7, word: ['PATS!'], wordSize: 0.7 },
  kill: { impact: 1, split: 1, duo: 0.55, roll: 0.035, hold: 70, word: ['KNAL!', 'BOEM!', 'KRAK!'], wordSize: 1 },
  hurt: { split: 0.8, duo: 0.35, duoCol: 'red' },
  down: { split: 1, duo: 0.6, duoCol: 'red', roll: -0.05, hold: 90, decay: 0.8 },
  knock: { impact: 0.5, split: 0.6, lines: 0.5, word: ['PATS!', 'BONK!', 'OEPS!'], wordSize: 0.55 },
  land: { split: 0.35 },
  shove: { split: 0.18 },
  shot: { split: 0.12 },
  shotgun: { split: 0.35 },
  wave: { duo: 0.65, duoCol: 'raid', roll: 0.04, decay: 1.4 },
  capture: { duo: 0.45, decay: 0.7 },
  lightning: { duo: 0.6, duoCol: 'white', decay: 0.35, split: 0.5 },
};
const DUO = { // shadow colour, light colour (linear-ish display values)
  verse: [[0.16, 0.04, 0.34], [1.0, 0.36, 0.62]],
  red: [[0.28, 0.02, 0.08], [1.0, 0.45, 0.35]],
  raid: [[0.12, 0.02, 0.18], [0.95, 0.22, 0.28]],
  white: [[0.3, 0.33, 0.45], [1.0, 1.0, 1.0]],
};

/** Fire a comic reaction from anywhere (no-op outside the browser). */
export function comicFx(kind, at = null) {
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('blox:fx', { detail: { kind, at } }));
}

export class ComicFx {
  constructor() {
    this.impact = 0; this.split = 0; this.duo = 0; this.roll = 0; this.rollT = 0; this.holdUntil = 0;
    this.at = null; this.duoCol = DUO.verse; this.decay = 2.2; this.lines = 1;
    this.v = new THREE.Vector3();
    this.words = typeof document !== 'undefined' ? Object.assign(document.createElement('div'), { id: 'comic-words' }) : null;
    if (this.words) {
      document.body.append(this.words);
      const css = document.createElement('style');
      css.textContent = `#comic-words { position: fixed; inset: 0; pointer-events: none; z-index: 4; overflow: hidden; }
        #comic-words b { position: absolute; font: 400 54px/1 'Anton', Impact, sans-serif; letter-spacing: .02em; color: #ffd23f;
          -webkit-text-stroke: 2.5px #121016; text-shadow: 4px 4px 0 #e2336b; transform-origin: 50% 50%; white-space: nowrap;
          animation: comic-pop .75s ease-out forwards; }
        @keyframes comic-pop { 0% { transform: translate(-50%,-50%) rotate(var(--r)) scale(.3); opacity: 1 }
          18% { transform: translate(-50%,-50%) rotate(var(--r)) scale(calc(var(--s) * 1.18)); }
          35% { transform: translate(-50%,-50%) rotate(var(--r)) scale(var(--s)); opacity: 1 }
          100% { transform: translate(-50%,-62%) rotate(var(--r)) scale(var(--s)); opacity: 0 } }`;
      document.head.append(css);
    }
    this.onFx = (e) => this.fire(e.detail.kind, e.detail.at);
    if (typeof window !== 'undefined') window.addEventListener('blox:fx', this.onFx);
  }

  fire(kind, at) {
    const f = FX[kind];
    if (!f) return;
    this.impact = Math.max(this.impact, f.impact || 0);
    this.split = Math.max(this.split, f.split || 0);
    if (f.impact) { this.at = at ? [...at] : null; this.lines = f.lines ?? 1; }
    if (f.duo) { this.duo = Math.max(this.duo, f.duo); this.duoCol = DUO[f.duoCol || 'verse']; this.decay = 1 / (f.decay || 0.45); }
    if (f.roll) { this.roll = f.roll * (Math.random() < 0.5 ? -1 : 1) * (kind === 'down' ? -1 : 1); this.rollT = 1; }
    if (f.hold) this.holdUntil = performance.now() + f.hold;
    if (f.word && this.words) this.word(f.word[Math.floor(Math.random() * f.word.length)], at, f.wordSize || 1);
    this.pending = true;
  }

  word(text, at, size) {
    const b = document.createElement('b');
    b.textContent = text;
    b.style.setProperty('--r', `${(Math.random() - 0.5) * 24}deg`);
    b.style.setProperty('--s', String(size));
    this.wordAt = at; this.wordEl = b;
    b.style.left = '50%'; b.style.top = '42%';
    this.words.append(b);
    setTimeout(() => b.remove(), 800);
  }

  /** Per frame (seconds): decay, and the uniforms for the comic pass. camera: to place the impact. */
  update(dt, camera, u) {
    const k = Math.exp(-dt * 6.5);
    this.impact *= k; this.split *= Math.exp(-dt * 7); this.duo *= Math.exp(-dt * this.decay * 2.2);
    this.rollT *= Math.exp(-dt * 4);
    if (this.impact < 0.003) this.impact = 0;
    if (this.duo < 0.003) this.duo = 0;
    let ax = 0.5, ay = 0.5;
    if (this.at && camera) {
      this.v.set(this.at[0], this.at[1] + 1.2, this.at[2]).project(camera);
      if (this.v.z < 1) { ax = this.v.x * 0.5 + 0.5; ay = this.v.y * 0.5 + 0.5; }
    }
    if (this.wordEl && this.wordAt && camera) { // the newest word sits at the hit
      this.v.set(this.wordAt[0], this.wordAt[1] + 1.9, this.wordAt[2]).project(camera);
      if (this.v.z < 1) { this.wordEl.style.left = `${(this.v.x * 0.5 + 0.5) * 100}%`; this.wordEl.style.top = `${(0.5 - this.v.y * 0.5) * 100}%`; }
      this.wordAt = null;
    }
    u.fxImpact.value = this.impact; u.fxAt.value.set(ax, ay); u.fxSplit.value = this.split; u.fxDuo.value = this.duo;
    u.fxLines.value = this.lines;
    u.fxDuoLo.value.set(...this.duoCol[0]); u.fxDuoHi.value.set(...this.duoCol[1]);
    return this.roll * this.rollT; // camera roll to apply for this frame (radians)
  }

  get holding() { return performance.now() < this.holdUntil; }

  dispose() { window.removeEventListener('blox:fx', this.onFx); this.words?.remove(); }
}
