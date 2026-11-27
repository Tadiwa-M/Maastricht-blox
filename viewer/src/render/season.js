// The season on the trees and the ground, from the date (the real one, or #date=YYYY-MM-DD, or
// #season=spring|summer|autumn|winter to test): lime and plane leaves turn yellow, orange and brown
// through October, fall through November into a bare December to March, and come back light
// green in April; fallen leaves lie on the ground in autumn. Read by the surface shader
// (render/surface.js: leaf bricks found by their palette colour, every look and every level of
// detail) and by bricks.js (bare trees cast no leafy shadows). Also the festive season (the
// Christmas lights and the market on the Vrijthof, life/xmas.js): Magisch Maastricht.
import { magischDays, dayNumber, parseYmd, fromDayNumber } from '../life/calendar.js';

export const seasonUniforms = { uLeafTurn: { value: 0 }, uLeafBare: { value: 0 }, uLitter: { value: 0 }, uLeafFresh: { value: 0 } };

const ramp = (x, a, b) => Math.max(0, Math.min(1, (x - a) / (b - a)));

/** Day of the year (1 Jan = 0) -> { turn, bare, litter, fresh } all 0..1. */
export function leafState(doy) {
  // turning: 20 Sep (263) .. 5 Nov (309); falling: 25 Oct (298) .. 10 Dec (344); back: 25 Mar (84) .. 25 Apr (115)
  const turn = doy >= 200 ? ramp(doy, 263, 309) : 0;
  const fall = doy >= 200 ? ramp(doy, 298, 344) : 1 - ramp(doy, 84, 115);
  const bare = 0.92 * fall;
  const litter = doy >= 200 ? Math.min(ramp(doy, 285, 315), 1 - ramp(doy, 350, 365)) : 0;
  const fresh = doy < 200 ? Math.max(0, 1 - Math.abs(doy - 115) / 25) : 0;
  return { turn: doy < 200 ? 0 : turn, bare, litter, fresh };
}

const TEST = { spring: 110, summer: 190, autumn: 305, winter: 20 };

/** The date the world shows: #date= in the address, else today. */
export function worldDate(hash = typeof location !== 'undefined' ? location.hash : '') {
  const p = new URLSearchParams(String(hash).replace(/^#/, ''));
  const dn = p.get('date') ? parseYmd(p.get('date')) : null;
  if (dn !== null && dn !== undefined) return fromDayNumber(dn);
  const n = new Date();
  return { y: n.getFullYear(), m: n.getMonth() + 1, d: n.getDate() };
}

/** { turn, bare, litter, fresh, festive } for an address hash. */
export function seasonNow(hash = typeof location !== 'undefined' ? location.hash : '') {
  const p = new URLSearchParams(String(hash).replace(/^#/, ''));
  const { y, m, d } = worldDate(hash);
  const dn = dayNumber(y, m, d), doy = dn - dayNumber(y, 1, 1);
  const forced = TEST[p.get('season')];
  const st = leafState(forced ?? doy);
  const [a, b] = magischDays(m <= 1 ? y - 1 : y);
  // the lights go up mid-November; the market is built the week before it opens (fenced off,
  // as in the owner's photos of 21 November) and taken down a few days after
  const lightsFrom = dayNumber(m <= 1 ? y - 1 : y, 11, 14), lightsTo = dayNumber(m <= 1 ? y : y + 1, 1, 6);
  const on = (from, to) => (p.has('festive') ? p.get('festive') !== '0' : dn >= from && dn <= to);
  st.festive = on(lightsFrom, lightsTo);
  st.market = on(a - 7, b + 3) ? (dn >= a && dn <= b) || p.get('festive') === '1' ? 'open' : 'building' : null;
  return st;
}

export const SEASON = typeof location !== 'undefined' ? seasonNow() : leafState(190);
seasonUniforms.uLeafTurn.value = SEASON.turn;
seasonUniforms.uLeafBare.value = SEASON.bare;
seasonUniforms.uLitter.value = SEASON.litter;
seasonUniforms.uLeafFresh.value = SEASON.fresh;
/** Bare trees cast no leafy shadows (bricks.js). */
export const leafShadows = () => SEASON.bare < 0.6;
