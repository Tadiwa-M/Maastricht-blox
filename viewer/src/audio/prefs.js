// Volume and mute, remembered per browser (localStorage, key blox.audio.v1). Storage can be
// missing or throw (private mode, blocked site data): then the defaults apply. Pure; the store is
// passed in (tests use a Map-like stub).

export const PREFS_KEY = 'blox.audio.v1';
export const PREFS_DEFAULTS = Object.freeze({ volume: 0.6, muted: false });

export function loadPrefs(store) {
  try {
    const p = JSON.parse(store?.getItem(PREFS_KEY) || 'null');
    if (!p || typeof p !== 'object') return { ...PREFS_DEFAULTS };
    const v = Number(p.volume);
    return { volume: Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : PREFS_DEFAULTS.volume, muted: p.muted === true };
  } catch { return { ...PREFS_DEFAULTS }; }
}

export function savePrefs(store, prefs) {
  try { store?.setItem(PREFS_KEY, JSON.stringify({ volume: prefs.volume, muted: !!prefs.muted })); return true; } catch { return false; }
}

/** Master gain for the prefs: 0 muted, else a perceptual (squared) curve, 0.6 -> ~0.3. */
export const masterGain = (p) => (p.muted ? 0 : 0.85 * p.volume * p.volume);
