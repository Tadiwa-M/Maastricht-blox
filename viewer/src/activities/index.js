// Activities: quiet things to do on foot in the city (docs/guide/16-activities.md).
//   Sit on a cafe terrace   a free chair (life/terraces.js): the camera eases to a relaxed view
//                           of the street, the clock runs 10x while you sit; G or walking stands up
//   Ride a bike             a parked bike (life/cyclists.js parkedBikes): faster, cycling pose,
//                           the bike under you; same walking collision; G leaves it where you are
//   Ride a river boat       from the riverside near a passing boat (life/boats.js): you stand on
//                           deck with a wide camera; G gets you off at the next bit of quay
//   Feed the ducks          at the water's edge: bread lands on the water, the ducks swim over
// One key (G, gamepad X, or the prompt pill above the walk bar) does what fits where you stand
// (choose.js). The player is driven through its public API (window.__bloxPlayer: ctrl, follow,
// character.override for the seated / cycling pose); pure logic lives in the sibling modules.
//
// initActivities(ctx) is called once by main.js initHooks after the other hooks; returns
// { update(dt) }, run every frame before drawing (after life has moved the boats).
import * as THREE from 'three';
import { MODE } from '../figure/rig.js';
import { VehicleFleet, BIKE } from '../figure/vehicles.js';
import { chooseAction, promptText, REACH } from './choose.js';
import { seatView, leftSeat, SEATED_SPEED } from './seat.js';
import { RIDE, Pedals, nearestBike, dismount } from './bike.js';
import { nearestWater, findLanding, waterAt, waterAhead } from './water.js';
import { Ducks } from './ducks.js';
import { DuckMeshes } from './duck-mesh.js';
import { Prompt } from './prompt.js';
import { parkedSource } from './parked.js';

const DEG = Math.PI / 180;
const PAD_BUTTON = 2; // standard mapping X (left face button): free in player/input.js BINDINGS

