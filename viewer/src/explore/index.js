// Exploration (docs/guide/15-exploration.md): plaques at real landmarks that tell a line of
// history when you walk up to them, golden studs to collect, a journal with a map that lights
// up where you have walked, and a photo mode that makes postcards.
//
// initExplore(ctx) is called once by main.js initHooks (after the report hook). It only reads
// the player (window.__bloxPlayer: mode, ctrl.pos, ctrl.yaw, state().street) and the ride
// (body.riding); progress is saved in localStorage ('blox.explore.v1').
//
// Keys: J journal, P photo mode (Space takes the postcard while in it).
import { LANDMARKS, STUDS, UNLOCKS, DATA_ORIGIN_RD } from './data.js';
import {
  shiftTo, loadState, saveState, visit, plaqueAt, touched, unlocked, newUnlocks, nextUnlock,
  formatDate, placeName,
} from './logic.js';
import { Props } from './props.js';
import { ExploreUI } from './ui.js';
import { drawMap } from './minimap.js';
import { captureView, makePostcard, sharePostcard } from './photo.js';

const TYPING = /^(INPUT|TEXTAREA|SELECT)$/;
// keys the player and other panels would act on: swallowed while taking photos (look and zoom pass)
const PHOTO_PASS = new Set(['KeyP', 'KeyQ', 'KeyE', 'Equal', 'Minus', 'NumpadAdd', 'NumpadSubtract']);

const blocked = () => document.body.classList.contains('title') || document.body.classList.contains('riding');

