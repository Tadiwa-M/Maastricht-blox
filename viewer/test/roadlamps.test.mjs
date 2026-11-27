// Street lights along the roads (src/life/roadlamps.js roadLampPlan).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RoadGraph } from '../src/life/traffic.js';
import { roadLampPlan, LIGHT } from '../src/life/roadlamps.js';

// one two-way residential street 200 m east, and a service drive
const doc = { nodes: [0, 0, 200, 0, 200, 60], edges: [0, 1, 1, 2], flags: [0 << 1, 5 << 1], classes: ['residential', 'primary', 'secondary', 'tertiary', 'unclassified', 'service'] };

test('a light every step along the road, alternating sides, out of the carriageway, the head over its edge', () => {
  const g = new RoadGraph(doc);
  const plan = roadLampPlan(g);
  const onStreet = plan.filter((l) => l.z > -20 && l.z < 20 && l.x < 199);
  assert.equal(onStreet.length, Math.floor((200 - 2 * LIGHT.edgeIn) / LIGHT.step) + 1, 'planned once for both directions');
  assert.ok(onStreet.some((l) => l.z > 0) && onStreet.some((l) => l.z < 0), 'both sides');
  for (const l of onStreet) {
    assert.ok(Math.abs(l.z) > 2, 'off the carriageway');
    assert.ok(Math.abs(l.hz) < Math.abs(l.z), 'the head leans over the road');
  }
  assert.equal(plan.filter((l) => l.x > 199).length, 0, 'the service drive stays dark');
});
