// A player's own figure (character creator): the choices, the variant built from them, and a
// short text code for the link (#look=...) and the browser's storage. Pure (no DOM, no three.js),
// tested in test/figure-custom.test.mjs. The figure stays our original brick-style design
// (figure/parts.js): the creator only picks among its parts and colours.

import { HAIR_STYLES, TOP_STYLES, ACCESSORIES } from './parts.js';
import { SKIN, HAIR, GREY_HAIR, PALETTE_HEX, makeVariant } from './variants.js';

const CLOTHES = [44, 38, 8, 37, 41, 20, 45, 43, 4, 9, 42, 21, 17, 11, 15, 6, 16, 12, 5, 7, 10, 18, 19, 46];
const SHOE_COLS = [11, 7, 8, 10, 5, 21, 38, 44, 37];
export const HAIR_COLOURS = [...HAIR, ...GREY_HAIR];
export const HEADWEAR = new Set(['cap', 'beanie', 'hat']);

/** Every choice: key, label, its options (values; colours are hex strings) and when(values) it applies. */
export const CHOICES = [
  { key: 'height', label: 'Height', values: [0.9, 0.94, 0.97, 1.0, 1.03, 1.06, 1.1] },
  { key: 'build', label: 'Build', values: [0.88, 0.92, 0.96, 1.0, 1.04, 1.08] },
  { key: 'skin', label: 'Skin', values: SKIN, colour: true },
  { key: 'hair', label: 'Hair', values: HAIR_STYLES },
  { key: 'hairCol', label: 'Hair colour', values: HAIR_COLOURS, colour: true },
  { key: 'hatCol', label: 'Hat colour', values: CLOTHES.map((i) => PALETTE_HEX[i]), colour: true, when: (c) => HEADWEAR.has(c.hair) },
  { key: 'top', label: 'Top', values: TOP_STYLES },
  { key: 'topCol', label: 'Top colour', values: CLOTHES.map((i) => PALETTE_HEX[i]), colour: true },
  { key: 'bottomCol', label: 'Trousers', values: CLOTHES.map((i) => PALETTE_HEX[i]), colour: true, when: (c) => c.top !== 'dress' },
  { key: 'shoeCol', label: 'Shoes', values: SHOE_COLS.map((i) => PALETTE_HEX[i]), colour: true },
  { key: 'acc', label: 'Carrying', values: ACCESSORIES.filter((a) => a !== 'umbrella') },
  { key: 'accCol', label: 'Bag colour', values: CLOTHES.map((i) => PALETTE_HEX[i]), colour: true, when: (c) => c.acc !== 'none' },
];
const BY_KEY = Object.fromEntries(CHOICES.map((c) => [c.key, c]));

/** The chosen values { key: value } for choices given as option indexes. */
export function resolveChoices(ch) {
  return Object.fromEntries(CHOICES.map((c) => [c.key, c.values[clampIdx(c.key, ch[c.key])]]));
}

/** The choices that apply to this look (no hat colour without a hat, no trousers under a dress). */
export function visibleChoices(ch) {
  const v = resolveChoices(ch);
  return CHOICES.filter((c) => !c.when || c.when(v));
}

/** Choices as option indexes { key: index }. */
export function defaultChoices(seed = 52) {
  const v = makeVariant(seed, { kind: 'adult' });
  const near = (key, x) => { const vs = BY_KEY[key].values; let b = 0; for (let i = 1; i < vs.length; i++) if (Math.abs(vs[i] - x) < Math.abs(vs[b] - x)) b = i; return b; };
  const idx = (key, x) => Math.max(0, BY_KEY[key].values.indexOf(x));
  return {
    height: near('height', v.scale), build: near('build', v.width), skin: idx('skin', v.colours.skin),
    hair: idx('hair', v.hair), hairCol: idx('hairCol', v.colours.hair), hatCol: idx('hatCol', v.colours.hat),
    top: idx('top', v.top), topCol: idx('topCol', v.colours.top), bottomCol: idx('bottomCol', v.colours.bottom),
    shoeCol: idx('shoeCol', v.colours.shoe), acc: idx('acc', v.acc === 'umbrella' ? 'none' : v.acc), accCol: idx('accCol', v.colours.acc),
  };
}

/** The figure variant for a set of choices (a fresh object: the crowd caches per variant). */
export function customVariant(ch) {
  const val = (k) => BY_KEY[k].values[clampIdx(k, ch[k])];
  const hair = val('hair'), top = val('top'), skin = val('skin');
  const v = {
    seed: 52, kind: 'adult', fem: top === 'dress', hair, top, acc: val('acc'),
    scale: val('height'), width: val('build'), headScale: 1, stoop: 0.01, speed: 1.4,
    colours: {
      skin, hair: val('hairCol'), top: val('topCol'), bottom: top === 'dress' ? skin : val('bottomCol'),
      shoe: val('shoeCol'), hat: val('hatCol'), acc: val('accCol'),
    },
  };
  if (HEADWEAR.has(hair)) v.colours.hairTint = v.colours.hat;
  return v;
}

function clampIdx(key, i) {
  const n = BY_KEY[key].values.length;
  return Number.isInteger(i) && i >= 0 && i < n ? i : 0;
}

/** Step a choice by +1 / -1 (wraps). Returns new choices. */
export function stepChoice(ch, key, d) {
  const n = BY_KEY[key].values.length;
  return { ...ch, [key]: (((clampIdx(key, ch[key]) + d) % n) + n) % n };
}

/** A random look (the "Surprise me" button). rand: () => [0, 1). */
export function randomChoices(rand = Math.random) {
  const ch = {};
  for (const c of CHOICES) ch[c.key] = Math.floor(rand() * c.values.length);
  return ch;
}

// text code: one base-36 digit per choice, in CHOICES order, prefixed with a version letter
const VERSION = 'a';

export function encodeChoices(ch) {
  return VERSION + CHOICES.map((c) => clampIdx(c.key, ch[c.key]).toString(36)).join('');
}

/** Choices from a code, or null if it isn't one (unknown version, wrong length, bad digit). */
export function decodeChoices(code) {
  if (typeof code !== 'string' || code[0] !== VERSION || code.length !== CHOICES.length + 1) return null;
  const ch = {};
  for (let q = 0; q < CHOICES.length; q++) {
    const i = parseInt(code[q + 1], 36);
    if (!Number.isInteger(i) || i >= CHOICES[q].values.length) return null;
    ch[CHOICES[q].key] = i;
  }
  return ch;
}

export const STORAGE_KEY = 'blox.look';

/** The saved look: the link's #look= first, then the browser's storage, else null. */
export function loadChoices(hash = '', store = null) {
  const fromLink = decodeChoices(new URLSearchParams(hash.replace(/^#/, '')).get('look'));
  if (fromLink) return fromLink;
  try { return decodeChoices(store?.getItem(STORAGE_KEY)); } catch { return null; }
}

export function saveChoices(ch, store = null) {
  try { store?.setItem(STORAGE_KEY, encodeChoices(ch)); return true; } catch { return false; }
}
