// Cars (src/figure/vehicles.js): every type has a body and glass, and the lights come on at night.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CAR_TYPES, VEHICLE_GEOS, VehicleFleet, LIGHTS_FROM } from '../src/figure/vehicles.js';

test('every car type has its geometry; the family of cars grew', () => {
  const G = VEHICLE_GEOS();
  for (const k of Object.keys(CAR_TYPES)) {
    assert.ok(G[`body:${k}`].attributes.position.count > 100, k);
    assert.ok(G[`glass:${k}`].attributes.color, k);
  }
  for (const k of ['estate', 'suv', 'taxi']) assert.ok(CAR_TYPES[k], k);
  assert.ok(G['glass:taxi'].attributes.position.count > G['glass:saloon'].attributes.position.count, 'the taxi carries a roof sign');
});

test('lights: off by day, on from dusk, one more draw call for all cars together', () => {
  const fleet = new VehicleFleet({ bikes: 2, cars: 8 });
  const draw = () => { fleet.begin(); for (const [q, t] of ['hatch', 'van', 'suv', 'taxi'].entries()) fleet.addCar(t, q * 6, 0, 0, 0); fleet.end(); };
  draw();
  const lights = fleet.meshes.get('carLights').mesh;
  assert.equal(lights.count, 0, 'day');
  const day = fleet.drawCalls();
  fleet.setNight(LIGHTS_FROM + 0.5);
  draw();
  assert.equal(lights.count, 4);
  assert.equal(fleet.drawCalls(), day + 1);
  assert.ok(!lights.castShadow, 'light does not cast a shadow');
  assert.ok(lights.material.transparent && !lights.material.depthWrite);
  fleet.setNight(LIGHTS_FROM + 0.05);
  draw();
  assert.ok(lights.instanceColor.array[0] > 0 && lights.instanceColor.array[0] < 0.5, 'they fade in at dusk');
});
