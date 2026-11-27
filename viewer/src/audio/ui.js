// Sound controls in the settings panel (#hud), appended like the life clock row: a volume slider
// and a mute button. V toggles mute (not while typing, not on the title screen).

export function bindAudioUI(prefs, { onChange } = {}) {
  if (typeof document === 'undefined') return { sync() {} };
  const hud = document.getElementById('hud');
  const row = document.createElement('label');
  row.id = 'audioRow';
  row.title = 'Sound volume (V mutes)';
  const slider = document.createElement('input');
  slider.type = 'range'; slider.min = '0'; slider.max = '100'; slider.step = '1'; slider.id = 'audioVolume';
  slider.setAttribute('aria-label', 'Sound volume');
  const pct = document.createElement('span');
  pct.style.cssText = 'min-width:2.5em;text-align:right;font-variant-numeric:tabular-nums';
  const mute = document.createElement('button');
  mute.type = 'button'; mute.id = 'audioMute';
  mute.style.cssText = 'background:rgba(255,255,255,.1);color:var(--text);border:1px solid rgba(255,255,255,.25);border-radius:5px;padding:0 6px;cursor:pointer;min-width:4.5em';
  row.append('Sound ', slider, pct, mute);
  if (hud) hud.insertBefore(row, document.getElementById('stats') || null);

  function sync() {
    slider.value = String(Math.round(prefs.volume * 100));
    pct.textContent = prefs.muted ? 'off' : `${Math.round(prefs.volume * 100)}%`;
    mute.textContent = prefs.muted ? 'unmute' : 'mute';
    mute.setAttribute('aria-pressed', String(prefs.muted));
    slider.style.opacity = prefs.muted ? '0.5' : '1';
  }
  const changed = () => { sync(); onChange?.(prefs); };
  slider.addEventListener('input', () => { prefs.volume = +slider.value / 100; prefs.muted = false; changed(); });
  mute.addEventListener('click', (e) => { e.preventDefault(); prefs.muted = !prefs.muted; changed(); });
  window.addEventListener('keydown', (e) => {
    if (e.code !== 'KeyV' || e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
    const tag = e.target?.tagName;
    const typing = tag === 'TEXTAREA' || (tag === 'INPUT' && !/^(range|checkbox|button)$/.test(e.target.type));
    if (typing || e.target?.isContentEditable) return;
    if (document.body.classList.contains('title')) return;
    prefs.muted = !prefs.muted; changed();
  });
  sync();
  return { sync };
}
