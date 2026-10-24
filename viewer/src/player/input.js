// Unified input: keyboard, mouse (pointer lock), Gamepad API (standard mapping) and touch ->
// one frame of actions.
//
// All bindings live in BINDINGS (one table, so remapping later is a data change). The pure
// helpers (deadzone, readKeys, readPad, lockDelta, combine, frameSpeed) are tested without a
// browser; the Input class only collects DOM/Gamepad state and calls them once per frame.
//
// Mouse look (walk mode): click the canvas to capture the mouse (Pointer Lock API); while
// locked, every pointermove's movementX/Y turns the camera, no button held. Without the lock
// (declined, or before the first click) dragging still turns it. Only one path feeds a given
// event, so deltas are never applied twice. Esc releases the lock (the browser does that
// itself); the Escape key press that released it is swallowed so it does not also open the menu.
//
// Frame: { move: [x right, y forward], speed01 (0..1 analog, 1 = run), run, look: [dx, dy]
// radians this frame, lookInput (any look source active), zoom: metres this frame (+ = out),
// held: Set, pressed: Set (this frame) }.
import { StickLook, mouseLook } from './look.js';
import { SETTINGS_DEFAULTS } from './settings.js';

export const BINDINGS = {
  keys: {
    forward: ['KeyW', 'ArrowUp'], back: ['KeyS', 'ArrowDown'],
    left: ['KeyA', 'ArrowLeft'], right: ['KeyD', 'ArrowRight'],
    run: ['ShiftLeft', 'ShiftRight'], jump: ['Space'], enter: ['KeyF'],
    map: ['KeyM'], menu: ['Escape'], help: ['KeyH'], lookLeft: ['KeyQ'], lookRight: ['KeyE'],
    zoomIn: ['Equal', 'NumpadAdd'], zoomOut: ['Minus', 'NumpadSubtract'],
  },
  // standard gamepad mapping (https://w3c.github.io/gamepad/#remapping)
  pad: {
    axes: { moveX: 0, moveY: 1, lookX: 2, lookY: 3 },
    buttons: { jump: 0, enter: 0, map: 1, run: 4, zoomOut: 6, zoomIn: 7, help: 8, menu: 9 },
    deadzone: 0.18,
    triggerDeadzone: 0.08,
  },
  // rad per px (mouse/touch, x settings.mouseSens) / rad per s (keys); sticks: look.js StickLook
  look: { mouse: 0.003, touch: 0.006, keys: 1.8 },
  zoom: { wheel: 0.004, triggers: 8, keys: 6 }, // m per wheel unit / m per s
};

/** Radial deadzone with rescale: |v| < dz -> 0, else (|v| - dz) / (1 - dz), direction kept. */
export function deadzone(x, y, dz) {
  const m = Math.hypot(x, y);
  if (m <= dz) return [0, 0];
  const s = Math.min(1, (m - dz) / (1 - dz)) / m;
  return [x * s, y * s];
}

/** Held keyboard codes (Set) -> { move, held:Set of actions }. */
export function readKeys(codes, b = BINDINGS) {
  const held = new Set();
  for (const [action, list] of Object.entries(b.keys)) if (list.some((c) => codes.has(c))) held.add(action);
  let x = (held.has('right') ? 1 : 0) - (held.has('left') ? 1 : 0);
  let y = (held.has('forward') ? 1 : 0) - (held.has('back') ? 1 : 0);
  const m = Math.hypot(x, y);
  if (m > 1) { x /= m; y /= m; }
  return { move: [x, y], held };
}

/**
 * A Gamepad (or { axes, buttons }) -> { move, look, held:Set, zoom (-1..1, + = out) }.
 * Stick y is down-positive in the API: move y is flipped to forward-positive, look y stays
 * down-positive like a mouse drag (push down = look down, not inverted).
 */
export function readPad(pad, b = BINDINGS) {
  const ax = (i) => pad.axes?.[i] ?? 0;
  const val = (i) => { const v = pad.buttons?.[i]; return v == null ? 0 : typeof v === 'object' ? (v.value || (v.pressed ? 1 : 0)) : +v; };
  const A = b.pad.axes;
  const [mx, my] = deadzone(ax(A.moveX), ax(A.moveY), b.pad.deadzone);
  const [lx, ly] = deadzone(ax(A.lookX), ax(A.lookY), b.pad.deadzone);
  const held = new Set();
  for (const [action, i] of Object.entries(b.pad.buttons)) if (val(i) > 0.5) held.add(action);
  const t = (i) => { const v = val(i); return v > b.pad.triggerDeadzone ? v : 0; };
  return { move: [mx, -my], look: [lx, ly], held, zoom: t(b.pad.buttons.zoomOut) - t(b.pad.buttons.zoomIn) };
}

