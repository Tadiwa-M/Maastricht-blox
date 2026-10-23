// Unified input: keyboard, Gamepad API (standard mapping) and touch -> one frame of actions.
//
// All bindings live in BINDINGS (one table, so remapping later is a data change). The pure
// helpers (deadzone, readKeys, readPad, combine, frameSpeed) are tested without a
// browser; the Input class only collects DOM/Gamepad state and calls them once per frame.
//
// Frame: { move: [x right, y forward], speed01 (0..1 analog, 1 = run), run, look: [dx, dy]
// radians this frame, zoom: metres this frame (+ = out), held: Set, pressed: Set (this frame) }.

export const BINDINGS = {
  keys: {
    forward: ['KeyW', 'ArrowUp'], back: ['KeyS', 'ArrowDown'],
    left: ['KeyA', 'ArrowLeft'], right: ['KeyD', 'ArrowRight'],
    run: ['ShiftLeft', 'ShiftRight'], jump: ['Space'], enter: ['KeyF'], exit: ['Escape'],
    help: ['KeyH'], lookLeft: ['KeyQ'], lookRight: ['KeyE'],
    zoomIn: ['Equal', 'NumpadAdd'], zoomOut: ['Minus', 'NumpadSubtract'],
  },
  // standard gamepad mapping (https://w3c.github.io/gamepad/#remapping)
  pad: {
    axes: { moveX: 0, moveY: 1, lookX: 2, lookY: 3 },
    buttons: { jump: 0, enter: 0, exit: 1, run: 4, zoomOut: 6, zoomIn: 7, help: 8, menu: 9 },
    deadzone: 0.18,
    triggerDeadzone: 0.08,
  },
  look: { mouse: 0.005, touch: 0.006, stick: 2.6, keys: 1.8 }, // rad per px / rad per s
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
 * Combine sources into a frame. kb: readKeys result; pads: [readPad results]; touch:
 * { move, look:[dx,dy] px, zoom px } | null; mouse: { look:[dx,dy] px, wheel } accumulated.
 */
export function combine({ kb, pads = [], touch = null, mouse = null, dt, prevHeld = new Set(), b = BINDINGS }) {
  const held = new Set(kb.held);
  let move = kb.move, analog = Math.hypot(...kb.move) > 0 ? 1 : 0;
  let look = [0, 0], zoom = 0, padRun = false;
  for (const p of pads) {
    for (const a of p.held) held.add(a);
    const m = Math.hypot(...p.move);
    if (m > Math.hypot(...move)) { move = p.move; analog = m; padRun = m > 0.92; }
    look[0] += p.look[0] * b.look.stick * dt; look[1] += p.look[1] * b.look.stick * dt;
    zoom += p.zoom * b.zoom.triggers * dt;
  }
  if (touch) {
    const m = Math.hypot(...touch.move);
    if (m > Math.hypot(...move)) { move = touch.move; analog = Math.min(1, m); padRun = m > 0.92; }
    look[0] += touch.look[0] * b.look.touch; look[1] += touch.look[1] * b.look.touch;
    zoom += (touch.zoom || 0) * 0.02;
  }
  if (mouse) {
    look[0] += mouse.look[0] * b.look.mouse; look[1] += mouse.look[1] * b.look.mouse;
    zoom += mouse.wheel * b.zoom.wheel;
  }
  if (held.has('lookLeft')) look[0] -= b.look.keys * dt;
  if (held.has('lookRight')) look[0] += b.look.keys * dt;
  if (held.has('zoomIn')) zoom -= b.zoom.keys * dt;
  if (held.has('zoomOut')) zoom += b.zoom.keys * dt;
  const run = held.has('run') || padRun;
  return { move, speed01: Math.min(1, analog), run, look, zoom, held, kbHeld: kb.held, pressed: pressedEdges(prevHeld, held) };
}

/** Speed in m/s for a frame: keyboard walk/run; analog sticks scale the walk speed, full tilt runs. */
export function frameSpeed(frame, walk, run) {
  if (frame.run) return run;
  return walk * Math.max(frame.speed01, frame.speed01 > 0 ? 0.35 : 0);
}

/** DOM/Gamepad collector. onPad(name|null, connected) is called on hot-plug. */
export class Input {
  constructor(target, { onPad, touch } = {}) {
    this.codes = new Set();
    this.taps = new Set();
    this.mouse = { look: [0, 0], wheel: 0 };
    this.prevHeld = new Set();
    this.touch = touch || null; // object with .read() -> { move, look, zoom }
    this.lookActive = false; // mouse-drag look (walk mode only)
    this.padNames = new Map();
    const typing = (e) => /^(INPUT|SELECT|TEXTAREA)$/.test(e.target?.tagName || '') && e.target.type !== 'checkbox';
    window.addEventListener('keydown', (e) => {
      if (typing(e)) return;
      this.codes.add(e.code);
      if (!e.repeat) this.taps.add(e.code); // a tap shorter than a frame still counts once
      if (this.lookActive && /^(Space|Arrow)/.test(e.code)) e.preventDefault();
    });
    window.addEventListener('keyup', (e) => this.codes.delete(e.code));
    window.addEventListener('blur', () => this.codes.clear());
    let drag = null;
    target.addEventListener('pointerdown', (e) => { if (e.pointerType === 'mouse') drag = [e.clientX, e.clientY]; });
    window.addEventListener('pointermove', (e) => {
      if (!drag || !this.lookActive) return;
      this.mouse.look[0] += e.clientX - drag[0]; this.mouse.look[1] += e.clientY - drag[1];
      drag = [e.clientX, e.clientY];
    });
    window.addEventListener('pointerup', () => { drag = null; });
    target.addEventListener('wheel', (e) => { if (this.lookActive) { this.mouse.wheel += e.deltaY; e.preventDefault(); } }, { passive: false });
    window.addEventListener('gamepadconnected', (e) => onPad?.(e.gamepad.id, true));
    window.addEventListener('gamepaddisconnected', (e) => onPad?.(e.gamepad.id, false));
  }

  pads() {
    const list = navigator.getGamepads ? [...navigator.getGamepads()].filter((p) => p && p.connected) : [];
    return list.filter((p) => p.mapping === 'standard' || p.axes.length >= 4);
  }

  /** One frame of input (consumes accumulated mouse/touch deltas). */
  poll(dt) {
    const frame = combine({
      kb: readKeys(new Set([...this.codes, ...this.taps])), pads: this.pads().map((p) => readPad(p)), touch: this.touch?.read() || null,
      mouse: this.mouse, dt, prevHeld: this.prevHeld,
    });
    this.prevHeld = frame.held;
    this.taps.clear();
    this.mouse = { look: [0, 0], wheel: 0 };
    return frame;
  }
}
