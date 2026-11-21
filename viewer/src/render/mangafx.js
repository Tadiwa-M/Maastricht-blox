// The manga look's atmosphere (owner: "doesn't feel like I'm in that world"): the things that make
// a bizarre-adventure manga page, as our own lettering and effects.
//   menace   stand your ground (still for a few seconds), aim, or face a raid wave, and the big
//            menacing katakana ゴ rise in a column beside you, magenta with black ink
//   palette  the sky and the shadow colour swing between unreal schemes (teal and violet, lime and
//            gold, pink and purple, orange and teal), a slow crossfade every ~75 s; a knock-out or a
//            raid wave throws it to pink and purple at once
//   speed    ink speed lines at the edges of the screen when you sprint
// Sound words (render/comicfx.js) are katakana in this look.
import * as THREE from 'three';

export const PALETTES = [
  { top: [0.16, 0.62, 0.66], bottom: [0.42, 0.3, 0.72], shade: [0.3, 0.2, 0.5] },
  { top: [0.66, 0.84, 0.16], bottom: [0.93, 0.86, 0.42], shade: [0.16, 0.32, 0.24] },
  { top: [0.96, 0.46, 0.72], bottom: [0.55, 0.26, 0.78], shade: [0.4, 0.12, 0.44] },
  { top: [1.0, 0.62, 0.3], bottom: [0.2, 0.56, 0.62], shade: [0.2, 0.17, 0.46] },
];
export const MANGA_FX = { holdS: 75, fadeS: 6, stillS: 2.5, menaceEvery: 0.32 };

const CSS = `#menace { position: fixed; inset: 0; pointer-events: none; z-index: 4; overflow: hidden; }
#menace i { position: absolute; font: 900 64px/1 'Noto Sans JP', 'Hiragino Kaku Gothic ProN', 'Yu Gothic', 'Meiryo', sans-serif; font-style: normal;
  color: #c63cff; -webkit-text-stroke: 3px #120818; text-shadow: 3px 3px 0 #120818; animation: menace 1.7s ease-out forwards; }
@keyframes menace { 0% { opacity: 0; transform: translate(0, 20px) scale(.6) rotate(var(--r)); } 15% { opacity: 1; }
  100% { opacity: 0; transform: translate(var(--dx), -90px) scale(1.15) rotate(var(--r)); } }
body.title #menace, body.shot #menace { display: none; }`;

export class MangaFx {
  constructor() {
    this.t = 0; this.pal = 0; this.next = 0; this.mix = 1; this.hold = MANGA_FX.holdS; this.still = 0; this.spawnT = 0; this.speedK = 0;
    this.v = new THREE.Vector3();
    if (typeof document !== 'undefined') {
      document.head.append(Object.assign(document.createElement('style'), { textContent: CSS }));
      this.box = Object.assign(document.createElement('div'), { id: 'menace' });
      document.body.append(this.box);
      this.onFx = (e) => { const k = e.detail?.kind; if (k === 'kill' || k === 'wave' || k === 'down') this.jump(2); if (k === 'wave') this.menaceT = 4; };
      window.addEventListener('blox:fx', this.onFx);
    }
  }

  jump(i) { this.next = i; this.mix = 0; this.fade = 0.6; this.hold = MANGA_FX.holdS; }

  menace(x, y) {
    if (!this.box || this.box.childElementCount > 14) return;
    const el = document.createElement('i');
    el.textContent = 'ゴ';
    el.style.left = `${x + (Math.random() - 0.5) * 60}px`; el.style.top = `${y + (Math.random() - 0.3) * 120}px`;
    el.style.fontSize = `${44 + Math.random() * 40}px`;
    el.style.setProperty('--r', `${(Math.random() - 0.5) * 30}deg`); el.style.setProperty('--dx', `${(Math.random() - 0.5) * 40}px`);
    this.box.append(el);
    setTimeout(() => el.remove(), 1750);
  }

  /** Per frame: dt (s), camera, the comic pass uniforms. */
  update(dt, camera, u) {
    this.t += dt;
    // the palette: hold, then crossfade to the next scheme
    if (this.mix < 1) this.mix = Math.min(1, this.mix + dt / (this.fade || MANGA_FX.fadeS));
    else if ((this.hold -= dt) <= 0) { this.pal = this.next; this.next = (this.next + 1) % PALETTES.length; this.mix = 0; this.fade = MANGA_FX.fadeS; this.hold = MANGA_FX.holdS; }
    const a = PALETTES[this.pal], b = PALETTES[this.next], k = this.mix * this.mix * (3 - 2 * this.mix);
    if (this.mix >= 1) this.pal = this.next;
    for (const [name, key] of [['mSkyA', 'top'], ['mSkyB', 'bottom'], ['mShade', 'shade']]) u[name].value.set(...a[key].map((v, i) => v + (b[key][i] - v) * k));
    // the player: still (menace), aiming (menace), sprinting (speed lines)
    const p = typeof window !== 'undefined' ? window.__bloxPlayer : null;
    const walking = p?.mode === 'walk' && p.ctrl;
    const speed = walking ? Math.hypot(p.ctrl.vel[0], p.ctrl.vel[2]) : 0;
    this.still = walking && speed < 0.25 ? this.still + dt : 0;
    const aiming = (window.__bloxMp?.combat?.aim || 0) > 0.5;
    this.menaceT = Math.max(0, (this.menaceT || 0) - dt);
    this.speedK += ((walking && speed > 5 ? 1 : 0) - this.speedK) * Math.min(1, dt * 5);
    u.uSpeedK.value = this.speedK; u.uTime.value = this.t;
    if (walking && (this.still > MANGA_FX.stillS || aiming || this.menaceT > 0) && (this.spawnT -= dt) <= 0) {
      this.spawnT = MANGA_FX.menaceEvery;
      this.v.set(p.ctrl.pos[0], p.ctrl.pos[1] + 1.4, p.ctrl.pos[2]).project(camera);
      if (this.v.z < 1) this.menace((this.v.x * 0.5 + 0.5) * innerWidth + 90, (0.5 - this.v.y * 0.5) * innerHeight - 40);
    }
  }
}
