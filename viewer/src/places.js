// Named places (RD metres, EPSG:28992). Converted to chunks with the world's own origin from the
// manifest, so they work for any slice (CONTRACT 1, v4: the slice is whatever the manifest says).
export const PLACES_RD = {
  markt: [176430, 318007],
  vrijthof: [176185, 317717],
  brug: [176748, 317786],
  station: [177403, 317800],
  bonnefanten: [177040, 317098],
  bosscherweg: [176197, 319239],
  fort: [176050, 316326],
  enci: [176549, 314837],
};

/** Chunk (cx, cy) of a place for a world with ``originRD`` and ``chunkStuds * studM`` chunks. */
export function placeChunk(name, originRD, chunkM = 32) {
  const p = PLACES_RD[name.toLowerCase()];
  if (!p) return null;
  return [Math.floor((p[0] - originRD[0]) / chunkM), Math.floor((p[1] - originRD[1]) / chunkM)];
}
