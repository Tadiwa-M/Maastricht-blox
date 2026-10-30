// Ride UI (DOM): the Transit button, the side panel (lines, vehicles running now, stop departure
// boards), map badges over vehicles, and the passenger HUD while riding. Logic lives in
// ride/index.js; this file only builds and fills elements.
import { waitLabel } from '../life/schedule.js';

const CSS = `
#rd-open { position: fixed; left: 14px; bottom: 14px; z-index: 5; display: flex; align-items: center; gap: 8px;
  background: #F2A900; color: #10153a; border: 0; border-radius: 12px; padding: 10px 16px 10px 12px; cursor: pointer;
  font: 700 15px system-ui, sans-serif; box-shadow: 0 3px 0 #9a6a00, 0 8px 18px rgba(0,0,0,.3); }
#rd-open[hidden], #rd-panel[hidden], #rd-hud[hidden], .rd-mark[hidden] { display: none; }
#rd-panel { position: fixed; left: 14px; bottom: 72px; top: 14px; z-index: 6; width: min(360px, calc(100vw - 28px));
  display: flex; flex-direction: column; background: rgba(14,17,40,.94); backdrop-filter: blur(10px); color: #f6f3ea;
  border-radius: 14px; box-shadow: 0 10px 30px rgba(0,0,0,.4); font: 13px/1.35 system-ui, sans-serif; overflow: hidden; }
#rd-panel header { display: flex; align-items: center; gap: 10px; padding: 14px 14px 10px; }
#rd-panel header h3 { margin: 0; font: 400 22px/1 'Anton', Impact, sans-serif; letter-spacing: .06em; flex: 1; }
.rd-badge { font: 700 10px/1 system-ui, sans-serif; letter-spacing: .08em; padding: 4px 7px; border-radius: 5px; background: #3a3f63; color: #cfd3ea; }
.rd-badge.live { background: #1f9d55; color: #fff; }
#rd-panel .x { background: none; border: 0; color: #b9bcc4; font-size: 20px; cursor: pointer; padding: 0 4px; }
.rd-tabs { display: flex; gap: 6px; padding: 0 14px 8px; }
.rd-tabs button { flex: 1; background: rgba(255,255,255,.08); color: #f6f3ea; border: 0; border-radius: 8px; padding: 7px; cursor: pointer; font: 600 13px system-ui; }
.rd-tabs button.on { background: #F2A900; color: #10153a; }
.rd-lines { display: flex; flex-wrap: wrap; gap: 5px; padding: 0 14px 10px; }
.rd-chip { display: inline-grid; place-items: center; min-width: 26px; height: 24px; padding: 0 6px; border-radius: 6px; box-sizing: border-box;
  font: 800 12px/1 system-ui, sans-serif; color: #fff; border: 2px solid transparent; cursor: pointer; text-shadow: 0 1px 2px rgba(0,0,0,.4); }
.rd-chip.on { border-color: #fff; }
.rd-chip.all { background: #3a3f63; }
.rd-list { flex: 1; overflow: auto; padding: 0 8px 10px; }
.rd-row { display: flex; align-items: center; gap: 10px; padding: 8px 6px; border-radius: 8px; cursor: pointer; }
.rd-row:hover { background: rgba(255,255,255,.06); }
.rd-row .t { flex: 1; min-width: 0; }
.rd-row .t b { display: block; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.rd-row .t span { color: #b9bcc4; font-size: 12px; }
.rd-go { background: #F2A900; color: #10153a; border: 0; border-radius: 8px; padding: 7px 12px; font: 700 12px system-ui; cursor: pointer; white-space: nowrap; }
.rd-search { margin: 0 14px 8px; padding: 9px 11px; border-radius: 9px; border: 0; background: rgba(255,255,255,.1); color: #fff; font: 14px system-ui; }
.rd-empty { color: #b9bcc4; padding: 14px; text-align: center; }
.rd-mark { position: fixed; z-index: 4; transform: translate(-50%, -100%); border: 2px solid #fff; cursor: pointer;
  box-shadow: 0 2px 8px rgba(0,0,0,.4); }
#rd-hud { position: fixed; top: 14px; left: 50%; transform: translateX(-50%); z-index: 6; width: min(520px, calc(100vw - 28px));
  background: rgba(14,17,40,.9); backdrop-filter: blur(10px); color: #f6f3ea; border-radius: 14px; padding: 12px 14px;
  box-sizing: border-box; font: 13px/1.35 system-ui, sans-serif; box-shadow: 0 10px 30px rgba(0,0,0,.35); }
#rd-hud .top { display: flex; align-items: center; gap: 10px; }
#rd-hud .head { flex: 1; font-weight: 700; font-size: 15px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
#rd-hud .next { margin: 8px 0 2px; font: 400 26px/1.05 'Anton', Impact, sans-serif; letter-spacing: .03em; }
#rd-hud .next small { display: block; font: 600 11px system-ui, sans-serif; letter-spacing: .14em; color: #F2A900; margin-bottom: 2px; }
#rd-hud .strip { display: flex; gap: 6px; flex-wrap: wrap; color: #b9bcc4; font-size: 12px; margin-bottom: 10px; }
#rd-hud .strip span::after { content: '›'; margin-left: 6px; color: #5d628a; }
#rd-hud .strip span:last-child::after { content: ''; }
#rd-hud .btns { display: flex; gap: 6px; flex-wrap: wrap; }
#rd-hud .btns button { background: rgba(255,255,255,.1); color: #fff; border: 0; border-radius: 8px; padding: 8px 11px; font: 600 12px system-ui; cursor: pointer; }
#rd-hud .btns button.main { background: #F2A900; color: #10153a; }
#rd-hud .btns button.on { outline: 2px solid #F2A900; }
#rd-hud .hint { color: #8d91ad; font-size: 11px; margin-top: 8px; }
body.riding #pl-bar, body.riding #pl-back, body.riding #rd-open, body.riding #pl-compass, body.riding #hud, body.riding #info { display: none !important; }
body.title #rd-open, body.title #rd-panel, body.title .rd-mark { visibility: hidden; }
@media (max-width: 600px) { #rd-panel { top: auto; height: 62vh; bottom: 70px; } #rd-hud .next { font-size: 22px; } }
`;

