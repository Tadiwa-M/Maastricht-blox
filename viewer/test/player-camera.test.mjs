// Follow camera (src/player/camera.js), city raycast and street names.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FollowCamera, pullIn, backDir } from '../src/player/camera.js';
import { raycastCity, spawnPoint } from '../src/player/ray.js';
import { streetFinder } from '../src/player/streets.js';
import { parseWalkHash } from '../src/player/hash.js';
import { synthCity } from './player-city.mjs';

test('backDir: camera sits behind the look direction and above it for positive pitch', () => {
  const d = backDir(0, 0.3); // looking north (-z): camera to the south (+z)
  assert.ok(d[2] > 0.9 && d[1] > 0.2 && Math.abs(d[0]) < 1e-9);
  const e = backDir(Math.PI / 2, 0); // looking east: camera to the west
  assert.ok(e[0] < -0.99);
});

test('pull-in: open space keeps the wanted distance, a wall pulls the camera in front of it', () => {
  const city = synthCity();
  const focus = [5, city.floorY + 1.6, -5];
  const dir = backDir(0, 0.1);
  assert.equal(pullIn(city, focus, dir, 6), 6);
  city.fill(0, 4, 5, 39, 5, 30); // wall: cells J 4..5 = z in [-3, -2]; the camera looks from +z
  const d = pullIn(city, focus, dir, 6);
  const camZ = focus[2] + dir[2] * d;
  assert.ok(camZ < -3, `camera behind the wall face: z ${camZ}`);
  assert.ok(d > 1, `not collapsed: ${d}`);
});

test('pull-in: looking up from low, the floor stops the camera; unknown space does not', () => {
  const city = synthCity({ unknownX: 7 });
  const focus = [5, city.floorY + 1.6, -5];
  const d = pullIn(city, focus, backDir(0, -0.4), 8);
  assert.ok(focus[1] + backDir(0, -0.4)[1] * d > city.floorY, 'above the floor');
  assert.ok(d < 8);
  assert.equal(pullIn(city, focus, backDir(-Math.PI / 2, 0), 8), 8); // toward +x into unknown
});

test('FollowCamera: snaps in at once, eases back out, clamps zoom and pitch', () => {
  const city = synthCity();
  const cam = new FollowCamera();
  const feet = [5, city.floorY, -5];
  let r = cam.update(city, feet, 0.016);
  assert.ok(Math.abs(cam.dist - 5) < 1e-9);
  city.fill(0, 4, 5, 39, 5, 30);
  r = cam.update(city, feet, 0.016);
  assert.ok(r.position[2] < -3, `pulled in at once: ${r.position[2]}`);
  cam.input([0, 5], 100);
  assert.equal(cam.aimPitch, cam.o.maxPitch);
  assert.equal(cam.aimDist, cam.o.maxDist);
  assert.ok(cam.pitch < cam.o.maxPitch, 'shown pitch eases, it does not jump');
  for (let q = 0; q < 60; q++) cam.update(city, feet, 1 / 60);
  assert.ok(Math.abs(cam.pitch - cam.o.maxPitch) < 1e-3 && Math.abs(cam.want - cam.o.maxDist) < 0.05);
  cam.input([0, -10], -100);
  assert.equal(cam.aimPitch, cam.o.minPitch);
  assert.equal(cam.aimDist, cam.o.minDist);
  cam.pitch = 0.3; // direct assignment (URL hash) snaps aim and shown value
  assert.equal(cam.aimPitch, 0.3);
});

test('FollowCamera: damped turn is smooth at 60 fps and 10 fps, never overshoots, wraps yaw', () => {
  const city = synthCity();
  const feet = [5, city.floorY, -5];
  for (const dt of [1 / 60, 1 / 10]) {
    const cam = new FollowCamera();
    cam.input([1, 0], 0);
    let last = cam.yaw, steps = 0;
    for (let t = 0; t < 1; t += dt) {
      cam.update(city, feet, dt);
      assert.ok(cam.yaw >= last - 1e-12 && cam.yaw <= 1 + 1e-12, `monotonic, no overshoot at dt ${dt}: ${cam.yaw}`);
      last = cam.yaw; steps++;
    }
    assert.ok(Math.abs(cam.yaw - 1) < 1e-3, `settled at dt ${dt}`);
  }
  const cam = new FollowCamera();
  cam.yaw = 3.1;
  cam.input([0.2, 0], 0); // across +PI: the aim wraps, the shown yaw takes the short way
  assert.ok(cam.aimYaw < 0);
  cam.update(city, feet, 1 / 60);
  assert.ok(Math.abs(cam.yaw) > 3, `short way round: ${cam.yaw}`);
});

test('FollowCamera: collision pull-in still works on the damped values', () => {
  const city = synthCity();
  const feet = [5, city.floorY, -5];
  const cam = new FollowCamera();
  cam.yaw = Math.PI; // looking south: the camera sits north (-z) of the player
  cam.update(city, feet, 1 / 60);
  assert.ok(Math.abs(cam.dist - 5) < 1e-9);
  cam.input([Math.PI, 0], 0); // turn round to look north: the camera swings south, free
  for (let q = 0; q < 60; q++) cam.update(city, feet, 1 / 60);
  assert.ok(Math.abs(cam.dist - 5) < 0.05);
  city.fill(0, 4, 5, 39, 5, 30); // wall between player and camera (south)
  const r = cam.update(city, feet, 1 / 60);
  assert.ok(r.position[2] < -3, `pulled in at once: ${r.position[2]}`);
});

test('raycast finds the first solid point and the spawn point is backed off toward the viewer', () => {
  const city = synthCity();
  const o = [5, 10, 0], dir = [0, -Math.SQRT1_2, -Math.SQRT1_2];
  const hit = raycastCity(city, o, dir);
  assert.ok(Math.abs(hit.point[1] - city.floorY) < 0.01, `hit y ${hit.point[1]}`);
  const sp = spawnPoint(hit, dir);
  assert.ok(sp[2] > hit.point[2] && sp[1] > hit.point[1]);
  assert.equal(raycastCity(city, [5, 10, 0], [0, 1, 0]), null);
});

test('nearest street: inside a small square beats a huge diagonal box; far away -> empty', () => {
  const find = streetFinder([
    { kind: 'street', name: 'Maasboulevard', bboxIJ: [0, 0, 1000, 6000] },
    { kind: 'street', name: 'Markt', bboxIJ: [100, 100, 300, 300] },
    { kind: 'street', name: 'Boschstraat', bboxIJ: [400, 100, 440, 900] },
    { kind: 'building', name: 'Stadhuis', bboxIJ: [150, 150, 160, 160] },
  ]);
  assert.equal(find(200, 200), 'Markt');
  assert.equal(find(420, 500), 'Boschstraat');
  assert.equal(find(445, 500), 'Boschstraat');
  assert.equal(find(5000, 9000), '');
});

test('walk hash: #mode=walk&at=x,z with optional yaw/camyaw/pitch/dist', () => {
  assert.deepEqual(parseWalkHash('#view=hero&mode=walk&at=640.5,1508&yaw=90'),
    { x: 640.5, z: 1508, yaw: 90, camYaw: null, pitch: null, dist: null });
  assert.equal(parseWalkHash('#mode=walk'), null);
  assert.equal(parseWalkHash('#view=hero'), null);
  assert.equal(parseWalkHash('#mode=walk&at=a,b'), null);
});
