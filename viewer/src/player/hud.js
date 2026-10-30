// Player HUD (DOM, built here so index.html stays the viewer core's): walk/exit button, mode
// hint (follows the pointer lock), street name, compass (click: face north), controls help +
// camera settings (H / Esc with a free mouse / gamepad Select or Start), "controller
// connected" toast, and the touch controls (virtual joystick on the left half, drag-to-look on the right half,
// pinch to zoom, jump button), shown only on touch devices in walk mode.
const CSS = `
#pl-bar { position: fixed; left: 50%; bottom: 14px; transform: translateX(-50%); display: flex; gap: 10px;
  align-items: center; background: rgba(18,22,30,.72); backdrop-filter: blur(8px); border-radius: 10px;
  padding: 6px 8px 6px 14px; color: #f3f1ea; font: 13px/1.3 system-ui, sans-serif; z-index: 5; max-width: calc(100vw - 32px); }
#pl-bar button, #pl-help button { background: #ffcf5a; color: #1b1b1b; border: 0; border-radius: 7px; padding: 6px 12px;
  font: 600 13px system-ui, sans-serif; cursor: pointer; white-space: nowrap; }
#pl-hint { color: #b9bcc4; }
#pl-back { position: fixed; top: 14px; right: 14px; z-index: 5; display: flex; align-items: center; gap: 8px;
  background: #F2A900; color: #10153a; border: 0; border-radius: 10px; padding: 9px 14px 9px 12px; cursor: pointer;
  font: 700 15px system-ui, sans-serif; box-shadow: 0 3px 0 #b07b00, 0 6px 16px rgba(0,0,0,.3); }
#pl-back[hidden] { display: none; }
#pl-back:active { transform: translateY(2px); box-shadow: 0 1px 0 #b07b00; }
#pl-back kbd { font: 600 11px system-ui, sans-serif; background: rgba(16,21,58,.15); border-radius: 4px; padding: 1px 5px; }
@media (max-width: 600px) { #pl-back kbd { display: none; } }
#pl-street { position: fixed; top: 14px; left: 50%; transform: translateX(-50%); color: #fff; z-index: 5;
  font: 600 18px system-ui, sans-serif; text-shadow: 0 1px 4px rgba(0,0,0,.6); pointer-events: none; }
#pl-toast { position: fixed; top: 54px; left: 50%; transform: translateX(-50%); background: rgba(18,22,30,.8);
  color: #f3f1ea; padding: 6px 14px; border-radius: 8px; font: 13px system-ui, sans-serif; z-index: 6;
  transition: opacity .4s; pointer-events: none; }
#pl-help { position: fixed; inset: 0; margin: auto; width: min(520px, calc(100vw - 32px)); height: fit-content;
  max-height: calc(100vh - 32px); overflow: auto; box-sizing: border-box;
  background: rgba(18,22,30,.9); color: #f3f1ea; border-radius: 12px; padding: 16px 18px; z-index: 7;
  font: 13px/1.5 system-ui, sans-serif; }
#pl-help table { width: 100%; border-collapse: collapse; margin: 8px 0 12px; }
#pl-help td, #pl-help th { text-align: left; padding: 3px 6px; border-bottom: 1px solid rgba(255,255,255,.1); }
#pl-help th { color: #ffcf5a; font-weight: 600; }
.pl-touch { position: fixed; z-index: 4; pointer-events: none; }
#pl-stick { left: 28px; bottom: 90px; width: 120px; height: 120px; border-radius: 50%;
  background: rgba(255,255,255,.14); border: 2px solid rgba(255,255,255,.35); }
#pl-knob { position: absolute; left: 35px; top: 35px; width: 50px; height: 50px; border-radius: 50%; background: rgba(255,207,90,.85); }
#pl-jump { right: 28px; bottom: 100px; width: 74px; height: 74px; border-radius: 50%; pointer-events: auto;
  background: rgba(255,207,90,.8); border: 0; font: 700 14px system-ui, sans-serif; color: #1b1b1b; }
#pl-help h4 { margin: 10px 0 4px; color: #ffcf5a; font-size: 13px; }
#pl-help label { display: flex; align-items: center; gap: 8px; margin: 4px 0; }
#pl-help input[type=range] { flex: 1; accent-color: #ffcf5a; }
#pl-help output { min-width: 3.2em; text-align: right; color: #b9bcc4; }
#pl-compass { position: fixed; right: 14px; bottom: 40px; width: 44px; height: 44px; border-radius: 50%; z-index: 5;
  background: rgba(18,22,30,.72); border: 1px solid rgba(255,255,255,.25); cursor: pointer; padding: 0; }
#pl-compass svg { width: 100%; height: 100%; display: block; }
body.shot #pl-bar, body.shot #pl-back, body.shot #pl-toast, body.shot #pl-help, body.shot .pl-touch, body.shot #pl-compass { display: none; }
@media (max-width: 600px) { #pl-hint { display: none; } }
`;

