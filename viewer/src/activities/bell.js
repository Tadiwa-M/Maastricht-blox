// A bicycle bell, synthesised (no sound files): two quick bright "tring"s, a little detuned metal
// (two partials that beat against each other), quiet, and silent when the game's sound is off.
let ac = null;

export function bell() {
  const prefs = typeof window !== 'undefined' ? window.__bloxAudio?.prefs : null;
  if (prefs?.muted || prefs?.volume === 0) return false;
  try {
    ac = ac || new (window.AudioContext || window.webkitAudioContext)();
    const vol = 0.09 * ((prefs?.volume ?? 0.35) / 0.35);
    for (const [at, f] of [[0, 2380], [0.13, 2380]]) {
      const t = ac.currentTime + at, g = ac.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(vol, t + 0.004);
      g.gain.exponentialRampToValueAtTime(0.0008, t + 0.55);
      g.connect(ac.destination);
      for (const [mul, lvl] of [[1, 1], [1.006, 0.8], [2.76, 0.25]]) { // the ring, its beat, a metallic overtone
        const o = ac.createOscillator(), og = ac.createGain();
        o.type = 'sine'; o.frequency.value = f * mul; og.gain.value = lvl;
        o.connect(og).connect(g); o.start(t); o.stop(t + 0.6);
      }
    }
    return true;
  } catch { return false; }
}
