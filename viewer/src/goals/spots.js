// Fixed places the goals know by name: golden-hour viewpoints and the tall towers you orient by.
// Each has a GPS fallback and a name pattern; when the world's features.json has a matching named
// feature its centroid wins (it follows the data). Pure; tested in test/goals.logic.test.mjs.
import { gpsToUnity } from '../plan/geo.js';

/** Golden-hour viewpoints: looking west over the old town into the sunset. r: arrival radius (m). */
export const VIEWPOINTS = [
  { name: 'Fort Sint Pieter', match: /^fort sint[- ]pieter$/i, gps: [50.8376, 5.6862], r: 35 },
  { name: 'the Hoge Brug', match: /^hoge brug$/i, gps: [50.8457, 5.6972], r: 45 },
  { name: 'the Wilhelminabrug', match: /^wilhelminabrug$/i, gps: [50.8510, 5.6965], r: 50 },
  { name: 'the Sint Servaasbrug', match: /^sint[- ]servaasbrug$/i, gps: [50.8496, 5.6963], r: 45 },
  { name: 'the city wall', match: /^(onze lieve vrouwewal|de vijf koppen)$/i, gps: [50.8455, 5.6945], r: 40 },
];

/** Towers worth a tiny far-away label. h: rough height (m) of the tower top above the street. */
export const TOWERS = [
  { name: 'Sint-Jan', match: /sint[- ]?jans?kerk/i, gps: [50.8487, 5.6882], h: 79 },
  { name: 'Sint-Servaas', match: /servaas(basiliek|kerk)?$/i, gps: [50.8491, 5.6870], h: 60 },
];

/** The Markt (first-minute prompt): the square, or the Stadhuis on it. */
export const MARKT = { name: 'Markt', match: /^markt$/i, gps: [50.8513, 5.6907] };

const PREFER = ['landmark', 'park', 'poi', 'street', 'station', 'building'];

/**
 * Unity metres { name, x, z, ... } for a spot: the centroid of the best named feature matching
 * spot.match (features: iterable of features.json entries, centroid in studs), else its GPS.
 */
export function locateSpot(spot, features, originRD, studM = 0.5) {
  let best = null, rank = Infinity;
  for (const f of features || []) {
    if (!f?.name || !f.centroid || !spot.match.test(f.name)) continue;
    const r = PREFER.indexOf(f.kind);
    const k = r < 0 ? PREFER.length : r;
    if (k < rank) { rank = k; best = f; }
  }
  const [x, z] = best ? [best.centroid[0] * studM, best.centroid[1] * studM] : gpsToUnity(spot.gps[0], spot.gps[1], originRD);
  const { match, gps, ...rest } = spot;
  return { ...rest, x, z, fromData: !!best };
}