export const CONTROLS = [
  ['Look (walk)', 'Click to capture the mouse, then move it · Q E', 'Right stick', 'Right half: drag'],
  ['Free the mouse', 'Esc', '', ''],
  ['Move', 'W A S D / arrows (where the camera looks)', 'Left stick', 'Left half: joystick'],
  ['Run', 'Shift', 'Push stick fully / LB', 'Push joystick fully'],
  ['Jump', 'Space', 'A', 'Jump button'],
  ['Zoom', 'Wheel / + -', 'LT / RT', 'Pinch'],
  ['Walk here', 'F (cursor) / double-click', 'A (screen centre)', 'Double-tap'],
  ['Back to map', 'M / Map button', 'B', 'Map button'],
  ['Rotate map', 'Right drag / Ctrl or Alt + drag / Q E', 'Right stick', 'Two-finger drag'],
  ['Tilt map', 'Middle drag / right drag up-down', 'Right stick up-down', 'Two-finger drag up-down'],
  ['Face north', 'Click the compass', '', 'Tap the compass'],
  ['Menu (this panel)', 'H / Esc (mouse free)', 'Start / Select', ''],
];

const SLIDERS = [
  ['mouseSens', 'Mouse / touch sensitivity', 0.2, 3, 0.05],
  ['padSens', 'Controller sensitivity', 0.3, 2.5, 0.05],
];
const TOGGLES = [
  ['invertY', 'Invert Y (mouse / touch)'],
  ['padInvertY', 'Invert Y (controller)'],
  ['recenter', 'Camera eases behind you while walking'],
];

const el = (tag, attrs = {}, html = '') => Object.assign(document.createElement(tag), attrs, html ? { innerHTML: html } : {});

export const isTouchDevice = () => (navigator.maxTouchPoints || 0) > 0 && matchMedia('(pointer: coarse)').matches;

