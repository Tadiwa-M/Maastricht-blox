// People reacting to the player and to the rain (src/life/reactions.js, src/life/walkers.js):
// looking at jumps and landings, stepping aside from a runner, scattering after a knock-down,
// keeping to the walls and sheltering in the rain, groups heading for a goal, outfits at spawn.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PlayerWatch, playerSample, hitByVehicle, dodgeSide, yawTo, REACT } from '../src/life/reactions.js';
import { WalkGraph } from '../src/life/walkgraph.js';
import { Pedestrians } from '../src/life/walkers.js';

const street = () => new WalkGraph({ nodes: [0, 0, 100, 0, 200, 0], edges: [0, 1, 1, 2], weights: [1, 1, 1] });
const one = (opts = {}) => {
  const p = new Pedestrians({ graph: street(), ground: () => 0, cap: 1, seed: 3, ...opts });
  p.setCount(1, [100, 0]);
  const g = p.groups[0];
  g.nextPause = 1e9; g.pause = 0;
  return { p, g, k: g.walker };
};
const ahead = (k, d, side = 0) => ({ x: k.x + k.dirX * d + k.dirZ * side, z: k.z + k.dirZ * d - k.dirX * side });

test('PlayerWatch: jumps, landings, running, teleports', () => {
  const w = new PlayerWatch();
  assert.equal(w.sample(null, 0.1), null);
  const at = (x, grounded = true, vy = 0) => ({ x, z: 0, y: 0, grounded, vy });
  w.sample(at(0), 0.1);
  let s = w.sample(at(0, false, 4.4), 0.1);
  assert.deepEqual(s.events.map((e) => e.kind), ['jump']);
  for (let q = 0; q < 4; q++) assert.equal(w.sample(at(0, false, 1), 0.1).events.length, 0);
  s = w.sample(at(0), 0.1);
  assert.deepEqual(s.events.map((e) => e.kind), ['land']);
  w.sample(at(0, false, 0.5), 0.05); // stepping off a kerb: too short to count
  assert.equal(w.sample(at(0), 0.05).events.length, 0);
  let x = 0;
  for (let q = 0; q < 20; q++) s = w.sample(at((x += 0.4)), 0.1);
  assert.ok(s.running && Math.abs(s.vx - 4) < 0.2, `running at ${s.vx.toFixed(2)} m/s`);
  s = w.sample(at(500), 0.1);
  assert.ok(!s.running, 'a teleport is not a sprint');
  assert.equal(w.sample(at(500), 0.1, true).events[0].kind, 'knock');
  assert.equal(playerSample({ mode: 'map', ctrl: { pos: [1, 2, 3] } }), null);
  assert.deepEqual(playerSample({ mode: 'walk', ctrl: { pos: [1, 2, 3], vel: [0, -1, 0], grounded: true } }),
    { x: 1, z: -3, y: 2, grounded: true, vy: -1 });
});

test('hit by a moving vehicle; a runner coming at someone makes them step off the line', () => {
  const car = { x: 0, z: 0, yaw: 90, halfW: 0.9, halfL: 2.2, v: 8 }; // driving east
  assert.ok(hitByVehicle(1.5, 0.5, [car]));
  assert.ok(!hitByVehicle(1.5, 2, [car]));
  assert.ok(!hitByVehicle(1.5, 0.5, [{ ...car, v: 0.5 }]), 'a creeping car pushes, it does not knock');
  // runner at the origin going north; walkers heading north too
  assert.equal(dodgeSide(0.5, 2, 0, 1, 0, 0, 0, 4), 1, 'right of the runner: steps right');
  assert.equal(dodgeSide(-0.5, 2, 0, 1, 0, 0, 0, 4), -1);
  assert.equal(dodgeSide(-0.5, 2, 0, -1, 0, 0, 0, 4), 1, 'facing the other way: that is its right');
  assert.equal(dodgeSide(0, -2, 0, 1, 0, 0, 0, 4), 0, 'behind the runner');
  assert.equal(dodgeSide(3, 2, 0, 1, 0, 0, 0, 4), 0, 'well off the line');
  assert.equal(dodgeSide(0, 9, 0, 1, 0, 0, 0, 4), 0, 'too far ahead');
  assert.equal(yawTo(0, 0, 1, 0), 90);
});

test('people look at a jump near them, then walk on', () => {
  const { p, g, k } = one();
  g.members[0].u = 0.3; // (a quarter of the people do not look up)
  const pl = ahead(k, 3);
  p.react({ ...pl, vx: 0, vz: 0, running: false, events: [{ kind: 'jump', ...pl }] }, 0.1);
  assert.ok(g.pause > 1 && g.look, 'stops and looks');
  for (let q = 0; q < 5; q++) p.update(0.1, [100, 0], 120, []);
  const rot = [];
  p.draw({ add: (v, pose) => rot.push(pose.rotY) });
  const want = (-yawTo(k.x, k.z, pl.x, pl.z) * Math.PI) / 180;
  assert.ok(Math.abs(Math.atan2(Math.sin(rot[0] - want), Math.cos(rot[0] - want))) < 0.3, 'facing the player');
  for (let q = 0; q < 40; q++) p.update(0.1, [100, 0], 120, []);
  assert.equal(g.look, null);
  assert.ok(g.pause <= 0, 'walking again');
  const far = ahead(k, 30);
  p.react({ ...far, vx: 0, vz: 0, running: false, events: [{ kind: 'land', ...far }] }, 0.1);
  assert.equal(g.look, null, 'too far to notice');
});

