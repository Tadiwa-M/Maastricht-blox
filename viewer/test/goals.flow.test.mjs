// First minute and offer pacing (src/goals/flow.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Flow, PROMPT_DELAY_S, PROMPT_S, FIRST_OFFER_S, OFFER_S, AFTER_DECLINE_S, AFTER_GOAL_S } from '../src/goals/flow.js';

/** Run the flow for `s` seconds in 0.1 s frames; all events. */
function run(f, s, st = {}) {
  const ev = [];
  for (let t = 0; t < s - 1e-9; t += 0.1) ev.push(...f.update({ dt: 0.1, ...st }));
  return ev;
}

test('nothing happens on the title screen', () => {
  const f = new Flow({ rand: () => 0.5 });
  assert.deepEqual(run(f, 60, { title: true }), []);
});

test('the first-minute prompt: once, at the map view, gone after a while', () => {
  const f = new Flow({ rand: () => 0.5 });
  assert.deepEqual(run(f, PROMPT_DELAY_S - 0.2, { mode: 'map' }), []);
  assert.deepEqual(run(f, 0.5, { mode: 'map' }), ['prompt']);
  assert.equal(f.prompted, true);
  assert.deepEqual(run(f, PROMPT_S + 1, { mode: 'map' }), ['unprompt']);
  assert.deepEqual(run(f, 30, { mode: 'map' }), []); // never again
});

test('the prompt goes as soon as the player walks; no prompt for returning players', () => {
  const f = new Flow({ rand: () => 0.5 });
  run(f, 2, { mode: 'map' });
  assert.deepEqual(f.update({ dt: 0.1, mode: 'walk' }), ['unprompt']);
  const back = new Flow({ prompted: true });
  assert.deepEqual(run(back, 10, { mode: 'map' }), []);
});

test('the first offer comes ~20 s into the first walk, counting walking time only', () => {
  const f = new Flow({ prompted: true, rand: () => 0.5 });
  assert.deepEqual(run(f, 60, { mode: 'map' }), []);
  assert.deepEqual(run(f, FIRST_OFFER_S - 1, { mode: 'walk' }), []);
  assert.deepEqual(run(f, 5, { mode: 'map' }), []); // back at the map: the count waits
  assert.deepEqual(run(f, 5, { mode: 'walk', riding: true }), []); // riding a bus: waits too
  assert.deepEqual(run(f, 1.5, { mode: 'walk' }), ['offer']);
});

test('an ignored offer times out, then the next one waits longer', () => {
  const f = new Flow({ prompted: true, rand: () => 0.5 });
  run(f, FIRST_OFFER_S + 0.5, { mode: 'walk' });
  assert.deepEqual(run(f, OFFER_S + 0.5, { mode: 'walk' }), ['unoffer']);
  assert.ok(f.next > 60);
});

test('decline, take and finish pace the next offer; a running goal holds offers', () => {
  const f = new Flow({ prompted: true, rand: () => 0.5 });
  run(f, FIRST_OFFER_S + 0.5, { mode: 'walk' });
  f.declined();
  assert.equal(Math.round(f.next), AFTER_DECLINE_S);
  f.update({ dt: 0.1, mode: 'walk' });
  f.taken();
  assert.deepEqual(run(f, 1000, { mode: 'walk', busy: true }), []);
  f.ended();
  assert.equal(Math.round(f.next), AFTER_GOAL_S);
  assert.deepEqual(run(f, AFTER_GOAL_S + 1, { mode: 'walk' }), ['offer']);
});

test('offers off: no offers at all', () => {
  const f = new Flow({ prompted: true, off: true });
  assert.deepEqual(run(f, 600, { mode: 'walk' }), []);
});

test('nothing to offer: retry soon', () => {
  const f = new Flow({ prompted: true, rand: () => 0.5 });
  run(f, FIRST_OFFER_S + 0.5, { mode: 'walk' });
  f.retry(10);
  assert.equal(f.offerT, null);
  assert.deepEqual(run(f, 10.5, { mode: 'walk' }), ['offer']);
});
