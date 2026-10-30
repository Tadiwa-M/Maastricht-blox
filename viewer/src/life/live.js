// Live delays for the timetable buses, through the relay (relay/README.md): every POLL_S the
// lines in the timetable are asked for, and each journey's delay is applied to its trips row
// (Timetable.setDelays). Rows are matched by OVapi realtime trip id ("ARR:21004:1234", exported
// as transit.json realtimeIds). Without a relay, or a timetable without realtime ids, nothing
// changes: the buses run on the published timetable and say SCHEDULED.

export const POLL_S = 20, STALE_S = 150;

/** "ARR:21004:1234" ids of a timetable -> OVapi line bases ["ARR_21004", ...] and id -> rows. */
export function liveIndex(realtimeIds) {
  const rows = new Map(), lines = new Set();
  (realtimeIds || []).forEach((ids, q) => {
    for (const id of ids || []) {
      const m = /^([A-Z]+):([^:]+):\d+$/.exec(id);
      if (!m) continue;
      lines.add(`${m[1]}_${m[2]}`);
      if (!rows.has(id)) rows.set(id, []);
      rows.get(id).push(q);
    }
  });
  return { lines: [...lines].sort(), rows };
}

/** Relay answer ({ at, journeys: { id: { delay } } }) -> Map row -> delay (s). */
export function delaysByRow(answer, rows) {
  const out = new Map();
  for (const [id, j] of Object.entries(answer?.journeys || {})) {
    if (!Number.isFinite(j?.delay) || Math.abs(j.delay) > 3600) continue; // over an hour off: not trusted
    for (const q of rows.get(id) || []) out.set(q, j.delay);
  }
  return out;
}

export class LiveFeed {
  /** relay: base URL; timetable: Timetable (with realtimeIds). */
  constructor(relay, timetable, fetchImpl = (...a) => fetch(...a)) {
    this.relay = relay.replace(/\/$/, '');
    this.tt = timetable;
    this.fetch = fetchImpl;
    this.index = liveIndex(timetable.realtimeIds);
    this.ok = false; this.at = 0; this.count = 0;
  }

  get usable() { return !!this.relay && this.index.lines.length > 0; }

  /** One poll: fetch, apply; failures leave the timetable as it was (and mark not live). */
  async poll(nowS = Date.now() / 1000) {
    if (!this.usable) return false;
    try {
      const r = await this.fetch(`${this.relay}/live?lines=${this.index.lines.join(',')}`);
      if (!r.ok) throw new Error(`relay ${r.status}`);
      const delays = delaysByRow(await r.json(), this.index.rows);
      this.tt.setDelays(delays);
      this.ok = true; this.at = nowS; this.count = delays.size;
    } catch {
      if (nowS - this.at > STALE_S) { this.tt.setDelays(new Map()); this.ok = false; }
    }
    return this.ok;
  }

  start() {
    if (!this.usable || this.timer) return;
    this.poll();
    this.timer = setInterval(() => this.poll(), POLL_S * 1000);
  }
}
