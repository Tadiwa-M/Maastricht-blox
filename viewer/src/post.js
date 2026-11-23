// Post-processing chain: render -> ambient occlusion (GTAO) -> bloom -> tilt-shift -> grade
// (tone mapping, colour grade, vignette and, on High, anti-aliasing in one pass: render/grade.js).
//
// AO: a small radius (0.18 m, under half a stud) darkens the crevices between bricks and
// under studs; `thickness` stops occluders far in front of a surface from casting dark
// halos around silhouettes. Tilt-shift: the blur grows with camera distance (off for
// close-ups, stronger for the overview) and the sharp band follows the orbit target.
//
// Quality tiers (src/quality.js) may run AO at half resolution (its result is upsampled when
// blended) or switch it off, and keep bloom for the night only, when lamps and windows glow.
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { GradePass } from './render/grade.js';
import { LOOK, makeVersePass, updateVerse } from './render/verse.js';
import { PoolLights } from './render/pools.js';
import { DepthRenderPass } from './render/depthpass.js';
import { ComicFx } from './render/comicfx.js';
import { ComicPanel } from './render/panels.js';
import { MangaFx } from './render/mangafx.js';
import { outlineUniforms } from './render/outline.js';
import { HorizontalTiltShiftShader } from 'three/examples/jsm/shaders/HorizontalTiltShiftShader.js';
import { VerticalTiltShiftShader } from 'three/examples/jsm/shaders/VerticalTiltShiftShader.js';

export const AO = { radius: 0.18, distanceExponent: 1.3, thickness: 0.35, scale: 1.9, samples: 16 };
const TILT_NEAR = 15, TILT_FAR = 110, TILT_MAX = 2.4; // metres, metres, blur strength

