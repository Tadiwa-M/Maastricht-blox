// Stage: renderer, camera, lights, sky, ground, fog and the time of day.
//
// setTime(hours) drives everything that changes with the sun: direction, light colours,
// sky colours (and the reflections baked from them) and how much the city glows at night.
// Daytime sun elevation never drops below 22 degrees so late-afternoon shadows stay
// readable instead of stretching across the whole table.
import * as THREE from 'three';
import { Sky } from './sky.js';
import { makeGround } from './ground.js';
import { Post } from './post.js';

const DAY_TOP = new THREE.Color('#3a78d4'), DAY_HORIZON = new THREE.Color('#c9dcee');
const DUSK_TOP = new THREE.Color('#40619a'), DUSK_HORIZON = new THREE.Color('#f3c39a');
const NIGHT_TOP = new THREE.Color('#060a17'), NIGHT_HORIZON = new THREE.Color('#1b2540');
const SUN_NOON = new THREE.Color('#fff4e2'), SUN_LOW = new THREE.Color('#ffb46b');
const MIN_DAY_ELEVATION = THREE.MathUtils.degToRad(22);
const MAX_ELEVATION = THREE.MathUtils.degToRad(52);

/** Sun elevation/azimuth (radians, azimuth clockwise from north) and night factor 0..1. */
export function sunAt(hours) {
  const dayT = (hours - 6) / 12; // 0 at sunrise, 1 at sunset
  const raw = Math.sin(Math.PI * dayT) * MAX_ELEVATION;
  const night = THREE.MathUtils.smoothstep(-raw, -0.05, 0.12);
  const az = THREE.MathUtils.degToRad(90 + 180 * dayT); // east -> south -> west
  // day: clamp low suns; night: a moon high in the opposite sky keeps shadows sensible
  const elevation = raw > 0 ? Math.max(raw, MIN_DAY_ELEVATION) : 0.5;
  const azimuth = raw > 0 ? az : az + Math.PI;
  const low = 1 - THREE.MathUtils.smoothstep(raw, 0.05, 0.6); // 1 near sunrise/sunset
  return { elevation, azimuth, night, low };
}

export class Stage {
  constructor(canvas, width, height) {
    const r = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    r.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    r.setSize(width, height, false);
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFSoftShadowMap;
    r.localClippingEnabled = true; // moving models are cut at the diorama edge
    // the shadow map is rendered once per frame (render() below): with autoUpdate every
    // renderer.render call redraws it, and the AO pass's normal render is one of those
    r.shadowMap.autoUpdate = false;
    this.renderer = r;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(35, width / height, 0.3, 5000);
    this.sky = new Sky(r);
    this.scene.add(this.sky.mesh);
    this.scene.fog = new THREE.Fog(0xe9e2d6, 150, 900);

    this.hemi = new THREE.HemisphereLight(0xbcd3f0, 0x6b5a48, 0.6);
    this.sun = new THREE.DirectionalLight(0xffffff, 3);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(4096, 4096);
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.025;
    this.sun.shadow.radius = 2;
    this.scene.add(this.hemi, this.sun, this.sun.target);
    this.overlay = new THREE.Scene(); // drawn after post-processing (labels)
    this.width = width; this.height = height;
  }

  /** World box in metres: adds the baseplate ground, fits fog, shadows and AO to it. */
  setBounds(box, studM) {
    this.box = box.clone();
    const c = box.getCenter(new THREE.Vector3());
    this.radius = box.getSize(new THREE.Vector3()).length() / 2;
    this.ground = makeGround(c.x, box.min.y - 0.01, c.z, studM);
    this.scene.add(this.ground);
    // fade the baseplate into the horizon haze soon after the model ends, so the sky shows
    this.scene.fog.near = Math.max(60, this.radius * 1.2);
    this.scene.fog.far = Math.max(300, this.radius * 3);
  }

  initPost() {
    this.post = new Post(this.renderer, this.scene, this.camera, this.width, this.height, this.box);
  }

