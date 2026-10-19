// Renderer, sky, ground, sun + fill light, environment map and post-processing.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { HorizontalTiltShiftShader } from 'three/examples/jsm/shaders/HorizontalTiltShiftShader.js';
import { VerticalTiltShiftShader } from 'three/examples/jsm/shaders/VerticalTiltShiftShader.js';

const DAY_TOP = new THREE.Color('#6f9fd8'), DAY_HORIZON = new THREE.Color('#dfe6ea');
const DUSK_TOP = new THREE.Color('#3d5b8f'), DUSK_HORIZON = new THREE.Color('#f2c49b');
const NIGHT_TOP = new THREE.Color('#070b18'), NIGHT_HORIZON = new THREE.Color('#1c2640');
const SUN_NOON = new THREE.Color('#fff4e2'), SUN_LOW = new THREE.Color('#ffb46b');

function skyTexture() {
  const c = document.createElement('canvas');
  c.width = 2; c.height = 256;
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.paint = (top, horizon) => {
    const g = c.getContext('2d');
    const grad = g.createLinearGradient(0, 0, 0, 256);
    grad.addColorStop(0, `#${top.getHexString()}`);
    grad.addColorStop(0.62, `#${horizon.getHexString()}`);
    grad.addColorStop(1, `#${horizon.getHexString()}`);
    g.fillStyle = grad;
    g.fillRect(0, 0, 2, 256);
    tex.needsUpdate = true;
  };
  return tex;
}

export class Stage {
  constructor(canvas, width, height) {
    const r = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    r.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    r.setSize(width, height, false);
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.0;
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer = r;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(35, width / height, 0.3, 4000);
    const pmrem = new THREE.PMREMGenerator(r);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.sky = skyTexture();
    this.scene.background = this.sky;
    this.scene.fog = new THREE.Fog(0xdfe6ea, 200, 900);

    this.hemi = new THREE.HemisphereLight(0xbcd3f0, 0x6b5a48, 0.6);
    this.sun = new THREE.DirectionalLight(0xffffff, 3);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(4096, 4096);
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.025;
    this.sun.shadow.radius = 2;
    this.scene.add(this.hemi, this.sun, this.sun.target);
    this.tiltShift = true;
  }

