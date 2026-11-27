// Maastricht's calendar for city life: which events are on at a date and hour, and the date the
// game clock is showing. Dates are day numbers (days since 1970-01-01, UTC arithmetic, so no
// time zone or summer time can shift them). Pure, tested in test/life.calendar.test.mjs.
//
// Events (hours may run past 24: the night after the day belongs to that day):
//   carnaval      Friday-Tuesday before Ash Wednesday: the whole centre, Markt and Vrijthof packed,
//                 people dressed up (red, yellow, green), into the small hours
//   elfde         11 November: the season opens at 11:11 on the Markt
//   preuvenemint  Thursday-Sunday of the last weekend of August: the food fair on the Vrijthof
//   magisch       Magisch Maastricht, the Christmas market: last Friday of November - 4 January,
//                 Vrijthof (and the Markt)
//   koningsdag    27 April (26 when that is a Sunday): orange, the squares full
// The weekly market (Wednesday and Friday mornings) is data (streets.json market, market.js).

const DAY_MS = 86400000;

/** Day number of a calendar date (m 1..12). */
export function dayNumber(y, m, d) { return Math.floor(Date.UTC(y, m - 1, d) / DAY_MS); }

/** { y, m, d } of a day number. */
export function fromDayNumber(n) {
  const t = new Date(n * DAY_MS);
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() };
}

/** Weekday of a day number: 0 = Monday .. 6 = Sunday (1970-01-01 was a Thursday). */
export const weekdayOf = (n) => (((n + 3) % 7) + 7) % 7;

/** 'YYYY-MM-DD' -> day number, or null. */
export function parseYmd(text) {
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(String(text ?? '').trim());
  if (!m) return null;
  const y = +m[1], mo = +m[2], d = +m[3];
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const n = dayNumber(y, mo, d), back = fromDayNumber(n);
  return back.m === mo && back.d === d ? n : null;
}

/** Easter Sunday (Gregorian, anonymous algorithm) as a day number. */
export function easter(y) {
  const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4;
  const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
  return dayNumber(y, month, day);
}

export const ashWednesday = (y) => easter(y) - 46;

/** Last weekday wd (0 = Monday) of month m in year y, as a day number. */
export function lastWeekday(y, m, wd) {
  const last = dayNumber(y, m + 1, 1) - 1; // Date.UTC rolls month 13 into January
  return last - ((weekdayOf(last) - wd + 7) % 7);
}

/** Carnaval: [Friday, Tuesday] day numbers before Ash Wednesday. */
export function carnavalDays(y) { const a = ashWednesday(y); return [a - 5, a - 1]; }

/** Preuvenemint: [Thursday, last Sunday of August]. */
export function preuvenemintDays(y) { const s = lastWeekday(y, 8, 6); return [s - 3, s]; }

/** Magisch Maastricht starting in year y: [last Friday of November, 4 January of y + 1]. */
export function magischDays(y) { return [lastWeekday(y, 11, 4), dayNumber(y + 1, 1, 4)]; }

/** Koningsdag: 27 April, or the 26th when the 27th is a Sunday. */
export function koningsdag(y) { const n = dayNumber(y, 4, 27); return weekdayOf(n) === 6 ? n - 1 : n; }

/**
 * Event definitions. hours(dn) -> [from, to] hours of that day (to may exceed 24) or null when it
 * is not on. crowd: walkers out x this at full strength; spots: { place: spawn boost } (places
 * in routines.js); outfit: { style, share } of the people dressed for it.
 */
