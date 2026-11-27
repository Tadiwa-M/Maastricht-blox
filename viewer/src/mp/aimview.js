// Keeping the aim clear (owner, 2026-11-27: "the shooting view is still obstructed, this makes it very hard to aim").
// Pure maths, no three.js: how much the player's own figure covers the crosshair (the shooting camera fades it by
// this whenever the camera is behind it), and how far the gun drops when aiming so its sights don't fill the middle of the view.
// A match is first person since 2026-11-27, so the fade now matters only in the knocked-out view.

/** Aiming down the sights: the gun sits this much lower and further than its own aim point (camera space, m). */
export const ADS_DROP = [0, -0.012, -0.08]; // (the sights sit centred, the bulky brick receiver a touch lower and further)
/** The figure counts as in the way inside CLEAR_IN of the aim ray, and as clear past CLEAR_OUT (m). */
export const CLEAR_IN = 0.32, CLEAR_OUT = 0.6;
const HEIGHTS = [0.35, 0.8, 1.2, 1.55]; // sample points up the figure, from the feet (m)

/**
 * 0 (clear) .. 1 (fully in the way): how close the figure standing at `feet` comes to the aim ray from `cam`
 * along the unit vector `dir`. Points behind the camera don't count. All [x, y, z] in the same world space.
 */
export function figureBlocksAim(cam, dir, feet) {
  let best = Infinity;
  for (const h of HEIGHTS) {
    const p = [feet[0] - cam[0], feet[1] + h - cam[1], feet[2] - cam[2]];
    const t = p[0] * dir[0] + p[1] * dir[1] + p[2] * dir[2];
    if (t <= 0) continue;
    best = Math.min(best, Math.hypot(p[0] - dir[0] * t, p[1] - dir[1] * t, p[2] - dir[2] * t));
  }
  if (!Number.isFinite(best)) return 0;
  const u = Math.min(1, Math.max(0, (best - CLEAR_IN) / (CLEAR_OUT - CLEAR_IN)));
  return 1 - u * u * (3 - 2 * u);
}
