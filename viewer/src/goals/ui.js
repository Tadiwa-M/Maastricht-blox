// The goals' only screen furniture: one small card at the top right (an offer, the objective, a
// short "done" note, or the first-minute prompt), collapsible with O, plus the cue layer (edge
// glint, tower names, the tourist's "?"). Hidden on the title screen and in screenshots.

const CSS = `
#gl-zone { position: fixed; top: calc(60px + env(safe-area-inset-top, 0px)); right: 14px; z-index: 5; width: min(300px, calc(100vw - 28px));
  display: grid; gap: 8px; justify-items: end; pointer-events: none; font: 13px/1.4 system-ui, sans-serif; color: #f6f3ea; }
#gl-zone > * { pointer-events: auto; box-sizing: border-box; max-width: 100%; }
.gl-card { background: rgba(18,22,30,.78); border: 1px solid rgba(255,198,90,.35); border-radius: 12px; padding: 9px 12px;
  box-shadow: 0 6px 18px rgba(0,0,0,.28); transition: opacity .4s; width: 100%; }
.gl-card[hidden] { display: none; }
.gl-card .hd { display: flex; align-items: center; gap: 8px; }
.gl-card .hd b { flex: 1; font: 600 11px system-ui, sans-serif; letter-spacing: .14em; color: #ffc65a; text-transform: uppercase; }
.gl-card .hd button { background: none; border: 0; color: #b9bcc4; cursor: pointer; font-size: 13px; padding: 0 2px; }
.gl-card .t { font-weight: 600; margin-top: 3px; }
.gl-card .s { color: #c9ccd6; font-size: 12px; margin-top: 2px; }
.gl-card .acts { display: flex; gap: 6px; margin-top: 8px; flex-wrap: wrap; }
.gl-card .acts button { border: 0; border-radius: 8px; padding: 6px 10px; font: 700 12px system-ui, sans-serif; cursor: pointer;
  background: rgba(255,255,255,.1); color: #f6f3ea; }
.gl-card .acts button.go { background: #F2A900; color: #10153a; }
.gl-card .acts button.lnk { background: none; color: #8d91ad; font-weight: 500; padding: 6px 4px; }
.gl-card.min .body { display: none; }
.gl-card.min { width: auto; padding: 6px 10px; }
.gl-chip { display: inline-grid; place-items: center; min-width: 22px; height: 19px; padding: 0 5px; border-radius: 5px; color: #fff; font: 800 11px system-ui; vertical-align: 1px; }
#gl-cues { position: fixed; inset: 0; pointer-events: none; z-index: 4; overflow: hidden; }
#gl-cues > div { position: absolute; left: 0; top: 0; will-change: transform; }
#gl-cues > div[hidden] { display: none; }
.gl-glint { width: 26px; height: 26px; display: grid; place-items: center; color: #ffd27a;
  filter: drop-shadow(0 0 6px rgba(255,198,90,.9)); animation: gl-pulse 1.8s ease-in-out infinite; }
@keyframes gl-pulse { 0%, 100% { opacity: .55; } 50% { opacity: 1; } }
.gl-tower { font: 600 10px system-ui, sans-serif; letter-spacing: .08em; color: #fff; text-shadow: 0 1px 3px rgba(0,0,0,.7); white-space: nowrap; }
.gl-ask { width: 22px; height: 22px; border-radius: 50%; background: #ffc65a; color: #10153a; font: 800 14px/22px system-ui, sans-serif;
  text-align: center; box-shadow: 0 2px 8px rgba(0,0,0,.35); animation: gl-bob 1.4s ease-in-out infinite; }
@keyframes gl-bob { 0%, 100% { margin-top: 0; } 50% { margin-top: -4px; } }
body.title #gl-zone, body.title #gl-cues, body.shot #gl-zone, body.shot #gl-cues { display: none; }
@media (prefers-reduced-motion: reduce) { .gl-glint, .gl-ask { animation: none; } }
`;

const esc = (t) => String(t ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const el = (tag, attrs = {}) => Object.assign(document.createElement(tag), attrs);

export { esc };

export class GoalsUI {
  constructor() {
    document.head.append(el('style', { textContent: CSS }));
    this.zone = el('div', { id: 'gl-zone' });
    this.cues = el('div', { id: 'gl-cues' });
    this.card = el('div', { className: 'gl-card', hidden: true });
    this.note = el('div', { className: 'gl-card', hidden: true });
    this.zone.append(this.card, this.note);
    document.body.append(this.cues, this.zone);
    this.collapsed = false;
    this.view = null; // what the card shows: { head, title, sub, actions: [{ label, cls, on }] }
    this.noteT = 0;
  }

  /** Show the card (or hide it with null). Actions: [{ label, cls?, on }]. Re-renders only on change. */
  show(view) {
    const key = view ? JSON.stringify([view.head, view.title, view.sub, view.actions?.map((a) => a.label)]) : '';
    if (key === this.key) { this.actions = view?.actions || []; return; }
    this.key = key;
    this.view = view;
    this.actions = view?.actions || [];
    this.card.hidden = !view;
    if (!view) return;
    this.card.classList.toggle('min', this.collapsed);
    this.card.innerHTML = `<div class="hd"><b>${esc(view.head)}</b><button class="tg" title="Hide or show (O)">${this.collapsed ? '▸' : '▾'}</button></div>
      ${this.collapsed ? `<div class="t">${view.short || view.title}</div>` : ''}
      <div class="body"><div class="t">${view.title}</div>${view.sub ? `<div class="s">${view.sub}</div>` : ''}
      ${this.actions.length ? `<div class="acts">${this.actions.map((a, i) => `<button class="${a.cls || ''}" data-i="${i}">${esc(a.label)}</button>`).join('')}</div>` : ''}</div>`;
    this.card.querySelector('.tg').onclick = () => this.toggle();
    for (const b of this.card.querySelectorAll('.acts button')) b.onclick = () => this.actions[+b.dataset.i]?.on();
  }

  /** O: fold the card down to one line, or open it again. */
  toggle(on = this.collapsed) {
    this.collapsed = !on;
    const v = this.view;
    this.key = null;
    this.show(v);
  }

  /** A short note under the card ("Found it!"), gone after `ms`. */
  toast(html, ms = 4500) {
    this.note.innerHTML = `<div class="t">${html}</div>`;
    this.note.hidden = false;
    this.note.style.opacity = '1';
    clearTimeout(this.noteTimer);
    this.noteTimer = setTimeout(() => {
      this.note.style.opacity = '0';
      this.noteTimer = setTimeout(() => { this.note.hidden = true; }, 450);
    }, ms);
  }
}
