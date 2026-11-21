// The first-time walkthrough (owner: new players don't know what to do, nor that they must zoom in
// and double-tap to get into the street, nor that the look can change). A card at the bottom,
// one step at a time, on the first visit (saved: localStorage blox.tour); Skip ends it; pause menu
// > Tour plays it again. Steps move on by themselves when the player does the thing.
//   1 the city from above: zoom in and double-tap a street, or "Drop me on the Markt"
//   2 in the street: how to move; what there is to do (tourists ask for help, bikes, the ducks)
//   3 the looks: Jump into the Spider-Verse (opens the look picker)
//   4 games: Defend Maastricht at night, capture the flag (opens the Play panel)
export const TOUR_KEY = 'blox.tour';
export const MARKT_RD = [176380, 317990];

const touch = () => typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches;

/** The steps (pure: text for a touch or a mouse player). */
export function tourSteps(isTouch) {
  return [
    { id: 'drop', title: 'Welcome to Maastricht, in bricks',
      text: isTouch ? 'This is the real city. Pinch to zoom in close to a street, then double-tap it to jump in.' : 'This is the real city. Scroll to zoom in close to a street, then double-click it to jump in.',
      action: 'Drop me on the Markt', done: (p) => p?.mode === 'walk' },
    { id: 'walk', title: 'You are in the street',
      text: isTouch ? 'Joystick to walk, drag the right side to look. Tourists with a ! need help, bikes stand ready at the racks, and the ducks on the Maas are hungry.' : 'WASD to walk, the mouse to look, Space to jump. Tourists with a ! need help, bikes stand ready at the racks, and the ducks on the Maas are hungry.',
      action: 'Got it', minS: 6 },
    { id: 'look', title: 'Change how the city looks',
      text: 'Jump into the Spider-Verse: a comic-book film with ink outlines, halftone dots and colours that flash when the action hits. Any time from the pause menu, Look.',
      action: 'Show me the looks' },
    { id: 'play', title: 'Something to play',
      text: 'Defend Maastricht: raiders come out of the caves at night, keep them off the banner on the Markt. Or capture the flag, with friends or bots. The PLAY button on the right.',
      action: 'Open Play' },
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
      <span><button class="skip">Skip tour</button> <button class="go">${s.action}</button></span></div>`;
    el.hidden = false;
  }
  function next() { show(i + 1); }
  function end() {
    el.hidden = true; i = -1; clearInterval(timer); window.__bloxTourOn = false;
    try { store?.setItem(TOUR_KEY, 'done'); } catch { /* blocked */ }
  }
  el.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.classList.contains('skip')) { end(); return; }
    const s = steps[i];
    if (s.id === 'drop') {
      dropOnMarkt();
      next();
    } else if (s.id === 'look') { document.querySelector('#look-panel') ? (window.__bloxLooks?.open(), next()) : next(); }
    else if (s.id === 'play') { const btn = document.getElementById('mp-open'); if (btn && document.getElementById('mp-panel')?.hidden !== false) btn.click(); end(); }
    else next();
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