/** Actions held now but not in the previous frame. */
export function pressedEdges(prev, now) {
  const out = new Set();
  for (const a of now) if (!prev.has(a)) out.add(a);
  return out;
}

/**
 * Drop pointer-lock movement spikes: the first events right after locking and lone huge
 * jumps (Chrome on Windows reports both). msSinceLock: time since the lock was taken.
 */
export function lockDelta(dx, dy, msSinceLock, { settle = 150, spike = 120, max = 2000 } = {}) {
  if (!Number.isFinite(dx) || !Number.isFinite(dy)) return [0, 0];
  const m = Math.hypot(dx, dy);
  if ((msSinceLock < settle && m > spike) || m > max) return [0, 0];
  return [dx, dy];
}

/**
 * Combine sources into a frame. kb: readKeys result; pads: [readPad results]; touch:
 * { move, look:[dx,dy] px, zoom px } | null; mouse: { look:[dx,dy] px, wheel } accumulated;
 * settings: settings.js object; stick: a StickLook (keeps the turn-boost state across frames).
 */
export function combine({ kb, pads = [], touch = null, mouse = null, dt, prevHeld = new Set(), b = BINDINGS,
  settings = SETTINGS_DEFAULTS, stick = new StickLook() }) {
  const held = new Set(kb.held);
  let move = kb.move, analog = Math.hypot(...kb.move) > 0 ? 1 : 0;
  const look = [0, 0], padLook = [0, 0];
  let zoom = 0, padRun = false;
  for (const p of pads) {
    for (const a of p.held) held.add(a);
    const m = Math.hypot(...p.move);
    if (m > Math.hypot(...move)) { move = p.move; analog = m; padRun = m > 0.92; }
    padLook[0] += p.look[0]; padLook[1] += p.look[1];
    zoom += p.zoom * b.zoom.triggers * dt;
  }
  const [sx, sy] = stick.step(padLook[0], padLook[1], dt, { sens: settings.padSens, invertY: settings.padInvertY });
  look[0] += sx; look[1] += sy;
  const pointer = { sens: settings.mouseSens, invertY: settings.invertY };
  if (touch) {
    const m = Math.hypot(...touch.move);
    if (m > Math.hypot(...move)) { move = touch.move; analog = Math.min(1, m); padRun = m > 0.92; }
    const [tx, ty] = mouseLook(touch.look[0], touch.look[1], { base: b.look.touch, ...pointer });
    look[0] += tx; look[1] += ty;
    zoom += (touch.zoom || 0) * 0.02;
  }
  if (mouse) {
    const [mx, my] = mouseLook(mouse.look[0], mouse.look[1], { base: b.look.mouse, ...pointer });
    look[0] += mx; look[1] += my;
    zoom += mouse.wheel * b.zoom.wheel;
  }
  if (held.has('lookLeft')) look[0] -= b.look.keys * dt;
  if (held.has('lookRight')) look[0] += b.look.keys * dt;
  if (held.has('zoomIn')) zoom -= b.zoom.keys * dt;
  if (held.has('zoomOut')) zoom += b.zoom.keys * dt;
  const run = held.has('run') || padRun;
  return { move, speed01: Math.min(1, analog), run, look, lookInput: Math.hypot(...look) > 1e-6, zoom, held,
    kbHeld: kb.held, pressed: pressedEdges(prevHeld, held) };
}

/** Speed in m/s for a frame: keyboard walk/run; analog sticks scale the walk speed, full tilt runs. */
export function frameSpeed(frame, walk, run) {
  if (frame.run) return run;
  return walk * Math.max(frame.speed01, frame.speed01 > 0 ? 0.35 : 0);
}

/**
 * DOM/Gamepad collector. onPad(name|null, connected) is called on hot-plug, onLock(locked)
 * when the pointer lock changes. settings: a settings.js object (mutated in place by the HUD).
 */
