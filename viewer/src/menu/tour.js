// The first-time walkthrough (owner: new players don't know what to do, nor that they must zoom in
// and double-tap to get into the street, nor that the look can change). A card at the bottom,
// one step at a time, on the first visit (saved: localStorage blox.tour); Skip ends it; pause menu
// > Tour plays it again. Steps move on by themselves when the player does the thing.
//   1 the city from above: zoom in and double-tap a street, Walk here, or "Drop me on the Markt"
//   2 in the street: how to move; what there is to do (tourists ask for help, bikes, the ducks)
//   3 make it yours: hair, outfit, colours (opens the character creator)
//   4 the looks: Classic, Spider-Verse, Manga (opens the look picker)
//   5 more in the menu: trips on the real buses and trains, your Spotify, photo mode, fast travel
//   6 games: Defend Maastricht at night, capture the flag (opens the Play panel)
// (owner: people missed the character creator, the music and the trip planner: steps 3 and 5)
// Buttons go through the pause menu's own actions (menu/index.js choose), so there is one way to open each thing.
export const TOUR_KEY = 'blox.tour';
export const MARKT_RD = [176380, 317990];

const touch = () => typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches;

/** The steps (pure: text for a touch or a mouse player). */
export function tourSteps(isTouch) {
  return [
    { id: 'drop', title: 'Welcome to Maastricht, in bricks',
      text: isTouch ? 'This is the real city. Pinch to zoom in close to a street, then double-tap it to jump in.'
        : 'This is the real city. Scroll to zoom in close to a street, then double-click it (or press Walk here, bottom right) to jump in.',
      action: 'Drop me on the Markt', done: (p) => p?.mode === 'walk' },
    { id: 'walk', title: 'You are in the street',
      text: isTouch ? 'Joystick to walk, drag the right side to look. Tourists with a ! need help, bikes stand ready at the racks, and the ducks on the Maas are hungry.' : 'WASD to walk, the mouse to look, Space to jump. Tourists with a ! need help, bikes stand ready at the racks, and the ducks on the Maas are hungry.',
      action: 'Got it', minS: 6 },
    { id: 'you', title: 'Make it yours',
      text: isTouch ? 'Your hair, outfit and colours: menu (top right), Character. It is saved in this browser and others see it in games.'
        : 'Your hair, outfit and colours: press C, or the menu (Esc), Character. It is saved in this browser and others see it in games.',
      action: 'Change my look', menu: 'character' },
    { id: 'look', title: 'Change how the city looks',
      text: 'Three worlds, three casts: the Classic brick toy, the Spider-Verse comic film, or Manga, with its own poses and Stands. Any time from the menu, Look.',
      action: 'Show me the looks', menu: 'look' },
    { id: 'more', title: 'More in the menu',
      text: (isTouch ? 'In the menu (top right): ' : 'In the menu (Esc): ') + 'plan a trip on the real buses and trains, play your own Spotify while you walk, photo mode, and fast travel on the map.',
      action: 'Got it' },
    { id: 'play', title: 'Something to play',
      text: 'Defend Maastricht: raiders come out of the caves at night, keep them off the banner on the Markt. Or capture the flag, with friends or bots. The PLAY button on the right.',
      action: 'Open Play', menu: 'mp' },
  ];
}

const CSS = `
#tour { position: fixed; left: 50%; top: calc(64px + env(safe-area-inset-top, 0px)); transform: translateX(-50%); z-index: 25;
  width: min(460px, calc(100vw - 24px)); box-sizing: border-box; background: #11143a; color: #f6f3ea; border-radius: 16px; padding: 14px 16px;
  font: 13px/1.45 system-ui, sans-serif; box-shadow: 0 18px 50px rgba(0,0,0,.5); border: 1px solid rgba(242,169,0,.5); display: grid; gap: 8px; }
#tour[hidden] { display: none; }
#tour b { font: 400 19px/1.1 'Anton', Impact, sans-serif; letter-spacing: .04em; color: #F2A900; }
#tour .row { display: flex; gap: 8px; align-items: center; justify-content: space-between; }
#tour .dots { color: #8d91ad; font-size: 11px; letter-spacing: .3em; }
#tour button { border: 0; border-radius: 999px; padding: 8px 14px; font: 800 12px system-ui, sans-serif; cursor: pointer; }
#tour .go { background: #F2A900; color: #10153a; }
#tour .go kbd { font: 700 10px system-ui, sans-serif; opacity: .6; margin-left: 4px; }
#tour .skip { background: none; color: #8d91ad; text-decoration: underline; padding: 8px 4px; }
body.title #tour, body.shot #tour { display: none; }
`;

