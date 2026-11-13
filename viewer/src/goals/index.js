// Light goals, navigation cues and the first minute (docs/guide/17-goals.md).
//
// initGoals(ctx) is called once by main.js initHooks (after the report hook). It only reads the
// other tracks' public objects: window.__bloxPlayer (mode, state, ctrl), window.__bloxRide
// (state.ride), window.__bloxTrip (guide: no offers during a planned trip), window.__bloxLife (clock, vehicles, timetable,
// walkers, walkDoc) and ctx.features. One goal at a time, always optional: an offer card at the top
// right ("Sure" / "Not now"), then the objective card (O folds it). The hint is a faint golden beam
// on the destination plus an edge glint when it is off screen; the green ground line only when
// the player asks for the route.
import { builtAt } from '../player/spot.js';
import { placesFromFeatures } from '../plan/places.js';
import { WalkRouter } from '../plan/walk.js';
import { GroundLine } from '../plan/groundline.js';
import { upcomingCalls } from '../life/schedule.js';
import {
  dist, compassWord, distLabel, clockLabel, hhmm, weekDelta, weighted, pickTourist, touristLimit, askLine, placeLabel,
  pickBus, busWindow, BusWatch, goldenOpen, pickViewpoint, toSunset, SUNSET_H, ARRIVE_M, loadTally, saveTally, bump,
} from './logic.js';
import { VIEWPOINTS, TOWERS, MARKT, locateSpot } from './spots.js';
import { Flow } from './flow.js';
import { Beam, EdgeGlint, AskPin, TowerLabels } from './cues.js';
import { GoalsUI, esc } from './ui.js';

const ASK_RADIUS_M = 28;