const el = (tag, props = {}, html = '') => Object.assign(document.createElement(tag), props, html ? { innerHTML: html } : {});
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const BUS_SVG = '<svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M5 3h14a2 2 0 0 1 2 2v11a2 2 0 0 1-1 1.7V20a1 1 0 0 1-1 1h-1a1 1 0 0 1-1-1v-1H7v1a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-2.3A2 2 0 0 1 3 16V5a2 2 0 0 1 2-2Zm0 2v6h14V5H5Zm2 8.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3Zm10 0a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3Z"/></svg>';

/** A route chip: number on the route colour (trains: "Train"). */
export function chipHtml(route, extra = '') {
  const label = route?.mode === 'rail' ? 'Train' : route?.short ?? '?';
  return `<span class="rd-chip ${extra}" style="background:${esc(route?.colour || '#1F6FB2')}">${esc(label)}</span>`;
}

export class RideUI {
  /** h: { onOpen(open), onRide(vehicleId), onLine(routeIndex|null), onStop(stopName), onJump(dep), onGetOff(), onView(), onFast(), onExit() } */
  constructor(h) {
    this.h = h;
    document.head.append(el('style', { textContent: CSS }));
    this.open = el('button', { id: 'rd-open', title: 'Buses and trains: see them live and ride along (T)' }, `${BUS_SVG}<span>Transit</span>`);
    this.open.addEventListener('click', () => h.onOpen(true));
    this.panel = el('div', { id: 'rd-panel', hidden: true },
      `<header><h3>TRANSIT</h3><span class="rd-badge">SCHEDULED</span><button class="x" title="Close">✕</button></header>
      <div class="rd-tabs"><button data-tab="now" class="on">Running now</button><button data-tab="stops">Stops</button></div>
      <div class="rd-lines"></div><input class="rd-search" placeholder="Search a stop, e.g. Markt" hidden>
      <div class="rd-list"></div>`);
    this.panel.querySelector('.x').addEventListener('click', () => h.onOpen(false));
    this.badge = this.panel.querySelector('.rd-badge');
    this.lines = this.panel.querySelector('.rd-lines');
    this.list = this.panel.querySelector('.rd-list');
    this.search = this.panel.querySelector('.rd-search');
    this.tab = 'now';
    for (const b of this.panel.querySelectorAll('.rd-tabs button')) {
      b.addEventListener('click', () => this.setTab(b.dataset.tab));
    }
    this.search.addEventListener('input', () => h.onSearch?.(this.search.value));
    this.search.addEventListener('keydown', (e) => e.stopPropagation()); // typing must not walk or pan
    this.hud = el('div', { id: 'rd-hud', hidden: true });
    this.marks = [];
    document.body.append(this.open, this.panel, this.hud);
  }

