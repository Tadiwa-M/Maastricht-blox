// Trip planner inside the 3D city, with navigation like a maps app: plan from where you stand (or
// the map's centre, or a stop) to a stop, pick an option and press "Start trip". A green racing line
// on the ground (groundline.js) leads you to the bus stop; when your bus pulls in, F boards it
// (ride/); you get off at the planned stop automatically and the line leads you on to the
// destination. "Teleport" skips the walk: the clock jumps to the first bus's departure and you sit
// on it. "End trip" stops guiding. The step logic is trip.js; the search is raptor.js.

import { TripPlanner } from './raptor.js';
import { WalkRouter } from './walk.js';
import { TripGuide } from './trip.js';
import { GroundLine } from './groundline.js';

const CSS = `
#tp-panel { position: fixed; left: 14px; top: 14px; z-index: 7; width: min(360px, calc(100vw - 28px)); max-height: calc(100vh - 110px);
  overflow: auto; background: rgba(14,17,40,.95); color: #f6f3ea; border-radius: 14px; padding: 12px 14px; font: 14px/1.4 system-ui, sans-serif;
  box-shadow: 0 10px 30px rgba(0,0,0,.4); }
#tp-panel[hidden], #tp-hud[hidden] { display: none; }
#tp-panel h3 { margin: 0 0 8px; font: 400 22px/1 'Anton', Impact, sans-serif; letter-spacing: .06em; display: flex; justify-content: space-between; }
#tp-panel h3 button { background: none; border: 0; color: #b9bcc4; font-size: 18px; cursor: pointer; }
#tp-panel .row { display: flex; gap: 6px; margin: 6px 0; align-items: center; }
#tp-panel label { width: 40px; color: #aeb2c6; font-size: 13px; }
#tp-panel input { flex: 1 1 0; width: 0; padding: 8px; border-radius: 8px; border: 0; background: #262b52; color: #f6f3ea; font: inherit; }
#tp-panel button.go { width: 100%; background: #F2A900; color: #10153a; border: 0; border-radius: 8px; padding: 9px; font: 700 15px system-ui; cursor: pointer; margin-top: 4px; }
#tp-panel .opt { background: #191d3d; border-radius: 10px; padding: 9px 10px; margin-top: 8px; }
#tp-panel .opt .t { display: flex; justify-content: space-between; font-weight: 700; }
#tp-panel .opt .chips { margin: 5px 0; display: flex; gap: 4px; align-items: center; flex-wrap: wrap; }
#tp-panel .chip { display: inline-grid; place-items: center; min-width: 24px; height: 22px; padding: 0 6px; border-radius: 5px; color: #fff; font: 800 12px system-ui; }
#tp-panel .opt .acts { display: flex; gap: 6px; margin-top: 6px; }
#tp-panel .opt .acts button { flex: 1; border: 0; border-radius: 7px; padding: 7px; cursor: pointer; font: 700 13px system-ui; background: #2c335f; color: #f6f3ea; }
#tp-panel .opt .acts button.start { background: #22c55e; color: #052e14; }
#tp-panel .fine { color: #8a8fa8; font-size: 12px; margin-top: 8px; } #tp-panel .fine a { color: #F2A900; }
#tp-hud { position: fixed; left: 50%; top: 52px; transform: translateX(-50%); z-index: 7; display: flex; gap: 10px; align-items: center;
  background: rgba(10,40,22,.92); color: #eafff1; border: 2px solid #22c55e; border-radius: 12px; padding: 8px 12px; font: 600 15px system-ui, sans-serif;
  max-width: calc(100vw - 28px); box-shadow: 0 6px 18px rgba(0,0,0,.35); }
#tp-hud button { border: 0; border-radius: 7px; padding: 6px 10px; font: 700 13px system-ui; cursor: pointer; background: #14532d; color: #eafff1; }
#tp-hud button.board { background: #F2A900; color: #10153a; }
`;
const el = (tag, attrs = {}, html = '') => Object.assign(document.createElement(tag), attrs, html ? { innerHTML: html } : {});
const hhmm = (s) => { const m = Math.floor((((s % 86400) + 86400) % 86400) / 60); return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`; };
const esc = (t) => String(t ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export async function initTrip(ctx) {
  const life = typeof window !== 'undefined' ? window.__bloxLife : null;
  if (!life || ctx.still || typeof document === 'undefined') return null;
  const { stage, controls } = ctx;
  const groundAt = (x, zThree) => {
    const approx = ctx.city?.approxGround?.(x, zThree);
    const g = ctx.city?.groundHeight?.(x, zThree, Number.isFinite(approx) ? approx + 2.5 : Infinity);
    return typeof g === 'number' ? g : (approx ?? 0);
  };
  const line = new GroundLine(stage.scene, groundAt);
  document.head.append(el('style', { textContent: CSS }));
  const panel = el('div', { id: 'tp-panel', hidden: true });
  const hud = el('div', { id: 'tp-hud', hidden: true });
  document.body.append(panel, hud);
  const s = { planner: null, walk: null, results: [], guide: null, toLabel: '', routeT: 0, routeFor: null, path: null };

  function ready() {
    const tt = life.timetable;
    if (!tt?.stops?.length) return false;
    if (!s.planner) s.planner = new TripPlanner(tt);
    if (!s.walk && life.walkDoc) s.walk = new WalkRouter(life.walkDoc);
    return true;
  }
  const player = () => window.__bloxPlayer;
  const ride = () => window.__bloxRide;
  /** Where "here" is: the walking player, else the map's centre (Unity metres). */
  function here() {
    const p = player();
    if (p?.mode === 'walk') return [p.ctrl.pos[0], -p.ctrl.pos[2]];
    const t = controls?.target;
    return t ? [t.x, -t.z] : [0, 0];
  }
  function stopPoint(name) {
    const ss = life.timetable.stops.filter((x) => x.name.toLowerCase() === name.trim().toLowerCase());
    return ss.length ? [ss.reduce((a, x) => a + x.x, 0) / ss.length, ss.reduce((a, x) => a + x.y, 0) / ss.length] : null;
  }

  // ---- the panel ---------------------------------------------------------------------------
  function open(on = panel.hidden) {
    if (on && !ready()) return;
    panel.hidden = !on;
    if (!on) return;
    const names = [...new Set(life.timetable.stops.map((x) => x.name))].sort((a, b) => a.localeCompare(b));
    panel.innerHTML = `<h3>PLAN A TRIP <button title="Close">✕</button></h3>
      <div class="row"><label>From</label><input id="tp-from" list="tp-stops" placeholder="Here (where you stand)"></div>
      <div class="row"><label>To</label><input id="tp-to" list="tp-stops" placeholder="A stop"></div>
      <datalist id="tp-stops">${names.map((n) => `<option value="${esc(n)}">`).join('')}</datalist>
      <button class="go">Plan</button><div id="tp-res"></div>
      <p class="fine">On your phone: <a href="plan.html" target="_blank">plan.html</a> (with your GPS).</p>`;
    panel.querySelector('h3 button').onclick = () => open(false);
    panel.querySelector('.go').onclick = () => plan();
    for (const i of panel.querySelectorAll('input')) i.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') plan(); });
  }

  function plan() {
    const f = panel.querySelector('#tp-from').value.trim(), t = panel.querySelector('#tp-to').value.trim();
    const from = f ? stopPoint(f) : here(), to = stopPoint(t);
    const res = panel.querySelector('#tp-res');
    if (!from || !to) { res.innerHTML = `<p class="fine">${!to ? 'Pick a stop to go to.' : `No stop called "${esc(f)}".`}</p>`; return; }
    const c = life.clock;
    s.results = s.planner.plan(from, to, c.day, c.sec, 4);
    s.from = from; s.to = to; s.toLabel = t;
    res.innerHTML = s.results.map((j, i) => `<div class="opt">
      <div class="t"><span>${hhmm(j.dep)} → ${hhmm(j.arr)}</span><span>${Math.round(j.duration / 60)} min</span></div>
      <div class="chips">${j.legs.filter((l) => l.mode === 'bus').map((l) => `<span class="chip" style="background:${esc(l.colour || '#3a3f63')}">${esc(l.line)}</span>`).join('›') || '🚶 Walk'}
        <span style="color:#aeb2c6;font-size:12px">walk ${Math.round(j.walkSec / 60)} min</span></div>
      <div class="acts"><button class="start" data-i="${i}">Start trip</button>${j.lines.length ? `<button class="tele" data-i="${i}">Teleport onto the bus</button>` : ''}</div></div>`).join('')
      || '<p class="fine">No connection found.</p>';
    for (const b of res.querySelectorAll('.start')) b.onclick = () => start(+b.dataset.i, false);
    for (const b of res.querySelectorAll('.tele')) b.onclick = () => start(+b.dataset.i, true);
  }

  // ---- the trip ----------------------------------------------------------------------------
  function start(i, teleport) {
    const j = s.results[i];
    s.guide = new TripGuide(j, s.toLabel);
    open(false);
    const p = player();
    if (teleport) {
      const k = s.guide.firstBus(), L = j.legs[k];
      s.guide.jumpTo(k);
      const c = life.clock;
      if (L.dep - c.sec > 3) c.set(c.day, L.dep - 3); // skip to the departure
      if (ride()) ride().state.pendingBoard = { id: L.vid, until: performance.now() + 4000 };
    } else if (p && p.mode !== 'walk') {
      const [x, z] = s.from; // start walking where the trip starts
      p.enterAtUnity(x, z, 0, 0, true);
    }
    s.routeFor = null;
    showHud();
  }

  function end() {
    s.guide = null; s.path = null;
    line.set(null);
    hud.hidden = true;
  }

  let boardId = null;
  function showHud(r = null) {
    hud.hidden = false;
    hud.innerHTML = `<span>${esc(r?.message || 'Starting…')}</span>${r?.canBoard ? '<button class="board">Board (F)</button>' : ''}<button class="end">End trip</button>`;
    hud.querySelector('.end').onclick = () => end();
    const b = hud.querySelector('.board');
    if (b) b.onclick = () => board();
  }
  function board() {
    if (!boardId || !ride()) return;
    ride().board(boardId);
  }
  window.addEventListener('keydown', (e) => {
    if (e.code === 'KeyF' && s.guide && boardId) { board(); e.stopImmediatePropagation(); }
  }, true);

  let lastMsg = '';
  const api = {
    open,
    end,
    get guide() { return s.guide; },
    update(dt) {
      if (s.guide) {
        const rs = ride()?.state?.ride || null;
        const r = s.guide.update({ pos: here(), sec: life.clock.sec, riding: rs?.id || null,
          vehicles: (life.vehicles || []).map((v) => ({ id: v.id, x: v.x, z: v.z })) });
        // riding the planned bus: make sure it drops us at the planned stop
        if (r.phase === 'ride' && rs && (!rs.wantOff || rs.offK !== r.offK)) { rs.wantOff = true; rs.offK = r.offK; }
        boardId = r.canBoard || null;
        const key = `${r.message}|${!!r.canBoard}`;
        if (key !== lastMsg) { lastMsg = key; showHud(r); }
        // the green line: from the player to the target, re-routed as you walk
        s.routeT -= dt;
        const pos = here();
        if (r.target && player()?.mode === 'walk') {
          const moved = !s.routeFor || Math.hypot(pos[0] - s.routeFor[0], pos[1] - s.routeFor[1]) > 4 || s.routeFor[2] !== r.target.join();
          if (moved && s.routeT <= 0) {
            const route = s.walk?.route(pos, r.target);
            line.set(route ? route.pts : [pos, r.target]);
            s.routeFor = [pos[0], pos[1], r.target.join()];
            s.routeT = 0.5;
          }
        } else if (s.routeFor) { line.set(null); s.routeFor = null; }
        if (r.phase === 'done') { line.set(null); setTimeout(() => { if (s.guide?.done) end(); }, 6000); }
      }
      line.update(dt);
    },
  };
  window.__bloxTrip = api;
  return api;
}
