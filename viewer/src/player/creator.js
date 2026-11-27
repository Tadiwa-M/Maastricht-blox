// Character creator panel (walk mode, C or the menu): one row per choice of figure/custom.js,
// arrows for styles, swatches for colours, "Surprise me", a share link and Done. The figure
// itself is the preview: index.js turns the camera round to face it while the panel is open.
// Every change is applied at once (onChange) and saved in the browser and the link (#look=).
import { visibleChoices, customVariant, stepChoice, randomChoices, encodeChoices, saveChoices } from '../figure/custom.js';

const CSS = `
#pl-creator { position: fixed; right: 16px; top: 50%; transform: translateY(-50%); width: min(330px, calc(100vw - 32px));
  max-height: calc(100vh - 40px); overflow-y: auto; background: rgba(18,22,30,.88); color: #fff; z-index: 8;
  border-radius: 12px; padding: 14px 16px; font: 14px/1.35 system-ui, sans-serif; box-shadow: 0 6px 24px rgba(0,0,0,.35); }
#pl-creator h3 { margin: 0 0 10px; font-size: 16px; }
#pl-creator .row { margin: 8px 0; }
#pl-creator .lab { font-size: 12px; opacity: .75; margin-bottom: 3px; }
#pl-creator .pick { display: flex; align-items: center; gap: 6px; }
#pl-creator .pick span { flex: 1; text-align: center; text-transform: capitalize; }
#pl-creator button { background: #2c3442; color: #fff; border: 0; border-radius: 6px; padding: 5px 10px; cursor: pointer; font: inherit; }
#pl-creator button:hover { background: #3a4558; }
#pl-creator .sw { display: flex; flex-wrap: wrap; gap: 4px; }
#pl-creator .sw button { width: 22px; height: 22px; padding: 0; border-radius: 50%; border: 2px solid transparent; }
#pl-creator .sw button.on { border-color: #ffd34d; }
#pl-creator .foot { display: flex; gap: 8px; margin-top: 12px; flex-wrap: wrap; }
#pl-creator .foot .done { background: #ffc629; color: #1a1a1a; font-weight: 700; margin-left: auto; }
`;

const el = (tag, attrs = {}, html = '') => Object.assign(document.createElement(tag), attrs, html ? { innerHTML: html } : {});

export class Creator {
  /** choices: current { key: index }; onChange(variant, choices); onDone(). store: localStorage or null. */
  constructor(choices, { onChange, onDone, store = null }) {
    Object.assign(this, { choices, onChange, onDone, store });
    document.head.append(el('style', { textContent: CSS }));
    this.panel = el('div', { id: 'pl-creator', hidden: true });
    document.body.append(this.panel);
    this.open = false;
  }

  show(on = !this.open) {
    this.open = on;
    this.panel.hidden = !on;
    if (on) this.render();
  }

  set(choices) {
    this.choices = choices;
    saveChoices(choices, this.store);
    try { // keep the link shareable: #look=<code>, other hash parts untouched
      const p = new URLSearchParams(location.hash.replace(/^#/, ''));
      p.set('look', encodeChoices(choices)); p.delete('figure');
      history.replaceState(null, '', `#${p.toString()}`);
    } catch { /* no history API (tests) */ }
    this.onChange?.(customVariant(choices), choices);
    this.render();
  }

  render() {
    const ch = this.choices;
    this.panel.replaceChildren(el('h3', { textContent: 'Your character' }));
    for (const c of visibleChoices(ch)) {
      const row = el('div', { className: 'row' });
      row.append(el('div', { className: 'lab', textContent: c.label }));
      if (c.colour) {
        const sw = el('div', { className: 'sw' });
        c.values.forEach((hex, i) => {
          const b = el('button', { title: hex, className: i === ch[c.key] ? 'on' : '' });
          b.style.background = hex;
          b.addEventListener('click', () => this.set({ ...this.choices, [c.key]: i }));
          sw.append(b);
        });
        row.append(sw);
      } else {
        const pick = el('div', { className: 'pick' });
        const prev = el('button', { textContent: '◀', title: 'Previous' });
        const next = el('button', { textContent: '▶', title: 'Next' });
        const v = c.values[ch[c.key]];
        const name = typeof v === 'number' ? `${Math.round(v * 100)}%` : String(v).replace('none', 'nothing');
        prev.addEventListener('click', () => this.set(stepChoice(this.choices, c.key, -1)));
        next.addEventListener('click', () => this.set(stepChoice(this.choices, c.key, 1)));
        pick.append(prev, el('span', { textContent: name }), next);
        row.append(pick);
      }
      this.panel.append(row);
    }
    const foot = el('div', { className: 'foot' });
    const rand = el('button', { textContent: 'Surprise me' });
    rand.addEventListener('click', () => this.set(randomChoices()));
    const share = el('button', { textContent: 'Copy link', title: 'A link that opens the city with this character' });
    share.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(location.href); share.textContent = 'Copied'; } catch { share.textContent = 'Copy the address bar'; }
    });
    const done = el('button', { className: 'done', textContent: 'Done (C)' });
    done.addEventListener('click', () => { this.show(false); this.onDone?.(); });
    foot.append(rand, share, done);
    this.panel.append(foot);
  }
}
