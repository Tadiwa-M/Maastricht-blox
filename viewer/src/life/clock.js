// Simulated city clock for life (buses, walkers): a weekday + seconds since midnight, running
// at 1x, 10x or 60x. Starts from real Maastricht time (Europe/Amsterdam) unless the URL fixes
// it (#t=16.5&day=sat). Pure logic, tested in test/life.clock.test.mjs.

export const WEEK_S = 7 * 86400;
export const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
export const SPEEDS = [1, 10, 60];

/** { day: 0 = Monday .. 6, sec } of a Date in a time zone (default Maastricht). */
export function zonedWeekTime(date = new Date(), timeZone = 'Europe/Amsterdam') {
  try {
    const parts = new Intl.DateTimeFormat('en-GB', { timeZone, weekday: 'short', hour: 'numeric', minute: 'numeric',
      second: 'numeric', hourCycle: 'h23' }).formatToParts(date);
    const get = (t) => parts.find((p) => p.type === t)?.value;
    const day = DAY_NAMES.indexOf(get('weekday'));
    const sec = (+get('hour') % 24) * 3600 + +get('minute') * 60 + +get('second');
    if (day >= 0 && Number.isFinite(sec)) return { day, sec };
  } catch { /* no Intl time zones: local time */ }
  return { day: (date.getDay() + 6) % 7, sec: date.getHours() * 3600 + date.getMinutes() * 60 + date.getSeconds() };
}

/** Parse a day name ('mon', 'Saturday', '5') -> 0..6, or null. */
export function parseDay(text) {
  if (text == null || text === '') return null;
  if (/^\d$/.test(text)) return +text % 7;
  const i = DAY_NAMES.findIndex((d) => String(text).toLowerCase().startsWith(d.toLowerCase()));
  return i >= 0 ? i : null;
}

export class LifeClock {
  /** t: seconds since Monday 00:00 of the reference week. */
  constructor({ day = 0, sec = 0, speed = 1 } = {}) {
    this.t = 0;
    this.speed = speed;
    this.set(day, sec);
  }

  set(day, sec) { this.t = (((day * 86400 + sec) % WEEK_S) + WEEK_S) % WEEK_S; }
  get day() { return Math.floor(this.t / 86400); }
  get sec() { return this.t - this.day * 86400; }
  get hours() { return this.sec / 3600; }

  /** Jump to an hour of the current day (the sun slider). */
  setHours(h) { this.set(this.day, Math.round(h * 3600)); }

  /** Advance by real seconds dt (times speed); wraps Sunday night -> Monday. */
  advance(dt) { this.set(0, this.t + dt * this.speed); return this; }

  label() {
    const s = Math.floor(this.sec);
    const hh = String(Math.floor(s / 3600)).padStart(2, '0'), mm = String(Math.floor(s / 60) % 60).padStart(2, '0');
    return `${DAY_NAMES[this.day]} ${hh}:${mm}`;
  }
}