  setTab(tab) {
    this.tab = tab;
    for (const b of this.panel.querySelectorAll('.rd-tabs button')) b.classList.toggle('on', b.dataset.tab === tab);
    this.search.hidden = tab !== 'stops';
    this.lines.hidden = tab !== 'now';
    this.h.onTab?.(tab);
  }

  showPanel(on) { this.panel.hidden = !on; this.open.hidden = on; }

  setLive(live) { this.badge.textContent = live ? 'LIVE' : 'SCHEDULED'; this.badge.classList.toggle('live', live); }

  /** routes: [{ route, index, count }]; selected: index | null. */
  fillLines(routes, selected) {
    this.lines.innerHTML = `<span class="rd-chip all ${selected === null ? 'on' : ''}" data-i="">All</span>`
      + routes.map((r) => chipHtml(r.route, selected === r.index ? 'on' : '').replace('<span ', `<span data-i="${r.index}" title="${esc(r.route.long || '')}" `)).join('');
    for (const c of this.lines.querySelectorAll('.rd-chip')) {
      c.addEventListener('click', () => this.h.onLine(c.dataset.i === '' ? null : +c.dataset.i));
    }
  }

  /** rows: [{ id, route, head, next, inSec }] (vehicles running now). */
  fillVehicles(rows) {
    if (!rows.length) { this.list.innerHTML = '<div class="rd-empty">Nothing running right now on this line.</div>'; return; }
    this.list.innerHTML = rows.map((r) => `<div class="rd-row" data-id="${esc(r.id)}">${chipHtml(r.route)}
      <div class="t"><b>→ ${esc(r.head)}</b><span>${r.next ? `Next: ${esc(r.next)} · ${waitLabel(r.inSec)}` : 'On the way'}</span></div>
      <button class="rd-go">Ride</button></div>`).join('');
    for (const row of this.list.querySelectorAll('.rd-row')) row.addEventListener('click', () => this.h.onRide(row.dataset.id));
  }

  /** stops: [name] matching the search. */
  fillStops(names, query) {
    if (!query) { this.list.innerHTML = '<div class="rd-empty">Type a stop name to see the next buses and trains.</div>'; return; }
    if (!names.length) { this.list.innerHTML = `<div class="rd-empty">No stop called “${esc(query)}”.</div>`; return; }
    this.list.innerHTML = names.map((n) => `<div class="rd-row" data-n="${esc(n)}"><div class="t"><b>${esc(n)}</b><span>Departures</span></div></div>`).join('');
    for (const row of this.list.querySelectorAll('.rd-row')) row.addEventListener('click', () => this.h.onStop(row.dataset.n));
  }

