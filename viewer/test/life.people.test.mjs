// People behaving like people (src/life/walkers.js): wait for vehicles, single file where
// the pavement is narrow, never drawn on a roof.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WalkGraph } from '../src/life/walkgraph.js';
import { Pedestrians, inVehiclePath } from '../src/life/walkers.js';

// one long east-west street (x 0..200 at z 0)
const street = () => new WalkGraph({ nodes: [0, 0, 100, 0, 200, 0], edges: [0, 1, 1, 2], weights: [1, 1, 1] });

test('inVehiclePath: the footprint plus the road ahead of the vehicle, not behind it', () => {
  const bus = { x: 0, z: 0, yaw: 0, halfW: 1.25, halfL: 6 }; // heading north
  assert.ok(inVehiclePath(bus, 0, 10)); // 4 m ahead of its nose
  assert.ok(!inVehiclePath(bus, 0, 15)); // beyond the look-ahead
  assert.ok(!inVehiclePath(bus, 0, -9)); // behind it
  assert.ok(!inVehiclePath(bus, 3, 3)); // beside it
});

test('a walker waits at the kerb for a bus coming across, then walks on', () => {
  const p = new Pedestrians({ graph: street(), ground: () => 0, cap: 1, seed: 3 });
  p.setCount(1, [100, 0]);
  const g = p.groups[0], k = g.walker;
  g.nextPause = 1e9; g.pause = 0;
  const dir = [k.dirX, k.dirZ];
  // a bus driving north whose path crosses 2 m ahead of the walker
  const bus = { x: k.x + dir[0] * 3, z: k.z + dir[1] * 3 - 5, yaw: 0, halfW: 1.25, halfL: 6 }; // driving north, crossing 3 m ahead
  const x0 = k.x;
  for (let i = 0; i < 10; i++) p.update(0.1, [100, 0], 120, [bus]);
  assert.ok(Math.abs(k.x - x0) < 0.3, 'waited (a step to come to a stop, no more)');
  for (let i = 0; i < 10; i++) p.update(0.1, [100, 0], 120, []); // the bus has gone
  assert.ok(Math.abs(k.x - x0) > 0.5, 'walks on');
});

test('narrow pavement: a group falls into single file, and nobody stands on a roof', () => {
  // walls everywhere more than 0.5 m beside the street centre line (a narrow lane)
  const room = (x, z) => Math.abs(z) < 0.5;
  const ground = (x, z) => (Math.abs(z) < 0.5 ? 0 : 6); // the buildings' roofs
  const p = new Pedestrians({ graph: street(), ground, room, cap: 4, seed: 5 });
  const g = { size: 3 };
  p.spawn(g, 100, 0, 0);
  p.groups.push(g); p.active = 1;
  g.nextPause = 1e9;
  for (let i = 0; i < 30; i++) p.update(0.1, [100, 0], 120, []);
  assert.ok(g.file > 0.9, `single file (${g.file.toFixed(2)})`);
  for (const m of p.members()) {
    assert.ok(Math.abs(m.z) < 0.6, `in the lane: z ${m.z.toFixed(2)}`);
    assert.equal(m.y, 0, 'on the street, not the roof');
  }
});

test('giving way never goes into a wall: the shift is cut to the room there is', () => {
  const room = (x, z) => z > -0.9; // a facade 0.9 m south of the path
  const p = new Pedestrians({ graph: street(), ground: () => 0, room, cap: 1, seed: 3 });
  p.setCount(1, [100, 0]);
  const g = p.groups[0], k = g.walker;
  k.baseLateral = k.lateral = k.lateralGoal = 0; k.place();
  const toWall = k.dirX > 0 ? 1 : -1; // right of an eastbound walker is south
  k.shift = 1.6 * toWall; k.lateralGoal = k.shift;
  p.fitShift(g, 0.1);
  assert.ok(Math.abs(k.lateralGoal) < 0.6, `kept off the wall: ${k.lateralGoal}`);
  k.shift = -1.6 * toWall; k.lateralGoal = k.shift;
  p.fitShift(g, 0.1);
  assert.equal(k.lateralGoal, k.shift, 'the open side is free to use');
});

