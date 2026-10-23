// Player HUD (DOM, built here so index.html stays the viewer core's): walk/exit button, mode
// hint, street name, controls help (H / gamepad Select), "controller connected" toast, and
// the touch controls (virtual joystick on the left half, drag-to-look on the right half,
// pinch to zoom, jump button), shown only on touch devices in walk mode.
const CSS = `
#pl-bar { position: fixed; left: 50%; bottom: 14px; transform: translateX(-50%); display: flex; gap: 10px;
  align-items: center; background: rgba(18,22,30,.72); backdrop-filter: blur(8px); border-radius: 10px;
  padding: 6px 8px 6px 14px; color: #f3f1ea; font: 13px/1.3 system-ui, sans-serif; z-index: 5; max-width: calc(100vw - 32px); }
#pl-bar button, #pl-help button { background: #ffcf5a; color: #1b1b1b; border: 0; border-radius: 7px; padding: 6px 12px;
  font: 600 13px system-ui, sans-serif; cursor: pointer; white-space: nowrap; }
#pl-hint { color: #b9bcc4; }
#pl-street { position: fixed; top: 14px; left: 50%; transform: translateX(-50%); color: #fff; z-index: 5;
  font: 600 18px system-ui, sans-serif; text-shadow: 0 1px 4px rgba(0,0,0,.6); pointer-events: none; }
#pl-toast { position: fixed; top: 54px; left: 50%; transform: translateX(-50%); background: rgba(18,22,30,.8);
  color: #f3f1ea; padding: 6px 14px; border-radius: 8px; font: 13px system-ui, sans-serif; z-index: 6;
  transition: opacity .4s; pointer-events: none; }
#pl-help { position: fixed; inset: 0; margin: auto; width: min(460px, calc(100vw - 32px)); height: fit-content;
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
body.shot #pl-bar, body.shot #pl-toast, body.shot #pl-help, body.shot .pl-touch { display: none; }
@media (max-width: 600px) { #pl-hint { display: none; } }
`;

export const CONTROLS = [
  ['Move', 'W A S D / arrows', 'Left stick', 'Left half: joystick'],
  ['Run', 'Shift', 'Push stick fully / LB', 'Push joystick fully'],
  ['Jump', 'Space', 'A', 'Jump button'],
  ['Look', 'Drag mouse / Q E', 'Right stick', 'Right half: drag'],
  ['Zoom', 'Wheel / + -', 'LT / RT', 'Pinch'],
  ['Walk here', 'F (cursor) / double-click', 'A (screen centre)', 'Double-tap'],
  ['Back to map', 'Esc', 'B', 'Map button'],
  ['Help', 'H', 'Select', ''],
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

/** HUD. handlers: { onWalk(), onExit() }. */
export class Hud {
  constructor({ onWalk, onExit }) {
    document.head.append(el('style', { textContent: CSS }));
    this.bar = el('div', { id: 'pl-bar' });
    this.hint = el('span', { id: 'pl-hint' });
    this.button = el('button', { id: 'pl-walk' });
    this.button.addEventListener('click', () => (this.mode === 'walk' ? onExit() : onWalk()));
    this.bar.append(this.hint, this.button);
    this.street = el('div', { id: 'pl-street' });
    this.toastEl = el('div', { id: 'pl-toast', hidden: true });
    const rows = CONTROLS.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('');
    this.help = el('div', { id: 'pl-help', hidden: true },
      `<b>Controls</b><table><tr><th></th><th>Keyboard + mouse</th><th>Gamepad</th><th>Touch</th></tr>${rows}</table>`);
    const close = el('button', { textContent: 'Close (H)' });
    close.addEventListener('click', () => this.toggleHelp(false));
    this.help.append(close);
    document.body.append(this.bar, this.street, this.toastEl, this.help);
    this.setMode('map');
  }

  setMode(mode, padConnected = false) {
    this.mode = mode;
    const touch = isTouchDevice();
    if (mode === 'walk') {
      this.button.textContent = 'Map';
      this.hint.textContent = touch ? 'Joystick to move · drag to look' : padConnected
        ? 'Stick move · A jump · B map · Select help' : 'WASD move · Shift run · Space jump · drag look · Esc map · H help';
    } else {
      this.button.textContent = 'Walk here';
      this.hint.textContent = touch ? 'Double-tap the ground to walk there' : padConnected
        ? 'A: walk at the centre · sticks pan/orbit · LT/RT zoom' : 'F or double-click the ground to walk there · H help';
      this.setStreet('');
    }
  }

  setStreet(name) { if (this.street.textContent !== name) this.street.textContent = name; }

  toggleHelp(on = this.help.hidden) { this.help.hidden = !on; }

  toast(text) {
    this.toastEl.textContent = text;
    this.toastEl.hidden = false;
    this.toastEl.style.opacity = '1';
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => { this.toastEl.style.opacity = '0'; }, 2500);
  }
}