  /** deps: [{ route, head, inSec, key }] for stop `name`. */
  fillDepartures(name, deps) {
    const rows = deps.map((d, n) => `<div class="rd-row" data-n="${n}">${chipHtml(d.route)}
      <div class="t"><b>→ ${esc(d.head)}</b><span>${waitLabel(d.inSec)}</span></div><button class="rd-go">Jump on</button></div>`).join('');
    this.list.innerHTML = `<div class="rd-row" data-back="1"><div class="t"><b>‹ ${esc(name)}</b><span>Next departures</span></div></div>`
      + (rows || '<div class="rd-empty">No departures in the next 3 hours.</div>');
    this.list.querySelector('[data-back]').addEventListener('click', () => this.h.onSearch?.(this.search.value));
    for (const row of this.list.querySelectorAll('.rd-row[data-n]')) row.addEventListener('click', () => this.h.onJump(deps[+row.dataset.n]));
  }

  /** Badges over vehicles on the map. items: [{ id, route, sx, sy }] (screen px), others hidden. */
  placeMarks(items) {
    while (this.marks.length < items.length) {
      const m = el('button', { className: 'rd-chip rd-mark' });
      m.addEventListener('click', (e) => { e.stopPropagation(); this.h.onRide(m.dataset.id); });
      document.body.append(m);
      this.marks.push(m);
    }
    this.marks.forEach((m, n) => {
      const it = items[n];
      m.hidden = !it;
      if (!it) return;
      m.dataset.id = it.id;
      m.style.left = `${it.sx}px`; m.style.top = `${it.sy}px`;
      const label = it.route?.mode === 'rail' ? 'Train' : String(it.route?.short ?? '');
      if (m.textContent !== label) m.textContent = label;
      m.style.background = it.route?.colour || '#1F6FB2';
      m.title = `${label} → ${it.head || ''}: click to ride`;
    });
  }

  /** Riding HUD. s: { route, head, next, inSec, strip: [names], getOff: name|null, outside, fast, live } or null. */
  showHud(s, touch = false) {
    document.body.classList.toggle('riding', !!s);
    this.hud.hidden = !s;
    if (!s) return;
    const key = JSON.stringify([s.route?.short, s.head, s.next, s.hasNext, waitLabel(s.inSec), s.strip, s.getOff, s.outside, s.fast, s.live, s.wantOff]);
    if (key === this.hudKey) return;
    this.hudKey = key;
    const look = touch ? 'Drag to look around' : 'Drag the mouse (or use the arrow keys) to look around';
    this.hud.innerHTML = `<div class="top">${chipHtml(s.route)}<div class="head">→ ${esc(s.head)}</div>
      <span class="rd-badge ${s.live ? 'live' : ''}">${s.live ? 'LIVE' : 'SCHEDULED'}</span></div>
      <div class="next"><small>${s.wantOff ? 'GETTING OFF AT' : 'NEXT STOP'}</small>${s.hasNext
        ? `${esc(s.next || 'Next stop')} · ${waitLabel(s.inSec)}` : 'End of the line'}</div>
      <div class="strip">${s.strip.map((n) => `<span>${esc(n)}</span>`).join('')}</div>
      <div class="btns">${s.hasNext ? `<button class="main" data-a="off">${s.wantOff ? 'Stay on' : `Get off at ${esc(s.next || 'the next stop')}`}</button>` : ''}
      <button data-a="view" class="${s.outside ? 'on' : ''}">${s.outside ? 'Inside view' : 'Outside view'}</button>
      <button data-a="fast" class="${s.fast ? 'on' : ''}">⏩ Fast</button><button data-a="exit">✕ Map</button></div>
      <div class="hint">${look} · Esc or B: back to the map</div>`;
    const act = { off: this.h.onGetOff, view: this.h.onView, fast: this.h.onFast, exit: this.h.onExit };
    for (const b of this.hud.querySelectorAll('button[data-a]')) b.addEventListener('click', () => act[b.dataset.a]());
  }
}
