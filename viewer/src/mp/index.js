// Multiplayer capture the flag (docs/guide/18-multiplayer.md). initMultiplayer(ctx) is called
// once by main.js (initHooks). A room lives on the relay (window.BLOX_SITE.relay) as a Durable
// Object (relay/src/room.js) that decides flags and score; this side sends my position ~10 Hz,
// draws the others (view.js), spawns me at my base in walk mode, knocks me down when I'm tagged
// and runs the soft boundary. Without room support on the relay (404) the Play button only says
// "Multiplayer coming soon".
//
// URL hash: #mp=ABCD fills in a room code to join.
import { MpUi } from './ui.js';
import { RoomView } from './view.js';
import { MatchModel } from './model.js';
import { Boundary, inArena } from './arena.js';
import { probe, createRoom, checkRoom, Connection } from './net.js';
import { posMessage, newPid, parseCode, cleanNick, rdToUnity, threeToRd, toThree, NICK_KEY, PID_KEY } from './protocol.js';
import { loadChoices, encodeChoices } from '../figure/custom.js';
import { Combat } from './combat.js';

const SEND_S = 0.1, IDLE_SEND_S = 1, SPAWN_GIVE_UP_S = 20;
const STATUS = { connecting: 'Connecting...', on: '', reconnecting: 'Connection lost: reconnecting...' };

const storage = (kind) => { try { return window[kind]; } catch { return null; } };
const get = (s, k) => { try { return s?.getItem(k) || ''; } catch { return ''; } };
const set = (s, k, v) => { try { s?.setItem(k, v); } catch { /* private mode */ } };