test('drawn people: stopping eases walk into stand, they do something while standing, heads turn to the player', () => {
  const p = new Pedestrians({ graph: street(), ground: () => 0, cap: 1, seed: 3 });
  p.setCount(1, [100, 0]);
  const g = p.groups[0], k = g.walker;
  g.nextPause = 1e9;
  const poses = [];
  const crowd = { add: (v, pose) => poses.push(pose) };
  for (let q = 0; q < 10; q++) { p.update(0.05, [100, 0], 120, []); p.draw(crowd); }
  assert.ok(poses.at(-1).blend === undefined && poses.at(-1).mode === 0, 'walking: the plain walk');
  const sp = poses.at(-1).speed;
  g.pause = 6;
  const blends = [];
  for (let q = 0; q < 40; q++) { p.update(0.05, [100, 0], 120, []); p.draw(crowd); blends.push(poses.at(-1).blend ?? (poses.at(-1).mode === 0 ? 1 : 0)); }
  assert.ok(blends.some((b) => b > 0.1 && b < 0.9), 'eased through a blend');
  assert.equal(blends.at(-1), 0);
  for (let q = 1; q < blends.length; q++) assert.ok(blends[q] <= blends[q - 1] + 1e-9 && blends[q - 1] - blends[q] < 0.4, 'no snap');
  assert.ok(g.members.every((m) => m.act !== null && m.act !== undefined), 'picked something to do');
  // the player walks by on the left: a curious person's head follows
  g.members[0].u = 0.1;
  const left = { x: k.x - k.dirZ * 2 + k.dirX * 2, z: k.z + k.dirX * 2 + k.dirZ * 2 };
  let turned = 0;
  for (let q = 0; q < 200; q++) { p.react({ x: left.x, z: left.z, vx: 0, vz: 0, running: false, events: [] }, 0.05); p.update(0.05, [100, 0], 120, []); p.draw(crowd); turned = Math.max(turned, poses.at(-1).look); }
  assert.ok(turned > 0.4, `head turned to the player: ${turned}`);
  assert.ok(sp > 0.5);
});

test('running into a person: a sprint knocks them down (they get up again), a walk shoves them aside', async () => {
  const p = new Pedestrians({ graph: street(), ground: () => 0, cap: 1, seed: 3 });
  p.setCount(1, [100, 0]);
  const g = p.groups[0], k = g.walker;
  g.nextPause = 1e9; g.pause = 0;
  p.update(0.1, [100, 0], 120, []);
  const m = g.members[0], at = p.memberAt(g, m);
  const bumps = [];
  p.onBump = (kind) => bumps.push(kind);
  const drawn = () => { let parts = 0, figures = 0; p.draw({ add: () => { figures++; }, addParts: () => { parts++; } }); return { parts, figures }; };
  // a sprint straight at them
  p.react({ x: at.x - 0.4, z: at.z, vx: 5, vz: 0, speed: 5, running: true, events: [] }, 0.1);
  assert.deepEqual(bumps, ['knock']);
  assert.ok(m.scatter, 'down');
  assert.equal(drawn().parts, 1, 'drawn as flying pieces');
  p.react({ x: at.x - 0.4, z: at.z, vx: 5, vz: 0, speed: 5, running: true, events: [] }, 0.1);
  assert.equal(bumps.length, 1, 'not knocked again while down');
  for (let i = 0; i < 200 && m.scatter; i++) { p.dt = 0.05; p.draw({ add() {}, addParts() {} }); }
  assert.equal(m.scatter, null, 'back on their feet');
  // later, a walk into them: a shove
  p.t += 5;
  const at2 = p.memberAt(g, m), lat0 = k.lateral;
  p.react({ x: at2.x - 0.4, z: at2.z + 0.05, vx: 1.4, vz: 0, speed: 1.4, running: false, events: [] }, 0.1);
  assert.equal(bumps[1], 'shove');
  assert.ok(Math.abs(k.lateral - lat0) > 0.5, 'pushed aside');
  assert.ok(m.stumble > 0 && g.pause > 0.5);
  assert.equal(drawn().figures, 1);
});
