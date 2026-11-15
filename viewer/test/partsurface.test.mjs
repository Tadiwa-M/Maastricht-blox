import test from 'node:test';
import assert from 'node:assert/strict';
import { figureKindOf } from '../src/render/figuresurface.js';
import { vehicleKindOf } from '../src/render/vehiclesurface.js';

test('figure parts map to their material kinds (near and far parts alike)', () => {
  assert.equal(figureKindOf('head'), 'face');
  assert.equal(figureKindOf('lo:head'), 'face');
  assert.equal(figureKindOf('hand'), 'hand');
  assert.equal(figureKindOf('hair:short'), 'hair');
  assert.equal(figureKindOf('top:shirt'), 'top');
  assert.equal(figureKindOf('lo:upperArm'), 'sleeve');
  assert.equal(figureKindOf('hips'), 'hips');
  assert.equal(figureKindOf('shin'), 'legs');
  assert.equal(figureKindOf('shoe'), 'shoe');
  assert.equal(figureKindOf('acc:umbrella'), null);
});

test('vehicle meshes map to their material kinds; lights keep their own', () => {
  assert.equal(vehicleKindOf('body:saloon'), 'body');
  assert.equal(vehicleKindOf('glass:van'), 'glass');
  assert.equal(vehicleKindOf('carWheel'), 'wheel');
  assert.equal(vehicleKindOf('bikeWheel'), 'wheel');
  assert.equal(vehicleKindOf('bikeFrame'), 'frame');
  assert.equal(vehicleKindOf('carLights'), null);
  assert.equal(vehicleKindOf('beacon'), null);
});
