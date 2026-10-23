// Life clock (src/life/clock.js) and its start from the URL or real Maastricht time.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LifeClock, zonedWeekTime, parseDay, WEEK_S } from '../src/life/clock.js';
import { initialClock } from '../src/life/index.js';

test('clock advances with speed and wraps the week', () => {
  const c = new LifeClock({ day: 6, sec: 86400 - 30, speed: 60 });
  assert.equal(c.label(), 'Sun 23:59');
  c.advance(1); // +60 s
  assert.equal(c.day, 0);
  assert.equal(c.sec, 30);
  c.set(-1, 0);
  assert.equal(c.t, WEEK_S - 86400);
  c.setHours(16.5);
  assert.equal(c.label(), 'Sun 16:30');
});

test('Maastricht time from a UTC instant (summer and winter time)', () => {
  // 2026-10-23 is a Friday; CEST = UTC+2
  assert.deepEqual(zonedWeekTime(new Date('2026-10-23T10:00:00Z')), { day: 4, sec: 12 * 3600 });
  // 2026-12-27 is a Sunday; CET = UTC+1, 23:30 UTC = 00:30 Monday
  assert.deepEqual(zonedWeekTime(new Date('2026-12-27T23:30:00Z')), { day: 0, sec: 1800 });
});

test('day names and URL start', () => {
  assert.equal(parseDay('sat'), 5);
  assert.equal(parseDay('Monday'), 0);
  assert.equal(parseDay('x'), null);
  const { clock, fixed } = initialClock('#view=hero&t=8.25&day=sun&speed=60', new Date('2026-10-23T10:00:00Z'));
  assert.ok(fixed);
  assert.equal(clock.label(), 'Sun 08:15');
  assert.equal(clock.speed, 60);
  const real = initialClock('#view=hero', new Date('2026-10-23T10:00:00Z'));
  assert.ok(!real.fixed);
  assert.equal(real.clock.label(), 'Fri 12:00');
});
