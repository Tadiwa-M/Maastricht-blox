// Life controls in the HUD: the clock (weekday + time), speed 1x / 10x / 60x and "now"
// (back to real Maastricht time). Couples the clock with the sun slider (#time): dragging the
// slider sets the clock's time of day; the running clock moves the slider (and so the sun)
// in quarter-hour steps.
import { SPEEDS } from './clock.js';

export function bindLifeUI(clock, { onNow, still = false } = {}) {
  if (typeof document === 'undefined') return { update() {}, stats() {} };
  const hud = document.getElementById('hud');
  const row = document.createElement('div');
  row.id = 'lifeClock';
  row.style.cssText = 'display:flex;align-items:center;gap:6px;color:var(--muted);font-variant-numeric:tabular-nums';
  const label = document.createElement('b');
  label.style.cssText = 'color:var(--text);min-width:6.5em';
  row.append('Clock ', label);
  const buttons = SPEEDS.map((s) => {
    const b = document.createElement('button');
    b.textContent = `${s}x`;
    b.style.cssText = 'background:rgba(255,255,255,.1);color:var(--text);border:1px solid rgba(255,255,255,.25);border-radius:5px;padding:0 6px;cursor:pointer';
    b.addEventListener('click', () => { clock.speed = s; mark(); });
    row.append(b);
    return [s, b];
  });
  const now = document.createElement('button');
  now.textContent = 'now';
  now.style.cssText = buttons[0][1].style.cssText;
  now.addEventListener('click', () => onNow?.());
  row.append(now);
  const stats = document.createElement('div');
  stats.id = 'lifeStats';
  stats.style.cssText = 'color:var(--muted);font-variant-numeric:tabular-nums';
  const anchor = document.getElementById('stats');
  if (hud) { hud.insertBefore(row, anchor || null); hud.insertBefore(stats, anchor || null); }
  function mark() { for (const [s, b] of buttons) b.style.borderColor = s === clock.speed ? 'var(--accent)' : 'rgba(255,255,255,.25)'; }
  mark();

  const slider = document.getElementById('time');
  let pushing = false, lastQuarter = null;
  slider?.addEventListener('input', () => { if (!pushing) { clock.setHours(+slider.value); lastQuarter = null; } });
  /** Move the sun slider with the clock (quarter-hour steps, within the slider's range). */
  function pushSun() {
    if (!slider || still) return;
    const h = clock.hours, q = Math.round(h * 4) / 4;
    if (q === lastQuarter || q < +slider.min || q > +slider.max || Math.abs(+slider.value - q) < 0.01) { lastQuarter = q; return; }
    lastQuarter = q;
    pushing = true;
    slider.value = q;
    slider.dispatchEvent(new Event('input'));
    pushing = false;
  }
  return {
    update() { label.textContent = clock.label(); pushSun(); },
    stats(s) { stats.textContent = s; },
    mark,
  };
}