export async function initActivities(ctx) {
  const pl = typeof window !== 'undefined' ? window.__bloxPlayer : null;
  if (!pl || ctx.still || typeof document === 'undefined') return null;
  const life = window.__bloxLife || null;
  const { stage } = ctx;
  const city = pl.city || ctx.city;
  const ctrl = pl.ctrl, follow = pl.follow;
  const touch = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  const group = new THREE.Group();
  group.name = 'activities';
  stage.scene.add(group);
  const fleet = new VehicleFleet({ bikes: 24, cars: 1 });
  group.add(fleet.group);
  const duckMeshes = new DuckMeshes();
  group.add(duckMeshes.group);
  const ducks = new Ducks({ water: (x, z) => waterAt(city, x, z) });
  const parked = await parkedSource(ctx, life);
  const left = []; // bikes the player left, when life does not draw the parked bikes for us
  const ray = new THREE.Raycaster();

  let act = null; // { kind: 'sit' | 'bike' | 'boat', ... }
  let queued = false, near = {}, hits = {}, scanT = 0, duckT = 0, t = 0, posed = false, padWas = false;
  const prompt = new Prompt(() => { queued = true; });
  const busyElsewhere = () => !!window.__bloxRide?.state?.ride || document.body.classList.contains('title');
  window.addEventListener('keydown', (e) => {
    if (e.code !== 'KeyG' || e.repeat || /INPUT|TEXTAREA|SELECT/.test(e.target?.tagName || '')) return;
    if (pl.mode === 'walk' && !busyElsewhere()) queued = true;
  });

  // ---- the player's speeds and camera while busy -------------------------------------------
  const walkO = { walk: ctrl.o.walk, run: ctrl.o.run, jumpSpeed: ctrl.o.jumpSpeed };
  const setSpeeds = (o) => Object.assign(ctrl.o, o);
  let camWas = null;
  function aimCamera(c) {
    camWas = { pitch: follow.aimPitch, dist: follow.aimDist };
    follow.aimYaw = c.yaw; follow.aimPitch = c.pitch; follow.aimDist = c.dist;
  }
  function restoreCamera() {
    if (camWas) { follow.aimPitch = camWas.pitch; follow.aimDist = camWas.dist; }
    camWas = null;
  }
  const face = (yaw) => { ctrl.yaw = yaw; ctrl.loco.heading = yaw; ctrl.loco.speed = 0; };
  const groundNear = (x, z, y) => { const g = city.groundHeight(x, z, y + 1.5); return typeof g === 'number' ? g : y; };

  // ---- sitting ---------------------------------------------------------------------------
  function sit(seat) {
    const v = seatView(seat);
    ctrl.spawn(v.feet[0], groundNear(v.feet[0], v.feet[1], ctrl.pos[1]), v.feet[1], v.face);
    life.terraces.taken = { id: seat.poi.id, q: seat.q };
    const clock = life.clock;
    act = { kind: 'sit', feet: [ctrl.pos[0], ctrl.pos[2]], y: ctrl.pos[1], face: v.face, speedWas: clock?.speed ?? 1 };
    if (clock) clock.speed = SEATED_SPEED;
    aimCamera(v.cam);
  }
  function stand() {
    if (life.terraces) life.terraces.taken = null;
    if (life.clock && life.clock.speed === SEATED_SPEED) life.clock.speed = act.speedWas;
    restoreCamera();
    act = null;
  }

  // ---- cycling ---------------------------------------------------------------------------
  function mount({ bike }) {
    bike.gone = true;
    if (parked.shared) { bike.x0 = bike.x; bike.x = NaN; } // life's parked row: the bike leaves the rack
    const i = left.indexOf(bike);
    if (i >= 0) left.splice(i, 1);
    face(bike.yaw * DEG);
    setSpeeds(RIDE);
    act = { kind: 'bike', bike, pedals: new Pedals({ wheelR: BIKE.wheelR }) };
  }
  function getOff() {
    const ux = ctrl.pos[0], uz = -ctrl.pos[2];
    const d = dismount(ux, uz, ctrl.yaw);
    const b = act.bike;
    if (parked.shared) Object.assign(b, d.bike, { gone: false });
    else left.push({ ...d.bike, colour: b.colour, y: ctrl.pos[1] });
    setSpeeds(walkO);
    ctrl.loco.speed = 0;
    const sx = d.step.x, sz = -d.step.z;
    if (!ctrl.bodyHits(sx, ctrl.pos[1], sz)) { ctrl.pos[0] = sx; ctrl.pos[2] = sz; }
    act = null;
  }

  // ---- boats -----------------------------------------------------------------------------
  function board({ item }) {
    const obj = item.obj;
    obj.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(obj);
    const yaw = -obj.rotation.y, fx = Math.sin(yaw), fz = -Math.cos(yaw);
    const L = Math.max(box.max.x - box.min.x, box.max.z - box.min.z);
    let local = null;
    for (const s of [-0.3, -0.18, 0.18, 0]) { // the deck toward the stern, else amidships
      ray.set(new THREE.Vector3(obj.position.x + fx * s * L, box.max.y + 2, obj.position.z + fz * s * L), new THREE.Vector3(0, -1, 0));
      const hit = ray.intersectObject(obj, true)[0];
      if (hit) { local = obj.worldToLocal(hit.point.clone()); break; }
    }
    local ||= obj.worldToLocal(new THREE.Vector3(obj.position.x, box.max.y, obj.position.z));
    // look out toward the bank you came from
    const side = (ctrl.pos[0] - obj.position.x) * Math.cos(yaw) + (ctrl.pos[2] - obj.position.z) * Math.sin(yaw) > 0 ? 1 : -1;
    setSpeeds({ walk: 0, run: 0, jumpSpeed: 0 });
    act = { kind: 'boat', item, local, side, pending: false, scan: 0, seat: [0, 0, 0], face: yaw };
    followBoat();
    aimCamera({ yaw: act.face, pitch: 0.3, dist: 10 });
  }
  function followBoat() {
    const obj = act.item.obj;
    obj.updateMatrixWorld(true);
    const w = obj.localToWorld(act.local.clone());
    act.seat = [w.x, w.y, w.z];
    act.face = -obj.rotation.y + act.side * Math.PI / 2;
    ctrl.pos = [w.x, w.y, w.z];
    ctrl.vel = [0, 0, 0];
    face(act.face);
  }
  function land(spot) {
    const yaw = Math.atan2(spot.x - act.seat[0], -(spot.z - act.seat[2])); // facing inland
    setSpeeds(walkO);
    restoreCamera();
    act = null;
    pl.enterAtUnity(spot.x, -spot.z, yaw, yaw, true);
  }
  function leaveBoat() { setSpeeds(walkO); restoreCamera(); act = null; }

  // ---- ducks -----------------------------------------------------------------------------
  function feedDucks() {
    const [px, py, pz] = ctrl.pos;
    const spot = waterAhead(city, px, pz, ctrl.yaw, REACH.ducks + 1);
    if (!spot) return;
    face(Math.atan2(spot.x - px, -(spot.z - pz)));
    ducks.feed(spot.x, spot.z, [px, py + 1.3, pz]);
  }

  // ---- the figure's pose while busy (player/character.js override) ------------------------
  function drawBikes(ride) {
    fleet.begin();
    for (const b of left) fleet.addBike(b.x, b.y, -b.z, -b.yaw * DEG, { colour: b.colour });
    if (ride) fleet.addBike(...ride.at, ride.rot, { colour: ride.colour, spin: ride.spin });
    fleet.end();
  }
  const override = (feet, yaw, speed, travelled) => {
    if (!act) return null;
    posed = true;
    if (act.kind === 'sit') return { x: act.feet[0], y: act.y, z: act.feet[1], rotY: -act.face, mode: MODE.SIT, t };
    if (act.kind === 'boat') return { x: act.seat[0], y: act.seat[1], z: act.seat[2], rotY: -act.face, mode: MODE.IDLE, t };
    const p = act.pedals.step(travelled);
    drawBikes({ at: feet, rot: -yaw, colour: act.bike.colour, spin: p.spin });
    return { x: feet[0], y: feet[1], z: feet[2], rotY: -yaw, mode: MODE.CYCLE, phase: p.phase, speed };
  };
  if (pl.character) pl.character.override = override;

  // ---- what is in reach ------------------------------------------------------------------
  function scan() {
    const [px, , pz] = ctrl.pos, ux = px, uz = -pz;
    hits.seat = life?.terraces?.freeSeat(ux, uz, REACH.seat) || null;
    hits.bike = nearestBike(parked.shared ? parked.bikes : parked.bikes.concat(left), ux, uz, REACH.bike);
    const water = nearestWater(city, px, pz, REACH.boatWater, 1);
    hits.boat = water !== null && life?.boats?.items?.length ? life.boats.nearest(px, pz) : null;
    near = { seat: hits.seat?.d ?? null, bike: hits.bike?.d ?? null, water, boat: hits.boat?.d ?? null };
  }

  function end() {
    if (!act) return;
    if (act.kind === 'sit') stand();
    else if (act.kind === 'bike') getOff();
    else leaveBoat();
  }

  function run(choice) {
    switch (choice?.action) {
      case 'sit': if (hits.seat) sit(hits.seat); break;
      case 'bike': if (hits.bike) mount(hits.bike); break;
      case 'boat': if (hits.boat) board(hits.boat); break;
      case 'ducks': feedDucks(); break;
      case 'stand': stand(); break;
      case 'dismount': getOff(); break;
      case 'land': act.pending = true; act.scan = 0; break;
      case 'stay': act.pending = false; break;
      default: break;
    }
  }

  function padPressed() {
    const pads = navigator.getGamepads ? [...navigator.getGamepads()].filter((p) => p?.connected) : [];
    const down = pads.some((p) => p.buttons?.[PAD_BUTTON]?.pressed);
    const edge = down && !padWas;
    padWas = down;
    return edge;
  }

  function update(dt) {
    t += dt;
    const walking = pl.mode === 'walk' && !busyElsewhere();
    if (padPressed() && walking) queued = true;
    if (!walking) { end(); queued = false; }
    if (act?.kind === 'bike' && walking && !posed && pl.character) getOff(); // knocked off (the figure flew apart)
    posed = false;
    if (act?.kind === 'sit' && leftSeat([ctrl.pos[0], ctrl.pos[2]], act.feet, ctrl.vel[1])) stand();
    if (act?.kind === 'boat') {
      followBoat();
      if (act.pending && (act.scan -= dt) <= 0) {
        act.scan = 0.5;
        const spot = findLanding(city, act.seat[0], act.seat[2], { water: act.item.obj.position.y });
        if (spot) land(spot);
      }
    }
    if (walking && !act && (scanT -= dt) <= 0) { scanT = 0.2; scan(); }
    if (queued) {
      queued = false;
      if (walking) run(chooseAction(act?.kind ?? null, near, { pendingLand: !!act?.pending }));
      if (act?.kind === 'boat') followBoat();
      scanT = 0;
    }
    const choice = walking ? chooseAction(act?.kind ?? null, act ? {} : near, { pendingLand: !!act?.pending }) : null;
    prompt.show(promptText(choice, touch));
    // ducks near the player
    if (walking) {
      if ((duckT -= dt) <= 0) { duckT = 1; ducks.refresh(ctrl.pos[0], ctrl.pos[2]); }
      ducks.update(Math.min(dt, 0.1), ctrl.pos[0], ctrl.pos[2]);
      duckMeshes.draw(ducks.visible(), ducks.crumbs, t);
    } else duckMeshes.draw([], [], t);
    if (act?.kind !== 'bike') drawBikes(null);
  }

  const api = { get state() { return act ? { kind: act.kind, pending: !!act.pending } : null; }, near: () => ({ ...near }), ducks, parked, left, update };
  window.__bloxActivities = api;
  return api;
}