export async function initMultiplayer(ctx) {
  if (ctx.still || typeof document === 'undefined' || /[?&]shot=1/.test(location.search)) return null;
  const { stage, controls, city } = ctx;
  const camera = ctx.camera || stage.camera;
  const relay = (window.BLOX_SITE?.relay || '').replace(/\/$/, '');
  // the wire is RD metres: this world's origin turns them into its Unity / three.js metres
  const origin = window.BLOX_SITE?.originRD || ctx.originRD || ctx.world?.manifest?.originRD || [175700, 316500];
  const local = storage('localStorage'), session = storage('sessionStorage');
  // one player id per tab (two tabs are two players), kept across reloads to come back as the same one
  let pid = get(session, PID_KEY);
  if (!pid) { pid = newPid(); set(session, PID_KEY, pid); }
  let nick = get(local, NICK_KEY);
  const hashCode = parseCode(new URLSearchParams(location.hash.replace(/^#/, '')).get('mp'));
  const player = () => window.__bloxPlayer;
  const ground = (x, z) => { const g = city?.groundHeight?.(x, z); return typeof g === 'number' ? g : null; };
  const look = () => { const ch = loadChoices(location.hash, local); return ch ? encodeChoices(ch) : ''; };

  const lastWeapon = new Map();
  let conn = null, model = null, view = null, status = '', combat = null, basesKey = '';
  let sendT = 0, idleT = 0, lastSent = null, lastSentAt = 0;
  let spawn = null; // { at: { x, z, yaw }, t } waiting for the ground there to load
  const boundary = new Boundary();

  const ui = new MpUi({
    open: async () => {
      if (ui.availability === 'ok' || conn) return;
      ui.setAvailability(await probe(relay));
    },
    create: async (n) => {
      remember(n);
      ui.message('Making a room...');
      const r = await createRoom(relay);
      if (r.error) ui.message(r.error); else connect(r.code);
    },
    join: async (n, code) => {
      remember(n);
      ui.message('Looking for the room...');
      const r = await checkRoom(relay, code);
      if (r.error) ui.message(r.error);
      else if (r.full) ui.message('That room is full (8 players)');
      else connect(code);
    },
    start: () => conn?.send({ t: 'start' }),
    leave: () => { conn?.leave(); teardown(); ui.renderStart(); },
  }, { nick, code: hashCode || '' });
  ui.setAvailability('unknown');
  setTimeout(async () => ui.setAvailability(await probe(relay)), hashCode ? 0 : 2500);
  if (hashCode) ui.show(true);

  function remember(n) { nick = cleanNick(n); set(local, NICK_KEY, nick); }

  function connect(code) {
    model = new MatchModel();
    view = view || new RoomView(stage.scene, ground, origin);
    combat = combat || new Combat({ scene: stage.scene, camera, city, origin, player, send: (m) => conn?.send(m), toast: (t) => ui.toast(t),
      // every other player on screen, for the gun at their side (the weapon they last fired)
      figures: () => (model && view ? model.players.filter((p) => p.id !== model.me && p.on && view.others.get(p.id)?.prev)
        .map((p) => { const o = view.others.get(p.id); return { id: p.id, pos: [o.pose.x, o.pose.y, o.pose.z], yaw: -o.pose.rotY, team: p.team, w: lastWeapon.get(p.id) || 'rifle', hidden: !!o.scatter }; }) : []),
      // living enemies as the room last drew them (three.js feet)
      enemies: () => (model && view ? model.players.filter((p) => p.team !== model.team && p.on && view.others.get(p.id)?.prev && !view.others.get(p.id).scatter)
        .map((p) => { const o = view.others.get(p.id); return { id: p.id, pos: [o.pose.x, o.pose.y, o.pose.z], scale: o.variant?.scale || 1 }; }) : []) });
    conn = new Connection({ relay, code, who: () => ({ pid, name: nick, look: look() }), onMessage, onStatus });
    ui.renderRoom(model, STATUS.connecting);
  }

  function teardown(message = '') {
    conn?.stop();
    conn = null; model = null; spawn = null; basesKey = '';
    combat?.dispose(); combat = null;
    view?.dispose(); view = null;
    ui.pill(null); ui.warn(null);
    if (message) { ui.renderStart(message); ui.show(true); }
  }

  function onStatus(s, reason) {
    if (s === 'lost') { teardown('Lost the connection to the room.'); return; }
    if (s === 'closed') { teardown(reason === 'full' ? 'That room is full' : 'The room has closed.'); return; }
    status = STATUS[s] ?? '';
    if (model) ui.renderRoom(model, status);
  }

  function onMessage(m) {
    if (!model) return;
    const now = performance.now();
    for (const e of model.apply(m)) {
      if (e.k === 'pos') view.push(e.id, e.p, e.yaw, e.speed, now);
      else if (e.k === 'spawn' && e.at) { spawn = { at: e.at, t: 0 }; boundary.reset(); combat?.respawn(model.config?.hp || 100); }
      else if (e.k === 'take') combat?.taken(e.i, e.mine, e.s);
      else if (e.k === 'shot') { lastWeapon.set(e.by, e.w); combat?.tracer(toThree(e.o, origin), toThree(e.e, origin), e.w); }
      else if (e.k === 'hurt') combat?.hurt(e.hp);
      else if (e.k === 'hitmark') combat?.hitmark(e.kill);
      else if (e.k === 'killed') { knockMe(e.by); combat?.killed(model.config?.respawnS || 4, () => { const at = model?.spawn(); if (at && model.phase === 'play') { spawn = { at, t: 0 }; boundary.reset(); } }); }
      else if (e.k === 'knock') knockMe(e.by);
      else if (e.k === 'scatter') view.scatter(e.id, e.by === model.me ? player()?.state?.().pos : view.posOf(e.by));
      else if (e.k === 'toast') ui.toast(e.text, e.big);
    }
    const key = JSON.stringify(model.config?.bases || '');
    if (key !== basesKey && model.config) { basesKey = key; view.setBases(model.config); combat?.setBases(model.config.bases); } // bases move between rounds
    if (combat && model.team) { combat.setTeam(model.team); combat.range = model.config?.shotRangeM; }
    if (m.t === 'welcome') {
      // back after a reload in the middle of a match: on the map, so start at the base again
      if (m.rejoin && m.phase === 'play' && player()?.mode !== 'walk' && !spawn) { const at = model.spawn(); if (at) spawn = { at, t: 0 }; }
    }
    if (m.t === 'welcome' || m.t === 'state') ui.renderRoom(model, status);
  }

  /** Tagged: my figure pops apart away from the one who ran into me (player knockDown). */
  function knockMe(by) {
    const p = player(), st = p?.state?.();
    if (!st || st.mode !== 'walk') return;
    const from = view.posOf(by) || [st.pos[0], st.pos[1], st.pos[2] + 1];
    const d = [st.pos[0] - from[0], st.pos[2] - from[2]], L = Math.hypot(...d) || 1;
    p.knockDown?.([(d[0] / L) * 4, 3, (d[1] / L) * 4]);
  }

  /** Stand me at my base; if that part of the city isn't loaded yet, fly the map there first. */
  function trySpawn(dt) {
    const p = player();
    if (!p) return;
    const [x, z] = rdToUnity([spawn.at.x, spawn.at.z], origin), yaw = spawn.at.yaw;
    if (ground(x, -z) !== null && p.enterNearUnity(x, z, yaw, yaw, p.mode !== 'walk')) { spawn = null; lastSent = null; return; }
    if (spawn.t === 0) {
      if (p.mode === 'walk') p.exitWalk(true);
      const g = city?.approxGround?.(x, -z) ?? 0;
      controls.target.set(x, g, -z);
      camera.position.set(x + 50, g + 70, -z + 50);
      controls.update();
      city?.focus?.(x, -z);
    }
    spawn.t += dt;
    if (spawn.t > SPAWN_GIVE_UP_S) { spawn = null; ui.toast('Your base is still loading: walk there from the map'); }
  }

  function sendPosition(st, dt) {
    sendT -= dt; idleT -= dt;
    if (!conn?.live || st?.mode !== 'walk' || sendT > 0) return;
    sendT = SEND_S;
    const now = performance.now();
    const moved = !lastSent || Math.hypot(st.pos[0] - lastSent.pos[0], st.pos[1] - lastSent.pos[1], st.pos[2] - lastSent.pos[2]) > 0.02
      || Math.abs(st.yaw - lastSent.yaw) > 0.01;
    if (!moved && idleT > 0) return; // standing still: once a second is enough
    const speed = lastSent ? Math.hypot(st.pos[0] - lastSent.pos[0], st.pos[2] - lastSent.pos[2]) / Math.max(0.05, (now - lastSentAt) / 1000) : 0;
    conn.send(posMessage(st.pos, st.yaw, Math.min(speed, 12), origin));
    lastSent = { pos: st.pos, yaw: st.yaw }; lastSentAt = now; idleT = IDLE_SEND_S;
  }

  function runBoundary(st, dt) {
    if (model.phase !== 'play' || st?.mode !== 'walk' || spawn || !model.config) { ui.warn(null); boundary.reset(); return; }
    const r = boundary.update(inArena(model.config, threeToRd(st.pos, origin)), dt);
    ui.warn(r.warn, model.baseName(model.team));
    if (r.teleport) { const at = model.spawn(); if (at) spawn = { at, t: 0 }; }
  }

  // names over heads go where the figures were just drawn (the player moves the camera in its render)
  const render = stage.render.bind(stage);
  stage.render = (target) => { render(target); combat?.afterRender(); if (view && model) view.placeLabels(camera, model); };

  // for checks and tuning from the console
  window.__bloxMp = { get model() { return model; }, get combat() { return combat; }, get view() { return view; } };

  let lastT = 0;
  return {
    update(dt) {
      // timers run on the wall clock: a slow phone (frames longer than the 0.1 s dt cap) keeps time
      const t = performance.now(), real = lastT ? Math.min(1, (t - lastT) / 1000) : dt;
      lastT = t;
      if (!model) return;
      const st = player()?.state?.();
      if (spawn) trySpawn(real);
      sendPosition(st, real);
      runBoundary(st, real);
      combat?.update(real, st, model.phase === 'play' && st?.mode === 'walk' && !spawn && !window.__bloxMenu?.isOpen);
      view.update(dt, performance.now(), camera, model, st?.mode === 'walk' ? { pos: st.pos, yaw: st.yaw } : null);
      ui.pill(model, Date.now());
    },
  };
}