  /** Bounds box in metres; adds the ground plane and fits shadow + AO to it. */
  setBounds(box, groundY) {
    this.box = box.clone();
    const size = box.getSize(new THREE.Vector3());
    const c = box.getCenter(new THREE.Vector3());
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(4000, 4000),
      new THREE.MeshStandardMaterial({ color: 0xa8a393, roughness: 0.95 }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(c.x, box.min.y - 0.02, c.z);
    ground.receiveShadow = true;
    ground.name = 'ground';
    this.ground = ground;
    this.scene.add(ground);
    this.groundY = groundY;
    this.radius = size.length() / 2;
  }

  fitShadow() {
    const s = this.sun, cam = s.shadow.camera;
    const c = this.box.getCenter(new THREE.Vector3());
    const dir = this.sunDir.clone();
    s.target.position.copy(c);
    s.position.copy(c).addScaledVector(dir, this.radius * 2 + 10);
    s.updateMatrixWorld();
    s.target.updateMatrixWorld();
    cam.position.copy(s.position);
    cam.lookAt(c);
    cam.updateMatrixWorld();
    const inv = cam.matrixWorldInverse;
    const p = new THREE.Vector3();
    const lo = new THREE.Vector3(Infinity, Infinity, Infinity), hi = lo.clone().negate();
    const { min, max } = this.box;
    for (let q = 0; q < 8; q++) {
      p.set(q & 1 ? max.x : min.x, q & 2 ? max.y : min.y, q & 4 ? max.z : min.z).applyMatrix4(inv);
      lo.min(p); hi.max(p);
    }
    const pad = 1;
    cam.left = lo.x - pad; cam.right = hi.x + pad; cam.bottom = lo.y - pad; cam.top = hi.y + pad;
    cam.near = Math.max(0.1, -hi.z - pad); cam.far = -lo.z + pad + 200;
    cam.updateProjectionMatrix();
  }

  /** hours in [0, 24): sun azimuth/elevation, light colours, night glow. Returns night 0..1. */
  setTime(hours) {
    const dayT = (hours - 6) / 12; // 0 at sunrise, 1 at sunset
    const el = Math.sin(Math.PI * dayT) * THREE.MathUtils.degToRad(52);
    const az = THREE.MathUtils.degToRad(90 + 180 * dayT); // east -> south -> west
    const n = THREE.MathUtils.smoothstep(-el, -0.05, 0.12);
    const elUse = Math.max(el, 0.25); // at night, a high moon keeps shadows sensible
    const azUse = el > 0 ? az : az + Math.PI;
    this.sunDir = new THREE.Vector3(
      Math.sin(azUse) * Math.cos(elUse), Math.sin(elUse), -Math.cos(azUse) * Math.cos(elUse)).normalize();
    const low = 1 - THREE.MathUtils.smoothstep(el, 0.05, 0.6);
    this.sun.color.copy(SUN_NOON).lerp(SUN_LOW, low);
    this.sun.intensity = THREE.MathUtils.lerp(3.2, 0.25, n);
    if (n > 0.5) this.sun.color.set('#9fb4e0');
    this.hemi.intensity = THREE.MathUtils.lerp(0.75, 0.18, n);
    this.hemi.color.set(n > 0.5 ? '#4a5d8c' : '#bcd3f0');
    this.scene.environmentIntensity = THREE.MathUtils.lerp(0.55, 0.08, n);
    const top = DAY_TOP.clone().lerp(DUSK_TOP, low).lerp(NIGHT_TOP, n);
    const hor = DAY_HORIZON.clone().lerp(DUSK_HORIZON, low * 0.7).lerp(NIGHT_HORIZON, n);
    this.sky.paint(top, hor);
    this.scene.fog.color.copy(hor);
    this.renderer.toneMappingExposure = THREE.MathUtils.lerp(1.0, 1.25, n);
    if (this.box) this.fitShadow();
    if (this.bloom) this.bloom.strength = THREE.MathUtils.lerp(0.18, 0.7, n);
    return n;
  }

  initPost(width, height) {
    const r = this.renderer;
    const composer = new EffectComposer(r);
    composer.setPixelRatio(r.getPixelRatio());
    composer.setSize(width, height);
    composer.addPass(new RenderPass(this.scene, this.camera));
    const gtao = new GTAOPass(this.scene, this.camera, width, height);
    gtao.output = GTAOPass.OUTPUT.Default;
    gtao.blendIntensity = 1.0;
    gtao.updateGtaoMaterial({ radius: 0.35, distanceExponent: 1.5, thickness: 1, scale: 1, samples: 16 });
    gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 16 });
    if (this.box) gtao.setSceneClipBox(this.box.clone().expandByScalar(1));
    composer.addPass(gtao);
    this.gtao = gtao;
    const bloom = new UnrealBloomPass(new THREE.Vector2(width, height), 0.18, 0.4, 0.92);
    composer.addPass(bloom);
    this.bloom = bloom;
    const th = new ShaderPass(HorizontalTiltShiftShader), tv = new ShaderPass(VerticalTiltShiftShader);
    this.tilt = [th, tv];
    composer.addPass(th); composer.addPass(tv);
    composer.addPass(new OutputPass());
    this.composer = composer;
    this.resize(width, height);
  }

  setTiltShift(on, amount = 1.5) {
    this.tiltShift = on;
    for (const p of this.tilt) p.enabled = on;
    this.tiltAmount = amount;
    this.resize(this.width, this.height);
  }

  resize(width, height) {
    this.width = width; this.height = height;
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    if (!this.composer) return;
    this.composer.setSize(width, height);
    const a = this.tiltAmount ?? 1.5;
    this.tilt[0].uniforms.h.value = a / width;
    this.tilt[1].uniforms.v.value = a / height;
    for (const p of this.tilt) p.uniforms.r.value = 0.5;
  }

  render() {
    this.composer.render();
  }
}
