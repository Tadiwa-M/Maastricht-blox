// Figure variants: who a figure is (age group, size, hair, clothes, colours, accessory, pace).
// Pure and deterministic: makeVariant(seed) always gives the same figure (tests, screenshots).
//
// Clothing colours come from the city palette (contract/palette.json, by index). Skin and
// hair use their own small tables of natural tones: movers may use non-palette colours (see
// docs/guide/05-movers-and-models.md, "Colours of movers").
import { HAIR_STYLES, TOP_STYLES } from './parts.js';

/** mulberry32: deterministic random numbers in [0, 1). */
export function rng(seed = 1) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// palette srgb by index (copied from contract/palette.json so the figure needs no world)
export const PALETTE_HEX = {
  4: '#A33A2B', 5: '#7A2A22', 6: '#C0643A', 7: '#6E4A33', 8: '#F2F0EA', 9: '#A7AAA8', 10: '#5C6062', 11: '#1E1F21',
  12: '#4E5864', 15: '#5E9C8C', 16: '#B8302A', 17: '#EFE3C2', 18: '#CDB48B', 19: '#8F7A57', 20: '#6E8798', 21: '#22385A',
  37: '#F2C230', 38: '#C8102E', 41: '#2F5A3C', 42: '#88A891', 43: '#D6A445', 44: '#5B8DB8', 45: '#D9607E', 46: '#B5776A',
};
const TOPS = [44, 38, 8, 37, 41, 20, 45, 43, 4, 9, 42, 21, 17, 11, 15, 6, 16, 12];
const COATS = [21, 11, 10, 19, 7, 12, 41, 5, 20, 18];
const BOTTOMS = [21, 11, 10, 19, 20, 18, 7, 12, 9, 44];
const SHOES = [11, 7, 8, 10, 5, 21, 38];
const BAGS = [8, 37, 38, 41, 44, 18, 45, 11];
export const SKIN = ['#F3CFB0', '#EAB892', '#D49A6E', '#B07650', '#8A5638', '#5E3A26'];
export const HAIR = ['#2A1D16', '#4A2F1E', '#734A2A', '#A87A45', '#D8B26E', '#A9471F', '#151515'];
export const GREY_HAIR = ['#9C9A96', '#C9C6C0', '#E9E6E0'];

const pick = (r, a) => a[Math.floor(r() * a.length)];
const hex = (i) => PALETTE_HEX[i];

/**
 * A variant from a seed. opts.kind forces 'adult' | 'kid' | 'older'. Returns
 * { seed, kind, scale, width, headScale, hair, top, acc, colours: { skin, hair, top, bottom, shoe, hat, acc },
 *   speed (m/s walking), stoop (rad) }.
 */
export function makeVariant(seed, opts = {}) {
  const r = rng(seed * 7919 + 13);
  const u = r();
  const kind = opts.kind || (u < 0.12 ? 'kid' : u < 0.3 ? 'older' : 'adult');
  const fem = r() < 0.5;
  let hair;
  if (kind === 'older') hair = pick(r, fem ? ['bob', 'short', 'bun', 'hat', 'curly'] : ['fringe', 'short', 'hat', 'cap', 'fringe']);
  else if (kind === 'kid') hair = pick(r, fem ? ['ponytail', 'long', 'bob', 'curly', 'beanie'] : ['short', 'curly', 'cap', 'beanie', 'short']);
  else hair = pick(r, fem ? ['long', 'bob', 'bun', 'ponytail', 'curly', 'beanie', 'short'] : ['short', 'short', 'curly', 'cap', 'beanie', 'fringe', 'bun']);
  let top = pick(r, fem ? ['shirt', 'jacket', 'coat', 'dress', 'shirt'] : ['shirt', 'jacket', 'coat', 'shirt']);
  if (kind === 'older' && r() < 0.5) top = 'coat';
  const topIdx = top === 'coat' || top === 'jacket' ? pick(r, COATS.concat(TOPS.slice(0, 6))) : pick(r, TOPS);
  let bottomIdx = pick(r, BOTTOMS);
  if (bottomIdx === topIdx) bottomIdx = 11;
  const skin = pick(r, SKIN);
  const hairCol = kind === 'older' ? pick(r, GREY_HAIR) : pick(r, HAIR);
  const hatCol = hex(pick(r, [38, 21, 11, 37, 41, 44, 45, 9, 6, 8]));
  const accRoll = r();
  const acc = kind === 'kid' ? (accRoll < 0.35 ? 'backpack' : 'none')
    : accRoll < 0.18 ? 'backpack' : accRoll < 0.38 ? 'bag' : 'none';
  const height = kind === 'kid' ? 0.6 + r() * 0.07 : kind === 'older' ? 0.95 + r() * 0.05 : (fem ? 0.96 : 1.0) + r() * 0.05;
  const v = {
    seed, kind, fem, hair, top, acc,
    scale: height,
    width: kind === 'kid' ? 0.95 : (fem ? 0.92 : 0.97) + r() * 0.06,
    headScale: kind === 'kid' ? 1.32 : 1,
    stoop: kind === 'older' ? 0.12 + r() * 0.1 : r() * 0.03,
    speed: kind === 'older' ? 0.75 + r() * 0.3 : kind === 'kid' ? 1.1 + r() * 0.5 : 1.15 + r() * 0.5,
    colours: {
      skin, hair: hairCol,
      top: hex(topIdx), bottom: top === 'dress' ? skin : hex(bottomIdx),
      shoe: hex(pick(r, SHOES)), hat: hatCol, acc: hex(pick(r, BAGS)),
    },
  };
  if (['cap', 'beanie', 'hat'].includes(hair)) v.colours.hairTint = v.colours.hat;
  return v;
}

/** n distinct-looking variants for a sheet: every hair style and top style appears. */
export function sheetVariants(n = 12) {
  const out = [];
  const want = [...HAIR_STYLES];
  let seed = 1;
  while (out.length < n && seed < 5000) {
    const kind = out.length === 3 || out.length === 9 ? 'kid' : out.length === 6 || out.length === 11 ? 'older' : 'adult';
    const v = makeVariant(seed++, { kind });
    const k = want.indexOf(v.hair);
    if (want.length) { // first every hair style once
      if (k < 0) continue;
      want.splice(k, 1);
    } else if (!TOP_STYLES.every((t) => out.some((o) => o.top === t)) && out.some((o) => o.top === v.top)) continue; // then missing tops
    out.push(v);
  }
  return out;
}