  fitShadow() {
    const s = this.sun, cam = s.shadow.camera;
    const c = this.box.getCenter(new THREE.Vector3());
    s.target.position.copy(c);
    s.position.copy(c).addScaledVector(this.sunDir, this.radius * 2 + 10);
    s.updateMatrixWorld();
    s.target.updateMatrixWorld();
    cam.position.copy(s.position);
    cam.lookAt(c);
    cam.updateMatrixWorld();
    const inv = cam.matrixWorldInverse, p = new THREE.Vector3();
    const lo = new THREE.Vector3(Infinity, Infinity, Infinity), hi = lo.clone().negate();
    const { min, max } = this.box;
    for (let q = 0; q < 8; q++) {
      p.set(q & 1 ? max.x : min.x, q & 2 ? max.y : min.y, q & 4 ? max.z : min.z).applyMatrix4(inv);
      lo.min(p); hi.max(p);
    }
    const pad = 4; // room for models that drive a little past the edge
    cam.left = lo.x - pad; cam.right = hi.x + pad; cam.bottom = lo.y - pad; cam.top = hi.y + pad;
    cam.near = Math.max(0.1, -hi.z - pad); cam.far = -lo.z + pad + 200;
    cam.updateProjectionMatrix();
  }

  /** hours in [0, 24). Returns the night factor 0..1 (for window and lamp glow). */
  setTime(hours) {
    const { elevation: el, azimuth: az, night: n, low } = sunAt(hours);
    this.sunDir = new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el));
    this.sun.color.copy(SUN_NOON).lerp(SUN_LOW, low);
    this.sun.intensity = THREE.MathUtils.lerp(3.0, 0.45, n);
    if (n > 0.5) this.sun.color.set('#9fb4e0');
    this.hemi.intensity = THREE.MathUtils.lerp(0.55, 0.3, n);
    this.hemi.color.set(n > 0.5 ? '#4a5d8c' : '#cfe0f5');
    this.scene.environmentIntensity = THREE.MathUtils.lerp(0.7, 0.25, n);
    const top = DAY_TOP.clone().lerp(DUSK_TOP, low).lerp(NIGHT_TOP, n);
    const hor = DAY_HORIZON.clone().lerp(DUSK_HORIZON, low * 0.7).lerp(NIGHT_HORIZON, n);
    this.scene.environment = this.sky.set({
      top, horizon: hor, sunDir: this.sunDir, sunColor: this.sun.color, sunGlow: 1 - n,
    });
    this.scene.fog.color.copy(hor);
    this.renderer.toneMappingExposure = THREE.MathUtils.lerp(1.0, 1.6, n);
    if (this.box) this.fitShadow();
    this.night = n;
    this.post?.setNight(n);
    return n;
  }

  /** Apply a quality tier (src/quality.js): pixel ratio, shadow map size, AO and bloom. */
  setQuality(tier) {
    const pr = Math.min(window.devicePixelRatio || 1, tier.pixelRatio);
    if (pr !== this.renderer.getPixelRatio()) {
      this.renderer.setPixelRatio(pr);
      this.renderer.setSize(this.width, this.height, false);
      this.post?.setPixelRatio(pr);
    }
    const sh = this.sun.shadow;
    if (sh.mapSize.x !== tier.shadowMap) {
      sh.mapSize.set(tier.shadowMap, tier.shadowMap);
      sh.map?.dispose();
      sh.map = null;
    }
    this.post?.setQuality(tier);
  }

  resize(width, height) {
    this.width = width; this.height = height;
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.post?.resize(width, height);
  }

  render(target) {
    this.sky.follow(this.camera);
    if (target) this.post.updateTiltShift(target);
    this.renderer.shadowMap.needsUpdate = true; // consumed by the first scene render (RenderPass)
    this.post.render();
    if (this.overlay.children.length) {
      this.renderer.autoClear = false;
      this.renderer.clearDepth();
      this.renderer.render(this.overlay, this.camera);
      this.renderer.autoClear = true;
    }
  }
}
