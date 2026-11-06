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
  assert.ok(Math.abs(k.x - x0) < 0.05, 'waited');
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
