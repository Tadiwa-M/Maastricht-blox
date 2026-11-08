// Daily routines: who is out where and when. Named places of Maastricht (RD metres, from OSM)
// get a pull by hour and weekday: students towards the university buildings in the morning,
// shoppers on the shopping streets by day, commuters at the station at 8 and 17, nightlife
// around the Markt, Platielstraat and the Vrijthof in the evening, an almost empty city at 3 am.
// The pull does two things (life/index.js): it multiplies the walk graph's spawn weights near
// the place (spotWeights), and it sends a share of the groups somewhere (goalPlan: a group with
// a goal leans its random walk towards it, walkgraph.js). Events (calendar.js) add their own
// pull. Pure, tested in test/life.routines.test.mjs.

/** Piecewise-linear [[t, v], ...] at t (no wrapping: night curves run past 24). */
export function curve(pts, t) {
  if (t <= pts[0][0]) return pts[0][1];
  for (let q = 1; q < pts.length; q++) {
    const [t0, v0] = pts[q - 1], [t1, v1] = pts[q];
    if (t <= t1) return v0 + (v1 - v0) * ((t - t0) / (t1 - t0 || 1));
  }
  return pts[pts.length - 1][1];
}

// a: point, or a..b a street (segment); r: metres around it that feel the pull
export const PLACES_RD = {
  markt: { a: [176402, 318007], r: 75 },
  vrijthof: { a: [176213, 317739], r: 80 },
  platielstraat: { a: [176259, 317706], b: [176347, 317707], r: 40 },
  olvplein: { a: [176552, 317563], r: 50 }, // Onze Lieve Vrouweplein: terraces in the evening
  grotestaat: { a: [176260, 317815], b: [176496, 317816], r: 30 },
  kleinestaat: { a: [176496, 317816], b: [176521, 317761], r: 30 },
  brugstraat: { a: [176521, 317765], b: [176667, 317769], r: 30 }, // Maastrichter Brugstraat
  tongersestraat: { a: [176155, 317454], b: [175836, 317282], r: 60 }, // university (economics, inner city)
  minderbroedersberg: { a: [176066, 317505], r: 70 }, // university main building
  grotegracht: { a: [176114, 317895], r: 60 }, // university (arts, law)
  randwyck: { a: [178058, 316559], b: [178274, 315618], r: 250 }, // university campus, hospital, offices
  station: { a: [177389, 317800], r: 80 },
  wyckerbrugstraat: { a: [176850, 317786], b: [177096, 317788], r: 30 }, // station <-> bridge
};

const KIND = {
  study: ['tongersestraat', 'minderbroedersberg', 'grotegracht', 'randwyck'],
  shop: ['grotestaat', 'kleinestaat', 'brugstraat', 'wyckerbrugstraat'],
  commute: ['station', 'wyckerbrugstraat', 'randwyck'],
  night: ['markt', 'platielstraat', 'vrijthof', 'olvplein'],
};

// pull (x spawn weight) by hour; 1 = no pull
const STUDY = [[0, 1], [7, 1], [8.5, 3], [10, 2.2], [12.5, 2.6], [14, 2], [17, 2], [18.5, 1.2], [20, 1], [24, 1]];
const SHOP = [[0, 1], [9, 1], [10.5, 2.5], [13, 3], [17.5, 2.8], [18.5, 1.3], [19, 1], [24, 1]];
const SHOP_MON = [[0, 1], [11, 1], [13, 2.6], [17.5, 2.6], [18.5, 1.3], [19, 1], [24, 1]];
const SHOP_THU = [[0, 1], [9, 1], [10.5, 2.5], [13, 3], [17.5, 2.8], [20.5, 2.2], [21.5, 1], [24, 1]];
const SHOP_SUN = [[0, 1], [11.5, 1], [13, 2.5], [17, 2.2], [18, 1], [24, 1]];
const COMMUTE = [[0, 1], [6.5, 1], [8, 3], [9.5, 1.5], [12, 1.3], [16, 1.5], [17.2, 3], [18.7, 1.4], [24, 1]];
const COMMUTE_WE = [[0, 1], [10, 1.4], [18, 1.4], [24, 1]];
// the evening and the night after it (hours 24..29 = the small hours of the next day)
const NIGHT = [[0, 1], [17, 1], [19, 1.6], [21, 2.2], [23, 3], [26, 2.6], [27.5, 1.4], [29, 1]];
const WEEKNIGHT = [[0, 1], [17, 1], [19, 1.5], [21, 1.9], [23, 1.7], [25, 1.25], [26, 1], [29, 1]]; // home by 2
const NIGHT_OUT = [3, 4, 5]; // Thursday (students), Friday, Saturday: the nights out

/** Pull of a kind of place at hour 0..24 on day 0 = Monday .. 6 = Sunday. */
export function pull(kind, hours, day) {
  const h = ((hours % 24) + 24) % 24, weekend = day >= 5;
  if (kind === 'study') return weekend ? 1 : curve(STUDY, h);
  if (kind === 'shop') return curve(day === 0 ? SHOP_MON : day === 3 ? SHOP_THU : day === 6 ? SHOP_SUN : SHOP, h);
  if (kind === 'commute') return curve(weekend ? COMMUTE_WE : COMMUTE, h);
  if (kind === 'night') { // after midnight: the night of yesterday's evening
    const eve = h < 5 ? (day + 6) % 7 : day, t = h < 5 ? h + 24 : h;
    return curve(NIGHT_OUT.includes(eve) ? NIGHT : WEEKNIGHT, t);
  }
  return 1;
}

