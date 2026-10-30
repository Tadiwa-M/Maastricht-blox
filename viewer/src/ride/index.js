// Ride: buses and trains you can watch and board (docs/guide/09-player.md, "Ride").
//
// Map mode: the Transit panel lists the lines, the vehicles running now and, per stop, the next
// departures; badges float over vehicles on the map and the selected line's route is drawn on
// the city. "Ride" (or a badge) puts the camera on a passenger seat of that vehicle: it follows
// the vehicle's pose every frame (life/buses.js poses), the passenger looks around freely
// (drag / arrows / right stick), and the HUD shows the next stop. "Get off" waits for that stop
// and then drops you there in walk mode; "Jump on" from a departure board skips the clock to
// that departure. Vehicles come from life (window.__bloxLife.vehicles), so live data later only
// has to change those poses.
import * as THREE from 'three';
import { RideUI } from './ui.js';
import { RouteLines } from './routes.js';
import { seatPosition, lookTarget, outsideView, smoothYaw } from './seat.js';
import { upcomingCalls } from '../life/schedule.js';

const MARK_MAX = 80;
const LOOK_RAD_PX = 0.004, KEY_RAD_S = 1.6, PAD_RAD_S = 2.4;

export async function initRide(ctx) {
  const life = typeof window !== 'undefined' ? window.__bloxLife : null;
  if (!life || ctx.still || typeof document === 'undefined') return null;
  const { stage, controls } = ctx;
  const camera = ctx.camera || stage.camera;
  const canvas = stage.renderer.domElement;
  const touch = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  const groundAt = (x, zThree) => {
    const g = ctx.city?.groundHeight?.(x, zThree);
    return typeof g === 'number' ? g : (ctx.city?.approxGround?.(x, zThree) ?? 0);
  };
  const routeLines = new RouteLines(stage.scene, groundAt);
  const s = { open: false, line: null, tab: 'now', query: '', stop: null, ride: null, refresh: 0 };

  const ui = new RideUI({
    onOpen: (on) => { s.open = on; ui.showPanel(on); if (!on) { routeLines.show(null); ui.placeMarks([]); } refresh(true); },
    onTab: (tab) => { s.tab = tab; s.stop = null; refresh(true); },
    onLine: (i) => { s.line = i; routeLines.show(i === null ? null : routeShapes(i), tt()?.routes[i]?.colour); refresh(true); },
    onSearch: (q) => { s.query = q; s.stop = null; refresh(true); },
    onStop: (name) => { s.stop = name; refresh(true); },
    onRide: (id) => board(id),
    onJump: (dep) => jumpOn(dep),
    onGetOff: () => { if (s.ride) { s.ride.wantOff = !s.ride.wantOff; s.ride.offK = s.ride.nextK; } },
    onView: () => { if (s.ride) s.ride.outside = !s.ride.outside; },
    onFast: () => { if (s.ride && life.clock) { life.clock.speed = life.clock.speed > 1 ? 1 : 10; } },
    onExit: () => leave(),
  });
  if (!tt()) ui.open.hidden = true; // no timetable exported: nothing to show

  function tt() { return life.timetable || null; }
  function routeShapes(i) {
    const t = tt(), set = new Set();
    for (const p of t.patterns) if (p.route === i) set.add(t.shapes[p.shape]);
    return [...set];
  }
  function stopName(k) { return k >= 0 ? tt().stops[k]?.name ?? '' : ''; }

  // ------------------------------------------------------------------ panel content
  function refresh(force = false) {
    if (!s.open || !tt()) return;
    const now = performance.now();
    if (!force && now - s.refresh < 1000) return;
    s.refresh = now;
    const t = tt(), vehicles = life.vehicles || [];
    if (s.tab === 'now') {
      const counts = new Map();
      for (const v of vehicles) counts.set(v.pattern.route, (counts.get(v.pattern.route) || 0) + 1);
      const routes = t.routes.map((route, index) => ({ route, index, count: counts.get(index) || 0 }))
        .sort((a, b) => (a.route.mode === 'rail') - (b.route.mode === 'rail') || String(a.route.short).localeCompare(String(b.route.short), 'nl', { numeric: true }));
      ui.fillLines(routes, s.line);
      const rows = vehicles.filter((v) => s.line === null || v.pattern.route === s.line).map((v) => {
        const next = upcomingCalls(v.pattern, v.tRel)[0];
        return { id: v.id, route: v.route, head: v.pattern.head, next: next ? stopName(next.stop) : '', inSec: next?.inSec ?? 0 };
      }).sort((a, b) => String(a.route?.short).localeCompare(String(b.route?.short), 'nl', { numeric: true }) || a.inSec - b.inSec);
      ui.fillVehicles(rows);
    } else if (s.stop) {
      const ks = t.stops.map((st, k) => (st.name === s.stop ? k : -1)).filter((k) => k >= 0);
      const deps = ks.flatMap((k) => t.departures(k, life.clock.day, life.clock.sec, 10)).sort((a, b) => a.inSec - b.inSec).slice(0, 10);
      ui.fillDepartures(s.stop, deps);
    } else {
      const q = s.query.trim().toLowerCase();
      const names = q ? [...new Set(t.stops.map((st) => st.name))].filter((n) => n.toLowerCase().includes(q)).sort().slice(0, 30) : [];
      ui.fillStops(names, s.query.trim());
    }
  }

  // ------------------------------------------------------------------ boarding
  function board(id) {
    const v = (life.vehicles || []).find((x) => x.id === id);
    if (!v) return;
    window.__bloxPlayer?.exitWalk?.();
    s.open = false; ui.showPanel(false); routeLines.show(null); ui.placeMarks([]);
    s.ride = { id, yaw: null, look: 0, pitch: -0.05, outside: false, wantOff: false, offK: -1, nextK: -1,
      near: camera.near, fov: camera.fov };
    controls.enabled = false;
    camera.near = 0.05;
    camera.fov = 70;
    camera.updateProjectionMatrix();
    ui.showHud({ route: v.route, head: v.pattern.head, next: '', inSec: 0, strip: [], live: false });
  }

  /** From a departure board: skip the clock to just before that departure, then board it. */
  function jumpOn(dep) {
    const c = life.clock, t = tt();
    const start = t.trips[dep.trip][1];
    const sec = c.sec + dep.inSec - 3;
    c.set(c.day, sec);
    // the vehicle id is "<service day>:<row>": yesterday's after-midnight trips count from the day before
    const day = start >= 86400 ? (c.day + 6) % 7 : c.day;
    s.pendingBoard = { id: `${day}:${dep.trip}`, until: performance.now() + 3000 };
  }

  function leave(at = null) {
    const r = s.ride;
    if (!r) return;
    s.ride = null;
    camera.near = r.near; camera.fov = r.fov; camera.updateProjectionMatrix();
    controls.enabled = true;
    ui.showHud(null);
    if (life.clock && life.clock.speed > 1) life.clock.speed = 1;
    if (at) { // get off: walk from the stop
      if (window.__bloxPlayer?.enterAtUnity?.(at.x, at.z, at.yaw, at.yaw, false)) return;
    }
    const p = r.last;
    if (p) { // back to the map above the vehicle
      const t = new THREE.Vector3(p.x, p.y, -p.z);
      controls.target.copy(t);
      camera.position.copy(t).add(new THREE.Vector3(-Math.sin(p.yaw * Math.PI / 180) * 60, 70, Math.cos(p.yaw * Math.PI / 180) * 60));
      camera.lookAt(t);
      controls.update();
    }
  }

  // ------------------------------------------------------------------ input while riding
  let drag = null;
  canvas.addEventListener('pointerdown', (e) => { if (s.ride) { drag = [e.clientX, e.clientY]; e.preventDefault(); } });
  window.addEventListener('pointermove', (e) => {
    if (!s.ride || !drag) return;
    s.ride.look += (e.clientX - drag[0]) * LOOK_RAD_PX * 57.3;
    s.ride.pitch = THREE.MathUtils.clamp(s.ride.pitch - (e.clientY - drag[1]) * LOOK_RAD_PX, -1.2, 1.0);
    drag = [e.clientX, e.clientY];
  });
  window.addEventListener('pointerup', () => { drag = null; });
  const keys = new Set();
  window.addEventListener('keydown', (e) => {
    if (e.target?.tagName === 'INPUT') return;
    if (s.ride) {
      if (e.code === 'Escape') { leave(); e.stopImmediatePropagation(); return; }
      keys.add(e.code);
    } else if (e.code === 'KeyT' && !document.body.classList.contains('title')) {
      s.open = !s.open; ui.showPanel(s.open); if (!s.open) { routeLines.show(null); ui.placeMarks([]); } refresh(true);
    }
  }, true);
  window.addEventListener('keyup', (e) => keys.delete(e.code));

  // ------------------------------------------------------------------ per frame
  const v3 = new THREE.Vector3();
  function placeMarks() {
    if (!s.open || s.tab !== 'now') { ui.placeMarks([]); return; }
    const list = (life.vehicles || []).filter((v) => s.line === null || v.pattern.route === s.line);
    const cp = camera.position;
    const items = [];
    for (const v of list) {
      v3.set(v.x, v.y + (v.mode === 'rail' ? 6 : 5), -v.z);
      const d = v3.distanceTo(cp);
      v3.project(camera);
      if (v3.z > 1 || Math.abs(v3.x) > 1.05 || Math.abs(v3.y) > 1.05) continue;
      items.push({ id: v.id, route: v.route, head: v.pattern.head, d,
        sx: (v3.x + 1) / 2 * window.innerWidth, sy: (1 - v3.y) / 2 * window.innerHeight });
    }
    items.sort((a, b) => a.d - b.d);
    ui.placeMarks(items.slice(0, MARK_MAX));
  }

  function rideFrame(dt) {
    const r = s.ride;
    const v = (life.vehicles || []).find((x) => x.id === r.id);
    if (!v) { leave(); return; } // the trip ended (or left the city): back to the map above its last position
    r.last = v;
    // look input: keys and the gamepad's right stick
    const pad = navigator.getGamepads?.().find((g) => g && g.connected);
    if (pad) {
      const ax = Math.abs(pad.axes[2]) > 0.15 ? pad.axes[2] : 0, ay = Math.abs(pad.axes[3]) > 0.15 ? pad.axes[3] : 0;
      r.look += ax * PAD_RAD_S * dt * 57.3;
      r.pitch = THREE.MathUtils.clamp(r.pitch - ay * PAD_RAD_S * dt, -1.2, 1.0);
      if (pad.buttons[1]?.pressed) { leave(); return; }
    }
    if (keys.has('ArrowLeft') || keys.has('KeyQ')) r.look -= KEY_RAD_S * dt * 57.3;
    if (keys.has('ArrowRight') || keys.has('KeyE')) r.look += KEY_RAD_S * dt * 57.3;
    if (keys.has('ArrowUp')) r.pitch = Math.min(1.0, r.pitch + KEY_RAD_S * dt);
    if (keys.has('ArrowDown')) r.pitch = Math.max(-1.2, r.pitch - KEY_RAD_S * dt);
    r.yaw = smoothYaw(r.yaw, Number.isFinite(v.yaw) ? v.yaw : (r.yaw ?? 0), dt);
    // a vehicle over a spot that hasn't streamed in yet has no ground height (NaN): a NaN camera
    // poisons every matrix (and the clipping planes) and stops rendering, so fall back
    const gy = Number.isFinite(v.y) ? v.y : (Number.isFinite(r.lastY) ? r.lastY : groundAt(v.x, -v.z));
    r.lastY = gy;
    const pose = { ...v, y: gy, yaw: r.yaw };
    let from, to;
    if (r.outside) {
      const o = outsideView(pose, r.look);
      from = o.cam; to = o.target;
    } else {
      from = seatPosition(pose, v.mode);
      to = lookTarget(from, r.yaw + r.look, r.pitch);
    }
    if (![...from, ...to].every(Number.isFinite)) return; // never hand the renderer a NaN camera
    camera.position.set(...from);
    controls.target.set(...to);
    camera.lookAt(controls.target);
    // next stop, getting off
    const calls = upcomingCalls(v.pattern, v.tRel);
    const next = calls[0];
    r.nextK = next ? next.k : -1;
    // arrived at (or already past) the stop we asked for: step off there and walk
    if (r.wantOff && (!next || next.k > r.offK || (next.k === r.offK && next.inSec === 0))) {
      const stop = tt().stops[v.pattern.stops?.[r.offK]];
      if (stop) { leave({ x: stop.x, z: stop.y, yaw: r.yaw }); return; }
      r.wantOff = false;
    }
    ui.showHud({ route: v.route, head: v.pattern.head, next: next ? stopName(next.stop) : '', hasNext: !!next, inSec: next?.inSec ?? 0,
      strip: calls.slice(1, 5).map((c) => stopName(c.stop)).filter(Boolean), outside: r.outside,
      fast: (life.clock?.speed || 1) > 1, live: !!v.live, wantOff: r.wantOff }, touch);
  }

  window.__bloxRide = { board, leave, state: s, open: (on = true) => ui.h.onOpen(on) };
  return {
    update(dt) {
      if (s.pendingBoard && (life.vehicles || []).some((v) => v.id === s.pendingBoard.id)) {
        const id = s.pendingBoard.id; s.pendingBoard = null; board(id);
      } else if (s.pendingBoard && performance.now() > s.pendingBoard.until) s.pendingBoard = null;
      if (s.ride) rideFrame(dt);
      else { placeMarks(); refresh(); }
    },
  };
}

