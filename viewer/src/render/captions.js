// The Spider-Verse look narrates the city in comic caption boxes (owner: the panel mockup's
// "MAASTRICHT. SOME OTHER UNIVERSE." box, more of that comic-book feel): when you walk into a new
// place, a yellow box slides in at the top-left: the place's name and a narrator's line. At most
// one every CAPTION.gapS seconds, so it reads as a cut, not a ticker. Only in the Spider-Verse look.
import { LOOK } from './verse.js';

export const CAPTION = { showS: 4.5, gapS: 25 };
const LINES = ['MEANWHILE...', 'A FEW MINUTES LATER.', 'ELSEWHERE IN THE CITY.', 'THE SAME DAY.', 'NOT FAR FROM HOME.', 'JUST AROUND THE CORNER.'];

/** The caption for the n-th place of a visit (pure): the first is the universe, then the narrator. */
export function captionFor(place, n) {
  return { title: `${String(place || 'MAASTRICHT').toUpperCase()}.`, sub: n === 0 ? 'SOME OTHER UNIVERSE.' : LINES[(n - 1) % LINES.length] };
}

const CSS = `
#cmx-cap { position: fixed; left: 16px; top: calc(64px + env(safe-area-inset-top, 0px)); z-index: 6; pointer-events: none;
  background: #ffe23a; color: #0b0b10; border: 4px solid #0b0b10; box-shadow: 6px 6px 0 #0b0b10; padding: 8px 16px 9px;
  font: italic 900 22px/1.05 system-ui, 'Arial Black', sans-serif; letter-spacing: .01em; text-transform: uppercase;
  transform: translateX(calc(-100% - 40px)) rotate(-1deg); opacity: 0; transition: transform .35s cubic-bezier(.2,1.4,.4,1), opacity .2s; max-width: min(420px, calc(100vw - 48px)); }
#cmx-cap small { display: block; font: italic 800 14px/1.2 system-ui, sans-serif; margin-top: 3px; }
#cmx-cap.on { transform: translateX(0) rotate(-1deg); opacity: 1; }
body.title #cmx-cap, body.shot #cmx-cap, body.bx-paused #cmx-cap { display: none; }
`;

export class Captions {
  constructor({ look = LOOK, now = () => performance.now() } = {}) {
    this.on = look === 'verse' && typeof document !== 'undefined';
    this.now = now; this.last = ''; this.shownAt = -1e9; this.n = 0; this.timer = 0;
    if (!this.on) return;
    document.head.append(Object.assign(document.createElement('style'), { textContent: CSS }));
    this.el = Object.assign(document.createElement('div'), { id: 'cmx-cap' });
    document.body.append(this.el);
  }

  /** The player is at a named place (a street, a square); a caption when it is a new one and the last was a while ago. */
  place(name) {
    if (!this.on || !name || name === this.last) return;
    this.last = name;
    if (this.now() - this.shownAt < CAPTION.gapS * 1000) return;
    this.shownAt = this.now();
    const { title, sub } = captionFor(name, this.n++);
    this.el.innerHTML = '';
    this.el.append(title, Object.assign(document.createElement('small'), { textContent: sub }));
    this.el.classList.add('on');
    window.dispatchEvent(new CustomEvent('blox:fx', { detail: { kind: 'caption' } })); // the comic panel cuts in with it (render/panels.js)
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.el.classList.remove('on'), CAPTION.showS * 1000);
  }
}
