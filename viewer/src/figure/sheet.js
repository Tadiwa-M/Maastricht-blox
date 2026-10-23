// Design sheets for the toy figure (tools/figure-sheet.mjs renders them headless):
//   'figures': 12 variants in a row, front view (top) and three-quarter view (bottom), on a
//              brick floor next to a door piece for scale.
//   'poses':   walk, idle, browse, sitting at a cafe table, cycling, a kid and an older person.
// Not part of the game bundle; bundled on its own by the tool.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { buildModel } from '../models.js';
import { MaterialSet } from '../materials.js';
import { FigureCrowd } from './crowd.js';
import { sheetVariants, makeVariant } from './variants.js';
import { MODE } from './rig.js';
import { VehicleFleet } from './vehicles.js';
import { PropSet } from './props.js';

const STUD = 0.5, PLATE = 0.2;

function floorAndDoor(palette, types, width, doorX) {
  const bricks = [];
  const n = Math.ceil(width / STUD / 4) + 1;
  for (let a = -2 * n; a < 2 * n; a++) for (let b = -4; b < 6; b++) bricks.push({ type: 27, i: a * 2, j: b * 2, k: 0, color: (a + b) % 2 ? 22 : 24 }); // smooth tiles
  const di = Math.round(doorX / STUD);
  // a bit of facade: brick piers either side of a door, 12 plates high, one stud deep, behind the figures (j < 0 = +z)
  bricks.push({ type: 42, i: di, j: -4, k: 1, color: 7 });
  for (let k = 1; k < 13; k += 3) for (const i of [di - 1, di + 2]) bricks.push({ type: 1, i, j: -4, k, color: 4 });
  for (let i = di - 1; i < di + 3; i++) bricks.push({ type: 12, i, j: -4, k: 13, color: 17 });
  return buildModel({ name: 'sheet-floor', size: [1, 1, 1], pivot: [0, 0, 0], bricks }, { palette, types, mats: new MaterialSet(), studM: STUD, plateM: PLATE });
}

function stage(canvas, w, h) {
  const r = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
  r.setSize(w, h, false);
  r.toneMapping = THREE.ACESFilmicToneMapping;
  r.shadowMap.enabled = true; r.shadowMap.type = THREE.PCFSoftShadowMap;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#dfe3e8');
  scene.environment = new THREE.PMREMGenerator(r).fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.55;
  scene.add(new THREE.HemisphereLight('#ffffff', '#8a8378', 0.9));
  const sun = new THREE.DirectionalLight('#fff4e0', 2.2);
  sun.position.set(-4, 9, -7); sun.castShadow = true;
  sun.shadow.mapSize.set(4096, 4096);
  Object.assign(sun.shadow.camera, { left: -9, right: 9, top: 6, bottom: -6, near: 0.5, far: 30 });
  sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.02;
  scene.add(sun, sun.target);
  return { r, scene };
}

