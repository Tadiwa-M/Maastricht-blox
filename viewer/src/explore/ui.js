// Explore DOM: the journal button (right edge, above the report flag), the journal panel
// (walked-area map, places, golden studs, rewards), the plaque card, a small toast and the
// photo-mode bar. Built here so index.html stays the viewer core's; hidden on the title screen,
// while riding and in screenshot mode. The photo mode hides every other element on the page.
import { escapeHtml } from '../ui.js';

const CSS = `
#ex-open { position: fixed; right: 14px; bottom: calc(144px + env(safe-area-inset-bottom, 0px)); z-index: 5;
  width: 44px; height: 44px; border-radius: 50%; padding: 0; display: grid; place-items: center; cursor: pointer;
  background: rgba(18,22,30,.72); border: 1px solid rgba(255,255,255,.25); color: #f6f3ea; }
#ex-open:hover, #ex-open.on { border-color: #F2A900; color: #F2A900; }
#ex-open .dot { position: absolute; top: 3px; right: 3px; width: 9px; height: 9px; border-radius: 50%; background: #F2A900; }
#ex-open .dot[hidden] { display: none; }
#ex-journal { position: fixed; right: 14px; top: 64px; z-index: 6; box-sizing: border-box;
  width: min(340px, calc(100vw - 28px)); max-height: calc(100vh - 264px - env(safe-area-inset-bottom, 0px)); overflow: auto;
  background: rgba(17,20,58,.94); color: #f6f3ea; border-radius: 14px; padding: 14px 16px 16px;
  font: 13px/1.45 system-ui, sans-serif; box-shadow: 0 16px 40px rgba(0,0,0,.45); }
#ex-journal[hidden], #ex-card[hidden], #ex-toast[hidden], #ex-photobar[hidden] { display: none; }
#ex-journal h3 { margin: 0; font: 400 22px/1 'Anton', Impact, sans-serif; letter-spacing: .06em; display: flex; align-items: center; }
#ex-journal h3 button { margin-left: auto; background: none; border: 0; color: #b9bcc4; font: 22px/1 system-ui; cursor: pointer; padding: 0 2px; }
#ex-journal h4 { margin: 14px 0 6px; font: 700 12px system-ui, sans-serif; letter-spacing: .08em; text-transform: uppercase; color: #F2A900; }
#ex-journal canvas { width: 100%; aspect-ratio: 1; display: block; border-radius: 10px; margin-top: 10px; background: #070914; }
#ex-journal .stats { display: flex; gap: 8px; margin-top: 10px; }
#ex-journal .stat { flex: 1; background: rgba(255,255,255,.07); border-radius: 9px; padding: 7px 9px; }
#ex-journal .stat b { display: block; font: 400 20px/1.1 'Anton', Impact, sans-serif; letter-spacing: .03em; }
#ex-journal .stat span { color: #b9bcc4; font-size: 11px; }
#ex-journal .bar { height: 5px; border-radius: 3px; background: rgba(255,255,255,.1); margin-top: 6px; overflow: hidden; }
#ex-journal .bar i { display: block; height: 100%; background: #F2A900; }
#ex-journal ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 6px; }
#ex-journal li.place { background: rgba(255,255,255,.05); border-radius: 9px; padding: 7px 9px; }
#ex-journal li.place b { display: block; }
#ex-journal li.place small { color: #b9bcc4; display: block; }
#ex-journal li.none { color: #8d91ad; }
#ex-journal .chips { display: flex; flex-wrap: wrap; gap: 5px; }
#ex-journal .chip { background: rgba(242,169,0,.16); color: #ffd772; border-radius: 99px; padding: 2px 9px; font-size: 12px; }
#ex-journal .reward { display: flex; justify-content: space-between; gap: 8px; color: #8d91ad; }
#ex-journal .reward.got { color: #ffd772; }
#ex-journal .row { display: flex; gap: 8px; margin-top: 14px; }
#ex-journal .row button { flex: 1; border: 0; border-radius: 9px; padding: 9px 12px; font: 700 13px system-ui, sans-serif; cursor: pointer;
  background: #F2A900; color: #10153a; }
#ex-journal .note { color: #8d91ad; font-size: 11px; margin-top: 8px; }
#ex-card { position: fixed; right: 68px; bottom: calc(144px + env(safe-area-inset-bottom, 0px)); z-index: 5; box-sizing: border-box;
  width: min(300px, calc(100vw - 96px)); background: rgba(246,241,228,.96); color: #10153a; border-radius: 12px;
  padding: 10px 13px 11px; font: 13px/1.4 system-ui, sans-serif; box-shadow: 0 10px 28px rgba(0,0,0,.35);
  border-left: 5px solid #8a6436; animation: ex-in .35s ease-out; }
#ex-card b { display: block; font: 400 19px/1.1 'Anton', Impact, sans-serif; letter-spacing: .04em; margin-bottom: 3px; }
#ex-card .new { display: inline-block; background: #F2A900; color: #10153a; border-radius: 5px; padding: 0 6px; font: 700 10px/16px system-ui;
  letter-spacing: .06em; margin-bottom: 4px; }
#ex-toast { position: fixed; right: 68px; bottom: calc(196px + env(safe-area-inset-bottom, 0px)); z-index: 6;
  background: rgba(18,22,30,.86); color: #ffd772; padding: 6px 12px; border-radius: 9px; font: 600 13px system-ui, sans-serif;
  pointer-events: none; animation: ex-in .25s ease-out; }
@keyframes ex-in { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }
#ex-photobar { position: fixed; left: 50%; bottom: calc(16px + env(safe-area-inset-bottom, 0px)); transform: translateX(-50%); z-index: 9;
  display: flex; align-items: center; gap: 10px; background: rgba(18,22,30,.62); backdrop-filter: blur(6px); border-radius: 12px;
  padding: 6px 8px 6px 14px; color: #f6f3ea; font: 13px/1.3 system-ui, sans-serif; max-width: calc(100vw - 32px); }
#ex-photobar span { color: #b9bcc4; }
#ex-photobar button { border: 0; border-radius: 8px; padding: 7px 12px; font: 700 13px system-ui, sans-serif; cursor: pointer; white-space: nowrap; }
#ex-photobar .shoot { background: #F2A900; color: #10153a; }
#ex-photobar .done { background: rgba(255,255,255,.12); color: #fff; }
#ex-flash { position: fixed; inset: 0; z-index: 10; background: #fff; pointer-events: none; opacity: 0; transition: opacity .5s; }
body.ex-photo > :not(#view):not(#ex-photobar):not(#ex-flash) { visibility: hidden !important; }
body.title #ex-open, body.riding #ex-open, body.shot #ex-open,
body.title #ex-journal, body.riding #ex-journal, body.shot #ex-journal,
body.title #ex-card, body.riding #ex-card, body.shot #ex-card,
body.title #ex-toast, body.riding #ex-toast, body.shot #ex-toast { display: none; }
@media (max-width: 600px) { #ex-photobar span { display: none; } }
`;
const BOOK = '<svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M6 3h11a2 2 0 0 1 2 2v14a1 1 0 0 1-1 1H7a2 2 0 0 0-2 .3V5a2 2 0 0 1 1-2Zm1 2v11h10V5H7Zm2 2h6v2H9V7Zm0 3h4v2H9v-2ZM7 18a1 1 0 0 0 0 2h11v-2H7Z"/></svg>';
const el = (tag, props = {}, html = '') => Object.assign(document.createElement(tag), props, html ? { innerHTML: html } : {});

