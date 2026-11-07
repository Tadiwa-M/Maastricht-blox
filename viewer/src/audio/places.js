// Where the city's sounds come from: the church towers on the Vrijthof (the hour bells) and the
// green areas where birds sing (parks, the Jeker valley, the Sint Pietersberg). Hand-placed,
// approximate (tens of metres): RD metres (EPSG:28992), or GPS degrees converted with the trip
// planner's RD polynomial. audioPlaces(originRD) turns them into Unity metres (x east, z north;
// CONTRACT 1) for the world's own origin. Pure; tested in test/audio.test.mjs.
import { wgs84ToRd } from '../plan/geo.js';
import { PLACES_RD } from '../places.js';

/** Fallback origin (the full-city build: the Vrijthof at Unity x 1485, z 3717). */
export const DEFAULT_ORIGIN_RD = [174700, 314000];

/** The towers: Sint Servaas strikes the hours, Sint Jan the half hours and the short tune before the hour. */
export const BELLS_RD = {
  servaas: [176120, 317735],
  jan: [176130, 317680],
};

/** Green areas: [name, lat, lon or RD pair, radius m, greenness 0..1]. */
const GREEN_GPS = [
  ['stadspark', 50.8440, 5.6880, 230, 1],
  ['nolenspark', 50.8460, 5.6855, 110, 1],
  ['hoge-fronten', 50.8590, 5.6870, 300, 1],
  ['waldeckpark', 50.8460, 5.6770, 150, 1],
  ['aldenhofpark', 50.8520, 5.6770, 120, 0.9],
  ['griend', 50.8445, 5.7000, 180, 0.9],
  ['jekerdal', 50.8370, 5.6840, 350, 1],
  ['geusselt', 50.8590, 5.7180, 300, 0.8],
];
const GREEN_RD = [
  ['sint-pietersberg', ...PLACES_RD.enci, 550, 1],
  ['fort-sint-pieter', ...PLACES_RD.fort, 220, 1],
  ['vrijthof-trees', ...PLACES_RD.vrijthof, 90, 0.35],
];
/** The old town (cobbled streets): a circle around the Vrijthof and the Markt. */
const OLD_TOWN_RD = [176300, 317800, 650];

/**
 * Unity-metre places for a world origin:
 * { bells: { servaas: {x, z}, jan: {x, z} }, parks: [{ name, x, z, r, g }], oldTown: { x, z, r } }.
 */
export function audioPlaces(originRD = DEFAULT_ORIGIN_RD) {
  const o = Array.isArray(originRD) && originRD.length >= 2 ? originRD : DEFAULT_ORIGIN_RD;
  const at = ([x, y]) => ({ x: x - o[0], z: y - o[1] });
  const parks = [
    ...GREEN_GPS.map(([name, lat, lon, r, g]) => ({ name, ...at(wgs84ToRd(lat, lon)), r, g })),
    ...GREEN_RD.map(([name, x, y, r, g]) => ({ name, ...at([x, y]), r, g })),
  ];
  return {
    bells: { servaas: at(BELLS_RD.servaas), jan: at(BELLS_RD.jan) },
    parks,
    oldTown: { ...at(OLD_TOWN_RD), r: OLD_TOWN_RD[2] },
  };
}
