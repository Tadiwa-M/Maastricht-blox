// Maastricht's calendar (src/life/calendar.js) and outfits for the day (src/life/outfits.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dayNumber, fromDayNumber, weekdayOf, parseYmd, easter, ashWednesday, carnavalDays, preuvenemintDays,
  magischDays, koningsdag, lastWeekday, eventsAt, windowStrength, clockDate, zonedDayNumber } from '../src/life/calendar.js';
import { dress, seedUnit } from '../src/life/outfits.js';
import { makeVariant, PALETTE_HEX } from '../src/figure/variants.js';
import { initialClock } from '../src/life/index.js';

const ymd = (n) => { const d = fromDayNumber(n); return `${d.y}-${String(d.m).padStart(2, '0')}-${String(d.d).padStart(2, '0')}`; };
const ids = (dn, h) => eventsAt(dn, h).map((e) => e.id);

test('day numbers, weekdays and dates', () => {
  assert.equal(dayNumber(1970, 1, 1), 0);
  assert.equal(weekdayOf(0), 3, '1970-01-01 was a Thursday');
  assert.equal(weekdayOf(dayNumber(2026, 11, 7)), 5, '2026-11-07 is a Saturday');
  assert.deepEqual(fromDayNumber(dayNumber(2028, 2, 29)), { y: 2028, m: 2, d: 29 });
  assert.equal(parseYmd('2027-02-07'), dayNumber(2027, 2, 7));
  assert.equal(parseYmd('2027-02-30'), null);
  assert.equal(parseYmd('soon'), null);
  assert.equal(zonedDayNumber(new Date('2026-12-31T23:30:00Z')), dayNumber(2027, 1, 1), 'Maastricht is already in the new year');
});

test('Easter, Ash Wednesday and carnaval (Friday to Tuesday before Ash Wednesday)', () => {
  assert.equal(ymd(easter(2025)), '2025-04-20');
  assert.equal(ymd(easter(2026)), '2026-04-05');
  assert.equal(ymd(easter(2027)), '2027-03-28');
  assert.equal(ymd(ashWednesday(2026)), '2026-02-18');
  assert.deepEqual(carnavalDays(2026).map(ymd), ['2026-02-13', '2026-02-17']);
  assert.deepEqual(carnavalDays(2027).map(ymd), ['2027-02-05', '2027-02-09']);
  const [fri] = carnavalDays(2027);
  assert.equal(weekdayOf(fri), 4);
  assert.deepEqual(ids(fri, 9), [], 'not before the opening');
  assert.ok(ids(fri, 14).includes('carnaval'));
  assert.ok(ids(fri + 1, 1.5).includes('carnaval'), 'the night after counts');
  assert.ok(!ids(fri + 5, 12).includes('carnaval'), 'Ash Wednesday: over');
  assert.ok(!ids(fri + 5, 1).includes('carnaval'), 'Tuesday ends at midnight');
  const e = eventsAt(fri + 2, 14).find((x) => x.id === 'carnaval');
  assert.equal(e.outfit.style, 'carnaval');
  assert.ok(e.crowd > 1.5 && e.spots.vrijthof > 1 && e.spots.markt > 1);
});

test('Preuvenemint, Magisch Maastricht, Koningsdag, 11-11', () => {
  assert.deepEqual(preuvenemintDays(2026).map(ymd), ['2026-08-27', '2026-08-30']);
  assert.equal(weekdayOf(lastWeekday(2026, 8, 6)), 6);
  assert.ok(ids(dayNumber(2026, 8, 29), 15).includes('preuvenemint'));
  assert.ok(!ids(dayNumber(2026, 8, 29), 9).includes('preuvenemint'));
  assert.deepEqual(magischDays(2026).map(ymd), ['2026-11-27', '2027-01-04']);
  assert.ok(ids(dayNumber(2026, 12, 12), 16).includes('magisch'));
  assert.ok(ids(dayNumber(2027, 1, 2), 16).includes('magisch'), 'into January');
  assert.ok(!ids(dayNumber(2027, 1, 6), 16).includes('magisch'));
  assert.ok(!ids(dayNumber(2026, 11, 20), 16).includes('magisch'));
  assert.ok(!ids(dayNumber(2026, 12, 24), 19).includes('magisch'), 'Christmas Eve: closes early');
  assert.equal(ymd(koningsdag(2025)), '2025-04-26', '27 April 2025 was a Sunday');
  assert.equal(ymd(koningsdag(2026)), '2026-04-27');
  assert.ok(ids(dayNumber(2026, 11, 11), 12).includes('elfde'));
  assert.deepEqual(ids(dayNumber(2026, 11, 7), 12), [], 'an ordinary Saturday');
});

