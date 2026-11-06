// makeDeck (src/life/ground.js): a route line over the river moves onto the bridge beside it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeDeck } from '../src/life/ground.js';
import { synthCity } from './player-city.mjs';

test('deck: over water -> the bridge deck beside the line; on land -> null', () => {
  const c = synthCity({ size: 120 });
  c.water(0, 0, 5, 119, 119, 9); // a river everywhere, top at 2.0 m (cells 5..9)
  c.fill(0, 60, 5, 119, 69, 30); // a bridge deck running east-west, north 30..35 m, top 6.2 m
  const deck = makeDeck({ city: c });
  // a bus heading east (yaw 90) whose line runs 4 m south of the deck (north 26 m)
  const d = deck(20, 26, 90);
  assert.ok(d, 'found the deck');
  assert.ok(d.z >= 30 && d.z <= 35, `onto the deck, z ${d.z}`);
  assert.ok(Math.abs(d.x - 20) < 1e-9, 'moved straight across the heading');
  assert.equal(deck(20, 32, 90), null, 'already on the deck');
  c.fill(0, 0, 10, 119, 39, 10); // land south of the deck (not water on top)
  assert.equal(makeDeck({ city: c })(20, 10, 90), null, 'on land');
});

test('ground: a high bridge deck over the river is the ground, not the water under it', async () => {
  const { makeGround } = await import('../src/life/ground.js');
  const c = synthCity({ size: 120 });
  c.water(0, 0, 5, 119, 119, 9); // river top at 2.0 m
  for (let K = 40; K <= 44; K++) c.fill(0, 60, K, 119, 69, K); // a deck 8..9 m up (open underneath)
  c.approxGround = () => 2.0; // the area's baked ground: the water
  // the synth city's groundHeight ignores fromY: emulate the real one (top below fromY)
  const real = c.groundHeight;
  c.groundHeight = (x, z, fromY = Infinity) => {
    if (real(x, z) === 'unknown') return 'unknown';
    for (let K = Math.floor(Math.min(fromY, 60) / c.P); K > 0; K--) { // the highest top at or below fromY
      if (c.isSolid(x, (K - 0.5) * c.P, z) === true && c.isSolid(x, (K + 0.5) * c.P, z) !== true) return K * c.P;
    }
    return null;
  };
  const ground = makeGround({ city: c }, null);
  assert.ok(Math.abs(ground(20, 32) - 9.0) < 0.21, `on the deck: ${ground(20, 32)}`);
  assert.ok(Math.abs(ground(20, 10) - 2.0) < 0.21, 'open river stays the water');
});
