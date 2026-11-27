// The capture-the-flag arena on the client: the room sends the bases and the arena radius
// (relay/src/ctf.js arenaConfig); here the soft boundary (warn when you leave the old town,
// back to your base after BOUNDARY_S) and where each player spawns. Pure (RD metres [east,
// north], protocol.js), tested in test/mp.test.mjs.

export const BOUNDARY_S = 5;

export function segDist(p, a, b) {
  const dx = b[0] - a[0], dz = b[1] - a[1];
  const L = dx * dx + dz * dz;
  const t = L ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / L)) : 0;
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dz);
}

export const inArena = (cfg, p) => segDist(p, cfg.bases.blue.at, cfg.bases.yellow.at) <= cfg.arenaR;
export const otherTeam = (t) => (t === 'blue' ? 'yellow' : 'blue');

/** Compass yaw (radians, 0 north, clockwise) from a to b. */
export const yawTo = (a, b) => Math.atan2(b[0] - a[0], b[1] - a[1]);

/**
 * Where player `slot` (0, 1, ...) of a team starts: a few metres in front of the flag towards
 * the enemy base, side by side, facing the enemy. -> { x, z, yaw }.
 */
export function spawnSpot(cfg, team, slot = 0) {
  const base = cfg.bases[team].at, enemy = cfg.bases[otherTeam(team)].at;
  const yaw = yawTo(base, enemy);
  const f = [Math.sin(yaw), Math.cos(yaw)], side = [f[1], -f[0]];
  const s = ((slot % 4) - 1.5) * 2.5, back = 6 + Math.floor(slot / 4) * 2.5;
  return { x: base[0] + f[0] * back + side[0] * s, z: base[1] + f[1] * back + side[1] * s, yaw };
}

/** The soft boundary: update(inside, dt) -> { warn: seconds left | null, teleport: bool }. */
export class Boundary {
  constructor(seconds = BOUNDARY_S) { this.seconds = seconds; this.out = 0; }
  reset() { this.out = 0; }
  update(inside, dt) {
    if (inside) { this.out = 0; return { warn: null, teleport: false }; }
    this.out += dt;
    if (this.out >= this.seconds) { this.out = 0; return { warn: null, teleport: true }; }
    return { warn: Math.ceil(this.seconds - this.out), teleport: false };
  }
}