/** Virtual joystick + look/pinch on touch. read() -> { move, look:[dx,dy] px, zoom px } and resets deltas. */
export class TouchControls {
  constructor(canvas, onJump, onDoubleTap) {
    this.stick = el('div', { id: 'pl-stick', className: 'pl-touch', hidden: true });
    this.knob = el('div', { id: 'pl-knob' });
    this.stick.append(this.knob);
    this.jump = el('button', { id: 'pl-jump', className: 'pl-touch', hidden: true, textContent: 'JUMP' });
    this.jump.addEventListener('pointerdown', (e) => { e.stopPropagation(); this.jumpDown = true; onJump?.(); });
    document.body.append(this.stick, this.jump);
    this.active = false;
    this.move = [0, 0]; this.look = [0, 0]; this.zoom = 0;
    this.pointers = new Map(); // id -> { role, x, y, x0, y0 }
    let lastTap = null;
    canvas.addEventListener('pointerdown', (e) => {
      if (e.pointerType !== 'touch') return;
      const now = performance.now();
      if (!this.active && lastTap && now - lastTap.t < 320 && Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y) < 30) {
        onDoubleTap?.(e.clientX, e.clientY); lastTap = null; return;
      }
      lastTap = { t: now, x: e.clientX, y: e.clientY };
      if (!this.active) return;
      const role = e.clientX < innerWidth / 2 && ![...this.pointers.values()].some((p) => p.role === 'stick') ? 'stick' : 'look';
      this.pointers.set(e.pointerId, { role, x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY });
    });
    canvas.addEventListener('pointermove', (e) => {
      const p = this.pointers.get(e.pointerId);
      if (!p) return;
      const looks = [...this.pointers.values()].filter((q) => q.role === 'look');
      if (p.role === 'stick') {
        const R = 60, dx = e.clientX - p.x0, dy = e.clientY - p.y0, m = Math.hypot(dx, dy);
        const s = m > R ? R / m : 1;
        this.move = [(dx * s) / R, (-dy * s) / R];
        this.knob.style.transform = `translate(${dx * s}px, ${dy * s}px)`;
      } else if (looks.length >= 2) { // pinch: change of distance between the two look fingers
        const [a, b] = looks, before = Math.hypot(a.x - b.x, a.y - b.y);
        p.x = e.clientX; p.y = e.clientY;
        this.zoom -= Math.hypot(a.x - b.x, a.y - b.y) - before;
        return;
      } else {
        this.look[0] += e.clientX - p.x; this.look[1] += e.clientY - p.y;
      }
      p.x = e.clientX; p.y = e.clientY;
    });
    const end = (e) => {
      const p = this.pointers.get(e.pointerId);
      if (!p) return;
      this.pointers.delete(e.pointerId);
      if (p.role === 'stick') { this.move = [0, 0]; this.knob.style.transform = ''; }
    };
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);
  }

  show(on) {
    this.active = on;
    this.stick.hidden = this.jump.hidden = !(on && isTouchDevice());
    if (!on) { this.pointers.clear(); this.move = [0, 0]; }
  }

  read() {
    const out = { move: this.move, look: this.look, zoom: this.zoom };
    this.look = [0, 0]; this.zoom = 0;
    return out;
  }
}

/** Hint line for the bottom bar (pure, tested). */
export function hintFor(mode, { touch = false, pad = false, locked = false } = {}) {
  if (mode === 'walk') {
    if (touch) return 'Joystick to move · drag the right side to look · pinch out for the map';
    if (pad) return 'Left stick move · right stick look · A jump · B map · Start menu';
    return locked ? 'Mouse look · WASD move · Space jump · M or scroll out: map · Esc frees the mouse'
      : 'Click to look around · WASD move · Space jump · M or scroll out: map · Esc menu';
  }
  if (touch) return 'Double-tap the ground to walk there';
  if (pad) return 'A: walk at the centre · left stick pan · right stick orbit · LT/RT zoom';
  return 'F or double-click to walk there · right/Ctrl-drag rotate · middle-drag tilt · Q E turn · H help';
}

/** HUD. handlers: { onWalk(), onExit(), onNorth(), onSettings(settings) }; settings: object to edit. */
export class Hud {
  constructor({ onWalk, onExit, onNorth, onSettings, settings = {} }) {
    document.head.append(el('style', { textContent: CSS }));
    this.bar = el('div', { id: 'pl-bar' });
    this.hint = el('span', { id: 'pl-hint' });
    this.button = el('button', { id: 'pl-walk' });
    this.button.addEventListener('click', () => (this.mode === 'walk' ? onExit() : onWalk()));
    this.bar.append(this.hint, this.button);
    // walk mode: an always-visible way back (the bottom bar's button is easy to miss)
    this.back = el('button', { id: 'pl-back', hidden: true, title: 'Back to the map (M, scroll out, or B on a controller)' },
      '<svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M9 3 3 5.5v15.5l6-2.5 6 2.5 6-2.5V3l-6 2.5L9 3Zm1 2.2 4 1.7v12l-4-1.7v-12ZM5 6.8l3-1.3v12l-3 1.3v-12Zm11 .1 3-1.3v12l-3 1.3v-12Z"/></svg>'
      + '<span>Map</span><kbd>M</kbd>');
    this.back.addEventListener('click', () => onExit());
    this.street = el('div', { id: 'pl-street' });
    this.toastEl = el('div', { id: 'pl-toast', hidden: true });
    const rows = CONTROLS.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('');
    this.help = el('div', { id: 'pl-help', hidden: true },
      `<b>Controls</b><table><tr><th></th><th>Keyboard + mouse</th><th>Gamepad</th><th>Touch</th></tr>${rows}</table>`);
    this.help.append(this.settingsForm(settings, onSettings));
    const close = el('button', { textContent: 'Close (H)' });
    close.addEventListener('click', () => this.toggleHelp(false));
    this.help.append(close);
    this.compass = el('button', { id: 'pl-compass', title: 'Compass: click to face north' },
      '<svg viewBox="-22 -22 44 44"><g id="pl-needle"><path d="M0 -15 L5 0 L-5 0 Z" fill="#e85d4a"/>'
      + '<path d="M0 15 L5 0 L-5 0 Z" fill="#d8d4c8"/><text y="-16.5" text-anchor="middle" font-size="7" '
      + 'font-family="system-ui,sans-serif" font-weight="700" fill="#fff">N</text></g></svg>');
    this.needle = this.compass.querySelector('#pl-needle');
    this.compass.addEventListener('click', () => onNorth?.());
    document.body.append(this.bar, this.back, this.street, this.toastEl, this.help, this.compass);
    this.state = { pad: false, locked: false };
    this.setMode('map');
  }

