// Player (walk mode): map mode (MapControls) <-> third-person walk with the blocky character.
//
// initPlayer(ctx) is called once by main.js. ctx = { stage, camera, controls, city?, models,
// ui, world, islands, lod? }. Without ctx.city (the streaming query API from src/city.js) the
// same API is built from the in-memory World + islands (city-adapter.js).
//
// The player runs inside stage.render (wrapped here), i.e. after main's controls.update()
// and right before drawing, so the walk camera is never one frame behind or overridden.
//
// URL hash: #mode=walk&at=x,z[&yaw=deg][&camyaw=deg][&pitch=deg][&dist=m]
//   at = Unity metres (x east, z north; CONTRACT 1), yaw = compass degrees the player faces,
//   camyaw = compass degrees the camera looks toward (default: same as yaw).
import * as THREE from 'three';
import { cityFromWorld } from './city-adapter.js';
import { CharacterController } from './controller.js';
import { FollowCamera } from './camera.js';
import { Input, frameSpeed } from './input.js';
import { Character } from './character.js';
import { Hud, TouchControls } from './hud.js';
import { streetFinder } from './streets.js';
import { raycastCity, spawnPoint } from './ray.js';
import { parseWalkHash } from './hash.js';

const DEG = Math.PI / 180;
const ease = (t) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);

