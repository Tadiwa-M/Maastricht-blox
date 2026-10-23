// Deterministic integer hash -> [0, 1). Same inputs always give the same "random" value, so
// colour variation and lit windows never flicker between reloads.
export function hash3(I, J, K) {
  let h = Math.imul(I | 0, 0x8da6b343) ^ Math.imul(J | 0, 0xd8163841) ^ Math.imul(K | 0, 0xcb1ab31f);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}
