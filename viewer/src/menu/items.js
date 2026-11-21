// The pause menu's entries: which show (the modules that are there) and how they read. Pure.

/**
 * has: { player, explore, trip, goals, mp } (modules present), goalsOff (offers turned off),
 * touch (no key hints), match (in a multiplayer match: no fast travel).
 * -> [{ id, label, key, sub }]
 */
export function menuItems({ has = {}, goalsOff = false, touch = false, match = false, look = 'Classic' } = {}) {
  const all = [
    { id: 'resume', label: 'Resume', key: 'Esc' },
    { id: 'map', label: 'Map & fast travel', key: '', sub: match ? 'Map only during a match' : '' },
    { id: 'character', label: 'Character', key: 'C', need: 'player' },
    { id: 'journal', label: 'Journal', key: 'J', need: 'explore' },
    { id: 'photo', label: 'Photo mode', key: 'P', need: 'explore' },
    { id: 'trip', label: 'Plan a trip', key: '', need: 'trip' },
    { id: 'goals', label: goalsOff ? 'Goals: off' : 'Goals: on', key: 'O', need: 'goals' },
    { id: 'look', label: `Look: ${look}`, key: '', sub: 'Classic, Spider-Verse, Manga' },
    { id: 'music', label: 'Music', key: '', sub: 'Play your Spotify while you play', need: 'music' },
    { id: 'settings', label: 'Settings', key: '', sub: 'Sun, quality, sound' },
    { id: 'help', label: 'Controls & help', key: 'H', need: 'player' },
    { id: 'tour', label: 'Tour', key: '', sub: 'What there is to do, again', need: 'tour' },
    { id: 'mp', label: 'Multiplayer', key: '', need: 'mp' },
  ];
  return all.filter((it) => !it.need || has[it.need]).map(({ need, ...it }) => ({ ...it, key: touch ? '' : it.key, sub: it.sub || '' }));
}

/** Arrow-key / d-pad focus: the next index in a grid of `cols` columns (wraps top and bottom). */
export function moveFocus(i, n, dir, cols = 1) {
  if (n <= 0) return -1;
  if (i < 0) return 0;
  const step = { up: -cols, down: cols, left: -1, right: 1 }[dir] ?? 0;
  if (cols === 1 && (dir === 'left' || dir === 'right')) return i;
  return (((i + step) % n) + n) % n;
}

/** The clock speed while paused: almost stopped (0 would read as 1x in places). */
export const PAUSED_SPEED = 0.001;

/** Speed to restore on resume: the saved one, unless something changed it while paused. */
export function resumeSpeed(saved, now) {
  return now === PAUSED_SPEED ? saved : now;
}
