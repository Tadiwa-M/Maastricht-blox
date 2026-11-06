// How a plain load starts (citymode.js): the title slides stay up while the city streams in
// around a street-level camera at the Markt, then start cuts straight to the player standing
// there in walk mode. No overview of the whole city, no camera flight. Tested in test/intro.test.mjs.

export const INTRO = { waitMax: 20 }; // s to wait for the street to stream in before giving up

/** Compass yaw (radians, 0 north, clockwise) of looking from cam to target (three.js). */
export function lookYaw(cam, target) {
  return Math.atan2(target[0] - cam[0], -(target[2] - cam[2]));
}

/**
 * Whether a page load starts in the street: not for screenshots/films, links to a view or spot,
 * or automated browsers (tools/) unless the link says #intro=1.
 */
export function wantsIntro(hash, search, automated = false) {
  const p = new URLSearchParams(String(hash).replace(/^#/, ''));
  if (p.get('intro') === '1') return true;
  if (automated || /[?&](shot|film)=1/.test(search)) return false;
  return !['view', 'at', 'mode', 'intro'].some((k) => p.has(k));
}
