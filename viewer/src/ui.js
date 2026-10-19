// Overlay UI wiring: sun-time slider, toggles, stats, picked-feature info.
const $ = (id) => document.getElementById(id);

export function fmtHours(h) {
  const m = Math.round(h * 60);
  return `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

export function bindUI({ time, tilt, ao, onTime, onTilt, onAO }) {
  const slider = $('time'), label = $('timeLabel');
  slider.value = time;
  label.textContent = fmtHours(time);
  slider.addEventListener('input', () => {
    label.textContent = fmtHours(+slider.value);
    onTime(+slider.value);
  });
  $('tilt').checked = tilt;
  $('tilt').addEventListener('change', (e) => onTilt(e.target.checked));
  $('ao').checked = ao;
  $('ao').addEventListener('change', (e) => onAO(e.target.checked));
  return {
    setTime(h) { slider.value = h; label.textContent = fmtHours(h); },
    stats(s) {
      $('stats').textContent =
        `${s.bricks.toLocaleString()} bricks · ${s.studs.toLocaleString()} studs · ${s.calls} draws · ${s.fps} fps`;
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
