// The season (src/render/season.js) and the Christmas market layout (src/life/xmas.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import { seasonNow, leafState } from '../src/render/season.js';
import { chaletLayout } from '../src/life/xmas.js';

test('leaves: green in summer, turning in October, half gone late November, bare in January, fresh in April', () => {
  assert.deepEqual([leafState(190).turn, leafState(190).bare], [0, 0]);
  const oct = seasonNow('#date=2026-10-10'), nov = seasonNow('#date=2026-11-21'), jan = seasonNow('#date=2027-01-15'), apr = seasonNow('#date=2026-04-20');
  assert.ok(oct.turn > 0.2 && oct.turn < 0.7 && oct.bare === 0);
  assert.ok(nov.turn === 1 && nov.bare > 0.4 && nov.bare < 0.7 && nov.litter === 1);
  assert.ok(jan.bare > 0.9 && jan.litter === 0);
  assert.ok(apr.fresh > 0.5);
  assert.equal(seasonNow('#season=winter').bare > 0.9, true);
});

test('festive: lights from mid-November; the market built the week before Magisch Maastricht, open until early January', () => {
  assert.equal(seasonNow('#date=2026-11-10').festive, false);
  const b = seasonNow('#date=2026-11-21');
  assert.equal(b.festive, true); assert.equal(b.market, 'building');
  assert.equal(seasonNow('#date=2026-12-05').market, 'open');
  assert.equal(seasonNow('#date=2027-01-02').market, 'open');
  assert.equal(seasonNow('#date=2027-01-20').market, null);
  assert.equal(seasonNow('#date=2026-07-01&festive=1').market, 'open');
});

test('the chalets stand in rows on the square, none on top of another', () => {
  const c = chaletLayout();
  assert.ok(c.length > 40);
  for (let i = 0; i < c.length; i++) for (let j = i + 1; j < c.length; j++) assert.ok(Math.hypot(c[i].x - c[j].x, c[i].z - c[j].z) > 3);
});