export const EVENTS = [
  { id: 'carnaval', name: 'Carnaval', crowd: 1.6, spots: { markt: 3, vrijthof: 3, grotestaat: 2, platielstraat: 2 },
    outfit: { style: 'carnaval', share: 0.85 },
    hours(dn) {
      const { y } = fromDayNumber(dn), [a, b] = carnavalDays(y);
      if (dn < a || dn > b) return null;
      return [dn === a ? 11 : 10, dn === b ? 24 : 28];
    } },
  { id: 'elfde', name: 'Elfde van de Elfde', crowd: 1.15, spots: { markt: 3.5 }, outfit: { style: 'carnaval', share: 0.4 },
    hours(dn) { const { m, d } = fromDayNumber(dn); return m === 11 && d === 11 ? [10, 21] : null; } },
  { id: 'preuvenemint', name: 'Preuvenemint', crowd: 1.25, spots: { vrijthof: 4 }, outfit: null,
    hours(dn) {
      const { y } = fromDayNumber(dn), [a, b] = preuvenemintDays(y);
      if (dn < a || dn > b) return null;
      return [12, dn === b ? 23 : 24];
    } },
  { id: 'magisch', name: 'Magisch Maastricht', crowd: 1.1, spots: { vrijthof: 2.5, markt: 1.5 }, outfit: null,
    hours(dn) {
      const { y, m, d } = fromDayNumber(dn);
      const [a, b] = magischDays(m === 1 ? y - 1 : y);
      if (dn < a || dn > b) return null;
      if (m === 12 && (d === 24 || d === 31)) return [11, 17];
      if (m === 12 && d === 25) return [13, 22];
      return [11, weekdayOf(dn) >= 4 ? 23 : 22];
    } },
  { id: 'koningsdag', name: 'Koningsdag', crowd: 1.35, spots: { vrijthof: 2, markt: 2 }, outfit: { style: 'orange', share: 0.55 },
    hours(dn) { return dn === koningsdag(fromDayNumber(dn).y) ? [10, 24] : null; } },
];

const RAMP_H = 1; // events build up and thin out over an hour

/** Strength 0..1 of a window [from, to] at hour h (linear ramps of RAMP_H inside it). */
export function windowStrength([from, to], h) {
  if (h < from || h > to) return 0;
  return Math.min(1, (h - from) / RAMP_H + 0.25, (to - h) / RAMP_H + 0.25);
}

/**
 * Events on at day number dn, hour 0..24 (the night before counts for yesterday's events):
 * [{ id, name, strength 0..1, crowd, spots, outfit }], strongest first.
 */
export function eventsAt(dn, hours) {
  const out = [];
  for (const e of EVENTS) {
    let s = 0;
    const today = e.hours(dn), yday = e.hours(dn - 1);
    if (today) s = Math.max(s, windowStrength(today, hours));
    if (yday) s = Math.max(s, windowStrength(yday, hours + 24));
    if (s > 0) out.push({ id: e.id, name: e.name, strength: s, crowd: 1 + (e.crowd - 1) * s, spots: e.spots, outfit: e.outfit });
  }
  return out.sort((a, b) => b.strength - a.strength);
}

/** Day number of a Date in Maastricht (Europe/Amsterdam), or the local date without Intl zones. */
export function zonedDayNumber(date = new Date(), timeZone = 'Europe/Amsterdam') {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: 'numeric', day: 'numeric' }).formatToParts(date);
    const get = (t) => +parts.find((p) => p.type === t)?.value;
    const n = dayNumber(get('year'), get('month'), get('day'));
    if (Number.isFinite(n)) return n;
  } catch { /* no Intl time zones */ }
  return dayNumber(date.getFullYear(), date.getMonth() + 1, date.getDate());
}

const WEEK = 7 * 86400;

/**
 * The date the game clock shows. The clock only knows a weekday and a time; the date is the one
 * within half a week of an anchor (dn0 at week time t0: today and now, or a #date= start).
 * clockT: seconds since Monday 00:00 (LifeClock.t).
 */
export function clockDate(clockT, dn0, t0) {
  const diff = ((((clockT - t0) % WEEK) + WEEK + WEEK / 2) % WEEK) - WEEK / 2;
  return dn0 + Math.floor(((t0 % 86400) + diff) / 86400);
}