export class ExploreUI {
  /** on: { journal(open), photo(), shoot(), photoDone() } */
  constructor(on) {
    this.on = on;
    document.head.append(el('style', { textContent: CSS }));
    this.open = el('button', { id: 'ex-open', title: 'Journal: places, golden studs, map (J)', ariaLabel: 'Journal' }, `${BOOK}<i class="dot" hidden></i>`);
    this.dot = this.open.querySelector('.dot');
    this.journal = el('div', { id: 'ex-journal', hidden: true, role: 'dialog', ariaLabel: 'Journal' });
    this.journal.innerHTML = `<h3>JOURNAL <button type="button" title="Close (J)" aria-label="Close">×</button></h3>
      <canvas width="560" height="560" aria-label="Map of where you have walked"></canvas>
      <div class="stats"><div class="stat st-places"></div><div class="stat st-studs"></div></div>
      <div class="next"></div>
      <h4>Places</h4><ul class="places"></ul>
      <h4>Golden studs found</h4><div class="chips studs"></div>
      <h4>Rewards</h4><div class="rewards"></div>
      <div class="row"><button type="button" class="photo">Photo mode (P)</button></div>
      <div class="note">Walk the city to light up the map. Plaques stand in front of landmarks; golden studs hide in squares, parks, courtyards and on the hills.</div>`;
    this.canvas = this.journal.querySelector('canvas');
    this.card = el('div', { id: 'ex-card', hidden: true, role: 'status', ariaLive: 'polite' });
    this.toastEl = el('div', { id: 'ex-toast', hidden: true, role: 'status' });
    this.photobar = el('div', { id: 'ex-photobar', hidden: true });
    this.photobar.innerHTML = `<b>PHOTO</b><span class="hint">Drag to orbit · scroll to zoom · Space: postcard</span>
      <button type="button" class="shoot">Take postcard</button><button type="button" class="done">Done (P)</button>`;
    this.flash = el('div', { id: 'ex-flash' });
    document.body.append(this.open, this.journal, this.card, this.toastEl, this.photobar, this.flash);
    this.open.addEventListener('click', () => on.journal(this.journal.hidden));
    this.journal.querySelector('h3 button').addEventListener('click', () => on.journal(false));
    this.journal.querySelector('button.photo').addEventListener('click', () => on.photo());
    this.photobar.querySelector('.shoot').addEventListener('click', () => on.shoot());
    this.photobar.querySelector('.done').addEventListener('click', () => on.photoDone());
    for (const e of ['keydown', 'keyup']) this.photobar.addEventListener(e, (ev) => ev.stopPropagation());
  }

