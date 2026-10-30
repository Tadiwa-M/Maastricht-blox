// OVapi (v0.ovapi.nl, KV78turbo) -> live delays per journey for the buses we show.
// The viewer asks for lines by their realtime key base ("ARR_21004"); OVapi keys lines per
// direction ("ARR_21004_1", "ARR_21004_2"), so both are requested in one call. Each line's
// "Actuals" lists stop passes with target (timetable) and expected times; a journey's delay is
// taken from its next pass that is not yet PASSED (else its last one).
// Pure parts are exported for test/ovapi.test.mjs.

export const OVAPI = 'https://v0.ovapi.nl';
const LINE_RE = /^[A-Z]{2,8}_[A-Za-z0-9-]{1,12}$/;

/** "ARR_21004,ARR_21005" -> validated, de-duplicated line keys with both directions. */
export function lineKeys(param, max = 40) {
  const bases = [...new Set(String(param || '').split(',').map((s) => s.trim()).filter((s) => LINE_RE.test(s)))].slice(0, max);
  return bases.flatMap((b) => [`${b}_1`, `${b}_2`]);
}

const secs = (iso) => (iso ? Date.parse(`${iso}${/Z|[+-]\d\d:?\d\d$/.test(iso) ? '' : '+01:00'}`) / 1000 : NaN);

/**
 * OVapi line JSON ({ lineKey: { Actuals: { passKey: pass } } }) -> { "<owner>:<line>:<journey>":
 * { delay (s), stop (name), status, order } }. The key matches GTFS realtime_trip_id.
 */
export function journeyDelays(doc) {
  const out = {};
  for (const line of Object.values(doc || {})) {
    for (const p of Object.values(line?.Actuals || {})) {
      if (!p || p.JourneyNumber == null) continue;
      const key = `${p.DataOwnerCode}:${p.LinePlanningNumber}:${p.JourneyNumber}`;
      const delay = Math.round(secs(p.ExpectedArrivalTime || p.ExpectedDepartureTime) - secs(p.TargetArrivalTime || p.TargetDepartureTime));
      if (!Number.isFinite(delay)) continue;
      const order = +p.UserStopOrderNumber || 0;
      const passed = p.TripStopStatus === 'PASSED';
      const cur = out[key];
      // prefer the first pass still ahead; among passed ones, the latest
      const better = !cur || (cur.passed && !passed) || (cur.passed === passed && (passed ? order > cur.order : order < cur.order));
      if (better) out[key] = { delay, stop: p.TimingPointName || '', status: p.TripStopStatus || '', order, passed };
    }
  }
  for (const v of Object.values(out)) delete v.passed;
  return out;
}