test('events build up and thin out', () => {
  assert.equal(windowStrength([10, 20], 9), 0);
  assert.ok(windowStrength([10, 20], 10) < 0.5);
  assert.equal(windowStrength([10, 20], 15), 1);
  assert.ok(windowStrength([10, 20], 19.9) < 0.5);
  const dn = dayNumber(2026, 8, 29);
  assert.ok(eventsAt(dn, 12.2)[0].crowd < eventsAt(dn, 16)[0].crowd);
});

test('the date the game clock shows: within half a week of the anchor', () => {
  const sat = dayNumber(2026, 11, 7), t0 = 5 * 86400 + 10 * 3600; // Saturday 10:00
  assert.equal(clockDate(t0, sat, t0), sat);
  assert.equal(clockDate(5 * 86400 + 23.9 * 3600, sat, t0), sat);
  assert.equal(clockDate(6 * 86400 + 3600, sat, t0), sat + 1, 'Sunday 01:00');
  assert.equal(clockDate(0, sat, t0), sat + 2, 'Monday 00:00 next');
  assert.equal(clockDate(2 * 86400 + 12 * 3600, sat, t0), sat - 3, 'Wednesday: the one just gone');
  for (let t = 0; t < 7 * 86400; t += 5000) assert.equal(weekdayOf(clockDate(t, sat, t0)), Math.floor(t / 86400));
  const { clock, anchor } = initialClock('#date=2027-02-07&t=14', new Date('2026-11-07T10:00:00Z'));
  assert.equal(clock.day, 6, 'the date gives the weekday');
  assert.equal(clockDate(clock.t, anchor.dn, anchor.t), dayNumber(2027, 2, 7));
  assert.ok(eventsAt(clockDate(clock.t, anchor.dn, anchor.t), clock.hours).some((e) => e.id === 'carnaval'));
  const now = initialClock('', new Date('2026-11-07T10:00:00Z'));
  assert.equal(clockDate(now.clock.t, now.anchor.dn, now.anchor.t), dayNumber(2026, 11, 7));
});

test('outfits: dressed up for carnaval in palette colours, stable, coats in the cold', () => {
  const palette = new Set(Object.values(PALETTE_HEX));
  let dressed = 0;
  for (let s = 1; s <= 200; s++) {
    const v = dress(makeVariant(s), { outfit: { style: 'carnaval', share: 0.8 } });
    if (!v.dressed) continue;
    dressed++;
    for (const k of ['top', 'bottom', 'hat', 'acc']) assert.ok(palette.has(v.colours[k]) || v.colours[k] === v.colours.skin, `${k} ${v.colours[k]}`);
    assert.deepEqual(dress(makeVariant(s), { outfit: { style: 'carnaval', share: 0.8 } }).colours, v.colours, 'the same person every time');
  }
  assert.ok(dressed > 130 && dressed < 190, `${dressed} of 200 dressed up`);
  assert.deepEqual(dress(makeVariant(5), {}), makeVariant(5), 'an ordinary day: unchanged');
  const coats = (tempC) => Array.from({ length: 200 }, (_, s) => dress(makeVariant(s + 1), { tempC })).filter((v) => v.top === 'coat').length;
  assert.ok(coats(-2) > coats(15) + 40, `${coats(-2)} coats at -2 °C, ${coats(15)} at 15 °C`);
  assert.ok(seedUnit(3, 1) >= 0 && seedUnit(3, 1) < 1 && seedUnit(3, 1) !== seedUnit(4, 1));
});