  get journalOpen() { return !this.journal.hidden; }

  showJournal(on) {
    this.journal.hidden = !on;
    this.open.classList.toggle('on', on);
    if (on) this.dot.hidden = true;
  }

  /** Fill the journal's lists. places: [{ name, text, found }], studs: [{ hint }], rewards: [{ name, studs, got }]. */
  renderJournal({ places, totalPlaces, studs, totalStuds, rewards, next }) {
    const j = this.journal;
    j.querySelector('.st-places').innerHTML = `<b>${places.length} / ${totalPlaces}</b><span>places discovered</span>`;
    j.querySelector('.st-studs').innerHTML = `<b>${studs.length} / ${totalStuds}</b><span>golden studs</span>
      <div class="bar"><i style="width:${Math.round((100 * studs.length) / Math.max(1, totalStuds))}%"></i></div>`;
    j.querySelector('.next').innerHTML = next ? `<div class="note">${next.studs - studs.length} more for: ${escapeHtml(next.name)}</div>` : '';
    j.querySelector('ul.places').innerHTML = places.length
      ? places.map((p) => `<li class="place"><b>${escapeHtml(p.name)}</b>${escapeHtml(p.text)}<small>Found ${escapeHtml(p.found)}</small></li>`).join('')
      : '<li class="none">None yet: look for the bronze plaques by the landmarks.</li>';
    j.querySelector('.studs').innerHTML = studs.length
      ? studs.map((s) => `<span class="chip">${escapeHtml(s.hint)}</span>`).join('')
      : '<span class="none" style="color:#8d91ad">None yet.</span>';
    j.querySelector('.rewards').innerHTML = rewards.map((r) =>
      `<div class="reward${r.got ? ' got' : ''}"><span>${escapeHtml(r.name)}</span><span>${r.got ? 'unlocked' : `${r.studs} studs`}</span></div>`).join('');
  }

  /** The plaque card (null hides it). */
  showCard(l, isNew, count, total) {
    if (!l) { this.card.hidden = true; this.cardId = null; return; }
    if (this.cardId === l.id) return;
    this.cardId = l.id;
    this.card.innerHTML = `${isNew ? `<span class="new">NEW PLACE · ${count} / ${total}</span>` : ''}<b>${escapeHtml(l.name)}</b>${escapeHtml(l.text)}`;
    this.card.hidden = false;
    if (isNew && this.journal.hidden) this.dot.hidden = false;
  }

  toast(text, ms = 2600) {
    this.toastEl.textContent = text;
    this.toastEl.hidden = false;
    this.toastEl.style.animation = 'none';
    void this.toastEl.offsetWidth; // restart the slide-in
    this.toastEl.style.animation = '';
    clearTimeout(this.toastT);
    this.toastT = setTimeout(() => { this.toastEl.hidden = true; }, ms);
  }

  /** Photo mode on/off: everything else on the page hides (CSS on body.ex-photo). */
  setPhoto(on) {
    document.body.classList.toggle('ex-photo', on);
    this.photobar.hidden = !on;
  }

  photoMessage(text) {
    const hint = this.photobar.querySelector('.hint');
    hint.textContent = text;
    clearTimeout(this.photoT);
    this.photoT = setTimeout(() => { hint.textContent = 'Drag to orbit · scroll to zoom · Space: postcard'; }, 3000);
  }

  doFlash() {
    this.flash.style.transition = 'none';
    this.flash.style.opacity = '0.85';
    void this.flash.offsetWidth;
    this.flash.style.transition = '';
    this.flash.style.opacity = '0';
  }
}