export class Input {
  constructor(target, { onPad, onLock, touch, settings } = {}) {
    this.target = target;
    this.settings = settings || { ...SETTINGS_DEFAULTS };
    this.stick = new StickLook();
    this.codes = new Set();
    this.taps = new Set();
    this.mouse = { look: [0, 0], wheel: 0 };
    this.prevHeld = new Set();
    this.touch = touch || null; // object with .read() -> { move, look, zoom }
    this.lookActive = false; // mouse look (walk mode only)
    this.locked = false; this.lockedAt = 0; this.unlockedAt = -1e9;
    this.padNames = new Map();
    const typing = (e) => /^(INPUT|SELECT|TEXTAREA)$/.test(e.target?.tagName || '') && !/^(checkbox|range)$/.test(e.target.type);
    window.addEventListener('keydown', (e) => {
      if (typing(e)) return;
      // the Esc that released the pointer lock is the browser's, not a menu press
      if (e.code === 'Escape' && (this.locked || performance.now() - this.unlockedAt < 300)) return;
      this.codes.add(e.code);
      if (!e.repeat) this.taps.add(e.code); // a tap shorter than a frame still counts once
      if (this.lookActive && /^(Space|Arrow)/.test(e.code)) e.preventDefault();
    });
    window.addEventListener('keyup', (e) => this.codes.delete(e.code));
    window.addEventListener('blur', () => this.codes.clear());
    document.addEventListener('pointerlockchange', () => {
      const locked = document.pointerLockElement === target;
      if (locked === this.locked) return;
      this.locked = locked;
      if (locked) this.lockedAt = performance.now(); else this.unlockedAt = performance.now();
      drag = null;
      onLock?.(locked);
    });
    let drag = null;
    target.addEventListener('pointerdown', (e) => { if (e.pointerType === 'mouse' && !this.locked) drag = [e.clientX, e.clientY]; });
    window.addEventListener('pointermove', (e) => {
      if (!this.lookActive) return;
      if (this.locked) { // relative motion only; clientX/Y stand still under the lock
        const [dx, dy] = lockDelta(e.movementX, e.movementY, performance.now() - this.lockedAt);
        this.mouse.look[0] += dx; this.mouse.look[1] += dy;
      } else if (drag) {
        this.mouse.look[0] += e.clientX - drag[0]; this.mouse.look[1] += e.clientY - drag[1];
        drag = [e.clientX, e.clientY];
      }
    });
    window.addEventListener('pointerup', () => { drag = null; });
    target.addEventListener('wheel', (e) => { if (this.lookActive) { this.mouse.wheel += e.deltaY; e.preventDefault(); } }, { passive: false });
    window.addEventListener('gamepadconnected', (e) => onPad?.(e.gamepad.id, true));
    window.addEventListener('gamepaddisconnected', (e) => onPad?.(e.gamepad.id, false));
  }

  /** Capture the mouse (needs a user gesture: a click or key press shortly before). */
  requestLock() {
    const t = this.target;
    if (this.locked || !t.requestPointerLock) return;
    const plain = () => { try { t.requestPointerLock()?.catch?.(() => {}); } catch { /* not allowed now */ } };
    try {
      // raw mouse input (no OS acceleration) where supported, like a desktop game
      const p = t.requestPointerLock({ unadjustedMovement: true });
      if (p?.catch) p.catch((err) => { if (err?.name === 'NotSupportedError') plain(); });
    } catch { plain(); }
  }

  releaseLock() { if (this.locked && document.exitPointerLock) document.exitPointerLock(); }

  pads() {
    const list = navigator.getGamepads ? [...navigator.getGamepads()].filter((p) => p && p.connected) : [];
    return list.filter((p) => p.mapping === 'standard' || p.axes.length >= 4);
  }

  /** One frame of input (consumes accumulated mouse/touch deltas). */
  poll(dt) {
    const frame = combine({
      kb: readKeys(new Set([...this.codes, ...this.taps])), pads: this.pads().map((p) => readPad(p)), touch: this.touch?.read() || null,
      mouse: this.mouse, dt, prevHeld: this.prevHeld, settings: this.settings, stick: this.stick,
    });
    this.prevHeld = frame.held;
    this.taps.clear();
    this.mouse = { look: [0, 0], wheel: 0 };
    return frame;
  }
}
