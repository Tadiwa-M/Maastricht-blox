// Shooting in capture the flag, on this player's side: the brick gun in the hands (seen from the
// eyes when you aim, at the figure's side otherwise), aiming down the sights and the scout's
// scope (the follow camera moves in to the eyes and narrows its view), recoil, the crosshair that
// opens with the spread, tracers, hit markers, health, and the touch buttons. The numbers and
// the hit maths are weapons.js; the room decides the damage (relay/src/ctf.js shoot).
import * as THREE from 'three';
import { comicFx } from '../render/comicfx.js';
import { WEAPONS, PICKUP_R, PICKUP_BACK_S, Gun, spreadDir, hitTest, wallT, meleeTarget, pickupSpots, savedPrimary, REGEN } from './weapons.js';
import { TEAM_HEX } from './model.js';
import { standSpot } from '../player/spot.js';

const HIP_DIST = 2.6, EYE_DIST = 0.05, TRACER_S = 0.09, DARK = '#4b4f5c';
export const COMBAT_SHOULDER = 0.85; // m: the hip-fire camera over the right shoulder
const _L = new THREE.Vector3(), _R = new THREE.Vector3(), _D = new THREE.Vector3(), _T = new THREE.Vector3(), _UP = new THREE.Vector3(0, 1, 0), _M = new THREE.Matrix4(), _Q = new THREE.Quaternion();
const CSS = `
#cb { position: fixed; inset: 0; pointer-events: none; z-index: 4; font-family: system-ui, sans-serif; }
#cb[hidden] { display: none; }
#cb-x { position: absolute; left: 50%; top: 50%; }
#cb-x i { position: absolute; background: #fff; box-shadow: 0 0 2px #000; }
#cb-x .d { width: 2px; height: 2px; left: -1px; top: -1px; border-radius: 50%; }
#cb-hit { position: absolute; left: 50%; top: 50%; width: 26px; height: 26px; margin: -13px; opacity: 0; transition: opacity .25s;
  background: linear-gradient(45deg, transparent 46%, #fff 46%, #fff 54%, transparent 54%), linear-gradient(-45deg, transparent 46%, #fff 46%, #fff 54%, transparent 54%); }
#cb-hit.on { opacity: 1; transition: none; } #cb-hit.kill { filter: drop-shadow(0 0 3px #f33) sepia(1) saturate(20) hue-rotate(-50deg); transform: scale(1.4); }
#cb-scope { position: absolute; inset: 0; opacity: 0;
  background: radial-gradient(circle at center, transparent 0, transparent 37vmin, rgba(0,0,0,.6) 37.6vmin, #000 39vmin); }
#cb-scope::before, #cb-scope::after { content: ''; position: absolute; background: rgba(0,0,0,.85); }
#cb-scope::before { left: 50%; top: calc(50% - 37vmin); width: 1px; height: 74vmin; }
#cb-scope::after { top: 50%; left: calc(50% - 37vmin); height: 1px; width: 74vmin; }
#cb-dmg { position: absolute; inset: 0; opacity: 0; background: radial-gradient(ellipse at center, transparent 45%, rgba(210,20,20,.75) 100%); }
#cb-hp { position: absolute; left: 16px; bottom: 16px; width: 150px; height: 12px; border-radius: 7px; background: rgba(10,12,40,.7); overflow: hidden; border: 2px solid rgba(255,255,255,.35); }
#cb-hp b { display: block; height: 100%; background: #5fd66b; transition: width .15s; }
#cb-ammo { position: absolute; right: 70px; bottom: 16px; color: #fff; text-align: right; text-shadow: 0 1px 3px #000; font-weight: 700; }
#cb-ammo span { font-size: 26px; } #cb-ammo small { display: block; font-size: 11px; letter-spacing: .12em; opacity: .85; text-transform: uppercase; }
#cb-ammo u { display: block; height: 3px; margin-top: 3px; background: #F2C200; text-decoration: none; }
#cb-tip { position: absolute; left: 50%; bottom: 64px; transform: translateX(-50%); max-width: min(92vw, 640px); padding: 8px 14px; border-radius: 10px;
  background: rgba(11,13,42,.82); border-top: 3px solid #F2A900; color: #f6f3ea; font-size: 13px; line-height: 1.45; text-align: center; transition: opacity .6s; }
#cb-tip b { color: #F2A900; font-weight: 700; } #cb-tip.gone { opacity: 0; }
#cb-dir { position: absolute; left: 50%; top: 50%; width: 0; height: 0; opacity: 0; }
#cb-dir::before { content: ''; position: absolute; left: -46px; top: calc(-1 * min(30vmin, 190px)); width: 92px; height: 26px; box-sizing: border-box;
  border-top: 7px solid rgba(255,60,50,.95); border-radius: 50% 50% 0 0 / 100% 100% 0 0; filter: drop-shadow(0 0 6px rgba(255,40,30,.8)); }
#cb-obj { position: absolute; left: 50%; top: 58px; width: min(64vw, 420px); height: 30px; margin-left: calc(-1 * min(32vw, 210px)); }
#cb-obj::before { content: ''; position: absolute; left: 0; right: 0; top: 14px; height: 2px; background: linear-gradient(90deg, transparent, rgba(255,255,255,.35), transparent); }
#cb-obj i { position: absolute; top: 0; transform: translateX(-50%); padding: 3px 9px; border-radius: 9px; font: 700 12px/1.4 system-ui, sans-serif; font-style: normal;
  color: #11143a; background: #F2A900; white-space: nowrap; box-shadow: 0 2px 0 rgba(0,0,0,.35); transition: left .08s linear; }
@media (max-height: 500px) { #cb-obj { top: 46px; } }
#cb-cue { position: absolute; left: 50%; top: calc(50% + 34px); transform: translateX(-50%); min-width: 74px; text-align: center; color: #fff;
  font: 700 11px/1.3 system-ui, sans-serif; letter-spacing: .1em; text-shadow: 0 1px 3px #000; }
#cb-cue.warn { color: #ffb14a; } #cb-cue.empty { color: #ff6a5a; animation: cbblink .7s steps(2) infinite; }
#cb-cue u { display: block; height: 3px; margin: 3px auto 0; width: 74px; background: rgba(255,255,255,.25); text-decoration: none; border-radius: 2px; overflow: hidden; }
#cb-cue u b { display: block; height: 100%; background: #F2C200; }
@keyframes cbblink { 50% { opacity: .35; } }
@media (prefers-reduced-motion: reduce) { #cb-cue.empty { animation: none; } }
#cb-down { position: absolute; left: 0; right: 0; top: 38%; text-align: center; color: #fff; font-size: 22px; font-weight: 800; text-shadow: 0 2px 6px #000; }
.cb-btn { position: fixed; z-index: 6; pointer-events: auto; border-radius: 50%; border: 2px solid rgba(255,255,255,.6); background: rgba(17,20,58,.55);
  color: #fff; font: 700 12px system-ui, sans-serif; touch-action: none; user-select: none; -webkit-user-select: none; }
.cb-btn[hidden] { display: none; } .cb-btn.on { background: rgba(242,169,0,.8); }
#cb-fire { right: 24px; bottom: 190px; width: 84px; height: 84px; background: rgba(200,40,40,.55); }
#cb-aim { right: 122px; bottom: 150px; width: 62px; height: 62px; }
#cb-swap { right: 122px; bottom: 226px; width: 52px; height: 52px; }
#cb-knife { right: 30px; bottom: 286px; width: 52px; height: 52px; }
#cb-ammo em { display: block; font-style: normal; font-size: 10px; opacity: .7; font-weight: 400; }
@media (max-width: 600px), (max-height: 500px) { #cb-hp { bottom: 8px; left: 8px; width: 110px; } #cb-ammo { bottom: 8px; } }
/* phones: the jump and fire buttons own the bottom right; the ammo sits bottom left by the health bar */
@media (pointer: coarse) { #cb-ammo { right: auto; left: 16px; bottom: 36px; text-align: left; } #cb-ammo u { width: 110px; } }
`;