export function initPlayer(ctx) {
  const { stage, controls, world } = ctx;
  const camera = ctx.camera || stage.camera;
  const canvas = stage.renderer.domElement;
  const city = ctx.city || cityFromWorld(world, ctx.islands || []);
  const ctrl = new CharacterController(city);
  const follow = new FollowCamera();
  const character = new Character(ctx.models, world);
  character.group.visible = false;
  stage.scene.add(character.group);
  const findStreet = world?.features ? streetFinder(world.features.values()) : () => '';
  const S = world?.studM || 0.5;
  const still = /[?&]shot=1/.test(location.search);

  let mode = 'map', tween = null, mapView = null, jumpQueued = false, hover = null, streetT = 0;
  let padCount = 0;
  const focusVec = new THREE.Vector3(), smoothFeet = [0, 0, 0];

  const hud = new Hud({ onWalk: () => enterAt(centreRay()), onExit: exitWalk });
  const touch = new TouchControls(canvas, () => { jumpQueued = true; }, (x, y) => mode === 'map' && enterAt(screenRay(x, y)));
  const input = new Input(canvas, {
    touch,
    onPad: (name, on) => {
      padCount = Math.max(0, padCount + (on ? 1 : -1));
      hud.toast(on ? `Controller connected: ${name.replace(/\s*\(.*$/, '').slice(0, 40)}` : 'Controller disconnected');
      hud.setMode(mode, padCount > 0);
    },
  });
  canvas.addEventListener('pointermove', (e) => { hover = [e.clientX, e.clientY]; });
  canvas.addEventListener('dblclick', (e) => { if (mode === 'map' && !tween) enterAt(screenRay(e.clientX, e.clientY)); });

  // ---- rays from the screen -------------------------------------------------------------
  const rc = new THREE.Raycaster();
  function screenRay(x, y) {
    const r = canvas.getBoundingClientRect();
    rc.setFromCamera(new THREE.Vector2(((x - r.left) / r.width) * 2 - 1, -((y - r.top) / r.height) * 2 + 1), camera);
    return { origin: rc.ray.origin.toArray(), dir: rc.ray.direction.toArray() };
  }
  function centreRay() {
    const r = canvas.getBoundingClientRect();
    return screenRay(r.left + r.width / 2, r.top + r.height / 2);
  }

  // ---- mode switches ---------------------------------------------------------------------
  function enterAt(ray) {
    const hit = raycastCity(city, ray.origin, ray.dir);
    if (!hit) { hud.toast('No ground there'); return false; }
    const yaw = Math.atan2(ray.dir[0], -ray.dir[2]); // face away from the viewer
    startWalk(spawnPoint(hit, ray.dir), yaw, yaw, !still);
    return true;
  }

  /** Enter at Unity metres (x east, z north); y from the city's column top. */
  function enterAtUnity(x, z, yaw = 0, camYaw = yaw, animate = true) {
    const g = city.groundHeight(x, -z);
    if (g === 'unknown') { hud.toast('That place is not loaded yet'); return false; }
    startWalk([x, g + 0.05, -z], yaw, camYaw, animate);
    return true;
  }

  function startWalk(feet, yaw, camYaw, animate) {
    if (mode === 'map') mapView = { pos: camera.position.clone(), target: controls.target.clone(), fov: camera.fov, near: camera.near };
    ctrl.spawn(feet[0], feet[1], feet[2], yaw);
    smoothFeet.splice(0, 3, ...ctrl.pos);
    follow.yaw = camYaw;
    follow.dist = follow.want;
    character.group.visible = true;
    character.update(ctrl.pos, ctrl.yaw, 0, 0, 0);
    controls.enabled = false;
    input.lookActive = true;
    camera.near = 0.1;
    mode = 'walk';
    hud.setMode('walk', padCount > 0);
    touch.show(true);
    const { focus, position } = follow.update(city, ctrl.pos, 1);
    if (animate) startTween(position, focus, 55, 'walk');
    else { tween = null; setCamera(position, focus, 55); }
  }

  function exitWalk() {
    if (mode !== 'walk') return;
    mode = 'map';
    input.lookActive = false;
    touch.show(false);
    hud.setMode('map', padCount > 0);
    const t = new THREE.Vector3(...ctrl.pos);
    const back = new THREE.Vector3(-Math.sin(follow.yaw), 0, Math.cos(follow.yaw));
    const pos = t.clone().addScaledVector(back, 32).add(new THREE.Vector3(0, 38, 0));
    startTween(pos.toArray(), t.toArray(), mapView?.fov ?? 40, 'map');
  }

  function setCamera(pos, look, fov) {
    camera.position.set(...pos);
    focusVec.set(...look);
    camera.lookAt(focusVec);
    if (camera.fov !== fov) { camera.fov = fov; camera.updateProjectionMatrix(); }
    camera.updateProjectionMatrix();
  }

  function startTween(toPos, toLook, toFov, to) {
    const fromLook = to === 'walk' ? controls.target.clone() : focusVec.clone();
    tween = { t: 0, dur: 1.1, fromPos: camera.position.clone(), fromLook, fromFov: camera.fov, toPos, toLook, toFov, to };
  }

  function stepTween(dt) {
    tween.t = Math.min(1, tween.t + dt / tween.dur);
    const k = ease(tween.t);
    let toPos = tween.toPos, toLook = tween.toLook;
    if (tween.to === 'walk') ({ position: toPos, focus: toLook } = follow.update(city, ctrl.pos, dt));
    const pos = tween.fromPos.clone().lerp(new THREE.Vector3(...toPos), k);
    const look = tween.fromLook.clone().lerp(new THREE.Vector3(...toLook), k);
    setCamera(pos.toArray(), look.toArray(), tween.fromFov + (tween.toFov - tween.fromFov) * k);
    if (tween.t < 1) return;
    if (tween.to === 'map') {
      camera.near = mapView?.near ?? 0.3;
      camera.updateProjectionMatrix();
      controls.target.copy(look);
      controls.enabled = true;
      controls.update();
    }
    tween = null;
  }

  // ---- per frame -------------------------------------------------------------------------
  function mapPad(frame, dt) {
    // gamepad / keys in map mode: left stick pans, right stick orbits, triggers zoom
    const off = camera.position.clone().sub(controls.target);
    const dist = off.length();
    const [mx, my] = frame.move;
    if (mx || my) {
      const fwd = new THREE.Vector3(-off.x, 0, -off.z).normalize(), right = new THREE.Vector3(-fwd.z, 0, fwd.x);
      const d = fwd.multiplyScalar(my).add(right.multiplyScalar(mx)).multiplyScalar(dist * 0.9 * dt);
      controls.target.add(d); camera.position.add(d);
    }
    if (frame.look[0] || frame.look[1] || frame.zoom) {
      const sph = new THREE.Spherical().setFromVector3(off);
      sph.theta -= frame.look[0];
      sph.phi = THREE.MathUtils.clamp(sph.phi + frame.look[1], 0.05, controls.maxPolarAngle);
      sph.radius = THREE.MathUtils.clamp(sph.radius * Math.exp(frame.zoom * 0.15), controls.minDistance, controls.maxDistance);
      camera.position.copy(controls.target).add(new THREE.Vector3().setFromSpherical(sph));
      camera.lookAt(controls.target);
    }
  }

  let last = performance.now();
  function tick() {
    const now = performance.now();
    const dt = Math.min(0.1, Math.max(0, (now - last) / 1000));
    last = now;
    const frame = input.poll(dt);
    if (frame.pressed.has('help')) hud.toggleHelp();
    if (mode === 'map') {
      if (frame.pressed.has('enter') && !tween) {
        const byKey = frame.kbHeld.has('enter') && hover; // F aims at the cursor, gamepad A at the centre
        enterAt(byKey ? screenRay(...hover) : centreRay());
      } else if (!tween) mapPad(frame, dt);
    } else {
      if (frame.pressed.has('exit')) { if (!hud.help.hidden) hud.toggleHelp(false); else exitWalk(); }
    }
    if (mode === 'walk' || (tween && tween.to === 'walk')) {
      if (!tween) follow.input(frame.look, frame.zoom);
      const jump = jumpQueued || frame.pressed.has('jump');
      jumpQueued = false;
      const speed = frameSpeed(frame, ctrl.o.walk, ctrl.o.run);
      const res = tween ? ctrl.update(dt, {}, follow.yaw) : ctrl.update(dt, { move: frame.move, speed, jump }, follow.yaw);
      character.update(ctrl.pos, ctrl.yaw, res.speed, res.travelled, dt);
      // smooth the followed height (step-ups and landings), keep x/z exact
      smoothFeet[0] = ctrl.pos[0]; smoothFeet[2] = ctrl.pos[2];
      smoothFeet[1] += (ctrl.pos[1] - smoothFeet[1]) * Math.min(1, dt * 10);
      if (!tween) {
        const { focus, position } = follow.update(city, smoothFeet, dt);
        setCamera(position, focus, camera.fov);
      }
      // camera squeezed against a wall: hide the figure instead of filling the view with it
      character.group.visible = follow.dist > 0.9 || !!tween;
      if ((streetT -= dt) <= 0) {
        streetT = 0.5;
        hud.setStreet(findStreet(Math.floor(ctrl.pos[0] / S), Math.floor(-ctrl.pos[2] / S)));
      }
    }
    if (tween) stepTween(dt);
  }

  const render = stage.render.bind(stage);
  stage.render = (target) => {
    tick();
    render(mode === 'walk' || tween ? focusVec : target);
  };

  const fromHash = () => {
    const h = parseWalkHash(location.hash);
    if (!h) return false;
    const yaw = (h.yaw ?? 0) * DEG;
    if (h.pitch != null) follow.pitch = h.pitch * DEG;
    if (h.dist != null) follow.want = follow.dist = h.dist;
    return enterAtUnity(h.x, h.z, yaw, (h.camYaw ?? h.yaw ?? 0) * DEG, false);
  };
  if (fromHash() && ctx.lod) ctx.lod.settle(camera);
  window.addEventListener('hashchange', fromHash);

  const api = {
    get mode() { return mode; },
    state: () => ({ mode, pos: [...ctrl.pos], yaw: ctrl.yaw, grounded: ctrl.grounded, frozen: ctrl.frozen,
      cam: camera.position.toArray(), camDist: follow.dist, street: hud.street.textContent }),
    enterAtUnity, exitWalk, enterAt, ctrl, follow, city,
  };
  window.__bloxPlayer = api;
  return api;
}