export function initTour({ store = safe(), origin = () => window.BLOX_SITE?.originRD || [175700, 316500] } = {}) {
  if (typeof document === 'undefined' || /[?&]shot=1/.test(location.search)) return null;
  document.head.append(Object.assign(document.createElement('style'), { textContent: CSS }));
  const el = Object.assign(document.createElement('div'), { id: 'tour', hidden: true });
  document.body.append(el);
  for (const e of ['keydown', 'keyup']) el.addEventListener(e, (ev) => { if (ev.key !== 'Escape') ev.stopPropagation(); });
  let steps = [], i = -1, shownAt = 0, timer = 0;

  const player = () => window.__bloxPlayer;
  function show(k) {
    i = k;
    if (i >= steps.length) { end(); return; }
    const s = steps[i];
    shownAt = performance.now();
    el.innerHTML = `<b>${s.title}</b><div>${s.text}</div>
      <div class="row"><span class="dots">${steps.map((_, q) => (q === i ? '●' : '○')).join('')}</span>
      <span><button class="skip">Skip tour</button> <button class="go">${s.action}${touch() ? '' : ' <kbd>Enter</kbd>'}</button></span></div>`;
    el.hidden = false;
    // (found by playing it: in the street the mouse is held for looking around, so the card's buttons
    // could not be clicked; free it, as every other panel does; Enter works either way)
    player()?.input?.releaseLock?.();
  }
  function next() { show(i + 1); }
  function end() {
    el.hidden = true; i = -1; clearInterval(timer); window.__bloxTourOn = false;
    try { store?.setItem(TOUR_KEY, 'done'); } catch { /* blocked */ }
  }
  function act() {
    const s = steps[i];
    if (!s) return;
    if (s.id === 'drop') dropOnMarkt();
    if (s.menu) window.__bloxMenu?.choose(s.menu); // the menu's own way to open it
    if (i === steps.length - 1) end(); else next();
  }
  el.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.classList.contains('skip')) end(); else act();
  });
  // Enter presses the card's button, also while the mouse is held for looking around
  document.addEventListener('keydown', (e) => {
    if (el.hidden || e.key !== 'Enter' || e.repeat || /^(INPUT|TEXTAREA|SELECT)$/.test(e.target?.tagName || '')) return;
    e.preventDefault(); act();
  });

  /** Into the street on the Markt: fly the map there first if that part of town isn't loaded yet. */
  function dropOnMarkt() {
    const p = player(), o = origin(), x = MARKT_RD[0] - o[0], z = MARKT_RD[1] - o[1];
    if (!p || p.mode === 'walk') return;
    let t = 0, flown = false;
    const go = setInterval(() => {
      t += 0.5;
      if (p.mode === 'walk' || p.enterNearUnity?.(x, z, 0, 0, true) || t > 25) { clearInterval(go); return; }
      const B = window.__blox;
      if (!flown && B?.controls) { // look at the Markt from close by, so its streets stream in
        flown = true;
        const g = B.city?.approxGround?.(x, -z) ?? 0;
        B.controls.target.set(x, g, -z); B.stage?.camera?.position.set(x + 30, g + 40, -z + 30); B.controls.update?.();
        B.city?.focus?.(x, -z);
      }
    }, 500);
  }

  function start() {
    steps = tourSteps(touch());
    window.__bloxTourOn = true; // (the goals card holds its own welcome while the tour runs)
    show(player()?.mode === 'walk' ? 1 : 0);
    clearInterval(timer);
    timer = setInterval(() => { // move on when the player did it
      const s = steps[i];
      if (s?.done?.(player()) && performance.now() - shownAt > 300) next();
    }, 500);
  }

  // first visit: once the title screen is gone
  let seen = '';
  try { seen = store?.getItem(TOUR_KEY) || ''; } catch { seen = 'done'; }
  if (!seen) {
    const wait = setInterval(() => { if (!document.body.classList.contains('title') && window.__bloxReady) { clearInterval(wait); setTimeout(start, 1200); } }, 500);
  }
  return { start, end };
}

function safe() { try { return typeof localStorage !== 'undefined' ? localStorage : null; } catch { return null; } }
