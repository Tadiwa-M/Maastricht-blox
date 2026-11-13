// The pause menu (src/menu/): a small button top-right on every screen, Esc and the gamepad's
// Start open it. While it is open the game stands still (player input off, the life clock slowed
// to almost nothing) behind a dimmed backdrop; on PC in walk mode the mouse is freed and caught
// again on Resume. Losing the pointer lock in walk mode (the browser's own Esc) opens it too.
//
// Entries start the other modules through their window APIs (__bloxPlayer, __bloxExplore,
// __bloxTrip, __bloxGoals, the multiplayer button), Settings shows the #hud panel's controls
// (moved in while the page is up; on phones #hud is hidden otherwise), Map is the full-screen
// map with fast travel (map.js, travel.js). API: window.__bloxMenu { isOpen, open(page), close(), toggle() }.
import { MENU_CSS } from './style.js';
import { menuItems, moveFocus, PAUSED_SPEED, resumeSpeed } from './items.js';
import { MapScreen, builtMask } from './map.js';
import { mergeStops, segmentTiles, PointGrid, headingFrom } from './mapdata.js';
import { Travel } from './travel.js';
import { builtAt } from '../player/spot.js';
import { isTouchDevice } from '../player/hud.js';
import { fmtHours } from '../ui.js';

const el = (tag, props = {}, html = '') => Object.assign(document.createElement(tag), props, html ? { innerHTML: html } : {});

