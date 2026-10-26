// Overlay UI wiring: sun-time slider, toggles (tilt-shift, AO, animation), quality selector,
// stats (with the measured frame rate), info panel.
const $ = (id) => document.getElementById(id);

export function fmtHours(h) {
  const m = Math.round(h * 60);
  return `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

export function bindUI({ time, tilt, ao, anim, quality, onTime, onTilt, onAO, onAnim, onQuality }) {
  const slider = $('time'), label = $('timeLabel');
  slider.value = time;
  label.textContent = fmtHours(time);
  slider.addEventListener('input', () => {
    label.textContent = fmtHours(+slider.value);
    onTime(+slider.value);
  });
  const toggles = { tilt: onTilt, ao: onAO, anim: onAnim };
  const init = { tilt, ao, anim };
  for (const [id, fn] of Object.entries(toggles)) {
    $(id).checked = init[id];
    $(id).addEventListener('change', (e) => fn(e.target.checked));
  }
  $('quality').value = quality;
  $('quality').addEventListener('change', (e) => onQuality(e.target.value));
  bindHudToggle();
  return {
    set(o) {
      slider.value = o.time; label.textContent = fmtHours(o.time);
      for (const id of Object.keys(toggles)) $(id).checked = o[id];
      $('quality').value = o.quality;
    },
    /** Tier actually in use (auto shows what it picked). */
    tier(mode, name) { $('tierLabel').textContent = mode === 'auto' ? `→ ${name}` : ''; },
    /** Replace the view links (city mode has its own presets). */
    views(names) {
      $('views').innerHTML = 'View: ' + names.map((n) => `<a href="#view=${encodeURIComponent(n)}">${escapeHtml(n)}</a>`).join('');
    },
    stats(s) {
      if (s.text) { $('stats').textContent = s.text; return; }
      $('stats').textContent = `${s.bricks.toLocaleString()} bricks · ${s.near}/${s.chunks} chunks near · `
        + `${s.studs.toLocaleString()} studs · ${s.calls} draws · ${(s.triangles / 1e6).toFixed(2)} M tris · `
        + `${s.actors} movers · ${s.fps}`;
    },
    info(html) {
      const el = $('info');
      el.innerHTML = html || '';
      el.hidden = !html;
    },
  };
}

export function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
}

/** Collapse the panel to its title (button or U key). Starts collapsed on phones; remembered per browser. */
export function bindHudToggle(doc = document) {
  const hud = doc.getElementById('hud'), btn = doc.getElementById('hudToggle');
  if (!hud || !btn) return;
  let saved = null;
  try { saved = localStorage.getItem('blox.hud'); } catch { /* storage blocked: use the default */ }
  const small = typeof matchMedia === 'function' && matchMedia('(max-width: 600px)').matches;
  const set = (collapsed) => {
    hud.classList.toggle('collapsed', collapsed);
    btn.textContent = collapsed ? 'show' : 'hide';
    btn.setAttribute('aria-expanded', String(!collapsed));
    try { localStorage.setItem('blox.hud', collapsed ? 'collapsed' : 'open'); } catch { /* ignore */ }
  };
  set(saved ? saved === 'collapsed' : small);
  btn.addEventListener('click', () => set(!hud.classList.contains('collapsed')));
  doc.addEventListener('keydown', (e) => {
    if (e.code === 'KeyU' && !e.repeat && !/^(INPUT|SELECT|TEXTAREA)$/.test(e.target?.tagName || '')) set(!hud.classList.contains('collapsed'));
  });
}
