// The look picker (pause menu > Look): a card per look with what it is, the one in use marked, a
// button to switch (the page reloads: materials are built for one look; render/verse.js
// switchLook). Manga is shown as coming soon until it is right.
import { LOOK, switchLook } from '../render/verse.js';

export const LOOKS = [
  { id: null, name: 'Classic', text: 'The toy city: smooth plastic bricks, soft daylight and a miniature tilt-shift blur.' },
  { id: 'verse', name: 'Jump into the Spider-Verse', text: 'A comic-book film come to life: inked outlines, halftone dots and hatching, painted textures, people animated on twos, and colours that split and flash when the action hits.' },
  { id: 'manga', name: 'Manga', text: 'Black ink on paper: screentone, cross-hatching and bold lines, like a printed manga page.', soon: true },
];

const CSS = `
#look-panel { position: fixed; inset: 0; z-index: 30; display: grid; place-items: center; background: rgba(6,8,22,.55); backdrop-filter: blur(3px); }
#look-panel[hidden] { display: none; }
#look-panel .card { width: min(480px, calc(100vw - 24px)); max-height: calc(100vh - 40px); overflow: auto; box-sizing: border-box; background: #11143a;
  color: #f6f3ea; border-radius: 18px; padding: 18px; font: 13px/1.45 system-ui, sans-serif; display: grid; gap: 12px; position: relative; box-shadow: 0 24px 60px rgba(0,0,0,.5); }
#look-panel h3 { margin: 0; font: 400 26px/1 'Anton', Impact, sans-serif; letter-spacing: .05em; }
#look-panel .x { position: absolute; top: 12px; right: 12px; width: 34px; height: 34px; border-radius: 50%; border: 0; background: rgba(255,255,255,.1); color: #f6f3ea; font-size: 20px; cursor: pointer; }
#look-panel .opt { border-radius: 14px; padding: 14px; background: rgba(255,255,255,.05); border: 2px solid transparent; display: grid; gap: 6px; }
#look-panel .opt.on { border-color: #F2A900; }
#look-panel .opt b { font: 400 19px/1.1 'Anton', Impact, sans-serif; letter-spacing: .04em; }
#look-panel .opt p { margin: 0; color: #c3c6dc; }
#look-panel .opt .row { display: flex; gap: 8px; align-items: center; justify-content: space-between; }
#look-panel .tag { font: 700 11px system-ui, sans-serif; letter-spacing: .08em; text-transform: uppercase; padding: 4px 8px; border-radius: 999px; background: rgba(255,255,255,.1); color: #c3c6dc; }
#look-panel .tag.now { background: #F2A900; color: #10153a; }
#look-panel .go { border: 0; border-radius: 999px; padding: 9px 16px; background: #F2A900; color: #10153a; font: 800 13px system-ui, sans-serif; cursor: pointer; }
#look-panel .opt.verse b { color: #ff5c8a; text-shadow: 2px 0 #3ec8ff; }
#look-panel .note { color: #9da1bd; font-size: 12px; }
`;

export function initLooks() {
  if (typeof document === 'undefined') return null;
  document.head.append(Object.assign(document.createElement('style'), { textContent: CSS }));
  const panel = Object.assign(document.createElement('div'), { id: 'look-panel', hidden: true });
  document.body.append(panel);
  const close = () => { panel.hidden = true; };
  function open() {
    panel.innerHTML = `<div class="card"><button class="x" aria-label="Close">&times;</button><h3>LOOK</h3>
      ${LOOKS.map((l, i) => {
        const on = l.id === LOOK;
        const right = on ? '<span class="tag now">In use</span>' : l.soon ? '<span class="tag">Coming soon</span>' : `<button class="go" data-i="${i}">Switch</button>`;
        return `<div class="opt ${on ? 'on' : ''} ${l.id || 'classic'}"><div class="row"><b>${l.name}</b>${right}</div><p>${l.text}</p></div>`;
      }).join('')}
      <div class="note">Switching reloads the page; you start again where the address says.</div></div>`;
    panel.hidden = false;
    window.__bloxPlayer?.input?.releaseLock?.();
  }
  panel.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (e.target === panel || b?.classList.contains('x')) close();
    else if (b?.dataset.i) switchLook(LOOKS[+b.dataset.i].id);
  });
  panel.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
  return { open, close };
}