/** Render a sheet into canvas. world: { palette, types }. Returns stats. */
export function renderSheet(canvas, { palette, types }, kind = 'figures') {
  const W = 2400, H = 1200;
  canvas.width = W; canvas.height = H;
  const { r, scene } = stage(canvas, W, H);
  const crowd = new FigureCrowd(64);
  scene.add(crowd.group);
  const cam = new THREE.PerspectiveCamera(16, W / (H / 2), 0.5, 200);
  r.setScissorTest(true);
  if (kind === 'figures' || kind === 'back') {
    const vs = sheetVariants(12), gap = 0.78, x0 = -((vs.length - 1) * gap) / 2 - 0.3;
    scene.add(floorAndDoor(palette, types, 12, x0 - 1.4));
    const draw = (yaw, half, label) => {
      crowd.begin();
      vs.forEach((v, q) => crowd.add(v, { x: x0 + q * gap, y: 0.2, z: 0, rotY: yaw, mode: MODE.IDLE, t: 0.0, look: 0 }));
      crowd.end();
      cam.position.set(-0.75, 1.25, -11.5); cam.lookAt(-0.75, 0.98, 0);
      r.setViewport(0, half * H / 2, W, H / 2); r.setScissor(0, half * H / 2, W, H / 2);
      r.render(scene, cam);
      return label;
    };
    // our figures face -z (north); the camera looks from -z: front view = yaw 0
    draw(0, 1, 'front');
    draw(kind === 'back' ? Math.PI - 0.6 : -0.75, 0, 'three-quarter');
    return { variants: vs.map((v) => `${v.kind}:${v.hair}:${v.top}:${v.acc}`), drawCalls: crowd.drawCalls() };
  }
  if (kind === 'closeup') { // debugging: coat, jacket, dress, from the front, close
    const vs = [makeVariant(1, { kind: 'older' }), makeVariant(2), makeVariant(3)];
    vs[0].top = 'coat'; vs[1].top = 'jacket'; vs[2].top = 'dress';
    crowd.begin(); vs.forEach((v, q) => crowd.add(v, { x: (q - 1) * 0.8, y: 0, z: 0, rotY: 0.3, mode: MODE.IDLE, t: 0 })); crowd.end();
    cam.aspect = W / H; cam.fov = 20; cam.updateProjectionMatrix(); cam.position.set(0, 1.0, -6.5); cam.lookAt(0, 0.9, 0);
    r.setViewport(0, 0, W, H); r.setScissor(0, 0, W, H); r.render(scene, cam);
    return {};
  }
  if (kind === 'vehicles') { // cars and a bike, three-quarter view
    const fleet = new VehicleFleet({});
    scene.add(fleet.group, floorAndDoor(palette, types, 12, 9));
    fleet.begin();
    fleet.addCar('hatch', -4.2, 0.2, 0, -0.6, { colour: '#A33A2B' });
    fleet.addCar('saloon', 0, 0.2, 0, -0.6, { colour: '#22385A' });
    fleet.addCar('van', 4.4, 0.2, 0, -0.6, { colour: '#F2F0EA' });
    fleet.addBike(7.2, 0.2, 0, -0.6, { colour: '#2F5A3C' });
    fleet.end();
    crowd.begin(); crowd.add(makeVariant(52, { kind: 'adult' }), { x: 7.2, y: 0.2, z: 0, rotY: -0.6, mode: MODE.CYCLE, phase: 1 }); crowd.end();
    cam.aspect = W / H; cam.fov = 22; cam.updateProjectionMatrix(); cam.position.set(1.5, 5, -19); cam.lookAt(1.5, 0.8, 0);
    r.setViewport(0, 0, W, H); r.setScissor(0, 0, W, H); r.render(scene, cam);
    return { drawCalls: fleet.drawCalls() };
  }
  // poses
  const props = new PropSet({});
  const fleet = new VehicleFleet({});
  scene.add(props.group, fleet.group);
  scene.add(floorAndDoor(palette, types, 12, 5.2));
  const P = [];
  const add = (v, pose) => P.push([v, pose]);
  const A = makeVariant(3, { kind: 'adult' }), B = makeVariant(8, { kind: 'adult' }), C = makeVariant(21, { kind: 'adult' });
  add(A, { x: -4.6, z: 0, rotY: -0.5, mode: MODE.WALK, phase: 1.2, speed: 1.3 });
  add(B, { x: -3.6, z: 0, rotY: 0.3, mode: MODE.IDLE, t: 1 });
  add(C, { x: -2.6, z: 0.2, rotY: Math.PI, mode: MODE.BROWSE, t: 0 });
  props.begin();
  props.add('stall', -2.6, 0, 1.3, 0, { colour: 0 });
  // cafe table with two seated figures
  props.add('table', -0.6, 0, 0.0, 0); props.add('chair', -1.15, 0, 0.0, -Math.PI / 2); props.add('chair', -0.05, 0, 0.0, Math.PI / 2);
  props.add('parasol', -0.6, 0, 0.0, 0, { colour: 2 });
  add(makeVariant(40, { kind: 'adult' }), { x: -1.15, z: 0.0, rotY: -Math.PI / 2, mode: MODE.SIT, t: 3 });
  add(makeVariant(44, { kind: 'older' }), { x: -0.05, z: 0.0, rotY: Math.PI / 2, mode: MODE.SIT, t: 9.8 });
  // cyclist on a bike, and a parked bike
  fleet.begin();
  fleet.addBike(1.4, 0, 0, -0.9, { colour: '#22385A', spin: 0.6 });
  add(makeVariant(52, { kind: 'adult' }), { x: 1.4, z: 0, rotY: -0.9, mode: MODE.CYCLE, phase: 0.8 });
  fleet.addBike(3.0, 0, 0.6, 0.4, { colour: '#A33A2B', spin: 0 });
  props.add('rack', 3.0, 0, 0.6, 0.4);
  add(makeVariant(5, { kind: 'kid' }), { x: 3.9, z: 0, rotY: -0.3, mode: MODE.WALK, phase: 2.6, speed: 1.2 });
  add(makeVariant(6, { kind: 'older' }), { x: 4.6, z: 0, rotY: 0.3, mode: MODE.WALK, phase: 0.3, speed: 0.8 });
  fleet.end(); props.end();
  crowd.begin();
  for (const [v, p] of P) crowd.add(v, { y: 0.2, ...p });
  crowd.end();
  props.group.position.y = 0.2; fleet.group.position.y = 0.2;
  cam.position.set(0, 3.2, -26); cam.lookAt(0, 0.9, 0);
  cam.aspect = W / H; cam.fov = 13; cam.updateProjectionMatrix();
  r.setViewport(0, 0, W, H); r.setScissor(0, 0, W, H);
  r.render(scene, cam);
  return { drawCalls: crowd.drawCalls() };
}
