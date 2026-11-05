// GPS (WGS84 degrees) -> Dutch RD metres (EPSG:28992) -> our Unity metres, in the browser.
// The standard approximation polynomial (Schreutelaar), accurate to about a metre across the
// Netherlands: plenty for "which stops are near me". Pure; tested against the pipeline's pyproj.

const PHI0 = 52.1551744, LAM0 = 5.38720621, X0 = 155000, Y0 = 463000;
const R = [[0, 1, 190094.945], [1, 1, -11832.228], [2, 1, -114.221], [0, 3, -32.391], [1, 0, -0.705],
  [3, 1, -2.34], [1, 3, -0.608], [0, 2, -0.008], [2, 3, 0.148]];
const S = [[1, 0, 309056.544], [0, 2, 3638.893], [2, 0, 73.077], [1, 2, -157.984], [3, 0, 59.788],
  [0, 1, 0.433], [2, 2, -6.439], [1, 1, -0.032], [0, 4, 0.092], [1, 4, -0.054]];

/** [x, y] RD metres for a latitude and longitude in degrees. */
export function wgs84ToRd(lat, lon) {
  const dp = 0.36 * (lat - PHI0), dl = 0.36 * (lon - LAM0);
  let x = X0, y = Y0;
  for (const [p, q, c] of R) x += c * dp ** p * dl ** q;
  for (const [p, q, c] of S) y += c * dp ** p * dl ** q;
  return [x, y];
}

/** Unity metres (x east, z north from the world's origin) for a GPS position. */
export function gpsToUnity(lat, lon, originRD) {
  const [x, y] = wgs84ToRd(lat, lon);
  return [x - originRD[0], y - originRD[1]];
}
