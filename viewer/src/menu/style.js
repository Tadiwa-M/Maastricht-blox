// Styles of the pause menu, its map and the fast-travel fade (injected once by index.js).
// Title-screen look: dark Limburg blue, yellow brick buttons with a stud row, Anton headings.
export const MENU_CSS = `
#bx-menu-btn { position: fixed; top: calc(14px + env(safe-area-inset-top, 0px)); right: calc(14px + env(safe-area-inset-right, 0px));
  z-index: 7; width: 40px; height: 40px; padding: 0; border: 0; border-radius: 9px; cursor: pointer;
  background: rgba(16, 20, 58, .72); backdrop-filter: blur(6px); box-shadow: 0 2px 0 rgba(0,0,0,.35), 0 4px 14px rgba(0,0,0,.25);
  display: grid; place-items: center; touch-action: manipulation; -webkit-tap-highlight-color: transparent; }
#bx-menu-btn span { display: flex; gap: 5px; }
#bx-menu-btn span i { display: block; width: 5px; height: 16px; border-radius: 2px; background: #F2A900; box-shadow: inset 0 -2px 0 rgba(0,0,0,.2); }
#bx-menu-btn:hover span i { background: #ffc531; }
#bx-menu-btn:active { transform: translateY(2px); box-shadow: 0 0 0 rgba(0,0,0,.35); }
body.title #bx-menu-btn, body.shot #bx-menu-btn, body.bx-paused #bx-menu-btn { visibility: hidden; }

#bx-menu { position: fixed; inset: 0; z-index: 40; color: #f6f3ea; font: 14px/1.35 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  background: rgba(4, 5, 16, .62); backdrop-filter: blur(3px); user-select: none; -webkit-user-select: none; touch-action: none; }
#bx-menu[hidden], #bx-menu .bx-page[hidden] { display: none; }
#bx-menu .bx-page { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; box-sizing: border-box;
  padding: calc(12px + env(safe-area-inset-top, 0px)) calc(16px + env(safe-area-inset-right, 0px))
    calc(12px + env(safe-area-inset-bottom, 0px)) calc(16px + env(safe-area-inset-left, 0px)); }
#bx-menu .bx-card { width: min(440px, 100%); max-height: 100%; overflow: auto; box-sizing: border-box; padding: 16px 18px 18px;
  background: linear-gradient(180deg, #161a52 0%, #0b0d2a 100%); border-radius: 14px; border-top: 4px solid #F2A900;
  box-shadow: 0 18px 50px rgba(0,0,0,.55); touch-action: pan-y; overscroll-behavior: contain; }
#bx-menu h2 { margin: 0; font: 400 28px/1 'Anton', Impact, 'Arial Narrow Bold', sans-serif; letter-spacing: .12em; text-transform: uppercase; }
#bx-menu .bx-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 4px; }
#bx-menu .bx-where { color: rgba(246,243,234,.7); font-size: 12px; margin: 2px 0 12px; min-height: 1.3em; }
#bx-menu .bx-items { display: grid; grid-template-columns: 1fr; gap: 8px; }
#bx-menu button.bx-item { position: relative; display: flex; align-items: center; justify-content: space-between; gap: 10px;
  min-height: 46px; padding: 8px 14px; border: 0; border-radius: 9px; cursor: pointer; text-align: left;
  font: 600 15px/1.2 system-ui, sans-serif; color: #f6f3ea; background: rgba(255,255,255,.08);
  box-shadow: inset 0 -3px 0 rgba(0,0,0,.25); touch-action: manipulation; -webkit-tap-highlight-color: transparent; }
#bx-menu button.bx-item small { display: block; font-weight: 400; font-size: 11px; color: rgba(246,243,234,.6); margin-top: 1px; }
#bx-menu button.bx-item kbd { font: 700 11px/1 system-ui, sans-serif; color: #11143a; background: rgba(246,243,234,.85);
  border-radius: 5px; padding: 4px 6px; box-shadow: 0 2px 0 rgba(0,0,0,.4); }
#bx-menu button.bx-item:hover, #bx-menu button.bx-item:focus-visible { background: rgba(242,169,0,.22); outline: none; }
#bx-menu button.bx-item:focus-visible { box-shadow: inset 0 0 0 2px #F2A900; }
#bx-menu button.bx-item.primary { color: #11143a; background: #F2A900; box-shadow: inset 0 -3px 0 rgba(0,0,0,.2), inset 0 2px 0 rgba(255,255,255,.35); }
#bx-menu button.bx-item.primary kbd { background: rgba(17,20,58,.15); color: #11143a; box-shadow: none; }
#bx-menu button.bx-item.primary:focus-visible { box-shadow: inset 0 0 0 2px #fff; }
#bx-menu button.bx-back { font: 600 13px/1 system-ui, sans-serif; color: #11143a; background: #F2A900; border: 0; border-radius: 8px;
  min-height: 38px; padding: 0 14px; cursor: pointer; box-shadow: inset 0 -3px 0 rgba(0,0,0,.2); }
/* the settings panel (#hud) re-hosted on the Settings page */
#bx-menu .bx-slot #hud { position: static; transform: none; width: auto; display: grid; margin: 8px 0 0; padding: 0;
  background: none; backdrop-filter: none; box-shadow: none; }
#bx-menu .bx-slot #hud > h1 { display: none; }
#bx-menu .bx-slot #hud label { min-height: 34px; }
#bx-menu .bx-slot #hud input[type=range] { min-height: 28px; }
#bx-menu .bx-slot #hud button, #bx-menu .bx-slot #hud select { min-height: 30px; }
/* phones: the settings panel lives in the menu only */
@media (pointer: coarse) { body.bx-has-menu #hud { display: none; } }
@media (max-height: 520px) {
  #bx-menu .bx-card { width: min(640px, 100%); padding: 12px 14px 14px; }
  #bx-menu .bx-items { grid-template-columns: 1fr 1fr; gap: 6px; }
  #bx-menu button.bx-item { min-height: 44px; padding: 6px 12px; }
  #bx-menu h2 { font-size: 22px; }
  #bx-menu .bx-where { margin-bottom: 8px; }
}

/* the map */
#bx-menu .bx-map { padding: 0; display: block; background: #10143a; }
#bx-menu .bx-map canvas { position: absolute; inset: 0; width: 100%; height: 100%; display: block; touch-action: none; cursor: grab; }
#bx-menu .bx-map canvas.drag { cursor: grabbing; }
#bx-menu .bx-maptop { position: absolute; left: 0; right: 0; top: 0; display: flex; align-items: center; gap: 10px; pointer-events: none;
  padding: calc(10px + env(safe-area-inset-top, 0px)) calc(14px + env(safe-area-inset-right, 0px)) 10px calc(14px + env(safe-area-inset-left, 0px));
  background: linear-gradient(180deg, rgba(4,5,16,.7), rgba(4,5,16,0)); }
#bx-menu .bx-maptop > * { pointer-events: auto; }
#bx-menu .bx-maptop h2 { font-size: 22px; flex: 1; text-shadow: 0 2px 8px rgba(0,0,0,.6); }
#bx-menu .bx-zoom { position: absolute; right: calc(14px + env(safe-area-inset-right, 0px)); bottom: calc(60px + env(safe-area-inset-bottom, 0px));
  display: grid; gap: 8px; }
#bx-menu .bx-zoom button { width: 44px; height: 44px; border: 0; border-radius: 10px; cursor: pointer; font: 700 20px/1 system-ui, sans-serif;
  color: #11143a; background: #f6f3ea; box-shadow: 0 3px 0 rgba(0,0,0,.4); }
#bx-menu .bx-zoom button.me { background: #F2A900; font-size: 14px; }
#bx-menu .bx-legend { position: absolute; left: calc(14px + env(safe-area-inset-left, 0px)); bottom: calc(12px + env(safe-area-inset-bottom, 0px));
  display: flex; flex-wrap: wrap; gap: 4px 14px; align-items: center; font-size: 12px; color: rgba(246,243,234,.85);
  background: rgba(4,5,16,.55); padding: 6px 10px; border-radius: 8px; pointer-events: none; max-width: calc(100% - 100px); box-sizing: border-box; }
#bx-menu .bx-legend i { display: inline-block; width: 10px; height: 10px; margin-right: 5px; vertical-align: -1px; border-radius: 2px; }
#bx-menu .bx-sheet { position: absolute; left: 50%; transform: translateX(-50%); bottom: calc(14px + env(safe-area-inset-bottom, 0px));
  width: min(420px, calc(100% - 140px)); min-width: 240px; box-sizing: border-box; display: flex; align-items: center; gap: 10px;
  padding: 10px 12px; border-radius: 12px; background: #0b0d2a; border-top: 3px solid #F2A900; box-shadow: 0 10px 30px rgba(0,0,0,.5); }
#bx-menu .bx-sheet[hidden] { display: none; }
#bx-menu .bx-sheet .t { flex: 1; min-width: 0; }
#bx-menu .bx-sheet .t b { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
#bx-menu .bx-sheet .t small { color: rgba(246,243,234,.65); }
#bx-menu .bx-sheet button { min-height: 44px; padding: 0 16px; border: 0; border-radius: 9px; cursor: pointer; font: 700 14px/1 system-ui, sans-serif; }
#bx-menu .bx-sheet .go { color: #11143a; background: #F2A900; box-shadow: inset 0 -3px 0 rgba(0,0,0,.2); }
#bx-menu .bx-sheet .no { color: #f6f3ea; background: rgba(255,255,255,.12); }
@media (max-width: 600px) { #bx-menu .bx-sheet { width: calc(100% - 28px); bottom: calc(118px + env(safe-area-inset-bottom, 0px)); }
  #bx-menu .bx-zoom { bottom: calc(186px + env(safe-area-inset-bottom, 0px)); } }

#bx-fade { position: fixed; inset: 0; z-index: 45; background: #040510; opacity: 0; pointer-events: none; display: grid; place-items: center;
  color: #f6f3ea; font: 400 20px/1.2 'Anton', Impact, sans-serif; letter-spacing: .14em; text-transform: uppercase; }
#bx-fade.on { pointer-events: auto; }
`;