export async function initExplore(ctx) {
  if (ctx.still || typeof document === 'undefined') return null;
  const { stage, controls, city } = ctx;
  const camera = ctx.camera || stage.camera;
  const canvas = stage.renderer.domElement;
  const store = (() => { try { return localStorage; } catch { return null; } })();
  const originRD = ctx.originRD || window.BLOX_SITE?.originRD || ctx.world?.manifest?.originRD || DATA_ORIGIN_RD;
  // only what lies inside this world (the diorama and small slices hold part of the city)
  const box = city?.box;
  const inside = (it) => !box || (it.at[0] >= box.min.x && it.at[0] <= box.max.x && -it.at[1] >= box.min.z && -it.at[1] <= box.max.z);
  const landmarks = shiftTo(LANDMARKS, DATA_ORIGIN_RD, originRD).filter(inside);
  const studs = shiftTo(STUDS, DATA_ORIGIN_RD, originRD).filter(inside);
  const dx = DATA_ORIGIN_RD[0] - originRD[0], dz = DATA_ORIGIN_RD[1] - originRD[1];
  const mapBase = [1000 + dx, 2900 + dz, 2800 + dx, 4300 + dz];
  const unlocks = UNLOCKS.map((u) => ({ ...u, studs: Math.min(u.studs, studs.length || u.studs) }));
  const state = loadState(store, new Set(LANDMARKS.map((l) => l.id)), new Set(STUDS.map((s) => s.id)));
  const props = new Props(stage.scene, studs, landmarks, city);
  let dirty = false, lastSave = 0, cellT = 0, mapT = 0, shown = null, t = 0;
  let photo = false, shooting = false, lockedAt = 0;

  const player = () => window.__bloxPlayer;
  const walking = () => player()?.mode === 'walk';
  const studCount = () => Object.keys(state.studs).length;
  const save = () => { if (dirty) { saveState(state, store); dirty = false; lastSave = performance.now(); } };

  const ui = new ExploreUI({
    journal: (on) => setJournal(on),
    photo: () => setPhoto(true),
    shoot: () => shoot(),
    photoDone: () => setPhoto(false),
  });

  function journalData() {
    const found = landmarks.filter((l) => state.places[l.id]).sort((a, b) => state.places[b.id] - state.places[a.id]);
    const n = studCount();
    return {
      places: found.map((l) => ({ name: l.name, text: l.text, found: formatDate(new Date(state.places[l.id])) })),
      totalPlaces: landmarks.length,
      studs: studs.filter((s) => state.studs[s.id]).map((s) => ({ hint: s.hint })),
      totalStuds: studs.length,
      rewards: unlocks.map((u) => ({ name: u.name, studs: u.studs, got: n >= u.studs })),
      next: nextUnlock(unlocks, n),
    };
  }
  function me() {
    const p = player();
    if (walking()) return { x: p.ctrl.pos[0], z: -p.ctrl.pos[2], yaw: p.ctrl.yaw };
    return { x: controls.target.x, z: -controls.target.z, yaw: Math.atan2(controls.target.x - camera.position.x, camera.position.z - controls.target.z) };
  }
  function refreshMap() {
    drawMap(ui.canvas, state, landmarks.filter((l) => state.places[l.id]), me(), mapBase);
  }
  function setJournal(on) {
    if (on && blocked()) return;
    ui.showJournal(on);
    if (on) {
      player()?.input?.releaseLock?.();
      ui.renderJournal(journalData());
      refreshMap();
    }
  }

  // ---- photo mode ----------------------------------------------------------------------
  function setPhoto(on) {
    if (on === photo || (on && blocked())) return;
    photo = on;
    if (on) ui.showJournal(false);
    ui.setPhoto(on);
  }
  async function shoot() {
    if (!photo || shooting) return;
    shooting = true;
    try {
      const date = new Date();
      const m = me();
      const place = placeName(landmarks, m.x, m.z, walking() ? player().state?.().street : '');
      const url = captureView(canvas, () => stage.render(controls.target));
      ui.doFlash();
      const blob = await makePostcard(url, place, date);
      const how = await sharePostcard(blob, place, date);
      ui.photoMessage(how === 'shared' ? 'Postcard shared.' : how === 'saved' ? 'Postcard saved to your downloads.' : 'Not shared.');
    } catch (e) {
      console.error('explore photo', e);
      ui.photoMessage(`Could not make the postcard: ${e.message}`);
    } finally {
      shooting = false;
    }
  }

  // ---- keys ----------------------------------------------------------------------------
  document.addEventListener('pointerlockchange', () => { lockedAt = performance.now(); });
  // capture phase on window: runs before the player's and the panels' own key handlers
  window.addEventListener('keydown', (e) => {
    if (TYPING.test(e.target?.tagName || '') || e.ctrlKey || e.metaKey || e.altKey) return;
    if (photo) {
      if (e.code === 'Space') { e.preventDefault(); if (!e.repeat) shoot(); }
      else if (e.code === 'Escape' && !document.pointerLockElement && performance.now() - lockedAt > 300) setPhoto(false);
      if (!PHOTO_PASS.has(e.code)) { e.stopImmediatePropagation(); return; }
    }
    if (e.repeat) return;
    if (e.code === 'KeyJ' && !photo) setJournal(ui.journal.hidden);
    else if (e.code === 'KeyP') setPhoto(!photo);
  }, true);
  window.addEventListener('pagehide', save);
  document.addEventListener('visibilitychange', () => { if (document.hidden) save(); });

  // ---- per frame -----------------------------------------------------------------------
  function collect(id) {
    const before = studCount();
    state.studs[id] = Date.now();
    dirty = true;
    props.pop(id);
    const after = studCount();
    const s = studs.find((x) => x.id === id);
    ui.toast(`Golden stud ${after} / ${studs.length}${s ? ` · ${s.hint}` : ''}`);
    for (const u of newUnlocks(unlocks, before, after)) {
      setTimeout(() => ui.toast(`Unlocked: ${u.name}`, 3500), 1400);
      window.dispatchEvent(new CustomEvent('blox:unlock', { detail: { id: u.id, name: u.name } }));
    }
    if (ui.journalOpen) ui.renderJournal(journalData());
  }

  function update(dt) {
    t += dt;
    const hide = blocked();
    props.setVisible(!hide);
    if (hide) { if (photo) setPhoto(false); ui.showCard(null); if (ui.journalOpen) ui.showJournal(false); return; }
    props.update(dt, t, camera, state.studs);
    const p = player();
    if (walking() && p.ctrl) {
      const x = p.ctrl.pos[0], y = p.ctrl.pos[1], z = -p.ctrl.pos[2];
      if ((cellT -= dt) <= 0) { cellT = 0.3; if (visit(state, x, z)) dirty = true; }
      const id = plaqueAt(landmarks, x, z, shown, (l) => y - l.y);
      if (id !== shown) {
        shown = id;
        const l = id && landmarks.find((it) => it.id === id);
        const isNew = !!l && !state.places[id];
        if (isNew) { state.places[id] = Date.now(); dirty = true; }
        ui.showCard(l || null, isNew, Object.keys(state.places).length, landmarks.length);
        if (isNew && ui.journalOpen) ui.renderJournal(journalData());
      }
      for (const sid of touched(studs, state.studs, x, y, z, (s) => props.studGround(s.id) ?? s.y)) collect(sid);
    } else if (shown) { shown = null; ui.showCard(null); }
    if (ui.journalOpen && (mapT -= dt) <= 0) { mapT = 0.5; refreshMap(); }
    if (dirty && performance.now() - lastSave > 4000) save();
  }

  window.__bloxExplore = {
    state: () => ({ places: Object.keys(state.places).length, studs: studCount(), cells: state.cells.size,
      totalPlaces: landmarks.length, totalStuds: studs.length, photo }),
    unlocked: () => unlocked(unlocks, studCount()).map((u) => u.id),
    journal: setJournal,
    photo: setPhoto,
    /** Landmarks in this world for the pause-menu map: { id, name, at: [x, z] Unity m, anchor (the building), found }. */
    landmarks: () => landmarks.map((l) => ({ id: l.id, name: l.name, at: [...l.at], anchor: l.anchor ? [...l.anchor] : null, found: !!state.places[l.id] })),
    get journalOpen() { return !!ui.journalOpen; },
  };
  return { update };
}
