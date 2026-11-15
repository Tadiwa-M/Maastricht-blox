// Real Maastricht weather for city life: the current conditions from Open-Meteo (no key, CORS
// allowed), polled every POLL_S, used only while the game clock shows the real time (as live bus
// delays). Otherwise, offline, or with #rain= / #temp= in the URL, the URL (or a dry, mild day)
// decides. What it does to the city (pure, tested in test/life.weather.test.mjs):
//   rain  -> umbrellas, fewer people out, people keeping to the walls and sheltering (walkers.js)
//   cold  -> fewer terrace sitters (terraceWeather), coats and hats (outfits.js)
// life/index.js publishes the result as window.__bloxLife.weather (see weatherState).

export const WEATHER_URL = 'https://api.open-meteo.com/v1/forecast?latitude=50.85&longitude=5.69'
  + '&current=precipitation,rain,snowfall,weather_code,cloud_cover,wind_speed_10m,temperature_2m';
export const POLL_S = 900, STALE_S = 3 * 3600;
export const MILD = { rain: 0, tempC: 15, cloud: 0.4, wind: 10, snow: false, storm: false }; // no weather source: a dry, mild day
// WMO weather codes (Open-Meteo weather_code): snow 71-77 and 85-86, thunderstorms 95-99
export const isSnowCode = (c) => (c >= 71 && c <= 77) || c === 85 || c === 86;
export const isStormCode = (c) => c >= 95 && c <= 99;

/** Rain 0 (dry) .. 1 (pouring) from a rate in mm per hour. */
export function rainLevel(mmH) {
  if (!Number.isFinite(mmH) || mmH < 0.05) return 0;
  return Math.min(1, 0.25 + 0.75 * Math.sqrt(mmH / 4)); // drizzle 0.3, 1 mm/h 0.6, 4 mm/h and more 1
}

/** Open-Meteo forecast answer -> { rain, tempC, cloud (0..1), wind (km/h) }, or null. */
export function parseOpenMeteo(doc) {
  const c = doc?.current;
  if (!c) return null;
  // `current` sums the last `interval` seconds (15 min): scale to an hourly rate
  const mm = Math.max(Number.isFinite(c.precipitation) ? c.precipitation : 0, Number.isFinite(c.rain) ? c.rain : 0);
  const perHour = Number.isFinite(c.interval) && c.interval > 0 ? 3600 / c.interval : 1;
  const tempC = Number.isFinite(c.temperature_2m) ? c.temperature_2m : null;
  if (tempC === null && !Number.isFinite(c.precipitation) && !Number.isFinite(c.rain)) return null;
  const code = Number.isFinite(c.weather_code) ? c.weather_code : -1;
  const snowing = isSnowCode(code) || (Number.isFinite(c.snowfall) && c.snowfall > 0);
  return {
    snow: snowing, storm: isStormCode(code),
    rain: snowing ? Math.max(0.4, rainLevel(Math.max(mm, (c.snowfall || 0) / 0.7) * perHour)) : rainLevel(mm * perHour),
    tempC: tempC ?? MILD.tempC,
    cloud: Number.isFinite(c.cloud_cover) ? Math.max(0, Math.min(1, c.cloud_cover / 100)) : MILD.cloud,
    wind: Number.isFinite(c.wind_speed_10m) ? c.wind_speed_10m : MILD.wind,
  };
}

/** Walkers out x this: rain keeps people in, so do bitter cold and storms. */
export function crowdWeather(w) {
  let f = 1 - 0.4 * Math.max(0, Math.min(1, w.rain || 0));
  if (Number.isFinite(w.tempC) && w.tempC < 3) f *= 0.85 + 0.05 * Math.max(-3, w.tempC); // 3 °C 1.0 .. -3 °C 0.7
  if (w.wind > 50) f *= 0.85;
  return Math.max(0.4, f);
}

/** Terrace chairs taken x this (rain is applied by the terraces themselves): cold and wind. */
export function terraceWeather(w) {
  const t = Number.isFinite(w.tempC) ? w.tempC : MILD.tempC;
  let f = t >= 14 ? 1 : t <= 2 ? 0.2 : 0.2 + 0.8 * ((t - 2) / 12);
  if (w.wind > 40) f *= 0.75;
  return f;
}

/**
 * The rain value to hand Terraces.draw (share = day curve x (1 - 0.85 rain)) so that it also
 * carries terraceWeather: 1 - 0.85 x = (1 - 0.85 rain) x terrace.
 */
export function terraceRain(rain, terrace) {
  const keep = (1 - 0.85 * Math.max(0, Math.min(1, rain))) * Math.max(0, Math.min(1, terrace));
  return Math.max(0, Math.min(1, (1 - keep) / 0.85));
}

/** #rain= and #temp= from the URL hash: { rain?, tempC? } (only what is given). */
export function hashWeather(hash = '') {
  const p = new URLSearchParams(String(hash).replace(/^#/, '')), out = {};
  if (p.has('rain') && Number.isFinite(+p.get('rain'))) out.rain = Math.max(0, Math.min(1, +p.get('rain')));
  if (p.has('temp') && Number.isFinite(+p.get('temp'))) out.tempC = +p.get('temp');
  if (p.has('snow')) { out.snow = p.get('snow') !== '0'; if (out.snow && !('rain' in out)) out.rain = 0.6; }
  if (p.has('storm')) { out.storm = p.get('storm') !== '0'; if (out.storm && !('rain' in out)) out.rain = 0.9; }
  return out;
}

/**
 * The weather life uses now: the URL wins, then the live reading while the clock shows the real
 * time (`near`), else a dry, mild day. -> { rain, tempC, cloud, wind, live, terrace, crowd }.
 */
export function weatherState({ hash = {}, live = null, near = false, ctxRain = null } = {}) {
  const useLive = !!live && near;
  const base = useLive ? live : MILD;
  const w = { ...MILD, ...base };
  if (Number.isFinite(ctxRain)) w.rain = ctxRain;
  if ('rain' in hash) w.rain = hash.rain;
  if ('tempC' in hash) w.tempC = hash.tempC;
  if ('snow' in hash) w.snow = hash.snow;
  if ('storm' in hash) w.storm = hash.storm;
  if (w.snow && w.rain === 0) w.rain = 0.6;
  w.live = useLive && !('rain' in hash) && !('tempC' in hash) && !('snow' in hash) && !('storm' in hash);
  w.terrace = terraceWeather(w);
  w.crowd = crowdWeather(w);
  return w;
}

export class WeatherFeed {
  constructor(fetchImpl = (...a) => fetch(...a), url = WEATHER_URL) {
    Object.assign(this, { fetch: fetchImpl, url });
    this.now = null; // last reading (parseOpenMeteo), null until one arrived
    this.at = 0;
  }

  /** One poll; failures keep the last reading for STALE_S, then forget it. Never throws. */
  async poll(nowS = Date.now() / 1000) {
    try {
      const r = await this.fetch(this.url);
      if (!r.ok) throw new Error(`weather ${r.status}`);
      const w = parseOpenMeteo(await r.json());
      if (!w) throw new Error('weather: no current conditions');
      this.now = w; this.at = nowS;
    } catch {
      if (nowS - this.at > STALE_S) this.now = null;
    }
    return this.now;
  }

  start() {
    if (this.timer) return;
    this.poll();
    this.timer = setInterval(() => this.poll(), POLL_S * 1000);
  }
}
