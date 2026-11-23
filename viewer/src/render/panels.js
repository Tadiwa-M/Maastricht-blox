// The Spider-Verse look's comic panel (owner: panel borders, "that's comic coded"): the screen is
// one panel of a comic page: a paper gutter round the edge and a hand-inked border, a little
// uneven, as if drawn. A big moment (a knock-out, a hard landing, a raid wave) jolts the panel:
// the gutter widens and the border kicks, like a cut to a new panel. Only in the Spider-Verse look.
import { LOOK } from './verse.js';

export const PANEL = { gutterPx: 9, inkPx: 4, jolt: { kill: 1, down: 1, thud: 0.6, wave: 0.8, capture: 0.5 } };

/** The border's path: a rectangle with slightly wobbly corners (pure; 0..100 units, seed: which wobble). */
export function panelPath(seed = 1, wobble = 0.35) {
  const r = (k) => (Math.sin(seed * 12.9898 + k * 78.233) * 43758.5453 % 1 + 1) % 1;
  const c = [[0, 0], [100, 0], [100, 100], [0, 100]].map(([x, y], k) => [x + (r(k) - 0.5) * wobble * 2, y + (r(k + 4) - 0.5) * wobble * 2]);
  return `M${c.map((p) => p.map((v) => v.toFixed(2)).join(' ')).join(' L')} Z`;
}

const CSS = `
#cmx-panel { position: fixed; inset: 0; z-index: 3; pointer-events: none; }
#cmx-panel .gutter { position: absolute; inset: 0; border: ${PANEL.gutterPx}px solid #f4efe2; transition: border-width .12s; }
#cmx-panel svg { position: absolute; inset: ${PANEL.gutterPx}px; width: calc(100% - ${PANEL.gutterPx * 2}px); height: calc(100% - ${PANEL.gutterPx * 2}px); overflow: visible; transition: inset .12s, width .12s, height .12s; }
#cmx-panel path { fill: none; stroke: #0b0b10; stroke-width: ${PANEL.inkPx}px; vector-effect: non-scaling-stroke; stroke-linejoin: round; }
#cmx-panel.jolt .gutter { border-width: ${PANEL.gutterPx * 2.4}px; }
#cmx-panel.jolt svg { inset: ${PANEL.gutterPx * 2.4}px; width: calc(100% - ${PANEL.gutterPx * 4.8}px); height: calc(100% - ${PANEL.gutterPx * 4.8}px); }
body.title #cmx-panel, body.shot #cmx-panel { display: none; }
`;

export class ComicPanel {
  constructor({ look = LOOK } = {}) {
    this.on = look === 'verse' && typeof document !== 'undefined';
    if (!this.on) return;
    document.head.append(Object.assign(document.createElement('style'), { textContent: CSS }));
    this.el = Object.assign(document.createElement('div'), { id: 'cmx-panel' });
    this.el.innerHTML = `<div class="gutter"></div><svg viewBox="0 0 100 100" preserveAspectRatio="none"><path d="${panelPath(1)}"/></svg>`;
    document.body.append(this.el);
    this.seed = 1; this.timer = 0;
    this.onFx = (e) => this.jolt(PANEL.jolt[e.detail?.kind] || 0);
    window.addEventListener('blox:fx', this.onFx);
  }

  /** A cut to a new panel: the gutter widens for a moment and the border is redrawn a little differently. */
  jolt(k) {
    if (!this.on || k <= 0) return;
    this.el.querySelector('path').setAttribute('d', panelPath(++this.seed, 0.35 + 0.5 * k));
    this.el.classList.add('jolt');
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.el.classList.remove('jolt'), 140 + 160 * k);
  }

  dispose() { if (this.on) { window.removeEventListener('blox:fx', this.onFx); this.el.remove(); } }
}