function box(parent, w, h, d, x, y, z, mat) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  parent.add(m);
  return m;
}

/** A gun out of bricks: the barrel points along -z, the grip is at the origin. */
export function buildGun(kind, accentHex) {
  const g = new THREE.Group();
  const dark = new THREE.MeshStandardMaterial({ color: DARK, roughness: 0.45, metalness: 0.1 });
  const accent = new THREE.MeshStandardMaterial({ color: accentHex, roughness: 0.4 });
  const stud = new THREE.CylinderGeometry(0.014, 0.014, 0.012, 10);
  const studs = (z0, z1, y) => { for (let z = z0; z >= z1; z -= 0.045) { const s = new THREE.Mesh(stud, dark); s.position.set(0, y, z); g.add(s); } };
  if (kind === 'knife') {
    const steel = new THREE.MeshStandardMaterial({ color: '#cfd4dc', roughness: 0.25, metalness: 0.7 });
    box(g, 0.035, 0.045, 0.13, 0, 0, 0.05, dark);
    box(g, 0.06, 0.02, 0.02, 0, 0, -0.02, accent);
    box(g, 0.012, 0.04, 0.2, 0, 0.002, -0.13, steel);
    box(g, 0.012, 0.025, 0.05, 0, -0.004, -0.25, steel);
    g.userData.muzzle = new THREE.Vector3(0, 0, -0.28);
    g.userData.aim = new THREE.Vector3(0.12, -0.14, -0.4);
  } else if (kind === 'shotgun') {
    const wood = new THREE.MeshStandardMaterial({ color: '#8a5a2b', roughness: 0.6 });
    box(g, 0.07, 0.085, 0.3, 0, 0.02, -0.04, dark);
    box(g, 0.045, 0.045, 0.42, 0, 0.04, -0.4, dark);
    box(g, 0.04, 0.035, 0.36, 0, -0.005, -0.36, dark);
    box(g, 0.065, 0.055, 0.16, 0, -0.005, -0.34, wood);
    box(g, 0.055, 0.1, 0.24, 0, -0.01, 0.23, wood);
    box(g, 0.045, 0.1, 0.05, 0, -0.07, 0.08, wood);
    box(g, 0.072, 0.02, 0.1, 0, 0.02, -0.04, accent);
    box(g, 0.014, 0.022, 0.014, 0, 0.073, -0.58, dark);
    g.userData.muzzle = new THREE.Vector3(0, 0.04, -0.63);
    g.userData.aim = new THREE.Vector3(0, -0.088, -0.62);
  } else if (kind === 'smg') { // short, a long curved magazine, a folding stock
    box(g, 0.06, 0.08, 0.3, 0, 0.02, -0.05, dark);
    box(g, 0.026, 0.026, 0.12, 0, 0.03, -0.26, dark);
    box(g, 0.04, 0.2, 0.05, 0, -0.11, -0.08, accent);
    box(g, 0.04, 0.09, 0.05, 0, -0.07, 0.07, dark);
    box(g, 0.02, 0.02, 0.18, 0.02, 0.01, 0.18, dark);
    g.userData.muzzle = new THREE.Vector3(0, 0.03, -0.33);
    g.userData.aim = new THREE.Vector3(0, -0.1, -0.52);
  } else if (kind === 'pistol') {
    box(g, 0.035, 0.045, 0.19, 0, 0.03, -0.05, dark);
    box(g, 0.032, 0.11, 0.045, 0, -0.04, 0.02, accent);
    g.userData.muzzle = new THREE.Vector3(0, 0.03, -0.16);
    g.userData.aim = new THREE.Vector3(0, -0.09, -0.42);
  } else if (kind === 'lmg') { // long, a box magazine under, a bipod folded
    box(g, 0.08, 0.1, 0.55, 0, 0.02, -0.1, dark);
    box(g, 0.035, 0.035, 0.36, 0, 0.03, -0.54, dark);
    box(g, 0.09, 0.09, 0.12, 0, -0.07, -0.08, accent);
    box(g, 0.055, 0.1, 0.22, 0, 0, 0.27, dark);
    box(g, 0.045, 0.1, 0.05, 0, -0.07, 0.1, dark);
    box(g, 0.012, 0.012, 0.25, 0.03, -0.03, -0.45, dark); box(g, 0.012, 0.012, 0.25, -0.03, -0.03, -0.45, dark);
    g.userData.muzzle = new THREE.Vector3(0, 0.03, -0.74);
    g.userData.aim = new THREE.Vector3(0, -0.11, -0.7);
  } else if (kind === 'ammo') { // an olive ammo box with a yellow band
    box(g, 0.34, 0.2, 0.2, 0, 0, 0, new THREE.MeshStandardMaterial({ color: '#4f5a2c', roughness: 0.7 }));
    box(g, 0.345, 0.04, 0.205, 0, 0.03, 0, new THREE.MeshStandardMaterial({ color: '#F2C200', roughness: 0.5 }));
    box(g, 0.12, 0.03, 0.03, 0, 0.12, 0, dark);
  } else if (kind === 'med') { // a white medkit with a red cross
    const red = new THREE.MeshStandardMaterial({ color: '#d7263d', roughness: 0.5 });
    box(g, 0.32, 0.22, 0.12, 0, 0, 0, new THREE.MeshStandardMaterial({ color: '#f4f4f0', roughness: 0.5 }));
    box(g, 0.16, 0.05, 0.125, 0, 0, 0.002, red); box(g, 0.05, 0.16, 0.125, 0, 0, 0.002, red);
  } else if (kind === 'scout') {
    const wood = new THREE.MeshStandardMaterial({ color: '#8a5a2b', roughness: 0.6 });
    box(g, 0.06, 0.07, 0.5, 0, 0.02, -0.1, dark);
    box(g, 0.026, 0.026, 0.5, 0, 0.03, -0.58, dark);
    box(g, 0.055, 0.1, 0.26, 0, -0.01, 0.27, wood);
    box(g, 0.045, 0.1, 0.05, 0, -0.07, 0.08, wood);
    box(g, 0.05, 0.03, 0.2, 0, -0.03, -0.15, accent);
    const scope = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.26, 14), dark);
    scope.rotation.x = Math.PI / 2; scope.position.set(0, 0.1, -0.08);
    g.add(scope);
    box(g, 0.02, 0.03, 0.03, 0, 0.065, -0.02, dark); box(g, 0.02, 0.03, 0.03, 0, 0.065, -0.15, dark);
    g.userData.muzzle = new THREE.Vector3(0, 0.03, -0.84);
    g.userData.aim = new THREE.Vector3(0, -0.1, -0.3);
  } else {
    box(g, 0.065, 0.085, 0.42, 0, 0.02, -0.08, dark);
    box(g, 0.03, 0.03, 0.26, 0, 0.03, -0.42, dark);
    box(g, 0.055, 0.09, 0.2, 0, 0, 0.23, dark);
    box(g, 0.045, 0.1, 0.05, 0, -0.07, 0.08, dark);
    box(g, 0.045, 0.15, 0.07, 0, -0.1, -0.1, accent);
    box(g, 0.067, 0.02, 0.18, 0, 0.0, -0.2, accent);
    box(g, 0.014, 0.035, 0.014, 0, 0.08, -0.27, dark);
    box(g, 0.03, 0.03, 0.02, 0, 0.078, 0.06, dark);
    studs(0.0, -0.22, 0.068);
    g.userData.muzzle = new THREE.Vector3(0, 0.03, -0.56);
    g.userData.aim = new THREE.Vector3(0, -0.1, -0.66); // far enough that the stock does not fill the view
  }
  return g;
}

