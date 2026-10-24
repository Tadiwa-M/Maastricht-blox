// Camera rotation math (src/player/look.js), settings (settings.js), map orbit (maporbit.js)
// and the HUD hint line (hud.js hintFor).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  wrapAngle, angleDelta, applyLook, PITCH, mouseLook, moveHeading, smoothDamp, smoothDampAngle,
  StickLook, recenterYaw, takeSpin, viewYaw,
} from '../src/player/look.js';
import { sanitizeSettings, loadSettings, saveSettings, SETTINGS_DEFAULTS, SETTINGS_KEY } from '../src/player/settings.js';
import { orbitOffset, mapDragKind } from '../src/player/maporbit.js';
import { hintFor } from '../src/player/hud.js';

const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} vs ${b}`);
const DEG = Math.PI / 180;

test('yaw wraps to [-PI, PI) and turns are unlimited; angleDelta takes the short way', () => {
  near(wrapAngle(3 * Math.PI), -Math.PI);
  near(wrapAngle(-Math.PI / 2 - 4 * Math.PI), -Math.PI / 2);
  near(wrapAngle(0.25), 0.25);
  let s = { yaw: 0, pitch: 0 };
  for (let q = 0; q < 100; q++) s = applyLook(s, [0.5, 0]); // 50 rad of turning
  near(s.yaw, wrapAngle(50));
  assert.ok(s.yaw >= -Math.PI && s.yaw < Math.PI);
  near(angleDelta(3, -3), 2 * Math.PI - 6);
  near(angleDelta(-3, 3), -(2 * Math.PI - 6));
});

test('pitch clamps to about -35..70 degrees', () => {
  near(PITCH.min, -35 * DEG); near(PITCH.max, 70 * DEG);
  assert.equal(applyLook({ yaw: 0, pitch: 0 }, [0, 10]).pitch, PITCH.max);
  assert.equal(applyLook({ yaw: 0, pitch: 0 }, [0, -10]).pitch, PITCH.min);
  near(applyLook({ yaw: 0, pitch: 0.1 }, [0, 0.2]).pitch, 0.3);
});

test('mouse look: sensitivity scales both axes, invert Y flips only the vertical', () => {
  const [x1, y1] = mouseLook(100, 50, { base: 0.003, sens: 1 });
  near(x1, 0.3); near(y1, 0.15);
  const [x2, y2] = mouseLook(100, 50, { base: 0.003, sens: 2.5 });
  near(x2, 0.75); near(y2, 0.375);
  const [x3, y3] = mouseLook(100, 50, { base: 0.003, sens: 1, invertY: true });
  near(x3, 0.3); near(y3, -0.15);
});

test('camera-relative move: W goes where the camera looks, D to its right, S toward the camera', () => {
  near(moveHeading(0, [0, 1]), 0); // camera north, W -> north
  near(moveHeading(Math.PI / 2, [0, 1]), Math.PI / 2); // camera east, W -> east
  near(moveHeading(Math.PI / 2, [1, 0]), wrapAngle(Math.PI)); // camera east, D -> south
  near(Math.abs(moveHeading(0, [0, -1])), Math.PI); // S -> south
  near(moveHeading(-Math.PI / 4, [1, 1]), 0); // camera NW, W+D -> north
});

test('critically damped spring: converges, never overshoots, stable at 10 fps', () => {
  for (const dt of [1 / 144, 1 / 60, 1 / 10, 0.25]) {
    let v = 0, vel = 0, last = 0;
    for (let t = 0; t < 1.5; t += dt) {
      [v, vel] = smoothDamp(v, 1, vel, 0.05, dt);
      assert.ok(v >= last - 1e-12 && v <= 1, `dt ${dt}: ${v}`);
      last = v;
    }
    near(v, 1, 1e-4);
  }
  // angle version takes the short way across +-PI
  const [a] = smoothDampAngle(3.0, -3.0, 0, 0.05, 1 / 60);
  assert.ok(a > 3.0 || a < -3.0, `${a}`);
});

test('gamepad look curve: fine near the centre, full rate at full tilt, boost after holding', () => {
  const s = new StickLook();
  const [half] = s.step(0.5, 0, 0.1);
  const [full] = new StickLook().step(1, 0, 0.1);
  near(full, s.o.yawRate * 0.1);
  assert.ok(half < full * 0.5, 'half tilt turns less than half as fast (curve)');
  const held = new StickLook();
  let last = 0;
  for (let t = 0; t < 1.2; t += 0.05) last = held.step(1, 0, 0.05)[0];
  near(last, held.o.yawRate * (1 + held.o.boost) * 0.05, 1e-9);
  near(held.step(0.5, 0, 0.05)[0], new StickLook().step(0.5, 0, 0.05)[0]); // letting go resets the boost
  assert.deepEqual(held.step(0, 0, 0.05), [0, 0]);
  const [, inv] = new StickLook().step(0, 1, 0.1, { invertY: true });
  assert.ok(inv < 0);
  const [slow] = new StickLook().step(1, 0, 0.1, { sens: 0.5 });
  near(slow, full * 0.5);
});

test('auto-recenter: only after ~2 s idle while walking forward-ish, gently, toward behind the player', () => {
  const base = { idle: 3.5, moving: true, moveAngle: 0, dt: 1 / 60 };
  assert.equal(recenterYaw(0, 1, { ...base, idle: 1 }), 0, 'not before the delay');
  assert.equal(recenterYaw(0, 1, { ...base, moving: false }), 0, 'not while standing');
  assert.equal(recenterYaw(0, 1, { ...base, moveAngle: Math.PI }), 0, 'not when walking toward the camera');
  const step = recenterYaw(0, 1, base);
  assert.ok(step > 0 && step < 1.2 / 60 + 1e-12, `gentle: ${step}`);
  assert.ok(recenterYaw(0, 1, { ...base, idle: 2.2 }) < step, 'ramps in');
  let y = 0;
  for (let q = 0; q < 600; q++) y = recenterYaw(y, 1, base);
  near(y, 1, 0.02);
  assert.ok(recenterYaw(3, -3, base) > 3, 'short way round across +-PI');
});

test('settings: sanitized, saved and loaded; a throwing or missing storage falls back to defaults', () => {
  assert.deepEqual(sanitizeSettings(null), SETTINGS_DEFAULTS);
  const s = sanitizeSettings({ mouseSens: 99, padSens: '0.8', invertY: true, recenter: 'no', junk: 1 });
  assert.equal(s.mouseSens, 3); assert.equal(s.padSens, 0.8); assert.equal(s.invertY, true); assert.equal(s.recenter, true);
  assert.ok(!('junk' in s));
  const mem = new Map();
  const storage = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v) };
  assert.ok(saveSettings({ ...SETTINGS_DEFAULTS, mouseSens: 1.7, padInvertY: true }, storage));
  assert.ok(mem.has(SETTINGS_KEY));
  const back = loadSettings(storage);
  assert.equal(back.mouseSens, 1.7); assert.equal(back.padInvertY, true);
  const broken = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); } };
  assert.deepEqual(loadSettings(broken), SETTINGS_DEFAULTS);
  assert.equal(saveSettings(back, broken), false);
  assert.deepEqual(loadSettings(null), SETTINGS_DEFAULTS);
  mem.set(SETTINGS_KEY, '{not json');
  assert.deepEqual(loadSettings(storage), SETTINGS_DEFAULTS);
});

test('map orbit: rotation keeps the distance, tilt clamps to the polar limits, damped spin', () => {
  const off = [0, 10, 10];
  const r = orbitOffset(off, Math.PI / 2, 0);
  near(Math.hypot(...r), Math.hypot(...off)); near(r[0], 10); near(r[2], 0, 1e-9); near(r[1], 10);
  const flat = orbitOffset(off, 0, 10, 0.05, 80 * DEG);
  near(Math.acos(flat[1] / Math.hypot(...flat)), 80 * DEG);
  const top = orbitOffset(off, 0, -10, 0.05, 80 * DEG);
  near(Math.acos(top[1] / Math.hypot(...top)), 0.05);
  // pending spin drains smoothly and completely
  let pending = 1, total = 0;
  for (let q = 0; q < 120; q++) { let t; [t, pending] = takeSpin(pending, 1 / 60); total += t; }
  near(total, 1, 1e-6);
  const [first] = takeSpin(1, 1 / 60), [firstSlow] = takeSpin(1, 1 / 10);
  assert.ok(first > 0 && first < 0.3 && firstSlow > first, 'frame-rate aware share');
  near(viewYaw([0, 0, 10], [0, 0, 0]), 0); // camera south of the target looks north
  near(viewYaw([-10, 0, 0], [0, 0, 0]), Math.PI / 2); // camera west looks east
});

test('map drags: Ctrl/Alt + left orbits, middle tilts, plain left/right stay with MapControls', () => {
  assert.equal(mapDragKind({ pointerType: 'mouse', button: 0, ctrlKey: true }), 'orbit');
  assert.equal(mapDragKind({ pointerType: 'mouse', button: 0, altKey: true }), 'orbit');
  assert.equal(mapDragKind({ pointerType: 'mouse', button: 1 }), 'tilt');
  assert.equal(mapDragKind({ pointerType: 'mouse', button: 0 }), null);
  assert.equal(mapDragKind({ pointerType: 'mouse', button: 2 }), null);
  assert.equal(mapDragKind({ pointerType: 'touch', button: 0, ctrlKey: true }), null);
});

test('HUD hint follows the mode, the mouse lock and the device', () => {
  assert.match(hintFor('walk', { locked: false }), /Click to look around.*M map.*Esc menu/);
  assert.match(hintFor('walk', { locked: true }), /Mouse look.*M map.*Esc free mouse/);
  assert.match(hintFor('walk', { pad: true }), /right stick look/);
  assert.match(hintFor('walk', { touch: true }), /drag/);
  assert.match(hintFor('map'), /middle-drag tilt.*Q E/);
});
