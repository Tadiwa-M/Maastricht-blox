// Dressing figure variants (figure/variants.js) for the day: carnaval (Limburg's red, yellow and
// green, hats, everything bright), orange for Koningsdag, coats and beanies when it is cold.
// Changes a fresh variant in place before it is first drawn (FigureCrowd caches its colours).
// Pure, tested in test/life.calendar.test.mjs. Palette colours only (contract/palette.json).

const RED = '#C8102E', YELLOW = '#F2C230', GREEN = '#2F5A3C', PINK = '#D9607E', BLUE = '#5B8DB8', WHITE = '#F2F0EA';
const ORANGE = '#C0643A', OCHRE = '#D6A445';
const CARNAVAL = [RED, YELLOW, GREEN, PINK, BLUE, YELLOW, RED, GREEN];
const WINTER_HATS = ['#22385A', '#1E1F21', '#B8302A', '#5C6062', '#2F5A3C'];

/** Stable 0..1 from a seed and a salt (who is dressed up does not flicker). */
export function seedUnit(seed, salt = 0) {
  let h = Math.imul((seed + salt * 7919) ^ 0x5bd1e995, 0x27d4eb2d);
  h ^= h >>> 15; h = Math.imul(h, 0x165667b1); h ^= h >>> 13;
  return (h >>> 0) / 4294967296;
}

const pick = (arr, u) => arr[Math.min(arr.length - 1, Math.floor(u * arr.length))];

/**
 * Dress variant v for the moment: outfit { style: 'carnaval' | 'orange', share } (calendar
 * events) and tempC (cold: more coats and hats). Returns v (changed when it is dressed).
 */
export function dress(v, { outfit = null, tempC = null } = {}) {
  const s = v.seed ?? 0;
  if (outfit && seedUnit(s, 1) < outfit.share) {
    const c = v.colours;
    if (outfit.style === 'carnaval') {
      c.top = pick(CARNAVAL, seedUnit(s, 2));
      c.bottom = pick([RED, YELLOW, GREEN, WHITE, BLUE], seedUnit(s, 3));
      if (v.top === 'dress' && seedUnit(s, 4) < 0.5) c.bottom = c.top;
      c.hat = pick(CARNAVAL, seedUnit(s, 5));
      if (seedUnit(s, 6) < 0.7) { v.hair = seedUnit(s, 7) < 0.6 ? 'hat' : 'cap'; c.hairTint = c.hat; }
      if (v.top === 'coat' && seedUnit(s, 8) < 0.6) v.top = 'jacket';
      c.acc = pick(CARNAVAL, seedUnit(s, 9));
    } else if (outfit.style === 'orange') {
      c.top = seedUnit(s, 2) < 0.8 ? ORANGE : OCHRE;
      if (seedUnit(s, 6) < 0.35) { v.hair = 'cap'; c.hat = ORANGE; c.hairTint = ORANGE; }
    }
    v.dressed = outfit.style;
    return v;
  }
  if (Number.isFinite(tempC) && tempC < 8 && v.kind !== 'kid') {
    const cold = Math.min(1, (8 - tempC) / 10); // 8 °C: a few coats more .. -2 °C: most people
    if (v.top !== 'coat' && seedUnit(s, 11) < cold * 0.7) v.top = 'coat';
    if (!['cap', 'beanie', 'hat'].includes(v.hair) && seedUnit(s, 12) < cold * 0.45) {
      v.hair = 'beanie'; v.colours.hat = pick(WINTER_HATS, seedUnit(s, 13)); v.colours.hairTint = v.colours.hat;
    }
  }
  return v;
}
