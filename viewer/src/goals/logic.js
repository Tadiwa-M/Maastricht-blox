// Light goals (docs/guide/17-goals.md): what to offer and when it counts as done. Pure: no
// three.js, no DOM; positions are Unity metres (x east, z north). Tested in test/goals.logic.test.mjs.
//
// Five kinds, one at a time, always optional:
//   tourist  a passer-by asks for a real place; walk there within a generous time
//   bus      catch a timetable bus line to a stop a few calls down the line
//   golden   reach a viewpoint before sunset on the game clock
//   delivery a shop asks you to run something across town: short, against the clock (you have to run)
//   tour     three sights near you, in any order, no clock

export const WEEK_S = 7 * 86400;
/** The game's sun sets at 18:00 (scene.js sunAt: dayT = 1 at 18 h). */
export const SUNSET_H = 18;
export const ARRIVE_M = 20; // close enough to a place
export const STOP_ARRIVE_M = 90; // got off "at" the stop: the doors open beside it, on either kerb

export const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

const DIRS = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];
/** 8-point compass word for a step (dx east, dz north). */
export function compassWord(dx, dz) {
  const a = (Math.atan2(dx, dz) * 180) / Math.PI;
  return DIRS[((Math.round(a / 45) % 8) + 8) % 8];
}

/** "80 m", "1.2 km". */
export function distLabel(m) {
  return m < 950 ? `${Math.max(10, Math.round(m / 10) * 10)} m` : `${(m / 1000).toFixed(1)} km`;
}