test('a knock-down: people startle, turn away and hurry off', () => {
  const { p, g, k } = one();
  const pl = ahead(k, 4), pace = g.pace;
  p.react({ ...pl, vx: 0, vz: 0, running: false, events: [{ kind: 'knock', ...pl }] }, 0.1);
  assert.ok((pl.x - k.x) * k.dirX + (pl.z - k.z) * k.dirZ < 0, 'turned round');
  assert.ok(g.flee > 0 && g.pause > 0);
  const d0 = Math.hypot(k.x - pl.x, k.z - pl.z);
  for (let q = 0; q < 15; q++) p.update(0.1, [100, 0], 120, []);
  assert.ok(k.speed > pace * 1.5, 'hurrying');
  assert.ok(Math.hypot(k.x - pl.x, k.z - pl.z) > d0 + 0.5, 'away from it');
  for (let q = 0; q < 40; q++) p.update(0.1, [100, 0], 120, []);
  assert.equal(k.speed, pace, 'back to their own pace');
});

test('a runner coming up behind: the group steps aside', () => {
  const { p, k } = one();
  k.lateral = 0; k.place();
  const pl = ahead(k, -2, 0.3); // 2 m behind, a little to the walker's right
  const x0 = k.x, z0 = k.z;
  for (let q = 0; q < 5; q++) p.react({ ...pl, vx: k.dirX * 4, vz: k.dirZ * 4, running: true, events: [] }, 0.1);
  k.place();
  const moved = (k.x - x0) * k.dirZ - (k.z - z0) * k.dirX; // + : to the walker's right
  assert.ok(moved < -0.5, `stepped to the left, away from the runner (${moved.toFixed(2)} m)`);
});

test('rain: people keep to the wall and shelter there; dry again, they spread out', () => {
  const room = (x, z) => z > -2.2; // a facade along the south side of the street
  const { p, g, k } = one({ room });
  p.setRain(0.9);
  for (let q = 0; q < 40; q++) p.update(0.1, [100, 0], 120, []);
  assert.ok(g.wall !== 0, 'found the wall');
  assert.ok(k.z < -1.2 && k.z > -2.2, `close to the wall, clear of it: z ${k.z.toFixed(2)}`);
  g.nextPause = 0;
  p.update(0.1, [100, 0], 120, []);
  assert.ok(g.pause > 8 && g.shelter !== null, 'waits it out');
  const rot = [];
  for (let q = 0; q < 5; q++) p.draw({ add: (v, pose) => rot.push(pose.rotY) }); // (turning takes a moment)
  assert.ok(Math.cos(rot[rot.length - 1]) > 0.95, 'facing the street (north), back to the wall');
  g.pause = 0; g.nextPause = 1e9;
  p.setRain(0);
  for (let q = 0; q < 40; q++) p.update(0.1, [100, 0], 120, []);
  assert.equal(g.wall, 0);
  assert.ok(k.z > -1.2, 'off the wall again');
});

test('rain: keeping to the wall never climbs a stoop beside it', () => {
  const room = (x, z) => z > -2.2;
  const ground = (x, z) => (z < -1.0 ? 0.4 : 0); // a raised step along the facade
  const { p, g, k } = one({ room, ground });
  p.setRain(0.9);
  for (let q = 0; q < 40; q++) p.update(0.1, [100, 0], 120, []);
  assert.ok(g.wall !== 0);
  assert.ok(k.z > -1.0 && k.z < -0.4, `on the street beside the step: z ${k.z.toFixed(2)}`);
  for (const m of p.members()) assert.equal(m.y, 0);
});

test('spawning with a plan and outfits: some groups head somewhere, dressed for the day', () => {
  const p = new Pedestrians({ graph: street(), ground: () => 0, cap: 200, seed: 4 });
  p.plan = { share: 0.5, goals: [{ name: 'station', w: 1, x: 5000, z: 0, r: 40 }] };
  p.dressFor = (v) => { v.dressed = 'test'; return v; };
  p.setCount(200, [100, 0]);
  const withGoal = p.groups.filter((g) => g.walker.goal).length;
  assert.ok(withGoal > p.groups.length * 0.3 && withGoal < p.groups.length * 0.7, `${withGoal} of ${p.groups.length}`);
  assert.ok(p.groups.every((g) => g.members.every((m) => m.v.dressed === 'test')));
  const g = p.groups.find((x) => x.walker.goal);
  g.walker.goal = { x: g.walker.x, z: g.walker.z, r: 40 }; // arrived
  p.update(0.1, [100, 0], 120, []);
  assert.equal(g.walker.goal, null, 'arrived: wanders from here');
  assert.ok(REACT.lookM > 3);
});
