// Café terraces at night (src/life/terraces.js): parasols fold after dark.
import test from 'node:test';
import assert from 'node:assert/strict';
import { parasolsOpen } from '../src/life/terraces.js';

test('parasols are up in the daytime and folded at night', () => {
  assert.equal(parasolsOpen(14), true);
  assert.equal(parasolsOpen(22), false);
  assert.equal(parasolsOpen(7), false);
});