const el = (tag, props = {}, parent = null) => { const e = Object.assign(document.createElement(tag), props); parent?.append(e); return e; };
const lerp = (a, b, t) => a + (b - a) * t;
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

/**
 * Shot sounds (Web Audio, no files), one character per weapon: the rifle a short crack with a
 * thump, the scout a loud crack with a long tail, the shotgun a deep boom and then the pump
 * (two clicks), the knife a whoosh. Every shot echoes off the street walls (a short feedback
 * delay). Silent when the game's sound is muted.
 */
export const SHOT_SOUND = {
  rifle: { len: 0.12, lp: 2600, f0: 170, f1: 50, gain: 1, echo: 0.11, fb: 0.28 },
  scout: { len: 0.32, lp: 1900, f0: 125, f1: 38, gain: 1.35, echo: 0.17, fb: 0.38 },
  shotgun: { len: 0.45, lp: 750, f0: 85, f1: 28, gain: 1.6, echo: 0.14, fb: 0.36, pump: 0.42 },
  knife: { len: 0.13, lp: 0, f0: 0, f1: 0, gain: 0.5, echo: 0, fb: 0, whoosh: true },
};
class ShotSound {
  play(kind, gain = 1) {
    const prefs = window.__bloxAudio?.prefs;
    if (prefs?.muted || prefs?.volume === 0 || gain < 0.02) return;
    try {
      this.ac = this.ac || new (window.AudioContext || window.webkitAudioContext)();
      const ac = this.ac, t = ac.currentTime, P = SHOT_SOUND[kind] || SHOT_SOUND.rifle;
      const vol = 0.16 * gain * P.gain * (prefs?.volume ?? 0.35) / 0.35;
      const out = ac.createGain(); out.gain.value = 1; out.connect(ac.destination);
      if (P.echo) { // the street's echo
        const dl = ac.createDelay(1), fb = ac.createGain(), wet = ac.createGain();
        dl.delayTime.value = P.echo; fb.gain.value = P.fb; wet.gain.value = 0.5;
        out.connect(dl); dl.connect(fb).connect(dl); dl.connect(wet).connect(ac.destination);
        setTimeout(() => { try { out.disconnect(); dl.disconnect(); fb.disconnect(); wet.disconnect(); } catch { /* gone */ } }, 2500);
      }
      const noise = (len, at, type, f, g) => {
        const buf = ac.createBuffer(1, Math.ceil(ac.sampleRate * len), ac.sampleRate), d = buf.getChannelData(0);
        for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length) ** 2.2;
        const n = ac.createBufferSource(); n.buffer = buf;
        const flt = ac.createBiquadFilter(); flt.type = type; flt.frequency.value = f;
        const gn = ac.createGain(); gn.gain.setValueAtTime(g, at); gn.gain.exponentialRampToValueAtTime(0.001, at + len);
        n.connect(flt).connect(gn).connect(out); n.start(at);
        return flt;
      };
      if (P.whoosh) { const flt = noise(P.len, t, 'bandpass', 600, vol); flt.frequency.exponentialRampToValueAtTime(3000, t + P.len); return; }
      noise(P.len, t, 'lowpass', P.lp, vol);
      noise(0.025, t, 'highpass', 3000, vol * 0.6); // the crack
      const o = ac.createOscillator(), og = ac.createGain();
      o.frequency.setValueAtTime(P.f0, t); o.frequency.exponentialRampToValueAtTime(P.f1, t + P.len);
      og.gain.setValueAtTime(vol * 1.1, t); og.gain.exponentialRampToValueAtTime(0.001, t + P.len);
      o.connect(og).connect(out); o.start(t); o.stop(t + P.len);
      if (P.pump) { noise(0.03, t + P.pump, 'highpass', 1800, vol * 0.35); noise(0.035, t + P.pump + 0.12, 'highpass', 1400, vol * 0.4); }
    } catch { /* no audio */ }
  }
}

// Shots are a tick, being hit a thump, a knock-out a long shake. Phones: navigator.vibrate (Android;
// iPhones do not offer it to web pages). Gamepads: the pad's rumble motors, where the browser has them.
export const HAPTICS = {
  rifle: [10, { ms: 45, weak: 0.5, strong: 0.15 }],
  scout: [35, { ms: 140, weak: 0.7, strong: 0.9 }],
  shotgun: [45, { ms: 160, weak: 0.8, strong: 1 }],
  knife: [20, { ms: 70, weak: 0.3, strong: 0.5 }],
  hit: [15, { ms: 60, weak: 0.6, strong: 0 }], // my shot landed
  shove: [25, { ms: 90, weak: 0.5, strong: 0.3 }], // brushed someone aside
  kill: [[20, 40, 60], { ms: 180, weak: 1, strong: 0.4 }],
  hurt: [70, { ms: 150, weak: 0.4, strong: 0.9 }],
  down: [[120, 60, 220], { ms: 500, weak: 1, strong: 1 }],
  pickup: [[15, 30, 15], { ms: 80, weak: 0.6, strong: 0.2 }],
  empty: [8, { ms: 30, weak: 0.25, strong: 0 }],
};

/** Play a HAPTICS entry on whatever this device has. nav: navigator (for tests). Never throws. */
export function haptic(kind, nav = typeof navigator !== 'undefined' ? navigator : null) {
  const h = HAPTICS[kind];
  if (!h || !nav) return false;
  let felt = false;
  try { if (typeof nav.vibrate === 'function') felt = nav.vibrate(h[0]) !== false; } catch { /* not allowed here */ }
  try { for (const pad of nav.getGamepads?.() || []) if (pad?.connected && rumble(pad, h[1])) felt = true; } catch { /* no rumble */ }
  return felt;
}

/**
 * Rumble one gamepad by whatever the browser offers: Chrome/Edge `vibrationActuator.playEffect`
 * ('dual-rumble'; on PlayStation and Xbox pads), the older `hapticActuators[0].pulse` (Firefox).
 * -> true when a rumble was asked for (the browser may still not move the motors).
 */
export function rumble(pad, { ms, weak, strong }) {
  const act = pad?.vibrationActuator;
  if (act?.playEffect && (!act.effects || act.effects.includes('dual-rumble'))) {
    act.playEffect('dual-rumble', { startDelay: 0, duration: ms, weakMagnitude: weak, strongMagnitude: strong })?.catch?.(() => {});
    // pads with trigger motors (Xbox, and DualSense where the browser maps them) feel it in the triggers too
    if (act.effects?.includes('trigger-rumble')) act.playEffect('trigger-rumble', { startDelay: 0, duration: ms, leftTrigger: weak * 0.6, rightTrigger: strong })?.catch?.(() => {});
    return true;
  }
  const old = pad?.hapticActuators?.[0];
  if (old?.pulse) { old.pulse(Math.max(weak, strong), ms)?.catch?.(() => {}); return true; }
  return false;
}

/**
 * What this browser says about each connected controller's rumble (Settings > Test controller
 * rumble): -> [{ name, how: 'dual-rumble' | 'pulse' | null, effects }]; buzzes each one that can.
 */