/** "4:05" for seconds left (never negative). */
export function clockLabel(sec) {
  const s = Math.max(0, Math.ceil(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** "14:32" for seconds since midnight. */
export function hhmm(sec) {
  const m = Math.floor((((sec % 86400) + 86400) % 86400) / 60);
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

/** Signed seconds from week time b to a, the short way round the week (Sunday night wraps). */
export function weekDelta(a, b) {
  return ((((a - b) % WEEK_S) + WEEK_S + WEEK_S / 2) % WEEK_S) - WEEK_S / 2;
}

/** Pick one item by weight (rand() in [0, 1)). */
export function weighted(items, weight, rand = Math.random) {
  const ws = items.map(weight), sum = ws.reduce((a, b) => a + b, 0);
  if (!(sum > 0)) return null;
  let r = rand() * sum;
  for (let i = 0; i < items.length; i++) { r -= ws[i]; if (r < 0) return items[i]; }
  return items[items.length - 1];
}

// ---- tourist ------------------------------------------------------------------------------

/** POI types a visitor might ask for (places.js poiType values). */
const ASKABLE = new Set(['cafe', 'restaurant', 'museum', 'attraction', 'viewpoint', 'artwork', 'bar', 'pub', 'ice cream',
  'bakery', 'books', 'theatre', 'cinema', 'place of worship', 'castle', 'memorial', 'monument', 'fountain', 'gallery',
  'library', 'chocolate', 'cheese', 'marketplace', 'arts centre', 'city gate', 'church', 'ruins', 'park', 'garden',
  'hotel', 'information', 'clothes', 'gift', 'confectionery', 'deli', 'wine', 'coffee', 'tea']);
const KIND_W = { landmark: 4, station: 2, park: 1.5, poi: 1 };
export const TOURIST_RANGE = [120, 650]; // metres: a short walk, not a trek

/**
 * A place a tourist could ask for, from placesFromFeatures rows [[name, kind, x, z, sub]]:
 * a landmark, station, park or a pleasant POI between TOURIST_RANGE metres away, built, not
 * asked recently. Returns { name, kind, sub, x, z, d } or null.
 */
export function pickTourist(rows, here, { built = () => true, recent = new Set(), rand = Math.random, range = TOURIST_RANGE } = {}) {
  const ok = [];
  for (const [name, kind, x, z, sub] of rows) {
    if (!KIND_W[kind] || !name || name.length > 40 || recent.has(name)) continue;
    if (kind === 'poi' && !ASKABLE.has(String(sub || '').toLowerCase())) continue;
    const d = dist([x, z], here);
    if (d < range[0] || d > range[1] || !built(x, z)) continue;
    ok.push({ name, kind, sub, x, z, d });
  }
  return weighted(ok, (p) => KIND_W[p.kind], rand);
}

/** Seconds allowed for a walk of straight-line metres d: streets wind, people dawdle. Generous. */
export const touristLimit = (d) => Math.round(90 + d * 1.6);

/** What the tourist calls a place: "the Bonnefanten", "Maastricht station", "Café Sjiek". */
export function placeLabel(p) {
  if (p.kind === 'station') return /station/i.test(p.name) ? p.name : `${p.name} station`;
  if (p.kind === 'landmark' && !/^(the|de|het|'t)\s/i.test(p.name)) return `the ${p.name}`;
  return p.name;
}

export const askLine = (p) => `Excuse me, do you know the way to ${placeLabel(p)}?`;

// ---- delivery -----------------------------------------------------------------------------

/** Shops and cafes that send and receive things (places.js poiType values). */
const DELIVERS = new Set(['cafe', 'restaurant', 'bar', 'pub', 'bakery', 'books', 'chocolate', 'cheese', 'ice cream',
  'deli', 'wine', 'coffee', 'tea', 'gift', 'clothes', 'confectionery', 'hotel', 'library', 'theatre']);
const PARCELS = { bakery: 'a box of vlaai', cafe: 'a tray of coffees', restaurant: 'a hot order', bar: 'a crate of bottles', pub: 'a crate of bottles',
  books: 'a parcel of books', chocolate: 'a box of chocolates', cheese: 'a wheel of cheese', 'ice cream': 'a tub of ice cream', wine: 'two bottles of wine',
  deli: 'a lunch order', clothes: 'a mended coat', gift: 'a wrapped present', hotel: 'a forgotten suitcase', library: 'an overdue book', theatre: 'a costume' };
export const DELIVERY_RANGE = [150, 480];

/**
 * A delivery from one shop to another: rows as pickTourist. -> { from: { name, sub }, to: { name,
 * sub, x, z, d }, parcel } or null. The sender is the nearest shop (within 120 m, else nobody
 * in particular); the receiver a different shop DELIVERY_RANGE metres away.
 */
export function pickDelivery(rows, here, { built = () => true, recent = new Set(), rand = Math.random, range = DELIVERY_RANGE } = {}) {
  const shops = [];
  for (const [name, kind, x, z, sub] of rows) {
    const type = String(sub || '').toLowerCase();
    if (kind !== 'poi' || !DELIVERS.has(type) || !name || name.length > 40) continue;
    shops.push({ name, sub: type, x, z, d: dist([x, z], here) });
  }
  const to = weighted(shops.filter((p) => p.d >= range[0] && p.d <= range[1] && !recent.has(p.name) && built(p.x, p.z)), () => 1, rand);
  if (!to) return null;
  const from = shops.filter((p) => p.d <= 120 && p.name !== to.name).sort((a, b) => a.d - b.d)[0] || null;
  return { from, to, parcel: PARCELS[from?.sub] || PARCELS[to.sub] || 'a parcel' };
}

/** Seconds for a delivery of straight-line metres d: a walk will not do it, a run will (5 m/s, streets wind). */
export const deliveryLimit = (d) => Math.round(22 + d / 2.7);

// ---- tour ---------------------------------------------------------------------------------

export const TOUR_N = 3, TOUR_MAX_M = 900, TOUR_APART_M = 90;

/**
 * Three sights near `here` (landmarks, stations, parks), nearest first but at least
 * TOUR_APART_M from each other: [{ name, kind, x, z, seen: false }] or null (fewer than three).
 */
export function pickTour(rows, here, { built = () => true, recent = new Set(), n = TOUR_N, maxM = TOUR_MAX_M } = {}) {
  const cand = [];
  for (const [name, kind, x, z] of rows) {
    if (!['landmark', 'station', 'park'].includes(kind) || !name || name.length > 40 || recent.has(name)) continue;
    const d = dist([x, z], here);
    if (d < 60 || d > maxM || !built(x, z)) continue;
    cand.push({ name, kind, x, z, d });
  }
  cand.sort((a, b) => a.d - b.d);
  const out = [];
  for (const c of cand) {
    if (out.some((o) => dist([o.x, o.z], [c.x, c.z]) < TOUR_APART_M)) continue;
    out.push({ name: c.name, kind: c.kind, x: c.x, z: c.z, seen: false });
    if (out.length === n) return out;
  }
  return null;
}

/** Mark the sights within r of pos as seen. -> the names newly seen. */
export function tourVisit(stops, pos, r = ARRIVE_M + 10) {
  const now = [];
  for (const s of stops) if (!s.seen && dist([s.x, s.z], pos) <= r) { s.seen = true; now.push(s.name); }
  return now;
}

/** The nearest sight not seen yet, or null when the tour is done. */
export function tourNext(stops, pos) {
  return stops.filter((s) => !s.seen).sort((a, b) => dist([a.x, a.z], pos) - dist([b.x, b.z], pos))[0] || null;
}

// ---- bus ----------------------------------------------------------------------------------

/**
 * A bus to catch from a stop near `here`: a departure in 2..15 game minutes that you can walk to,
 * to a built stop 2..6 calls down the line. tt: life Timetable (stops [{ name, x, y }],
 * departures(k, day, sec, n, horizon)). Returns { line, colour, head, from, to, inSec, at } or null
 * (from/to: { k, name, x, z }).
 */
export function pickBus(tt, here, day, sec, { built = () => true, rand = Math.random, near = 350 } = {}) {
  if (!tt?.stops?.length || typeof tt.departures !== 'function') return null;
  const stops = [];
  tt.stops.forEach((st, k) => {
    const d = dist([st.x, st.y], here);
    if (d <= near && built(st.x, st.y)) stops.push({ k, d, st });
  });
  stops.sort((a, b) => a.d - b.d);
  const options = [];
  for (const { k, d, st } of stops.slice(0, 6)) {
    const walk = (d * 1.3) / 1.4 + 30; // seconds to get there, with a little slack
    for (const dep of tt.departures(k, day, sec, 6, 900)) {
      if (dep.inSec < Math.max(120, walk) || dep.inSec > 900 || dep.route?.mode === 'rail') continue;
      const ps = dep.pattern?.stops || [], i = ps.indexOf(k);
      if (i < 0) continue;
      for (let j = i + 2; j <= Math.min(i + 6, ps.length - 1); j++) {
        const to = tt.stops[ps[j]];
        if (!to || to.name === st.name || !built(to.x, to.y)) continue;
        options.push({ line: String(dep.route?.short ?? '?'), colour: dep.route?.colour || '#3a3f63', head: dep.head || '',
          from: { k, name: st.name, x: st.x, z: st.y }, to: { k: ps[j], name: to.name, x: to.x, z: to.y },
          inSec: dep.inSec, at: dep.at, w: j === i + 3 ? 2 : 1 });
      }
    }
  }
  const pick = weighted(options, (o) => o.w, rand);
  if (!pick) return null;
  delete pick.w;
  return pick;
}

/** Game seconds a bus goal stays open: the departure, the ride (a guess) and ten minutes' grace. */
export const busWindow = (b) => b.inSec + 900 + 600;

/**
 * Watches the rides for a bus goal. update({ ride: { line, atStop } | null, pos }) -> 'riding',
 * 'wrong' (on another line), 'done' (got off that line at that stop) or null. atStop: the name of
 * the stop the vehicle stands at now, if any.
 */
export class BusWatch {
  constructor(goal) { this.goal = goal; this.on = null; this.lastStop = null; }

  update({ ride, pos }) {
    const g = this.goal;
    if (ride) {
      if (this.on !== ride.line) this.lastStop = null;
      this.on = ride.line;
      if (ride.atStop) this.lastStop = ride.atStop;
      return ride.line === g.line ? 'riding' : 'wrong';
    }
    if (this.on === null) return null;
    const was = this.on;
    this.on = null;
    if (was !== g.line) return null;
    const near = pos && dist(pos, [g.to.x, g.to.z]) <= STOP_ARRIVE_M;
    return near || this.lastStop === g.to.name ? 'done' : null;
  }
}

// ---- golden hour --------------------------------------------------------------------------

export const GOLDEN_START_H = 15.75, GOLDEN_LAST_H = 17.6; // offered between these game-clock hours

export const goldenOpen = (hours) => hours >= GOLDEN_START_H && hours <= GOLDEN_LAST_H;

/** The nearest built viewpoint ({ name, x, z }) more than 150 m and at most maxM away, or null. */
export function pickViewpoint(spots, here, { built = () => true, maxM = 2000 } = {}) {
  let best = null;
  for (const s of spots) {
    const d = dist([s.x, s.z], here);
    if (d < 150 || d > maxM || !built(s.x, s.z)) continue;
    if (!best || d < best.d) best = { ...s, d };
  }
  return best;
}

/** Game seconds until sunset (negative after it). */
export const toSunset = (sec) => SUNSET_H * 3600 - sec;

// ---- reward -------------------------------------------------------------------------------

export const STORE_KEY = 'blox.goals.v1';

/** { total, tourist, bus, golden } from a Storage (or null), never throwing. */
export function loadTally(store) {
  try {
    const v = JSON.parse(store?.getItem(STORE_KEY) || '{}');
    return { total: +v.total || 0, tourist: +v.tourist || 0, bus: +v.bus || 0, golden: +v.golden || 0, ...pickPrefs(v) };
  } catch { return { total: 0, tourist: 0, bus: 0, golden: 0 }; }
}

function pickPrefs(v) {
  const out = {};
  if (v.off === true) out.off = true;
  if (v.prompted === true) out.prompted = true;
  return out;
}

/** Save a tally (best effort: private windows and blocked storage just forget). */
export function saveTally(store, tally) {
  try { store?.setItem(STORE_KEY, JSON.stringify(tally)); } catch { /* not kept */ }
  return tally;
}

/** One more goal of `kind` done: the new tally. */
export function bump(tally, kind) {
  return { ...tally, total: (tally.total || 0) + 1, [kind]: (tally[kind] || 0) + 1 };
}
