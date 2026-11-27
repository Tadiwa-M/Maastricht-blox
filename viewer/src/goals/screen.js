// Screen maths for the navigation cues (cues.js): where the edge glint sits, how strong the beam
// and the tower labels are. Pure numbers; tested in test/goals.screen.test.mjs.

export const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/**
 * The edge glint for a target off screen, or null when it is on screen (the beam shows it).
 * view: the target in camera space ({ x, y, z }, the camera looks down -z); ndc: its projection
 * ({ x, y } -1..1). w, h: viewport px; margin: px from the edges, bottom: px kept clear at the
 * bottom (the hint bar). A target behind you sits on the left or right edge ("turn this way").
 * Returns { x, y, angle } (px from top-left; angle in radians, 0 = pointing right, clockwise,
 * as CSS rotate).
 */
export function edgeArrow(view, ndc, w, h, margin = 34, bottom = margin) {
  const behind = view.z > 0;
  if (!behind && Math.abs(ndc.x) <= 0.9 && Math.abs(ndc.y) <= 0.85) return null;
  // camera-space x/y point the right way in front and behind (a projected point behind flips)
  let dx = view.x, dy = -view.y; // screen y grows downwards
  if (behind) { dx = dx < 0 ? -1 : 1; dy = 0; }
  const cx = w / 2, cy = (margin + h - bottom) / 2; // the box the glint runs round
  const hw = Math.max(1, w / 2 - margin), hh = Math.max(1, (h - bottom - margin) / 2);
  const t = Math.min(dx ? hw / Math.abs(dx) : Infinity, dy ? hh / Math.abs(dy) : Infinity);
  return { x: cx + dx * t, y: cy + dy * t, angle: Math.atan2(dy, dx) };
}

/** Beam strength 0..1 by horizontal distance (m) to the player: gone when you stand in it. */
export const beamOpacity = (d) => smooth(12, 70, d);

/**
 * Tower label strength 0..1: only from far away (> ~300 m) and only while looking toward it
 * (off: degrees between the view direction and the tower, horizontally).
 */
export function towerAlpha(off, d) {
  return (1 - smooth(4, 11, Math.abs(off))) * smooth(280, 420, d) * (1 - smooth(1800, 2400, d));
}

/** Degrees between two compass headings (radians), 0..180. */
export function angleOff(a, b) {
  const d = Math.abs((((a - b) % (2 * Math.PI)) + 3 * Math.PI) % (2 * Math.PI) - Math.PI);
  return (d * 180) / Math.PI;
}