export class Post {
  constructor(renderer, scene, camera, width, height, clipBox) {
    this.camera = camera;
    const c = new EffectComposer(renderer);
    c.setPixelRatio(renderer.getPixelRatio());
    c.setSize(width, height);
    // the look is fixed at load (render/verse.js LOOK); the painted looks keep the scene's depth
    this.look = typeof location !== 'undefined' ? LOOK : null;
    this.scenePass = this.look ? new DepthRenderPass(scene, camera) : new RenderPass(scene, camera);
    c.addPass(this.scenePass);
    const gtao = new GTAOPass(scene, camera, width, height);
    this.aoScale = 1;
    const setAoSize = gtao.setSize.bind(gtao);
    gtao.setSize = (w, h) => setAoSize(Math.max(1, Math.round(w * this.aoScale)), Math.max(1, Math.round(h * this.aoScale)));
    gtao.output = GTAOPass.OUTPUT.Default;
    gtao.blendIntensity = 1.0;
    gtao.updateGtaoMaterial(AO);
    gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 4, rings: 2, samples: 16 });
    if (clipBox) gtao.setSceneClipBox(clipBox.clone().expandByScalar(1));
    c.addPass(gtao);
    this.gtao = gtao;
    this.bloom = new UnrealBloomPass(new THREE.Vector2(width, height), 0.18, 0.4, 0.92);
    c.addPass(this.bloom);
    this.tilt = [new ShaderPass(HorizontalTiltShiftShader), new ShaderPass(VerticalTiltShiftShader)];
    for (const p of this.tilt) c.addPass(p);
    this.grade = new GradePass();
    c.addPass(this.grade);
    if (this.look) { // the painted looks (verse, manga): crisp, no miniature blur, a little more contact shade
      this.verse = makeVersePass(this.scenePass, this.look); c.addPass(this.verse); globalThis.__bloxTwos = true;
      for (const p of this.tilt) p.enabled = false;
      gtao.blendIntensity = 1.2;
      this.fx = new ComicFx(); // the look reacting to hits, knock-outs, waves (render/comicfx.js)
      if (this.look === 'manga') this.mfx = new MangaFx(); // menace lettering, palette swings, speed lines
      if (this.look === 'verse') this.panel = new ComicPanel(); // the screen as a comic panel (render/panels.js)
    }
    this.composer = c;
    this.pools = new PoolLights(); // lamps and shop windows light their surroundings at night (every look)
    this.tiltOn = !this.verse; // (the comic look is crisp: no miniature blur)
    this.aoWanted = true; // the HUD toggle
    this.quality = { ao: 'full', bloom: 'always' };
    this.night = 0;
    this.resize(width, height);
  }

  /** Tier settings: ao 'full' | 'half' | 'off', bloom 'always' | 'night', aa (edge smoothing in the grade pass). */
  setQuality({ ao, bloom, aa = false }) {
    this.quality = { ao, bloom };
    this.pools.cap = ao === 'full' ? 48 : ao === 'half' ? 24 : 12; // lights a pixel adds up: fewer on the cheaper tiers
    this.grade.aa = aa;
    const scale = ao === 'half' ? 0.5 : 1;
    if (scale !== this.aoScale) { this.aoScale = scale; this.resize(this.width, this.height); }
    this.setAO(this.aoWanted);
    this.setNight(this.night);
  }

  setAO(on) {
    this.aoWanted = on;
    this.gtao.enabled = on && this.quality.ao !== 'off' && this.aoInRange !== false;
  }

  /** City mode: AO only where it can show (its 0.18 m radius is sub-pixel from far away). */
  setAOInRange(on) {
    if (on === this.aoInRange) return;
    this.aoInRange = on;
    this.setAO(this.aoWanted);
  }

  /** Night factor 0..1: bloom strength, and whether bloom runs at all on lower tiers. */
  setNight(n) {
    this.night = n;
    // by day a faint glow on sun glints; at night lamps and windows bloom (threshold drops so
    // the warm windows, not just the lamp heads, get a halo)
    this.bloom.strength = THREE.MathUtils.lerp(0.18, 0.55, n);
    this.bloom.threshold = THREE.MathUtils.lerp(0.92, 0.82, n);
    this.bloom.radius = THREE.MathUtils.lerp(0.4, 0.45, n);
    this.bloom.enabled = this.quality.bloom === 'always' || (this.quality.bloom !== 'off' && n > 0.05);
  }

  /** Colour grade for the time of day (render/look.js lookAt().grade). */
  setGrade(g) { this.grade.setGrade(g); }

  /** The sun's direction (world): the painted clouds' lit side faces it. */
  setSun(dir) { if (this.verse && dir) this.verse.uniforms.sunXZ.value.set(dir.x, dir.z).normalize(); }

  setPixelRatio(pr) {
    this.composer.setPixelRatio(pr);
    this.resize(this.width, this.height);
  }

  setTiltShift(on) {
    if (this.verse) on = false;
    this.tiltOn = on;
    for (const p of this.tilt) p.enabled = on;
  }

  /** Blur strength from camera distance; focus band centred on the orbit target. */
  updateTiltShift(target) {
    this.focusTarget = target;
    if (!this.tiltOn) return;
    const dist = this.camera.position.distanceTo(target);
    const amount = THREE.MathUtils.smoothstep(dist, TILT_NEAR, TILT_FAR) * TILT_MAX;
    const focus = target.clone().project(this.camera).y * 0.5 + 0.5; // 0 = bottom, 1 = top
    this.tilt[0].uniforms.h.value = amount / this.width;
    this.tilt[1].uniforms.v.value = amount / this.height;
    for (const p of this.tilt) p.uniforms.r.value = THREE.MathUtils.clamp(focus, 0.1, 0.9);
    for (const p of this.tilt) p.enabled = amount > 0.05;
  }

  resize(width, height) {
    this.width = width; this.height = height;
    this.composer.setSize(width, height);
  }

  render() {
    this.pools.update(this.camera, this.night);
    if (this.verse) { // the focus follows what the camera looks at
      const p = globalThis.__bloxPlayer, cam = this.camera;
      const at = p?.mode === 'walk' && p.ctrl ? p.ctrl.pos : null;
      const focus = at ? Math.hypot(cam.position.x - at[0], cam.position.y - at[1] - 1.2, cam.position.z - at[2]) : (this.focusTarget ? cam.position.distanceTo(this.focusTarget) : 30);
      updateVerse(this.verse, cam, focus, this.width, this.height, this.night, this.composer.renderer.getPixelRatio());
      if (this.fx.holding) return; // a held impact frame: the last picture stays up a moment
      const t = performance.now(), dt = Math.min(0.1, (t - (this.fxT || t)) / 1000);
      this.fxT = t;
      const roll = this.fx.update(dt, cam, this.verse.uniforms);
      this.mfx?.update(dt, cam, this.verse.uniforms);
      outlineUniforms.uScreenH.value = this.height;
      if (roll) { cam.rotateZ(roll); this.composer.render(); cam.rotateZ(-roll); return; } // the film's tilt on the action
    }
    this.composer.render();
  }
}
