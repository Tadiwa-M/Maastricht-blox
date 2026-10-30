import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cabinBoxes, CABINS } from '../src/ride/cabin.js';
import { SEATS } from '../src/ride/seat.js';

test('cabin: big window openings at the seated eye height, seat backs ahead stay below the windows', () => {
  for (const kind of ['bus', 'rail']) {
    const c = CABINS[kind], eye = SEATS[kind].eye;
    assert.ok(eye > c.sill + 0.3 && eye < c.top - 0.2, `${kind}: eyes in the middle of the windows`);
    assert.ok(c.top - c.sill >= 1.0, `${kind}: windows at least 1 m tall`);
    const boxes = cabinBoxes(kind, SEATS[kind]);
    const backs = boxes.filter((b) => b[6] === '#25356b');
    assert.ok(backs.length >= 4);
    for (const b of backs) assert.ok(b[4] + b[1] / 2 <= c.sill + 0.3 && b[5] < 0, 'seat backs low and ahead (-z)');
    const pillars = boxes.filter((b) => b[6] === '#2a2d36' && b[0] < 0.1);
    assert.ok(pillars.every((b) => b[2] <= 0.1), 'pillars are thin');
  }
});