export async function initMenu(ctx) {
  if (ctx.still || typeof document === 'undefined' || /[?&]shot=1/.test(location.search)) return null;
  const { stage, controls, city } = ctx;
  const camera = ctx.camera || stage.camera;
  document.head.append(el('style', { textContent: MENU_CSS }));
  document.body.classList.add('bx-has-menu');

  const player = () => window.__bloxPlayer;
  const explore = () => window.__bloxExplore;
  const life = () => window.__bloxLife;
  const riding = () => !!window.__bloxRide?.state?.ride;
  const title = () => document.body.classList.contains('title');
  const match = () => document.body.classList.contains('mp-match');
  const walking = () => player()?.mode === 'walk';
  const touch = () => isTouchDevice();

  // ---- DOM ------------------------------------------------------------------------------
  const btn = el('button', { id: 'bx-menu-btn', type: 'button', title: 'Menu (Esc)' }, '<span><i></i><i></i></span>');
  btn.setAttribute('aria-label', 'Menu');
  const root = el('div', { id: 'bx-menu', hidden: true });
  root.setAttribute('role', 'dialog'); root.setAttribute('aria-label', 'Game menu');
  const main = el('div', { className: 'bx-page bx-main' },
    '<div class="bx-card"><div class="bx-brand"><b>Maastricht</b><span>Blox<i></i><i></i><i></i><i></i></span></div>'
    + '<div class="bx-stripe"><i></i><i></i><i></i></div><div class="bx-head"><h2>Paused</h2></div><div class="bx-where"></div><div class="bx-items"></div></div>');
  const settings = el('div', { className: 'bx-page bx-settings', hidden: true },
    '<div class="bx-card"><div class="bx-head"><h2>Settings</h2><button class="bx-back" type="button">Back</button></div><div class="bx-slot"></div></div>');
  const mapPage = el('div', { className: 'bx-page bx-map', hidden: true }, `<canvas></canvas>
    <div class="bx-maptop"><button class="bx-back" type="button">Back</button><h2>Map</h2><button class="bx-back resume" type="button">Resume</button></div>
    <div class="bx-zoom"><button class="zin" type="button" aria-label="Zoom in">+</button><button class="zout" type="button" aria-label="Zoom out">&minus;</button><button class="me" type="button" aria-label="Centre on you">You</button></div>
    <div class="bx-legend"><span><i style="background:#F2A900"></i>Bus stop</span><span><i style="background:#EF3340;transform:rotate(45deg)"></i>Landmark</span><span><i style="background:#3567d6"></i>Maas</span><span>Tap to travel</span></div>
    <div class="bx-sheet" hidden><div class="t"></div><button class="no" type="button">Cancel</button><button class="go" type="button">Go</button></div>`);
  root.append(main, settings, mapPage);
  const fade = el('div', { id: 'bx-fade' }, '<span></span>');
  document.body.append(btn, root, fade);
  // keep the menu's own taps and drags off the canvas, the touch stick and the map controls
  for (const ev of ['pointerdown', 'pointermove', 'pointerup', 'wheel', 'touchstart', 'touchmove', 'dblclick', 'contextmenu']) {
    root.addEventListener(ev, (e) => e.stopPropagation(), { passive: true });
  }

  // ---- state ----------------------------------------------------------------------------
  let isOpen = false, page = 'main', openedAt = 0, savedSpeed = null, relockOnResume = false;
  let hudHome = null, hudCollapsed = false, intentionalUnlockAt = -1e9, photoSeenAt = -1e9;

  // the player's lock release goes through here, so a lock lost by other means (the browser's
  // Esc, switching windows) can be told apart and pause the game
  const wrapRelease = () => {
    const inp = player()?.input;
    if (!inp || inp.__menuWrapped) return;
    const orig = inp.releaseLock.bind(inp);
    inp.releaseLock = () => { intentionalUnlockAt = performance.now(); orig(); };
    inp.__menuWrapped = true;
  };
  wrapRelease();
  document.addEventListener('pointerlockchange', () => {
    if (document.pointerLockElement) return;
    const now = performance.now();
    if (isOpen || title() || !walking() || riding() || now - intentionalUnlockAt < 500 || travel.busy) return;
    if (explore()?.state?.().photo) return;
    open('main', { relock: true });
  });

  function where() {
    const p = player(), clock = life()?.clock;
    const bits = [];
    if (p?.mode === 'walk') { const s = p.state?.().street; if (s) bits.push(s); }
    if (clock?.hours != null) bits.push(fmtHours(clock.hours));
    if (riding()) bits.push('on board');
    return bits.join(' · ');
  }

  function renderMain() {
    const has = { player: !!player(), explore: !!explore(), trip: !!window.__bloxTrip, goals: !!window.__bloxGoals,
      mp: !!document.getElementById('mp-open') };
    const list = menuItems({ has, goalsOff: !!window.__bloxGoals?.flow?.off, touch: touch(), match: match() });
    const box = main.querySelector('.bx-items');
    box.innerHTML = '';
    for (const it of list) {
      const b = el('button', { type: 'button', className: `bx-item${it.id === 'resume' ? ' primary' : ''}` });
      b.dataset.id = it.id;
      const label = el('span'); label.textContent = it.label;
      if (it.sub) { const s = el('small'); s.textContent = it.sub; label.append(s); }
      b.append(label);
      if (it.key) { const k = el('kbd'); k.textContent = it.key; b.append(k); }
      b.addEventListener('click', () => choose(it.id));
      box.append(b);
    }
    main.querySelector('.bx-where').textContent = where();
  }

  function showPage(p) {
    if (page === 'settings' && p !== 'settings') unhostHud();
    page = p;
    main.hidden = p !== 'main'; settings.hidden = p !== 'settings'; mapPage.hidden = p !== 'map';
    if (p === 'main') { renderMain(); focusFirst(); }
    if (p === 'settings') { hostHud(); settings.querySelector('.bx-back').focus({ preventScroll: true }); }
    if (p === 'map') openMap();
  }

  function focusFirst() {
    if (touch()) return; // no focus ring under a finger
    main.querySelector('.bx-item')?.focus({ preventScroll: true });
  }

  // ---- open / close ---------------------------------------------------------------------
  function open(p = 'main', { relock = false } = {}) {
    if (title()) return;
    wrapRelease();
    if (!isOpen) {
      isOpen = true; openedAt = performance.now();
      relockOnResume = relock || (walking() && !!player()?.input?.locked);
      player()?.input?.releaseLock?.();
      root.hidden = false;
      document.body.classList.add('bx-paused');
      const clock = life()?.clock;
      if (clock && !match()) { savedSpeed = clock.speed; clock.speed = PAUSED_SPEED; }
    }
    showPage(p);
  }

  function close({ resume = true } = {}) {
    if (!isOpen) return;
    showPage('main');
    isOpen = false;
    root.hidden = true;
    document.body.classList.remove('bx-paused');
    const clock = life()?.clock;
    if (clock && savedSpeed != null) clock.speed = resumeSpeed(savedSpeed, clock.speed);
    savedSpeed = null;
    document.activeElement?.blur?.();
    if (resume && relockOnResume && walking() && !touch()) player()?.input?.requestLock?.();
    relockOnResume = false;
  }

  /** Esc / Start / the button. Closes a panel that has no Esc of its own first. */
  function toggle() {
    if (isOpen) { if (page !== 'main') showPage('main'); else close(); return; }
    if (performance.now() - photoSeenAt < 300) return; // that Esc just ended photo mode
    const p = player();
    if (p?.creatorOpen) { p.closeCreator(); return; }
    if (explore()?.journalOpen) { explore().journal(false); return; }
    open('main');
  }

  btn.addEventListener('click', () => open('main'));
  settings.querySelector('.bx-back').onclick = () => showPage('main');
  mapPage.querySelector('.bx-back').onclick = () => showPage('main');
  mapPage.querySelector('.resume').onclick = () => close();

  // ---- entries --------------------------------------------------------------------------
  /** Things that need walk mode (character, photo): walk in at the map's centre first. */
  function inWalk(then) {
    const p = player();
    if (!p) return;
    if (p.mode === 'walk') { then(); return; }
    const t = controls.target, yaw = headingFrom(camera.position, t);
    if (!p.enterNearUnity(t.x, -t.z, yaw, yaw, true)) return;
    const wait = () => (p.busy ? setTimeout(wait, 150) : then());
    setTimeout(wait, 150);
  }

  function choose(id) {
    const p = player(), ex = explore();
    switch (id) {
      case 'resume': close(); break;
      case 'map': showPage('map'); break;
      case 'settings': showPage('settings'); break;
      case 'character': close({ resume: false }); inWalk(() => p?.openCreator?.()); break;
      case 'journal': close({ resume: false }); ex?.journal(true); break;
      case 'photo': close(); inWalk(() => ex?.photo(true)); break;
      case 'trip': close({ resume: false }); window.__bloxTrip?.open?.(true); break;
      case 'help': close({ resume: false }); p?.toggleHelp?.(true); break;
      case 'goals': {
        const g = window.__bloxGoals;
        if (g?.setOff) g.setOff(!g.flow?.off); else if (g?.flow) g.flow.off = !g.flow.off;
        renderMain();
        main.querySelector('[data-id=goals]')?.focus({ preventScroll: true });
        break;
      }
      case 'mp': {
        close({ resume: false });
        const b = document.getElementById('mp-open');
        if (b && document.getElementById('mp-panel')?.hidden !== false) b.click();
        break;
      }
      default: break;
    }
  }

  // ---- settings: the #hud panel moved in -------------------------------------------------
  function hostHud() {
    const hud = document.getElementById('hud');
    if (!hud || hudHome) return;
    hudHome = { parent: hud.parentNode, next: hud.nextSibling };
    hudCollapsed = hud.classList.contains('collapsed');
    hud.classList.remove('collapsed');
    settings.querySelector('.bx-slot').append(hud);
  }
  function unhostHud() {
    const hud = document.getElementById('hud');
    if (!hud || !hudHome) return;
    hudHome.parent.insertBefore(hud, hudHome.next);
    hud.classList.toggle('collapsed', hudCollapsed);
    hudHome = null;
  }

  // ---- map and fast travel ---------------------------------------------------------------
  const inside = (x, z) => {
    const b = city?.box;
    if (b && (x < b.min.x || x > b.max.x || -z < b.min.z || -z > b.max.z)) return false;
    return builtAt(city, x, z);
  };
  const map = new MapScreen(mapPage, {
    onTravel: (t) => go(t),
    canTravel: () => (match() ? 'Not during a match' : ''),
  });
  let mapLoaded = { walk: null, stops: null, marks: -1, river: false, built: false };

  function me() {
    const p = player();
    if (p?.mode === 'walk') return { x: p.ctrl.pos[0], z: -p.ctrl.pos[2], yaw: p.follow?.yaw ?? p.ctrl.yaw };
    const t = controls.target;
    return { x: t.x, z: -t.z, yaw: headingFrom(camera.position, t) };
  }

  function loadMapData() {
    const L = life(), d = {};
    if (L?.walkDoc && mapLoaded.walk !== L.walkDoc) {
      mapLoaded.walk = L.walkDoc;
      d.tiles = segmentTiles(L.walkDoc);
      d.grid = new PointGrid(L.walkDoc.nodes, 32);
    }
    const stops = L?.timetable?.stops;
    if (stops && mapLoaded.stops !== stops) { mapLoaded.stops = stops; d.stops = mergeStops(stops, inside); }
    const marks = explore()?.landmarks?.() || [];
    const found = marks.filter((m) => m.found).length;
    if (marks.length && mapLoaded.marks !== found) {
      mapLoaded.marks = found;
      d.landmarks = marks.filter((m) => inside(m.at[0], m.at[1]))
        .map((m) => ({ kind: 'landmark', id: m.id, name: m.name, x: m.at[0], z: m.at[1], found: m.found,
          face: m.anchor ? Math.atan2(m.anchor[0] - m.at[0], m.anchor[1] - m.at[1]) : null })); // arrive facing the building
    }
    if (!mapLoaded.built) { mapLoaded.built = true; d.built = builtMask(city); d.inside = inside; }
    if (!mapLoaded.river) {
      mapLoaded.river = true;
      const site = window.BLOX_SITE, emb = window.BLOX_WORLD?.life?.river;
      if (emb) d.river = emb;
      else if (site?.life) {
        fetch(new URL('life/river.json', new URL(site.base || 'world/', location.href)))
          .then((r) => (r.ok ? r.json() : null)).then((river) => river && map.setData({ river })).catch(() => {});
      }
    }
    map.setData(d);
  }

  function openMap() {
    loadMapData();
    map.open(me());
  }
  window.addEventListener('resize', () => { if (isOpen && page === 'map') map.resize(); });

  const travel = new Travel({
    fade(a, text) {
      fade.style.opacity = String(a);
      fade.classList.toggle('on', a > 0);
      fade.firstChild.textContent = text || '';
    },
    place(x, z, yaw) {
      const p = player();
      if (!p || typeof city?.groundHeight?.(x, -z) !== 'number') return false;
      if (!p.enterNearUnity(x, z, yaw, yaw, false)) return false;
      city.focus?.(null, null);
      return true;
    },
    prepare(x, z) {
      const p = player();
      if (p?.mode === 'walk') p.exitWalk(true);
      const g = city?.approxGround?.(x, -z) ?? 0;
      controls.target.set(x, g, -z);
      camera.position.set(x + 60, g + 80, -z + 60);
      controls.update();
      city?.focus?.(x, -z);
    },
    giveUp() { city?.focus?.(null, null); },
    done(result, g) {
      fade.classList.remove('on');
      if (result === 'gave-up') toastMsg(`${g.name || 'That place'} is still loading. Double-tap to walk in.`);
    },
  });

  function go(target) {
    if (!player()) return;
    if (riding()) window.__bloxRide?.leave?.();
    close({ resume: false });
    const yaw = target.face ?? me().yaw;
    travel.start({ x: target.x, z: target.z, yaw, name: target.name === 'This street' ? '' : target.name });
    // on PC, walking in again by a click would catch the mouse: the Go click is that gesture
    if (!touch()) setTimeout(() => { if (walking()) player()?.input?.requestLock?.(); }, 300);
  }

  function toastMsg(text) {
    const t = el('div', { className: 'panel notice' });
    t.textContent = text;
    document.body.append(t);
    setTimeout(() => t.remove(), 5000);
  }

  // ---- keys: the open menu takes every key (the game's handlers do not see them) ------------
  window.addEventListener('keydown', (e) => {
    if (!isOpen || !e.isTrusted) return;
    e.stopImmediatePropagation();
    const typing = /^(SELECT|TEXTAREA)$/.test(e.target?.tagName || '') || (e.target?.tagName === 'INPUT' && !/^(checkbox|button)$/.test(e.target.type));
    if (e.code === 'Escape') {
      e.preventDefault();
      if (performance.now() - openedAt > 250) toggle(); // the Esc that freed the mouse is not a second press
      return;
    }
    const dir = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' }[e.code];
    if (dir && page === 'main' && !typing) { e.preventDefault(); moveMain(dir); }
  }, true);

  function moveMain(dir) {
    const items = [...main.querySelectorAll('.bx-item')];
    const cols = getComputedStyle(main.querySelector('.bx-items')).gridTemplateColumns.split(' ').length;
    const i = items.indexOf(document.activeElement);
    items[moveFocus(i, items.length, dir, cols)]?.focus({ preventScroll: true });
  }

  // ---- gamepad: d-pad moves, A picks, B goes back (Start toggles through the player) --------
  let padPrev = [];
  function pollPad() {
    const pads = navigator.getGamepads ? [...navigator.getGamepads()].filter((p) => p && p.connected) : [];
    const now = [];
    for (const p of pads) p.buttons.forEach((b, i) => { if (b.pressed) now[i] = true; });
    const hit = (i) => now[i] && !padPrev[i];
    padPrev = now;
    if (!isOpen) {
      if (hit(9) && (!player() || riding()) && !title()) open('main'); // the player's tick is off while riding
      return;
    }
    if (hit(9) && (!player() || riding())) toggle();
    if (hit(1)) toggle();
    if (page === 'main') {
      if (hit(12)) moveMain('up'); if (hit(13)) moveMain('down'); if (hit(14)) moveMain('left'); if (hit(15)) moveMain('right');
      if (hit(0)) { const a = document.activeElement; if (a && main.contains(a)) a.click(); else focusFirst(); }
    }
    if (page === 'map') {
      if (hit(12)) map.zoomBy(1.6); if (hit(13)) map.zoomBy(1 / 1.6);
    }
  }

  let whereT = 0;
  const api = {
    get isOpen() { return isOpen; },
    get page() { return page; },
    open, close, toggle, travel: (x, z, name = '') => go({ x, z, name }), map,
    get travelling() { return travel.busy; },
    update(dt) {
      if (explore()?.state?.().photo) photoSeenAt = performance.now();
      pollPad();
      if (travel.busy) travel.step(dt);
      if (isOpen) {
        if (page === 'main' && (whereT -= dt) <= 0) { whereT = 1; main.querySelector('.bx-where').textContent = where(); }
        if (page === 'map') map.setMe(me());
        if (title()) close({ resume: false });
      }
    },
  };
  window.__bloxMenu = api;
  return api;
}
