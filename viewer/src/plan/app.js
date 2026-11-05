// The phone trip planner (plan.html): no 3D city, just the timetable, a location and a
// destination. Loads world/life/transit.json (the same file the game uses), asks the relay
// for live delays, and plans with raptor.js. Your location is used on the phone only (to find
// nearby stops); it is never sent anywhere.

import { Timetable } from '../life/schedule.js';
import { LiveFeed } from '../life/live.js';
import { zonedWeekTime } from '../life/clock.js';
import { TripPlanner } from './raptor.js';
import { gpsToUnity } from './geo.js';

const site = window.BLOX_SITE || null;
const $ = (id) => document.getElementById(id);
const hhmm = (s) => { const m = Math.floor((((s % 86400) + 86400) % 86400) / 60); return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`; };
const mins = (s) => Math.max(0, Math.round(s / 60));
const esc = (t) => String(t ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const state = { tt: null, planner: null, live: null, from: null, to: null, fromLabel: '', toLabel: '', results: [], open: -1, at: null };

function status(text, kind = '') { const e = $('pl-status'); e.textContent = text; e.className = kind; e.hidden = !text; }

async function load() {
  if (!site?.life) { status('This build has no timetable (run blox life and a site build).', 'err'); return; }
  status('Loading the timetable…');
  const doc = await (await fetch(`${site.base}life/transit.json`)).json();
  if (!(doc.version >= 2) || !doc.stops?.length) { status('This timetable is too old for planning (needs a fresh blox life).', 'err'); return; }
  state.tt = new Timetable(doc);
  state.planner = new TripPlanner(state.tt);
  const names = [...new Set(doc.stops.map((s) => s.name))].sort((a, b) => a.localeCompare(b));
  $('pl-stops').innerHTML = names.map((n) => `<option value="${esc(n)}">`).join('');
  if (site.relay) {
    state.live = new LiveFeed(site.relay, state.tt);
    if (state.live.usable) { state.live.start(); setInterval(() => state.results.length && plan(false), 30000); }
  }
  status('');
  restore();
}

/** A stop name -> the middle of its stops (a name often has several platforms). */
function stopPoint(name) {
  const ss = state.tt.stops.filter((s) => s.name.toLowerCase() === name.trim().toLowerCase());
  if (!ss.length) return null;
  return [ss.reduce((a, s) => a + s.x, 0) / ss.length, ss.reduce((a, s) => a + s.y, 0) / ss.length];
}

function locate() {
  if (!navigator.geolocation) { status('This browser has no location.', 'err'); return; }
  status('Finding you…');
  navigator.geolocation.getCurrentPosition((pos) => {
    const p = gpsToUnity(pos.coords.latitude, pos.coords.longitude, site.originRD || [175700, 316500]);
    if (!state.planner.near(p[0], p[1], 1500).length) { status('You seem to be outside Maastricht (the area this planner covers).', 'err'); return; }
    state.from = p; state.fromLabel = 'My location';
    $('pl-from').value = 'My location';
    status('');
    if (state.to) plan();
  }, (e) => status(e.code === 1 ? 'Location blocked: allow it in the browser, or type a stop.' : 'Could not get your location.', 'err'),
  { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 });
}

function readInputs() {
  const f = $('pl-from').value.trim(), t = $('pl-to').value.trim();
  if (f && f !== 'My location') { state.from = stopPoint(f); state.fromLabel = f; }
  if (t) { state.to = stopPoint(t); state.toLabel = t; }
  if (!state.from) { status(f ? `No stop called "${f}"` : 'Where from? Use your location or a stop.', 'err'); return false; }
  if (!state.to) { status(t ? `No stop called "${t}"` : 'Where to? Type a stop.', 'err'); return false; }
  return true;
}

function when() {
  const now = zonedWeekTime(new Date());
  const v = $('pl-time').value;
  if (!v) return now;
  const [h, m] = v.split(':').map(Number);
  return { day: now.day, sec: h * 3600 + m * 60 };
}

function plan(fromInputs = true) {
  if (!state.planner) return;
  if (fromInputs && !readInputs()) return;
  const t = when();
  state.at = t;
  state.results = state.planner.plan(state.from, state.to, t.day, t.sec, 4);
  if (fromInputs) state.open = -1;
  save();
  render();
}

function legHtml(l) {
  if (l.mode === 'walk') {
    const to = l.to.name ? `to ${esc(l.to.name)}` : 'to your destination';
    return `<li class="walk"><span class="ic">🚶</span><span>Walk ${mins(l.arr - l.dep)} min (${l.dist} m) ${to}</span></li>`;
  }
  const live = l.live ? '<span class="live">LIVE</span>' : '';
  return `<li class="bus"><span class="chip" style="background:${esc(l.colour || '#3a3f63')}">${esc(l.line)}</span>
    <span><b>${hhmm(l.dep)}</b> from ${esc(l.from.name)} → ${esc(l.head)} ${live}<br>
    ${l.stops} stop${l.stops === 1 ? '' : 's'}, get off at <b>${esc(l.to.name)}</b> (${hhmm(l.arr)})</span></li>`;
}

function render() {
  const out = $('pl-results');
  if (!state.results.length) { out.innerHTML = state.at ? '<p class="none">No connection found.</p>' : ''; return; }
  const now = zonedWeekTime(new Date()).sec;
  out.innerHTML = state.results.map((j, i) => {
    const leave = j.dep - now;
    const leaveTxt = $('pl-time').value ? `Leave ${hhmm(j.dep)}` : leave <= 30 ? 'Leave now' : `Leave in ${mins(leave)} min`;
    const chips = j.lines.length
      ? j.legs.filter((l) => l.mode === 'bus').map((l) => `<span class="chip" style="background:${esc(l.colour || '#3a3f63')}">${esc(l.line)}</span>`).join('<span class="arr">›</span>')
      : '<span class="walkonly">🚶 Walk</span>';
    return `<article class="${i === state.open ? 'open' : ''}" data-i="${i}">
      <div class="top"><span class="leave ${leave < 120 && !$('pl-time').value ? 'soon' : ''}">${leaveTxt}</span>
        <span class="dur">${mins(j.duration)} min</span></div>
      <div class="mid">${chips}${j.live ? '<span class="live">LIVE</span>' : ''}</div>
      <div class="bot">${hhmm(j.dep)} → ${hhmm(j.arr)} · walk ${mins(j.walkSec)} min${j.transfers ? ` · ${j.transfers} transfer${j.transfers > 1 ? 's' : ''}` : ''}</div>
      <ol class="legs">${j.legs.map(legHtml).join('')}</ol></article>`;
  }).join('');
  for (const a of out.querySelectorAll('article')) a.addEventListener('click', () => { state.open = state.open === +a.dataset.i ? -1 : +a.dataset.i; render(); });
}

// remember the last trip (on this phone only)
function save() { try { localStorage.setItem('blox.plan', JSON.stringify({ from: state.fromLabel, to: state.toLabel })); } catch { /* private mode */ } }
function restore() {
  try {
    const s = JSON.parse(localStorage.getItem('blox.plan') || 'null');
    if (s?.to) $('pl-to').value = s.to;
    if (s?.from && s.from !== 'My location') $('pl-from').value = s.from;
  } catch { /* nothing saved */ }
}

$('pl-me').addEventListener('click', locate);
$('pl-go').addEventListener('click', () => plan());
$('pl-swap').addEventListener('click', () => {
  const f = $('pl-from').value, t = $('pl-to').value;
  $('pl-from').value = t; $('pl-to').value = f === 'My location' ? '' : f;
  [state.from, state.to] = [state.to, state.from];
});
$('pl-from').addEventListener('input', () => { if ($('pl-from').value !== 'My location') state.from = null; });
$('pl-to').addEventListener('input', () => { state.to = null; });
for (const id of ['pl-from', 'pl-to']) $(id).addEventListener('keydown', (e) => { if (e.key === 'Enter') plan(); });
setInterval(() => state.results.length && render(), 15000); // the "leave in" countdown
load().catch((e) => status(`Could not load the timetable: ${e.message}`, 'err'));
