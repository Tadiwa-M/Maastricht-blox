// Overlay UI wiring: sun-time slider, toggles (tilt-shift, AO, animation), stats, info panel.
const $ = (id) => document.getElementById(id);

export function fmtHours(h) {
  const m = Math.round(h * 60);
  return `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

export function bindUI({ time, tilt, ao, anim, onTime, onTilt, onAO, onAnim }) {
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
  return {
    set(o) {
      slider.value = o.time; label.textContent = fmtHours(o.time);
      for (const id of Object.keys(toggles)) $(id).checked = o[id];
    },
    stats(s) {
      $('stats').textContent = `${s.bricks.toLocaleString()} bricks · ${s.studs.toLocaleString()} studs · `
        + `${s.calls} draws · ${s.actors} movers · ${s.fps} fps`;
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
