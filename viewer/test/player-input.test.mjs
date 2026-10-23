// Player input layer (src/player/input.js): deadzones, key/gamepad mapping, edges, speeds.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BINDINGS, deadzone, readKeys, readPad, pressedEdges, combine, frameSpeed } from '../src/player/input.js';

const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} vs ${b}`);
const pad = (axes = [0, 0, 0, 0], pressed = []) => ({
  axes, buttons: Array.from({ length: 17 }, (_, i) => ({ pressed: pressed.includes(i), value: pressed.includes(i) ? 1 : 0 })),
});

test('radial deadzone: zero inside, rescaled outside, direction kept', () => {
  assert.deepEqual(deadzone(0.1, 0.1, 0.18), [0, 0]);
  const [x, y] = deadzone(1, 0, 0.18);
  near(x, 1); near(y, 0);
  const [a, b] = deadzone(0.3, 0.4, 0.18); // |v| = 0.5 -> (0.5 - 0.18) / 0.82
  near(Math.hypot(a, b), 0.32 / 0.82); near(a / b, 0.75);
  const [c, d] = deadzone(1, 1, 0.18); // corners clamp to 1
  near(Math.hypot(c, d), 1);
});

test('keyboard: WASD and arrows map to move, diagonals normalised, actions held', () => {
  const k = readKeys(new Set(['KeyW', 'KeyD', 'ShiftLeft']));
  near(k.move[0], Math.SQRT1_2); near(k.move[1], Math.SQRT1_2);
  assert.ok(k.held.has('run'));
  assert.deepEqual(readKeys(new Set(['ArrowDown'])).move, [0, -1]);
  assert.deepEqual(readKeys(new Set(['KeyA', 'KeyD'])).move, [0, 0]);
  assert.ok(readKeys(new Set(['Escape'])).held.has('exit'));
});

test('gamepad standard mapping: sticks (y up), buttons, triggers, stick drift ignored', () => {
  const p = readPad(pad([0.05, -1, 0.6, 0.1], [0, 7]));
  assert.ok(Math.abs(p.move[0]) < 0.06 && p.move[1] > 0.99); // up on the stick = forward
  assert.ok(p.look[0] > 0.4 && p.look[1] > 0 && p.look[1] < 0.15); // stick down-right: look right, a bit down
  assert.ok(p.held.has('jump') && p.held.has('enter') && p.held.has('zoomIn'));
  assert.ok(p.zoom < 0); // RT zooms in
  assert.ok(readPad(pad([0, 0, 0, 0], [1])).held.has('exit'));
  assert.ok(readPad(pad([0, 0, 0, 0], [8])).held.has('help'));
  assert.deepEqual(readPad(pad([0.12, -0.1, 0, 0])).move.map(Math.abs), [0, 0]);
});

test('bindings live in one table', () => {
  assert.deepEqual(BINDINGS.keys.jump, ['Space']);
  assert.equal(BINDINGS.pad.buttons.exit, 1);
});

test('pressed edges fire once per press', () => {
  const e = pressedEdges(new Set(['jump']), new Set(['jump', 'exit']));
  assert.deepEqual([...e], ['exit']);
  const f1 = combine({ kb: readKeys(new Set(['Space'])), dt: 1 / 60 });
  assert.ok(f1.pressed.has('jump'));
  const f2 = combine({ kb: readKeys(new Set(['Space'])), dt: 1 / 60, prevHeld: f1.held });
  assert.ok(!f2.pressed.has('jump'));
});

test('speeds: keyboard walks 1.4 / runs 4; a half-tilted stick walks slower, full tilt runs', () => {
  const kb = combine({ kb: readKeys(new Set(['KeyW'])), dt: 0.016 });
  near(frameSpeed(kb, 1.4, 4), 1.4);
  near(frameSpeed(combine({ kb: readKeys(new Set(['KeyW', 'ShiftLeft'])), dt: 0.016 }), 1.4, 4), 4);
  const half = combine({ kb: readKeys(new Set()), pads: [readPad(pad([0, -0.6, 0, 0]))], dt: 0.016 });
  assert.ok(frameSpeed(half, 1.4, 4) < 1.4 && frameSpeed(half, 1.4, 4) > 0.3);
  const full = combine({ kb: readKeys(new Set()), pads: [readPad(pad([0, -1, 0, 0]))], dt: 0.016 });
  near(frameSpeed(full, 1.4, 4), 4);
  near(frameSpeed(combine({ kb: readKeys(new Set()), dt: 0.016 }), 1.4, 4), 0);
});

test('look: right stick scales with dt, mouse drag with pixels, touch move used when strongest', () => {
  const f = combine({ kb: readKeys(new Set()), pads: [readPad(pad([0, 0, 1, 0]))], dt: 0.5 });
  near(f.look[0], BINDINGS.look.stick * 0.5);
  const m = combine({ kb: readKeys(new Set()), mouse: { look: [100, -50], wheel: 100 }, dt: 0.016 });
  near(m.look[0], 100 * BINDINGS.look.mouse); near(m.look[1], -50 * BINDINGS.look.mouse);
  assert.ok(m.zoom > 0);
  const t = combine({ kb: readKeys(new Set()), touch: { move: [0, 1], look: [0, 0] }, dt: 0.016 });
  assert.deepEqual(t.move, [0, 1]); assert.ok(t.run);
});