export async function initGoals(ctx) {
  if (ctx.still || typeof document === 'undefined') return null;
  const { stage, controls } = ctx;
  const camera = ctx.camera || stage.camera;
  const store = (() => { try { return localStorage; } catch { return null; } })();
  let tally = loadTally(store);
  const flow = new Flow({ prompted: !!tally.prompted, off: !!tally.off });
  const ui = new GoalsUI();
  const beam = new Beam(stage.scene);
  const glint = new EdgeGlint(ui.cues);
  const askPin = new AskPin(ui.cues);
  const touch = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  const studM = ctx.world?.studM || 0.5;
  const originRD = window.BLOX_SITE?.originRD || ctx.originRD || ctx.world?.manifest?.originRD || [175700, 316500];
  const groundAt = (x, zThree) => {
    const approx = ctx.city?.approxGround?.(x, zThree);
    const g = ctx.city?.groundHeight?.(x, zThree, Number.isFinite(approx) ? approx + 2.5 : Infinity);
    return typeof g === 'number' ? g : (approx ?? 0);
  };
  const built = (x, z) => builtAt(ctx.city, x, z);
  const life = () => window.__bloxLife || null;
  const player = () => window.__bloxPlayer || null;
  const rideState = () => window.__bloxRide?.state?.ride || null;
  const walking = () => player()?.mode === 'walk' && !rideState();
  const title = () => document.body.classList.contains('title');

  /** Where "you" are (Unity metres): the walking player, else the map's centre. */
  function here() {
    const p = player();
    if (p?.mode === 'walk' && p.ctrl) return [p.ctrl.pos[0], -p.ctrl.pos[2]];
    const t = controls?.target;
    return t ? [t.x, -t.z] : [0, 0];
  }

  // ---- data that streams in (features.json arrives after the first frames) -----------------
  const known = { n: -1, rows: [], towers: null, views: [], markt: null };
  function refreshData() {
    const n = ctx.features?.size || 0;
    if (n === known.n) return;
    known.n = n;
    const feats = () => (n ? ctx.features.values() : []);
    known.rows = n ? placesFromFeatures(feats(), studM) : [];
    known.views = VIEWPOINTS.map((s) => locateSpot(s, feats(), originRD, studM));
    known.markt = locateSpot(MARKT, feats(), originRD, studM);
    for (const t of known.towers?.items || []) t.pin.remove();
    known.towers = new TowerLabels(ui.cues, TOWERS.map((s) => locateSpot(s, feats(), originRD, studM)), groundAt);
  }
  refreshData();

  // ---- offers -------------------------------------------------------------------------------
  let offer = null, goal = null, recent = [];
  let line = null, router = null, routeOn = false, routeFor = null, routeT = 0; // the green line on request

  /** The tourist: the nearest passer-by within ASK_RADIUS_M (life/walkers.js members). */
  function nearestWalker(at) {
    const w = life()?.walkers;
    if (!w?.members) return null;
    let best = null, bd = ASK_RADIUS_M;
    for (const m of w.members()) {
      const d = Math.hypot(m.x - at[0], m.z - at[1]);
      if (d > 2 && d < bd) { bd = d; best = m; }
    }
    return best;
  }

  function touristOffer(pos) {
    const p = pickTourist(known.rows, pos, { built, recent: new Set(recent) });
    if (!p) return null;
    return { kind: 'tourist', place: p, npc: walking() ? nearestWalker(pos) : null };
  }
  function busOffer(pos) {
    const L = life(), c = L?.clock;
    if (!L?.timetable || !c) return null;
    const b = pickBus(L.timetable, pos, c.day, c.sec, { built });
    return b ? { kind: 'bus', bus: b, madeT: c.t } : null;
  }
  function goldenOffer(pos) {
    const c = life()?.clock;
    if (!c || !goldenOpen(c.hours)) return null;
    const v = pickViewpoint(known.views, pos, { built });
    return v ? { kind: 'golden', spot: v } : null;
  }

  /** Something to offer now, or null. first: the very first offer is the gentlest (a tourist). */
  function makeOffer(first = false) {
    refreshData();
    const pos = here();
    if (first) return touristOffer(pos) || goldenOffer(pos) || busOffer(pos);
    const kinds = [[touristOffer, 1.5], [busOffer, 1], [goldenOffer, 2]];
    while (kinds.length) {
      const k = weighted(kinds, (x) => x[1]);
      const o = k[0](pos);
      if (o) return o;
      kinds.splice(kinds.indexOf(k), 1);
    }
    return null;
  }

  function showOffer(o) {
    offer = o;
    if (!o) return;
    const pos = here();
    if (o.kind === 'tourist') {
      o.view = () => ({ head: o.npc ? 'A tourist asks' : 'A visitor asks', title: `“${esc(askLine(o.place))}”`,
        sub: `${distLabel(dist(pos, [o.place.x, o.place.z]))} ${compassWord(o.place.x - pos[0], o.place.z - pos[1])} of here`,
        short: esc(placeLabel(o.place)), actions: offerActions('Show them the way') });
    } else if (o.kind === 'bus') {
      const b = o.bus;
      o.view = () => {
        const c = life()?.clock, left = b.inSec - (c ? weekDelta(c.t, o.madeT) : 0);
        return { head: 'Catch a bus', title: `Catch ${chip(b)} to <b>${esc(b.to.name)}</b>`,
          sub: `From ${esc(b.from.name)} at ${hhmm(b.at)}${left > 30 ? ` (in ${Math.round(left / 60)} min)` : ''}`,
          short: `${chip(b)} to ${esc(b.to.name)}`, actions: offerActions("I'll catch it") };
      };
    } else {
      const s = o.spot;
      o.view = () => {
        const c = life()?.clock;
        return { head: 'Golden hour', title: `Watch the sunset from <b>${esc(s.name)}</b>`,
          sub: `Sunset at ${hhmm(SUNSET_H * 3600)}${c ? `, in ${Math.round(toSunset(c.sec) / 60)} min` : ''} · ${distLabel(dist(pos, [s.x, s.z]))} ${compassWord(s.x - pos[0], s.z - pos[1])}`,
          short: esc(s.name), actions: offerActions("Let's go") };
      };
    }
  }

  function offerActions(yes) {
    return [
      { label: yes, cls: 'go', on: () => accept() },
      { label: 'Not now', on: () => { offer = null; flow.declined(); } },
      { label: 'No goals', cls: 'lnk', on: () => { offer = null; setOff(true); } },
    ];
  }

  function setOff(off) {
    flow.off = off;
    tally = saveTally(store, { ...tally, off: off || undefined });
    if (off) ui.toast(touch ? 'No more goal offers.' : 'No more goal offers. Press O to turn them back on.', 5000);
  }

  // ---- the running goal ---------------------------------------------------------------------
  function accept() {
    const o = offer;
    offer = null;
    flow.taken();
    if (!o) return;
    const c = life()?.clock;
    if (o.kind === 'tourist') {
      const p = o.place;
      recent = [p.name, ...recent].slice(0, 8);
      goal = { kind: 'tourist', name: placeLabel(p), target: [p.x, p.z], t: 0, limit: touristLimit(p.d), r: ARRIVE_M };
      if (o.npc) ui.toast('“Thank you! I’ll follow you.”', 3000);
    } else if (o.kind === 'bus') {
      const b = o.bus;
      const t0 = o.madeT ?? c?.t ?? 0;
      goal = { kind: 'bus', bus: b, watch: new BusWatch(b), depT: t0 + b.inSec, until: t0 + busWindow(b), phase: 'walk' };
    } else {
      const s = o.spot;
      goal = { kind: 'golden', name: s.name, target: [s.x, s.z], r: s.r || 40 };
    }
    setRoute(false);
  }

  function finish(ok, msg) {
    const kind = goal?.kind;
    goal = null;
    setRoute(false);
    beam.set(null);
    flow.ended();
    if (ok) {
      tally = saveTally(store, bump(tally, kind));
      ui.toast(`${msg}<div class="s">Goals done: ${tally.total}</div>`);
    } else if (msg) ui.toast(msg);
  }

  /** Where the cues point now (Unity [x, z]) and the card's text. */
  function goalTarget() {
    if (!goal) return null;
    if (goal.kind === 'bus') return goal.phase === 'walk' ? [goal.bus.from.x, goal.bus.from.z] : [goal.bus.to.x, goal.bus.to.z];
    return goal.target;
  }

  function goalView() {
    const pos = here(), tg = goalTarget(), c = life()?.clock;
    const where = tg ? `${distLabel(dist(pos, tg))} ${compassWord(tg[0] - pos[0], tg[1] - pos[1])}` : '';
    const acts = [{ label: routeOn ? 'Hide route' : 'Show route', on: () => setRoute(!routeOn) }, { label: 'Drop it', on: () => finish(false, '') }];
    if (goal.kind === 'tourist') {
      return { head: 'Tourist', title: `Take them to <b>${esc(goal.name)}</b>`, short: esc(goal.name),
        sub: `${where} · ${clockLabel(goal.limit - goal.t)} left`, actions: acts };
    }
    if (goal.kind === 'golden') {
      return { head: 'Golden hour', title: `Reach <b>${esc(goal.name)}</b> before sunset`, short: esc(goal.name),
        sub: `${where} · sunset in ${c ? Math.max(0, Math.round(toSunset(c.sec) / 60)) : '?'} min`, actions: acts };
    }
    const b = goal.bus;
    if (goal.phase === 'riding') {
      return { head: 'Catch a bus', title: `On ${chip(b)}: get off at <b>${esc(b.to.name)}</b>`, short: `${chip(b)} to ${esc(b.to.name)}`,
        sub: `Press “Get off” when ${esc(b.to.name)} is the next stop`, actions: acts.slice(1) };
    }
    const left = c ? weekDelta(goal.depT, c.t) : b.inSec;
    return { head: 'Catch a bus', title: `Catch ${chip(b)} to <b>${esc(b.to.name)}</b>`, short: `${chip(b)} to ${esc(b.to.name)}`,
      sub: `${esc(b.from.name)} · ${left > 30 ? `leaves ${hhmm(b.at)} (${Math.round(left / 60)} min)` : left > -60 ? 'due now' : 'or the next one'} · ${where}`,
      actions: acts };
  }

  /** What the ride reports for the bus goal: { line, atStop } or null (life/schedule.js calls). */
  function rideInfo() {
    const r = rideState(), L = life();
    if (!r || !L) return null;
    const v = (L.vehicles || []).find((x) => x.id === r.id);
    if (!v) return { line: null, atStop: null };
    const next = upcomingCalls(v.pattern, v.tRel)[0];
    const atStop = next && next.inSec === 0 ? L.timetable?.stops?.[next.stop]?.name ?? null : null;
    return { line: String(v.route?.short ?? ''), atStop };
  }

  function stepGoal(dt) {
    if (!goal) return;
    const pos = here(), c = life()?.clock;
    if (goal.kind === 'tourist') {
      goal.t += dt;
      if (walking() && dist(pos, goal.target) <= goal.r) finish(true, `“That’s it, thank you!” ${esc(goal.name)} found.`);
      else if (goal.t >= goal.limit) finish(false, 'The tourist found someone else to ask. No harm done.');
    } else if (goal.kind === 'golden') {
      if (walking() && dist(pos, goal.target) <= goal.r) finish(true, `Golden hour at ${esc(goal.name)}. Lovely.`);
      else if (c && toSunset(c.sec) <= 0) finish(false, 'The sun has set. Another evening, perhaps.');
    } else {
      const st = goal.watch.update({ ride: rideInfo(), pos: player()?.mode === 'walk' ? pos : null });
      if (st === 'done') { finish(true, `Bus ${esc(goal.bus.line)} to ${esc(goal.bus.to.name)}: nicely done.`); return; }
      goal.phase = st === 'riding' ? 'riding' : 'walk';
      if (st !== 'riding' && c && weekDelta(goal.until, c.t) < 0) finish(false, 'That bus is long gone. Another time.');
    }
  }

  // ---- the green line, only on request ------------------------------------------------------
  function setRoute(on) {
    routeOn = on;
    routeFor = null;
    if (!on) line?.set(null);
    else if (!line) line = new GroundLine(stage.scene, groundAt);
  }
  function stepRoute(dt) {
    if (!line) return;
    const tg = goalTarget();
    routeT -= dt;
    if (routeOn && tg && walking()) {
      const pos = here();
      const moved = !routeFor || Math.hypot(pos[0] - routeFor[0], pos[1] - routeFor[1]) > 4 || routeFor[2] !== tg.join();
      if (moved && routeT <= 0) {
        if (!router && life()?.walkDoc) router = new WalkRouter(life().walkDoc);
        const r = router?.route(pos, tg);
        line.set(r ? r.pts : [pos, tg]);
        routeFor = [pos[0], pos[1], tg.join()];
        routeT = 0.5;
      }
    } else if (routeFor) { line.set(null); routeFor = null; }
    line.update(dt);
  }

  // ---- the card -------------------------------------------------------------------------------
  let prompt = false, idle = false;
  function cardView() {
    if (prompt) {
      return { head: 'Welcome to Maastricht', title: `${touch ? 'Double-tap' : 'Double-click'} the <b>Markt</b> to walk there`,
        sub: 'Or anywhere else in town. The golden light marks the Markt.', short: 'Walk on the Markt',
        actions: [{ label: 'OK', on: () => { prompt = false; } }] };
    }
    if (offer) return offer.view();
    if (goal) return goalView();
    if (idle) {
      return { head: 'Goals', title: 'No goal right now', short: 'Goals',
        sub: `Goals done so far: ${tally.total}${flow.off ? ' · offers are off' : ''}`,
        actions: [{ label: 'Find one', cls: 'go', on: () => findOne() },
          { label: flow.off ? 'Offers on' : 'Offers off', on: () => setOff(!flow.off) }, { label: 'Close', on: () => { idle = false; } }] };
    }
    return null;
  }
  function findOne() {
    idle = false;
    const o = makeOffer();
    if (o) { flow.offerT = 0; showOffer(o); } else ui.toast('Nothing to do just here. Try somewhere busier, or later.');
  }

  window.addEventListener('keydown', (e) => {
    if (e.code !== 'KeyO' || e.repeat || e.ctrlKey || e.metaKey || e.altKey || title()) return;
    if (/INPUT|TEXTAREA|SELECT/.test(e.target?.tagName || '')) return;
    if (!offer && !goal && !prompt) { idle = !idle; ui.collapsed = false; } else ui.toggle();
  });

  // DOM cues are placed after the frame is drawn, when the camera is final (the player and the ride
  // set it inside stage.render)
  const render = stage.render.bind(stage);
  stage.render = (target) => {
    render(target);
    placeCues();
  };
  function placeCues() {
    const w = window.innerWidth, h = window.innerHeight, t = title();
    const on = !t && (walking() || !!rideState());
    glint.update(camera, on && goal ? beam.target : null, w, h);
    known.towers?.update(camera, on, w, h);
    askPin.update(camera, !t && offer?.kind === 'tourist' ? offer.npc : null, w, h);
  }

  // ---- per frame ------------------------------------------------------------------------------
  let groundT = 0;
  const api = {
    get goal() { return goal; },
    get offer() { return offer; },
    get tally() { return tally; },
    flow,
    offerNow: () => findOne(),
    accept: () => accept(),
    drop: () => finish(false, ''),
    setOff: (off) => setOff(off), // goal offers on/off (the pause menu)
    update(dt) {
      if ((groundT -= dt) <= 0) { groundT = 2; refreshData(); }
      const p = player();
      const ev = flow.update({ dt, title: title(), mode: p?.mode || 'map', riding: !!rideState(), busy: !!goal || !!window.__bloxTrip?.guide }); // a planned trip is busy too
      for (const e of ev) {
        if (e === 'prompt') { prompt = true; tally = saveTally(store, { ...tally, prompted: true }); }
        else if (e === 'unprompt') prompt = false;
        else if (e === 'offer') { const o = makeOffer(!tally.total && !recent.length); if (o) showOffer(o); else flow.retry(); }
        else if (e === 'unoffer') offer = null;
      }
      if (prompt && p?.mode === 'walk') prompt = false;
      // the tourist stands still while asking
      if (offer?.kind === 'tourist' && offer.npc) {
        const m = nearestTo(offer.npc);
        if (m) { offer.npc = m; const g = life()?.walkers?.groups?.[m.g]; if (g) g.pause = Math.max(g.pause || 0, 1.5); }
      }
      stepGoal(dt);
      // the beam: on the goal's target, or on the Markt during the first-minute prompt
      const tg = goalTarget() || (prompt && known.markt ? [known.markt.x, known.markt.z] : null);
      if (tg) beam.set(tg[0], tg[1], groundAt(tg[0], -tg[1]));
      else beam.set(null);
      const viewer = walking() ? here() : [camera.position.x, -camera.position.z];
      beam.update(dt, viewer, camera);
      stepRoute(dt);
      ui.show(title() ? null : cardView());
    },
  };

  /** The same tourist next frame (people move; the walker list is rebuilt as groups recycle). */
  function nearestTo(m) {
    const w = life()?.walkers;
    if (!w?.members) return null;
    let best = null, bd = 3;
    for (const q of w.members()) {
      const d = Math.hypot(q.x - m.x, q.z - m.z);
      if (d < bd) { bd = d; best = q; }
    }
    return best;
  }

  window.__bloxGoals = api;
  return api;
}

function chip(b) {
  return `<span class="gl-chip" style="background:${esc(b.colour)}">${esc(b.line)}</span>`;
}
