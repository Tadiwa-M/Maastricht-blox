// Map-mode orbit extras on top of MapControls (right-drag orbit and wheel zoom stay theirs):
//   - Ctrl + left drag or Alt + left drag orbits (for a touchpad or a one-button mouse)
//   - middle drag tilts (up/down only; MapControls would dolly)
//   - Q / E and the gamepad right stick turn continuously (index.js feeds add())
//   - north(): turn the view to look north (the compass button)
// Every rotation goes through a pending spin that is applied with exponential damping, so
// keys, sticks and drags start and stop smoothly at any frame rate. Applied in the player's
// per-frame tick, i.e. after controls.update() and CityCamera.update(), around
// controls.target, with the polar angle kept inside the controls' (zoom-dependent) limits.
import { takeSpin, angleDelta, clamp } from './look.js';

/** Rotate an offset [x, y, z] (camera - target) by dTheta (around +y) and dPhi (from +y). */
export function orbitOffset([x, y, z], dTheta, dPhi, minPhi = 0.05, maxPhi = Math.PI / 2) {
  const r = Math.hypot(x, y, z);
  if (r < 1e-9) return [x, y, z];
  const theta = Math.atan2(x, z) + dTheta;
  const phi = clamp(Math.acos(clamp(y / r, -1, 1)) + dPhi, minPhi, maxPhi);
  const s = Math.sin(phi) * r;
  return [s * Math.sin(theta), Math.cos(phi) * r, s * Math.cos(theta)];
}

/** Mouse/keyboard event -> which map drag we own: 'orbit' | 'tilt' | null (MapControls). */
export function mapDragKind(e) {
  if (e.pointerType && e.pointerType !== 'mouse') return null;
  if (e.button === 1) return 'tilt';
  if (e.button === 0 && (e.ctrlKey || e.altKey || e.metaKey)) return 'orbit';
  return null;
}

export class MapOrbit {
  /** canvas: the controls' element; controls: MapControls; camera: its camera. */
  constructor(canvas, controls, camera) {
    Object.assign(this, { canvas, controls, camera });
    this.enabled = true;
    this.spin = { theta: 0, phi: 0 };
    let drag = null;
    // capture phase on the canvas: runs before MapControls' own pointerdown on the same element
    canvas.addEventListener('pointerdown', (e) => {
      const kind = this.enabled && controls.enabled ? mapDragKind(e) : null;
      if (!kind) return;
      e.stopImmediatePropagation();
      e.preventDefault(); // no middle-click autoscroll
      drag = { kind, x: e.clientX, y: e.clientY, id: e.pointerId };
      try { canvas.setPointerCapture(e.pointerId); } catch { /* synthetic event */ }
    }, { capture: true });
    canvas.addEventListener('pointermove', (e) => {
      if (!drag || e.pointerId !== drag.id) return;
      const h = canvas.clientHeight || 800, k = (Math.PI * 2) / h; // same speed as a right drag
      if (drag.kind === 'orbit') this.add(-(e.clientX - drag.x) * k, -(e.clientY - drag.y) * k);
      else this.add(0, -(e.clientY - drag.y) * k);
      drag.x = e.clientX; drag.y = e.clientY;
    });
    const end = (e) => { if (drag && e.pointerId === drag.id) drag = null; };
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);
    canvas.addEventListener('auxclick', (e) => { if (e.button === 1) e.preventDefault(); });
  }

  /** Queue a rotation: dTheta around the vertical (+ = counter-clockwise from above), dPhi tilt (+ = toward the horizon). */
  add(dTheta, dPhi) { this.spin.theta += dTheta; this.spin.phi += dPhi; }

  /** Compass yaw the camera looks toward (0 = north). */
  yaw() {
    const c = this.camera.position, t = this.controls.target;
    return Math.atan2(t.x - c.x, -(t.z - c.z));
  }

  /** Turn to look north (pending spin replaced, so a double click does not over-turn). */
  north() {
    // looking north = camera due south of the target: theta = atan2(x, z) = 0
    const c = this.camera.position, t = this.controls.target;
    this.spin.theta = angleDelta(Math.atan2(c.x - t.x, c.z - t.z), 0);
  }

  /** Apply this frame's share of the pending spin. */
  step(dt) {
    if (!this.enabled) { this.spin.theta = this.spin.phi = 0; return; }
    let a, b;
    [a, this.spin.theta] = takeSpin(this.spin.theta, dt);
    [b, this.spin.phi] = takeSpin(this.spin.phi, dt);
    if (!a && !b) return;
    const { camera, controls } = this, t = controls.target, p = camera.position;
    const maxPhi = Math.min(controls.maxPolarAngle ?? Math.PI / 2, Math.PI / 2 - 0.02);
    const off = orbitOffset([p.x - t.x, p.y - t.y, p.z - t.z], a, b, Math.max(0.05, controls.minPolarAngle || 0), maxPhi);
    p.set(t.x + off[0], t.y + off[1], t.z + off[2]);
    camera.lookAt(t);
  }
}