export function rumbleReport(nav = typeof navigator !== 'undefined' ? navigator : null) {
  const out = [];
  for (const pad of [...(nav?.getGamepads?.() || [])]) {
    if (!pad?.connected) continue;
    const act = pad.vibrationActuator, how = act?.playEffect ? 'dual-rumble' : pad.hapticActuators?.[0]?.pulse ? 'pulse' : null;
    rumble(pad, { ms: 400, weak: 0.8, strong: 1 });
    out.push({ name: pad.id.replace(/\s*\(.*$/, '').slice(0, 40), how, effects: act?.effects ? [...act.effects] : null });
  }
  return out;
}

/** Can this gamepad rumble from a web page? (said when it connects) */
export const canRumble = (pad) => !!(pad?.vibrationActuator?.playEffect || pad?.hapticActuators?.[0]?.pulse);

export const HIT_DIR_S = 1.6;
export const READY_HOLD_S = 1.4; // the gun stays shouldered this long after the last shot
export const SPRINT_FROM = 4.2; // m/s: faster than this the gun goes to a sprint carry
/**
 * Screen angle (radians, clockwise from straight up) toward a shooter: pos is my feet (three.js
 * [x, y, z]), from the shooter's [x, z], yaw the compass direction the camera looks (0 = north,
 * three.js -z). 0: in front, +pi/2: to my right, pi: behind.
 */
export function hitAngle(pos, from, yaw) {
  const bearing = Math.atan2(from[0] - pos[0], -(from[1] - pos[2]));
  return Math.atan2(Math.sin(bearing - yaw), Math.cos(bearing - yaw));
}

export const LOW_AMMO = 0.25; // a magazine at or under this share is "low"
/**
 * What to say under the crosshair about the weapon in hand: null (nothing to say), or
 * { text, level: '' | 'warn' | 'empty', progress: 0..1 | null (the reload bar) }.
 */
export function ammoCue(gun, touch = false) {
  const d = gun.def;
  if (d.melee) return null;
  if (gun.reloading) return { text: 'RELOADING', level: '', progress: gun.reloadProgress };
  const n = gun.ammo[gun.w];
  if (n === 0) return { text: 'EMPTY', level: 'empty', progress: null };
  if (n <= Math.max(1, Math.floor(d.mag * LOW_AMMO))) return { text: touch ? `LOW · ${n}` : `LOW · ${n} · R`, level: 'warn', progress: null };
  return null;
}

export const STRIP_HALF = 1.0; // the strip at the top spans this many radians to each side of straight ahead
/**
 * Where a target at screen angle a (hitAngle) sits on the objective strip: x -1 (left end) .. 1
 * (right end); side -1 / 1 when it is further round than the strip shows (pinned to that end
 * with an arrow), else 0.
 */
export function stripMark(a) {
  if (Math.abs(a) <= STRIP_HALF) return { x: a / STRIP_HALF, side: 0 };
  return { x: Math.sign(a), side: Math.sign(a) };
}

export const TIP_S = 14;
/** The how-to-play line shown when a player's first match in a room starts. */
export function controlsTip(touch) {
  return touch
    ? '<b>FIRE</b> shoots · <b>AIM</b> looks down the sights · <b>SWAP</b> changes weapon · <b>KNIFE</b> knocks out in one hit up close · walk over a <b>yellow pad</b> for a scout or a shotgun'
    : '<b>Left mouse</b> fire · <b>right mouse</b> aim · <b>Q</b> or <b>1 2 3</b> weapon · <b>R</b> reload · <b>V</b> knife: one hit up close · walk over a <b>yellow pad</b> for a scout or a shotgun';
}

export class Combat {
  /** o: { scene, camera, city, origin, player: () => __bloxPlayer, send(msg), enemies: () => [{ id, pos, scale }] } */
  constructor(o) {
    Object.assign(this, o);
    this.gun = new Gun();
    this.aim = 0; this.aiming = false; this.fire = false; this.want = { reload: false, swap: false, slot: null, stab: false };
    this.camPos = new THREE.Vector3(); this.camDir = new THREE.Vector3(0, 0, -1); this.stabT = 0;
    this.pickups = []; this.pickGroup = new THREE.Group();
    this.hp = 100; this.maxHp = 100; this.down = 0; this.zoom2 = false;
    this.kick = 0; this.sway = 0; this.dmg = 0; this.hitT = 0; this.prevAim = null; this.saved = null; this.active = false;
    this.sound = new ShotSound();
    this.touch = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
    this.buildDom(); this.buildScene(); this.listen();
  }

  buildDom() {
    if (!document.getElementById('cb-css')) el('style', { id: 'cb-css', textContent: CSS }, document.head);
    const r = this.root = el('div', { id: 'cb', hidden: true }, document.body);
    this.scopeEl = el('div', { id: 'cb-scope' }, r);
    this.dmgEl = el('div', { id: 'cb-dmg' }, r);
    this.dirEl = el('div', { id: 'cb-dir' }, r); // where the last hit came from
    this.cueEl = el('div', { id: 'cb-cue' }, r); // ammo state where the eyes are: low, empty, reloading
    this.objEl = el('i', {}, el('div', { id: 'cb-obj' }, r)); // where to go: the flag, or home with it
    this.xEl = el('div', { id: 'cb-x' }, r);
    this.xLines = [0, 1, 2, 3].map(() => el('i', {}, this.xEl));
    el('i', { className: 'd' }, this.xEl);
    this.hitEl = el('div', { id: 'cb-hit' }, r);
    this.hpEl = el('b', {}, el('div', { id: 'cb-hp' }, r));
    this.ammoEl = el('div', { id: 'cb-ammo' }, r);
    this.downEl = el('div', { id: 'cb-down', hidden: true }, r);
    this.tipEl = el('div', { id: 'cb-tip', className: 'gone', innerHTML: controlsTip(this.touch) }, r);
    const btn = (id, text, down, up) => {
      const b = el('button', { id, className: 'cb-btn', textContent: text, hidden: true }, document.body);
      b.addEventListener('pointerdown', (e) => { e.stopPropagation(); e.preventDefault(); down(b); });
      for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) b.addEventListener(ev, (e) => { e.stopPropagation(); up?.(b); });
      return b;
    };
    this.btns = [
      btn('cb-fire', 'FIRE', () => { this.fire = this.tap = true; }, () => { this.fire = false; }),
      btn('cb-aim', 'AIM', (b) => { this.aiming = !this.aiming; b.classList.toggle('on', this.aiming); }),
      btn('cb-swap', 'SWAP', () => { this.want.swap = true; }),
      btn('cb-knife', 'KNIFE', () => { this.want.stab = true; }),
    ];
  }

  buildScene() {
    if (!this.camera.parent) this.scene.add(this.camera); // the gun in the hands is a child of the camera
    this.hands = new THREE.Group(); this.camera.add(this.hands);
    this.side = new THREE.Group(); this.scene.add(this.side);
    this.hands.visible = this.side.visible = false; // nothing in the hands until a match is on (the lobby showed a gun across the screen)
    this.models = {};
    this.setTeam('blue');
    const mat = new THREE.MeshBasicMaterial({ color: '#ffe9a0', transparent: true, opacity: 0.9, toneMapped: false, depthWrite: false });
    const geo = new THREE.BoxGeometry(0.025, 0.025, 1);
    this.tracers = Array.from({ length: 24 }, () => { const m = new THREE.Mesh(geo, mat); m.visible = false; m.frustumCulled = false; this.scene.add(m); return { m, t: 0 }; });
    this.flash = new THREE.Mesh(new THREE.OctahedronGeometry(0.07), new THREE.MeshBasicMaterial({ color: '#fff3b0', toneMapped: false }));
    this.flash.visible = false; this.scene.add(this.flash);
    this.puffs = Array.from({ length: 10 }, () => { const m = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 0.12), new THREE.MeshBasicMaterial({ color: '#d8d2c4', transparent: true })); m.visible = false; this.scene.add(m); return { m, t: 0 }; });
    this.flashT = 0;
    this.scene.add(this.pickGroup);
  }

  setTeam(team) {
    if (team === this.team) return;
    this.team = team;
    this.hands.clear(); this.side.clear();
    for (const k of Object.keys(WEAPONS)) {
      const a = buildGun(k, TEAM_HEX[team] || '#888'), b = buildGun(k, TEAM_HEX[team] || '#888');
      b.scale.setScalar(1.25); // reads at the figure's toy scale
      this.hands.add(a); this.side.add(b);
      this.models[k] = { hand: a, side: b };
    }
  }

  listen() {
    const locked = () => !!document.pointerLockElement;
    const L = (t, ev, fn, opt) => { t.addEventListener(ev, fn, opt); (this.off = this.off || []).push(() => t.removeEventListener(ev, fn, opt)); };
    L(document, 'mousedown', (e) => { if (!this.active || !locked()) return; if (e.button === 0) this.fire = this.tap = true; if (e.button === 2) this.aiming = true; });
    L(document, 'mouseup', (e) => { if (e.button === 0) this.fire = false; if (e.button === 2) this.aiming = false; });
    L(document, 'contextmenu', (e) => { if (this.active) e.preventDefault(); });
    L(document, 'keydown', (e) => {
      if (!this.active || e.repeat || /INPUT|TEXTAREA/.test(e.target?.tagName || '')) return;
      if (e.code === 'KeyR') this.want.reload = true;
      if (e.code === 'KeyQ') this.want.swap = true;
      if (/^Digit[1234]$/.test(e.code)) this.want.slot = +e.code.slice(5) - 1;
      if (e.code === 'KeyV' || e.code === 'KeyF') this.want.stab = true; // a quick stab whatever is in the hands
      if (e.code === 'KeyE') this.want.rush = true; // the Stand's rush (the manga look)
    });
    L(window, 'wheel', (e) => { if (this.active && this.aim > 0.5 && this.gun.def.scope) this.zoom2 = e.deltaY < 0; }, { passive: true });
    L(window, 'blur', () => { this.fire = false; this.aiming = false; });
  }

  /** A new round, or back at the base. */
  respawn(maxHp = 100, safeS = 0) { this.safeT = safeS; this.maxHp = this.hp = maxHp; this.down = 0; this.gun.reset(savedPrimary()); this.aiming = false; this.fire = false; this.hurtAt = 0; }
  /** from: the shooter's position (three.js [x, y, z]) or null: an arc on screen points their way for a moment. */
  hurt(hp, from = null) { this.hp = hp; this.dmg = 1; this.hurtAt = performance.now(); haptic('hurt'); if (from) { this.hitFrom = [from[0], from[2]]; this.hitDirT = HIT_DIR_S; } }
  /** Knocked out for `seconds`; onBack runs when it is time to stand at the base again. */
  killed(seconds, onBack) { haptic('down'); this.down = seconds; this.onBack = onBack; this.fire = false; this.aiming = false; this.btns[1].classList.remove('on'); }
  hitmark(kill) { haptic(kill ? 'kill' : 'hit'); this.hitT = kill ? 0.5 : 0.18; this.hitEl.className = kill ? 'on kill' : 'on'; }

  /** Someone else's shot: a tracer from where it left to where it ended (three.js points). */
  tracer(from, to, kind, mine = false) {
    if (kind === 'knife') return;
    const tr = this.tracers.find((t) => t.t <= 0) || this.tracers[0];
    const a = new THREE.Vector3(...from), b = new THREE.Vector3(...to), len = a.distanceTo(b);
    if (len < 0.5) return;
    tr.m.position.copy(a).lerp(b, 0.5); tr.m.lookAt(b); tr.m.scale.set(1, 1, len); tr.m.visible = true; tr.t = TRACER_S;
    const p = this.puffs.find((q) => q.t <= 0); if (p) { p.m.position.copy(b); p.m.visible = true; p.t = 0.25; }
    if (!mine) this.sound.play(kind, Math.min(1, 14 / Math.max(14, this.camera.position.distanceTo(a))) * 0.7);
  }

  /** Right after the frame is drawn: the camera as the player sees it (other code moves it between frames). */
  afterRender() {
    this.camPos.copy(this.camera.position); this.camera.getWorldDirection(this.camDir);
    const pt = this.pendingTracer, shown = this.shown;
    if (pt && shown) {
      shown.updateWorldMatrix(true, false);
      const muzzle = shown.userData.muzzle.clone().applyMatrix4(shown.matrixWorld);
      this.flash.position.copy(muzzle);
      for (const end of pt.ends) this.tracer(muzzle.toArray(), end, pt.kind, true);
      this.pendingTracer = null;
    }
  }

  /** Weapons lying in the arena for these bases (weapons.js pickupSpots). */
  setBases(bases) {
    this.pickGroup.clear();
    this.pickups = pickupSpots(bases).map((sp) => {
      const g = new THREE.Group(), gun = buildGun(sp.w, '#F2A900');
      gun.scale.setScalar(1.7); gun.position.y = 0.95; gun.rotation.z = 0.25;
      const base = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.6, 0.12, 20), new THREE.MeshStandardMaterial({ color: '#F2A900', roughness: 0.5 }));
      base.position.y = 0.06;
      g.add(base, gun); g.visible = false;
      this.pickGroup.add(g);
      return { ...sp, x: sp.at[0] - this.origin[0], z: this.origin[1] - sp.at[1], g, gun, back: 0, y: null };
    });
  }

  stepPickups(dt, st, alive) {
    for (const p of this.pickups) {
      if (p.y === null && (p.wait = (p.wait || 0) - dt) <= 0) { // once the ground there is loaded: the nearest open street spot (never a roof)
        p.wait = 1;
        const sp = standSpot(this.city, p.x, p.z), y = sp && this.city.groundHeight(sp.x, sp.z);
        if (typeof y === 'number') { p.x = sp.x; p.z = sp.z; p.y = y; p.g.position.set(p.x, y, p.z); }
      }
      if (p.back > 0) p.back -= dt;
      p.g.visible = this.active && p.y !== null && p.back <= 0;
      p.gun.rotation.y += dt * 1.5;
      if (!p.g.visible || !alive || Math.hypot(st.pos[0] - p.x, st.pos[2] - p.z) > PICKUP_R || Math.abs(st.pos[1] - p.y) > 2.5) continue;
      if (p.w === 'med' ? this.hp >= this.maxHp : p.w === 'ammo' ? Object.entries(WEAPONS).every(([k, d]) => !d.reserve || this.gun.spare[k] >= d.reserve) : (this.gun.slots.includes(p.w) && this.gun.ammo[p.w] === WEAPONS[p.w].mag && this.gun.spare[p.w] === WEAPONS[p.w].reserve)) continue; // nothing to gain
      if ((p.asked = (p.asked || 0) - dt) > 0) continue;
      p.asked = 0.5; this.send({ t: 'take', i: this.pickups.indexOf(p) }); // the room says who gets it
    }
  }

  /** The room: weapon i was taken (by me?) and is gone for `seconds`. */
  taken(i, mine, seconds = PICKUP_BACK_S, hp = null) {
    const p = this.pickups[i];
    if (!p) return;
    p.back = seconds;
    if (mine && Number.isFinite(hp)) this.hp = hp; // a medkit: the room healed me
    if (mine && this.gun.give(p.w)) { haptic('pickup'); this.zoom2 = false; this.toast?.(p.w === 'ammo' ? 'Ammo refilled' : p.w === 'med' ? 'Patched up' : `${WEAPONS[p.w].name} picked up`); }
  }

  /** Guns at the other players' sides: figures() -> [{ id, pos, yaw, team, w, hidden }]. */
  drawOthers() {
    this.otherGuns = this.otherGuns || new Map();
    const seen = new Set();
    for (const o of this.active ? this.figures?.() || [] : []) {
      const key = `${o.id}|${o.w}|${o.team}`;
      let g = this.otherGuns.get(o.id);
      if (!g || g.userData.key !== key) {
        if (g) this.scene.remove(g);
        g = buildGun(o.w, TEAM_HEX[o.team] || '#888'); g.scale.setScalar(1.25); g.userData.key = key;
        this.scene.add(g); this.otherGuns.set(o.id, g);
      }
      seen.add(o.id);
      g.visible = !o.hidden;
      if (o.hand) g.position.set(o.hand[12], o.hand[13] + 0.05, o.hand[14]);
      else g.position.set(o.pos[0] + Math.cos(o.yaw) * 0.42 + Math.sin(o.yaw) * 0.3, o.pos[1] + 1.12, o.pos[2] + Math.sin(o.yaw) * 0.42 - Math.cos(o.yaw) * 0.3);
      g.rotation.set(0, -o.yaw, 0);
    }
    for (const [id, g] of this.otherGuns) if (!seen.has(id)) { this.scene.remove(g); this.otherGuns.delete(id); }
  }

  /** Gamepad: RT fire, LT aim, X reload, Y next weapon, right stick click stab. */
  pollPad() {
    const pad = [...(navigator.getGamepads?.() || [])].find((g) => g && g.connected);
    const b = (i) => !!pad && (pad.buttons[i]?.pressed || pad.buttons[i]?.value > 0.4);
    const was = this.pad || {};
    this.pad = { fire: b(7), aim: b(6), reload: b(2), swap: b(3), stab: b(11) };
    if (this.pad.fire !== !!was.fire) { this.fire = this.pad.fire; if (this.pad.fire) this.tap = true; }
    if (this.pad.aim !== !!was.aim) this.aiming = this.pad.aim;
    if (this.pad.reload && !was.reload) this.want.reload = true;
    if (this.pad.swap && !was.swap) this.want.swap = true;
    if (this.pad.stab && !was.stab) this.want.stab = true;
  }

  restoreCamera() {
    const f = this.player()?.follow, s = this.saved;
    if (f && s) { Object.assign(f.o, s.o); f.aimDist = s.dist; this.player().settings.recenter = s.recenter; }
    this.saved = null; this.prevAim = null;
  }

  /** st: the player's state (index.js); playing: a match is on and I am walking in it. */
  update(dt, st, playing) {
    const P = this.player(), f = P?.follow;
    const on = !!(playing && f && st);
    if (on !== this.active) {
      this.active = on;
      this.root.hidden = !on;
      for (const b of this.btns) b.hidden = !(on && this.touch);
      if (on && !this.tipped) { this.tipped = true; this.tipT = TIP_S; this.tipEl.classList.remove('gone'); } // how to play, once per room
      if (on) { this.saved = { o: { minDist: f.o.minDist, shoulder: f.o.shoulder, fov: f.o.fov }, dist: f.aimDist, recenter: P.settings.recenter }; P.settings.recenter = false; }
      else { this.restoreCamera(); const P = this.player(); if (P?.character) { P.character.aim = null; P.character.setFade?.(0); } this.hands.visible = this.side.visible = false; this.fire = this.aiming = false; for (const p of this.pickups) p.g.visible = false; }
    }
    this.stepFx(dt);
    if (this.tipT > 0 && (this.tipT -= dt) <= 0) this.tipEl.classList.add('gone');
    this.drawOthers();
    if (!on) return;
    this.pollPad();
    const moved = this.lastPos ? Math.hypot(st.pos[0] - this.lastPos[0], st.pos[2] - this.lastPos[2]) / Math.max(dt, 1e-3) : 0;
    this.speed = lerp(this.speed || 0, Math.min(8, moved), Math.min(1, dt * 10)); this.lastPos = st.pos;
    const def = this.gun.def, alive = this.down <= 0;
    if (!alive) {
      this.down -= dt;
      this.downEl.hidden = false; this.downEl.textContent = `Knocked out: back in ${Math.max(1, Math.ceil(this.down))}`;
      if (this.down <= 0) { this.downEl.hidden = true; this.respawn(this.maxHp, this.safeS || 0); this.onBack?.(); }
    } else this.downEl.hidden = true;

    this.stepPickups(dt, st, alive);
    // the Stand (manga look): a rush on E punches whoever is within reach in front of me
    if (this.want.rush && alive) { window.__bloxStand?.rush(); }
    this.want.rush = false;
    // health comes back after a while without a hit (as the room counts it: weapons.js REGEN)
    if (alive && this.hp < this.maxHp && performance.now() - (this.hurtAt || 0) > REGEN.delay * 1000) this.hp = Math.min(this.maxHp, this.hp + REGEN.rate * dt);
    // the shooting camera (Call of Duty: your aim is never blocked): from the hip the camera sits
    // over the right shoulder (the figure to the left of the crosshair); aiming goes to the eyes
    // (the gun in the hands); the figure fades when the camera is close to it
    const hipShoulder = Math.max(this.saved.o.shoulder || 0, COMBAT_SHOULDER);
    // aim: ease in and out; the follow camera moves to the eyes and narrows its view
    const wantAim = alive && this.aiming && !this.gun.reloading && !def.melee ? 1 : 0;
    this.aim += (wantAim - this.aim) * Math.min(1, dt * 14);
    if (Math.abs(wantAim - this.aim) < 0.01) this.aim = wantAim;
    const a = this.aim, fov = def.scope && this.zoom2 ? def.fov * 0.5 : def.fov;
    // slower turning while zoomed: take back part of what the look input added since last frame
    const sens = lerp(1, def.sens * (def.scope && this.zoom2 ? 0.6 : 1), a);
    if (this.prevAim && sens < 1) {
      f.aimYaw = wrap(f.aimYaw - wrap(f.aimYaw - this.prevAim[0]) * (1 - sens));
      f.aimPitch -= (f.aimPitch - this.prevAim[1]) * (1 - sens);
    }
    f.o.minDist = EYE_DIST; f.o.shoulder = lerp(hipShoulder, 0, a); f.o.fov = lerp(this.saved.o.fov, fov, a);
    f.aimDist = lerp(HIP_DIST, EYE_DIST, a);
    P?.character?.setFade?.(a > 0.02 && a < 0.98 ? Math.min(1, a * 2.2) : 0); // see-through while the camera passes through it

    // a click shorter than a frame still fires (tap is cleared once the gun has seen it)
    // V: a quick stab with whatever is in the hands (the knife comes out, then the gun is back)
    if (this.want.stab && alive && this.stabT <= 0 && !def.melee) { this.back = this.gun.w; this.gun.w = 'knife'; this.gun.cool = 0; this.gun.held = false; this.stabT = 0.45; this.tap = true; }
    else if (this.stabT > 0 && (this.stabT -= dt) <= 0 && this.back) { if (this.gun.w === 'knife') this.gun.w = this.back; this.back = null; this.gun.cool = Math.max(this.gun.cool, 0.2); }
    const quick = this.stabT > 0;
    const r = this.gun.step(dt, { fire: alive && (this.fire || this.tap), reload: this.want.reload, swap: !quick && this.want.swap, slot: quick ? null : this.want.slot });
    this.want.reload = this.want.swap = this.want.stab = false; this.want.slot = null;
    if (this.tap) { this.tap = false; if (!this.fire) this.gun.held = false; }
    if (r.swapped) this.zoom2 = false;
    if (r.shot) { this.shoot(st, f); haptic(this.gun.w); this.safeT = 0; } // shooting gives up the spawn shield
    if (this.safeT > 0) this.safeT -= dt;
    if (r.empty) haptic('empty');
    f.aimPitch = Math.max(f.lim.min, Math.min(f.lim.max, f.aimPitch));
    this.prevAim = [f.aimYaw, f.aimPitch];
    this.draw(dt, st, f, alive);
  }

  /** One punch of the Stand's rush (player/stand.js): at = where it lands (three.js); the room judges. */
  standPunch(at) {
    if (!this.active || this.down > 0) return;
    const rd = (p) => [Math.round((this.origin[0] + p[0]) * 100) / 100, Math.round(p[1] * 100) / 100, Math.round((this.origin[1] - p[2]) * 100) / 100];
    let best = null, bd = 3.2;
    for (const e of this.enemies()) { const d = Math.hypot(e.pos[0] - at[0], e.pos[2] - at[2]); if (d < bd) { bd = d; best = e; } }
    const me = this.lastPos || at;
    this.send({ t: 'shot', w: 'stand', o: rd([me[0], me[1] + 1.4, me[2]]), e: rd(best ? [best.pos[0], best.pos[1] + 1.1, best.pos[2]] : at), hit: best ? best.id : 0, head: false });
    if (best) { haptic('hit'); comicFx('hit', best.pos); }
  }

  shoot(st, f) {
    const def = this.gun.def, w = this.gun.w;
    const o = this.camPos.toArray(), fwd = this.camDir.toArray();
    const head = [st.pos[0], st.pos[1] + 1.5, st.pos[2]];
    const rd = (p) => [Math.round((this.origin[0] + p[0]) * 100) / 100, Math.round(p[1] * 100) / 100, Math.round((this.origin[1] - p[2]) * 100) / 100];
    this.kick = 1;
    if (def.melee) { // a stab: whoever stands within reach in front of me
      const t = meleeTarget(st.pos, [Math.sin(f.yaw), 0, -Math.cos(f.yaw)], this.enemies());
      const tp = t && this.enemies().find((e) => e.id === t.id).pos;
      this.send({ t: 'shot', w, o: rd(head), e: rd(tp ? [tp[0], tp[1] + 1, tp[2]] : [head[0] + Math.sin(f.yaw) * 2, head[1], head[2] - Math.cos(f.yaw) * 2]), hit: t ? t.id : 0, head: false });
      this.sound.play('knife', 0.5);
      return;
    }
    const skip = Math.max(0, this.camPos.distanceTo(new THREE.Vector3(...head)) - 0.2); // nothing behind me counts
    const range = Math.min(def.rangeM || Infinity, this.range || 170);
    const centre = spreadDir(fwd, this.gun.spread(this.aim, this.speed, !st.grounded));
    const hits = new Map(), ends = [];
    let first = null;
    for (let n = 0; n < (def.pellets || 1); n++) {
      const d = def.pellets ? spreadDir(centre, def.pelletSpread) : centre;
      const wall = wallT(this.city, o, d, range, 0.2, skip + 0.4);
      const hit = hitTest(o, d, this.enemies(), wall);
      const ok = hit && hit.t > skip;
      const end = [0, 1, 2].map((k) => o[k] + d[k] * (ok ? hit.t : wall));
      if (ok) { const h = hits.get(hit.id) || { n: 0, head: false, end }; h.n++; h.head = h.head || hit.head; hits.set(hit.id, h); }
      if (n < 4) ends.push(end);
      first = first || end;
    }
    // one message per pull: the target most pellets hit
    const best = [...hits.entries()].sort((a, b) => b[1].n - a[1].n)[0];
    this.send({ t: 'shot', w, o: rd(head), e: rd(best ? best[1].end : first), hit: best ? best[0] : 0, head: !!best?.[1].head, n: best ? best[1].n : 0 });
    // feel: recoil (up and a little sideways), the gun jumps back, flash, tracer, sound
    const kp = def.kick[0] * (1 - this.aim * 0.35), fe = def.feel || {};
    f.aimPitch -= kp;
    f.aimYaw = wrap(f.aimYaw + (Math.random() - 0.5) * 2 * def.kick[1]);
    this.recoilDebt = (this.recoilDebt || 0) + kp * (fe.recover || 0); // part of the kick comes back down
    this.shakeT = 0.18; this.shakeA = fe.shake || 0;
    this.flash.scale.setScalar(fe.flash || 1);
    this.flashT = 0.03 + 0.015 * (fe.flash || 1);
    this.pendingTracer = { ends, kind: w };
    this.sound.play(w, 1);
    comicFx(w === 'shotgun' ? 'shotgun' : 'shot');
  }

  stepFx(dt) {
    for (const tr of this.tracers) if (tr.t > 0 && (tr.t -= dt) <= 0) tr.m.visible = false;
    for (const p of this.puffs) if (p.t > 0) { p.t -= dt; p.m.visible = p.t > 0; p.m.scale.setScalar(1 + (0.25 - p.t) * 5); p.m.material.opacity = Math.max(0, p.t * 4); }
    this.kick = Math.max(0, this.kick - dt * 9);
    this.dmg = Math.max(0, this.dmg - dt * 1.6);
    if (this.hitDirT > 0) this.hitDirT -= dt;
    if (this.hitT > 0 && (this.hitT -= dt) <= 0) this.hitEl.className = '';
    if (this.flashT > 0) this.flashT -= dt;
    this.flash.visible = this.flashT > 0;
  }

  draw(dt, st, f, alive) {
    const def = this.gun.def, a = this.aim, cam = this.camera;
    const eyes = f.dist < 0.9; // the figure is hidden: draw the gun in the hands
    const scoped = def.scope && a > 0.85;
    this.hands.visible = alive && eyes && !scoped;
    this.side.visible = alive && !eyes;
    for (const [k, m] of Object.entries(this.models)) m.hand.visible = m.side.visible = k === this.gun.w;
    const model = this.models[this.gun.w];
    this.sway += dt * (2 + Math.min(6, this.speed * 1.6));
    const bob = (1 - a * 0.85) * 0.006 * Math.min(1, 0.3 + this.speed / 3);
    const re = this.gun.reloading ? Math.sin(this.gun.reloadProgress * Math.PI) : 0; // dips while reloading
    const hip = new THREE.Vector3(0.19, -0.19, -0.42), aimAt = model.hand.userData.aim;
    model.hand.position.lerpVectors(hip, aimAt, a);
    model.hand.position.x += Math.sin(this.sway) * bob; model.hand.position.y += Math.abs(Math.cos(this.sway)) * bob - re * 0.16;
    model.hand.position.z += this.kick * (def.feel?.back ?? 0.05);
    model.hand.rotation.set(this.kick * 0.05 - re * 0.7, (1 - a) * 0.06, re * 0.35);
    // at the figure's side, pointing where the camera looks
    const yaw = f.yaw, right = [Math.cos(yaw), Math.sin(yaw)];
    // in the figure's hands: the arms are posed to hold it (rig.js holdGun), the grip sits in the right hand
    const P = this.player();
    // shot feel: the recovering part of the kick eases back, and a short shake after each shot
    if (this.recoilDebt > 0) { const r = this.recoilDebt * Math.min(1, dt * 9); f.aimPitch += r; this.recoilDebt -= r; }
    if (this.shakeT > 0) {
      const k = this.shakeA * (this.shakeT / 0.18);
      f.aimPitch += (Math.random() - 0.5) * k; f.aimYaw = wrap(f.aimYaw + (Math.random() - 0.5) * k);
      this.shakeT -= dt;
    }
    // sprinting (and not aiming or firing): the gun drops to a low carry; aiming or a shot brings it up at once
    const wantSprint = this.speed > SPRINT_FROM && this.aim < 0.1 && !this.fire && this.gun.cool <= 0 ? 1 : 0;
    this.sprintK = (this.sprintK || 0) + (wantSprint - (this.sprintK || 0)) * Math.min(1, dt * (wantSprint ? 6 : 14));
    // up to the shoulder when aiming or firing (a quick draw), back to the hip a moment after the last shot
    if (this.fire || this.kick > 0.8) this.lastShotT = 0; else this.lastShotT = (this.lastShotT ?? 9) + dt; // (kick: a shot this frame)
    const wantReady = this.aim > 0.05 || this.lastShotT < READY_HOLD_S ? 1 : 0;
    this.readyK = (this.readyK ?? 0) + (wantReady - (this.readyK ?? 0)) * Math.min(1, dt * (wantReady ? 18 : 3.5));
    if (P?.character) P.character.aim = alive && !eyes ? { k: 1, pitch: -f.pitch, yaw, sprint: this.sprintK, ready: this.readyK } : null;
    const hand = alive && !eyes ? P?.character?.rightHand?.() : null;
    if (hand) model.side.position.set(hand[12], hand[13] + 0.05, hand[14]);
    else model.side.position.set(st.pos[0] + right[0] * 0.42 + Math.sin(yaw) * 0.3, st.pos[1] + 1.12, st.pos[2] + right[1] * 0.42 - Math.cos(yaw) * 0.3);
    // where the barrel points: down and a little across at the hip, across the chest in a sprint,
    // along the aim when shouldered
    const sk = this.sprintK || 0, rk = (this.readyK ?? 0) * (1 - sk), lowK = 1 - rk;
    const downP = -0.55 * (1 - sk) - 0.7 * sk, across = 0.35 * (1 - sk) + 0.75 * sk;
    model.side.rotation.set(-f.pitch * rk + downP * lowK + this.kick * (def.feel?.back || 0) * 1.6, -yaw + across * lowK, 0.3 * lowK, 'YXZ');
    // truly in the hands: the grip in the right hand, the barrel out through the left (the support
    // hand the rig puts on the fore-end); the old aim pose only when the hands are apart (a carry)
    const both = alive && !eyes && !def.melee ? P?.character?.hands?.() : null;
    if (both) {
      _L.set(both[0][12], both[0][13], both[0][14]); _R.set(both[1][12], both[1][13], both[1][14]);
      _D.subVectors(_L, _R);
      const len = _D.length();
      if (len > 0.12 && len < 0.85) {
        _D.divideScalar(len);
        _M.lookAt(_R, _T.copy(_R).add(_D), _UP); // -z (the barrel) toward the support hand
        _Q.setFromRotationMatrix(_M);
        const k = Math.min(1, (0.85 - len) / 0.2); // ease out toward a one-hand carry
        model.side.quaternion.slerp(_Q, k);
        model.side.position.lerp(_T.copy(_R).addScaledVector(_UP, 0.01), k);
        if (this.kick > 0) model.side.rotateX(this.kick * (def.feel?.back || 0) * 1.6);
      }
    }
    if (!def.melee && this.kick > 0) { // the gun jumps back into the shoulder
      const b = this.kick * (def.feel?.back || 0);
      model.side.position.x -= Math.sin(yaw) * b; model.side.position.z += Math.cos(yaw) * b;
    }
    if (def.melee) { // the stab: a quick lunge forward
      model.hand.position.set(0.16, -0.16, -0.38 - this.kick * 0.28); model.hand.rotation.set(-0.25 + this.kick * 0.3, 0.25, 0.5);
      model.side.position.x += Math.sin(yaw) * this.kick * 0.4; model.side.position.z -= Math.cos(yaw) * this.kick * 0.4;
    }
    this.shown = eyes ? model.hand : model.side;
    this.flash.rotation.z += 1.3;

    // HUD
    this.scopeEl.style.opacity = def.scope ? Math.max(0, (a - 0.7) / 0.3) : 0;
    const px = Math.tan(this.gun.spread(a, this.speed, !st.grounded)) * (innerHeight / 2) / Math.tan((cam.fov * Math.PI) / 360);
    const gap = Math.max(3, px), len = 7;
    const set = (i, x, y, w, h) => { const s = this.xLines[i].style; s.left = `${x}px`; s.top = `${y}px`; s.width = `${w}px`; s.height = `${h}px`; };
    set(0, -gap - len, -1, len, 2); set(1, gap, -1, len, 2); set(2, -1, -gap - len, 2, len); set(3, -1, gap, 2, len);
    this.xEl.style.opacity = !alive || scoped ? 0 : 1 - a * (def.scope ? 1 : 0.55);
    if (this.hitDirT > 0 && this.hitFrom) { // turns with the view, so it keeps pointing at the shooter
      this.dirEl.style.transform = `rotate(${hitAngle(st.pos, this.hitFrom, f.yaw)}rad)`;
      this.dirEl.style.opacity = Math.min(1, this.hitDirT / 0.4);
    } else this.dirEl.style.opacity = 0;
    const cue = alive ? ammoCue(this.gun, this.touch) : null;
    const cueHtml = cue ? `${cue.text}${cue.progress !== null ? `<u><b style="width:${Math.round(cue.progress * 100)}%"></b></u>` : ''}` : '';
    if (cueHtml !== this.cueHtml) { this.cueEl.innerHTML = cueHtml; this.cueHtml = cueHtml; this.cueEl.className = cue?.level || ''; }
    const ob = alive ? this.objective?.() : null; // { at: [x, z] three.js, label, colour }
    this.objEl.parentElement.style.display = ob ? '' : 'none';
    if (ob) {
      const m = stripMark(hitAngle(st.pos, ob.at, f.yaw));
      const dist = Math.round(Math.hypot(ob.at[0] - st.pos[0], ob.at[1] - st.pos[2]));
      const text = `${m.side < 0 ? '◀ ' : ''}${ob.label} · ${dist} m${m.side > 0 ? ' ▶' : ''}`;
      if (text !== this.objText) { this.objEl.textContent = text; this.objText = text; }
      this.objEl.style.left = `${(m.x + 1) * 50}%`;
      this.objEl.style.background = ob.colour || '#F2A900';
      this.objEl.style.color = /^#2F6FD6$/i.test(ob.colour || '') ? '#fff' : '#11143a'; // readable on blue and on yellow
    }
    this.dmgEl.style.opacity = Math.max(this.dmg * 0.8, (1 - this.hp / this.maxHp) * 0.35);
    // the spawn shield: a white glow round the health bar while shots do not count on me
    this.hpEl.parentElement.style.boxShadow = this.safeT > 0 ? '0 0 0 2px #fff, 0 0 14px 4px rgba(255,255,255,.75)' : '';
    this.hpEl.style.width = `${(this.hp / this.maxHp) * 100}%`;
    this.hpEl.style.background = this.hp > 50 ? '#5fd66b' : this.hp > 25 ? '#F2C200' : '#e5484d';
    const ammo = `${def.melee ? '<span>—</span>' : `<span>${this.gun.ammo[this.gun.w]}</span> / ${this.gun.spare[this.gun.w]}`}<small>${this.gun.reloading ? 'Reloading' : def.name}</small><em>${this.gun.slots.map((w, i) => (w ? `${i + 1} ${WEAPONS[w].name}` : '')).filter(Boolean).join(' · ')}</em>${this.gun.reloading ? `<u style="width:${this.gun.reloadProgress * 100}%"></u>` : ''}`;
    if (ammo !== this.lastAmmo) { this.ammoEl.innerHTML = ammo; this.lastAmmo = ammo; }
  }

  dispose() {
    this.restoreCamera();
    for (const off of this.off || []) off();
    this.root.remove(); for (const b of this.btns) b.remove();
    this.camera.remove(this.hands); this.scene.remove(this.side, this.flash, this.pickGroup);
    for (const t of this.tracers) this.scene.remove(t.m);
    for (const p of this.puffs) this.scene.remove(p.m);
    for (const g of (this.otherGuns || new Map()).values()) this.scene.remove(g);
  }
}
