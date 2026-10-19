// Post-processing chain: render -> ambient occlusion (GTAO) -> bloom -> tilt-shift -> output.
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
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
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
    c.addPass(new RenderPass(scene, camera));
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
    c.addPass(new OutputPass());
    this.composer = c;
    this.tiltOn = true;
    this.aoWanted = true; // the HUD toggle
    this.quality = { ao: 'full', bloom: 'always' };
    this.night = 0;
    this.resize(width, height);
  }

  /** Tier settings: ao 'full' | 'half' | 'off', bloom 'always' | 'night'. */
  setQuality({ ao, bloom }) {
    this.quality = { ao, bloom };
    const scale = ao === 'half' ? 0.5 : 1;
    if (scale !== this.aoScale) { this.aoScale = scale; this.resize(this.width, this.height); }
    this.setAO(this.aoWanted);
    this.setNight(this.night);
  }

  setAO(on) {
    this.aoWanted = on;
    this.gtao.enabled = on && this.quality.ao !== 'off';
  }

  /** Night factor 0..1: bloom strength, and whether bloom runs at all on lower tiers. */
  setNight(n) {
    this.night = n;
    this.bloom.strength = THREE.MathUtils.lerp(0.18, 0.7, n);
    this.bloom.enabled = this.quality.bloom === 'always' || n > 0.05;
  }

  setPixelRatio(pr) {
    this.composer.setPixelRatio(pr);
    this.resize(this.width, this.height);
  }

  setTiltShift(on) {
    this.tiltOn = on;
    for (const p of this.tilt) p.enabled = on;
  }

  /** Blur strength from camera distance; focus band centred on the orbit target. */
  updateTiltShift(target) {
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

  render() { this.composer.render(); }
}