  /** Sliders + toggles editing `settings` in place; onSettings(settings) after each change. */
  settingsForm(settings, onSettings) {
    const box = el('div', {}, '<h4>Camera</h4>');
    for (const [key, label, min, max, step] of SLIDERS) {
      const row = el('label', {}, `<span>${label}</span>`);
      const input = el('input', { type: 'range', min, max, step, value: settings[key] ?? 1 });
      const out = el('output', { textContent: `${(+input.value).toFixed(2)}×` });
      input.addEventListener('input', () => { settings[key] = +input.value; out.textContent = `${(+input.value).toFixed(2)}×`; onSettings?.(settings); });
      input.addEventListener('change', () => input.blur()); // arrow keys walk again, not slide
      row.append(input, out);
      box.append(row);
    }
    for (const [key, label] of TOGGLES) {
      const input = el('input', { type: 'checkbox', checked: !!settings[key] });
      input.addEventListener('change', () => { settings[key] = input.checked; onSettings?.(settings); input.blur(); });
      const row = el('label');
      row.append(input, label);
      box.append(row);
    }
    return box;
  }

  /** Point the compass needle north for a view looking toward compass yaw (radians). */
  setHeading(yaw) {
    const deg = Math.round((-yaw * 180) / Math.PI);
    if (deg !== this.headingDeg) { this.headingDeg = deg; this.needle.setAttribute('transform', `rotate(${deg})`); }
  }

  setMode(mode, padConnected = this.state?.pad ?? false) {
    this.mode = mode;
    this.state.pad = padConnected;
    this.button.textContent = mode === 'walk' ? 'Map (M)' : 'Walk here';
    this.back.hidden = mode !== 'walk';
    if (mode !== 'walk') this.setStreet('');
    this.refreshHint();
  }

  setLocked(locked) { this.state.locked = locked; this.refreshHint(); }

  refreshHint() { this.hint.textContent = hintFor(this.mode, { touch: isTouchDevice(), ...this.state }); }

  setStreet(name) { if (this.street.textContent !== name) this.street.textContent = name; }

  toggleHelp(on = this.help.hidden) { this.help.hidden = !on; }

  toast(text, ms = 2500) {
    this.toastEl.textContent = text;
    this.toastEl.hidden = false;
    this.toastEl.style.opacity = '1';
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => { this.toastEl.style.opacity = '0'; }, ms);
  }

  /** The first few times someone starts walking: how to get back (remembered per browser). */
  firstWalkTip(pad = false) {
    let n = 0;
    try { n = +(localStorage.getItem('blox.walkTips') || 0); localStorage.setItem('blox.walkTips', String(n + 1)); } catch { /* show it */ }
    if (n >= 3) return;
    const how = isTouchDevice() ? 'pinch out or tap Map' : pad ? 'press B' : 'press M or scroll out';
    this.toast(`You're walking! To fly back to the map, ${how}.`, 6000);
  }
}
