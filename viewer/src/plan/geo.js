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

// RD -> WGS84: the inverse polynomial (Schreutelaar), same accuracy
const K = [[0, 1, 3235.65389], [2, 0, -32.58297], [0, 2, -0.2475], [2, 1, -0.84978], [0, 3, -0.0655], [2, 2, -0.01709],
  [1, 0, -0.00738], [4, 0, 0.0053], [2, 3, -0.00039], [4, 1, 0.00033], [1, 1, -0.00012]];
const L = [[1, 0, 5260.52916], [1, 1, 105.94684], [1, 2, 2.45656], [3, 0, -0.81885], [1, 3, 0.05594], [3, 1, -0.05607],
  [0, 1, 0.01199], [3, 2, -0.00256], [1, 4, 0.00128], [0, 2, 0.00022], [2, 0, -0.00022], [5, 0, 0.00026]];

/** [lat, lon] degrees for RD metres. */
export function rdToWgs84(x, y) {
  const dx = (x - X0) * 1e-5, dy = (y - Y0) * 1e-5;
  let lat = 0, lon = 0;
  for (const [p, q, c] of K) lat += c * dx ** p * dy ** q;
  for (const [p, q, c] of L) lon += c * dx ** p * dy ** q;
  return [PHI0 + lat / 3600, LAM0 + lon / 3600];
}

/** [lat, lon] for Unity metres (x east, z north from the world's origin). */
export function unityToGps(x, z, originRD) {
  return rdToWgs84(x + originRD[0], z + originRD[1]);
}