/**
 * Share of the walkers out on top of density.js crowdFactor: nights out keep their crowd,
 * other nights empty out (3 am on a Tuesday: almost nobody).
 */
export function nightFactor(hours, day) {
  const h = ((hours % 24) + 24) % 24;
  const eve = h < 12 ? (day + 6) % 7 : day;
  if (NIGHT_OUT.includes(eve)) return h >= 22 ? 1.25 : h < 2.5 ? 1.25 : h < 6 ? Math.max(0.5, 1.25 - (h - 2.5) * 0.3) : 1;
  if (h >= 1.5 && h < 6.5) return h < 2.5 ? 1 - (h - 1.5) * 0.6 : h < 5.5 ? 0.4 : 0.4 + (h - 5.5) * 0.6;
  return 1;
}

/** Places in Unity metres for a world origin: { name: { ax, az, bx, bz, r } }. */
export function placesUnity(originRD) {
  const out = {};
  for (const [k, p] of Object.entries(PLACES_RD)) {
    const b = p.b || p.a;
    out[k] = { ax: p.a[0] - originRD[0], az: p.a[1] - originRD[1], bx: b[0] - originRD[0], bz: b[1] - originRD[1], r: p.r };
  }
  return out;
}

/** Distance from (x, z) to a place (its point or street segment). */
export function placeDist(p, x, z) {
  const dx = p.bx - p.ax, dz = p.bz - p.az, L2 = dx * dx + dz * dz;
  const u = L2 > 0 ? Math.max(0, Math.min(1, ((x - p.ax) * dx + (z - p.az) * dz) / L2)) : 0;
  return Math.hypot(x - (p.ax + dx * u), z - (p.az + dz * u));
}

/** Middle of a place (where a group heading there walks to). */
export const placeMid = (p) => [(p.ax + p.bx) / 2, (p.az + p.bz) / 2];

/**
 * Pull per place now: { name: x weight >= 1 } from the routines and the events
 * (calendar.js eventsAt: their spots at their strength, multiplied in).
 */
export function spotPulls(hours, day, events = []) {
  const out = {};
  for (const [kind, names] of Object.entries(KIND)) {
    const p = pull(kind, hours, day);
    for (const n of names) out[n] = Math.max(out[n] || 1, p);
  }
  for (const e of events) {
    for (const [n, b] of Object.entries(e.spots || {})) out[n] = (out[n] || 1) * (1 + (b - 1) * e.strength);
  }
  return out;
}

/**
 * Spawn weights with the places' pull: weights near a place x its pull, fading to 1 at its
 * radius (and over half a radius beyond). Returns a new Float32Array; w is not changed.
 */
export function spotWeights(w, xs, zs, places, pulls) {
  const out = Float32Array.from(w);
  for (const [n, k] of Object.entries(pulls)) {
    const p = places[n];
    if (!p || k <= 1.001) continue;
    const reach = p.r * 1.5, x0 = Math.min(p.ax, p.bx) - reach, x1 = Math.max(p.ax, p.bx) + reach;
    const z0 = Math.min(p.az, p.bz) - reach, z1 = Math.max(p.az, p.bz) + reach;
    for (let q = 0; q < out.length; q++) {
      const x = xs[q], z = zs[q];
      if (x < x0 || x > x1 || z < z0 || z > z1) continue;
      const d = placeDist(p, x, z);
      if (d >= reach) continue;
      const f = d <= p.r ? 1 : 1 - (d - p.r) / (reach - p.r);
      out[q] *= 1 + (k - 1) * f;
    }
  }
  return out;
}

const GOAL_SHARE_MAX = 0.45;

/**
 * Where groups are heading now: { share (of new groups with a goal), goals: [{ name, w, x, z, r }] }.
 * A place's draw is its pull above 1 (a place without pull draws nobody). With places in Unity
 * metres (placesUnity).
 */
export function goalPlan(places, pulls) {
  const goals = [];
  let total = 0;
  for (const [n, k] of Object.entries(pulls)) {
    const p = places[n];
    if (!p || k <= 1.05) continue;
    const [x, z] = placeMid(p);
    goals.push({ name: n, w: k - 1, x, z, r: Math.max(25, p.r) });
    total += k - 1;
  }
  return { share: Math.min(GOAL_SHARE_MAX, 0.08 * total), goals };
}

/** A goal from a plan for random numbers u (has a goal?) and v (which), or null. */
export function pickGoal(plan, u, v) {
  if (!plan?.goals.length || u >= plan.share) return null;
  let total = 0;
  for (const g of plan.goals) total += g.w;
  let r = v * total;
  for (const g of plan.goals) { r -= g.w; if (r <= 0) return g; }
  return plan.goals[plan.goals.length - 1];
}

/** Product of the events' crowd factors (each already at its strength). */
export const eventCrowd = (events = []) => events.reduce((f, e) => f * e.crowd, 1);

/** The strongest dress code of the events: { style, share } or null. */
export function eventOutfit(events = []) {
  for (const e of events) if (e.outfit) return { style: e.outfit.style, share: e.outfit.share * e.strength };
  return null;
}
