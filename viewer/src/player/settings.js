// Player camera settings (mouse/controller sensitivity, invert Y, auto-recenter), kept per
// browser in localStorage. Storage can be missing or throw (private window, blocked site
// data), so every access is guarded and the defaults always work.

export const SETTINGS_KEY = 'blox.player.settings.v1';

export const SETTINGS_DEFAULTS = Object.freeze({
  mouseSens: 1, // x base rad/px (input.js BINDINGS.look.mouse)
  invertY: false, // mouse + touch
  padSens: 1, // x base stick turn rate (look.js StickLook)
  padInvertY: false,
  recenter: true, // ease the camera behind the player after ~2 s without look input
});

export const SETTINGS_RANGE = { mouseSens: [0.2, 3], padSens: [0.3, 2.5] };

/** Any object (parsed JSON, partial, garbage) -> a complete, valid settings object. */
export function sanitizeSettings(raw) {
  const s = { ...SETTINGS_DEFAULTS };
  if (!raw || typeof raw !== 'object') return s;
  for (const [k, [lo, hi]] of Object.entries(SETTINGS_RANGE)) {
    const v = Number(raw[k]);
    if (raw[k] != null && Number.isFinite(v)) s[k] = Math.min(hi, Math.max(lo, v));
  }
  for (const k of ['invertY', 'padInvertY', 'recenter']) if (typeof raw[k] === 'boolean') s[k] = raw[k];
  return s;
}

const store = () => { try { return globalThis.localStorage ?? null; } catch { return null; } };

export function loadSettings(storage = store()) {
  try { return sanitizeSettings(JSON.parse(storage?.getItem(SETTINGS_KEY) || 'null')); } catch { return { ...SETTINGS_DEFAULTS }; }
}

/** Returns true when saved. */
export function saveSettings(settings, storage = store()) {
  try { storage?.setItem(SETTINGS_KEY, JSON.stringify(sanitizeSettings(settings))); return !!storage; } catch { return false; }
}
