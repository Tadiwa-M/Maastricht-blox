// The street-life audit (src/life/audit.js) counts each kind of problem once.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { auditLife, inFootprint } from '../src/life/audit.js';

const bus = { x: 0, z: 0, yaw: 0, halfW: 1.25, halfL: 6 }; // heading north

test('inFootprint: along the heading and across it', () => {
  assert.ok(inFootprint(bus, 0, 5.9));
  assert.ok(!inFootprint(bus, 0, 6.2));
  assert.ok(!inFootprint(bus, 1.4, 0));
  assert.ok(inFootprint({ ...bus, yaw: 90 }, 5.9, 0), 'turned east');
});

test('auditLife: overlaps, people in vehicles, roofs, bikes and cars in buses', () => {
  const people = [
    { x: 10, z: 10, y: 0, g: 1 }, { x: 10.2, z: 10, y: 0, g: 2 }, // two strangers through each other
    { x: 20, z: 20, y: 0, g: 3 }, { x: 20.2, z: 20, y: 0, g: 3 }, // a group: close on purpose
    { x: 0, z: 1, y: 0, g: 4 }, // inside the bus
    { x: 30, z: 30, y: 6, g: 5 }, // on a roof
  ];
  const r = auditLife({ people, buses: [bus], cars: [{ x: 0.5, z: 7, yaw: 0, halfW: 0.9, halfL: 2.2 }, { x: 40, z: 0, yaw: 0, halfW: 0.9, halfL: 2.2 }, { x: 40.5, z: 1, yaw: 0, halfW: 0.9, halfL: 2.2 }],
    bikes: [{ x: 1, z: -3, yaw: 0 }, { x: 50, z: 50, yaw: 0 }], street: () => 0 });
  assert.equal(r.peopleOverlap, 1);
  assert.equal(r.peopleInVehicles, 1);
  assert.equal(r.peopleOnRoofs, 1);
  assert.equal(r.bikesInVehicles, 1);
  assert.equal(r.carsInBuses, 1);
  assert.equal(r.carsOverlap, 1);
});
