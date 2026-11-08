// Real weather for city life (src/life/weather.js): parsing Open-Meteo, what rain and cold do,
// and who decides (the URL, the live reading near real time, a dry mild day).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rainLevel, parseOpenMeteo, crowdWeather, terraceWeather, terraceRain, hashWeather, weatherState, WeatherFeed,
  MILD, STALE_S, WEATHER_URL } from '../src/life/weather.js';
import { clockOffset } from '../src/life/index.js';
import { LifeClock } from '../src/life/clock.js';

const answer = (c) => ({ current_units: {}, current: { time: '2026-11-07T10:00', interval: 900, ...c } });

test('Open-Meteo current conditions -> rain, temperature, cloud, wind', () => {
  assert.ok(WEATHER_URL.includes('latitude=50.85') && WEATHER_URL.includes('temperature_2m'));
  const w = parseOpenMeteo(answer({ precipitation: 0.25, rain: 0.25, cloud_cover: 90, wind_speed_10m: 18, temperature_2m: 7.5 }));
  assert.ok(Math.abs(w.rain - rainLevel(1)) < 1e-9, '0.25 mm in 15 min = 1 mm/h');
  assert.equal(w.tempC, 7.5); assert.equal(w.cloud, 0.9); assert.equal(w.wind, 18);
  assert.equal(parseOpenMeteo(answer({ precipitation: 0, temperature_2m: 20 })).rain, 0);
  assert.equal(parseOpenMeteo({}), null);
  assert.equal(parseOpenMeteo(answer({})), null);
  assert.equal(rainLevel(0), 0); assert.equal(rainLevel(NaN), 0);
  assert.ok(rainLevel(0.2) > 0.25 && rainLevel(0.2) < rainLevel(1) && rainLevel(1) < rainLevel(4));
  assert.equal(rainLevel(12), 1);
});

test('rain and cold keep people in and empty the terraces', () => {
  assert.equal(crowdWeather(MILD), 1);
  assert.ok(crowdWeather({ rain: 1, tempC: 12 }) < 0.7);
  assert.ok(crowdWeather({ rain: 0, tempC: -3 }) < crowdWeather({ rain: 0, tempC: 5 }));
  assert.ok(crowdWeather({ rain: 1, tempC: -10, wind: 80 }) >= 0.4);
  assert.equal(terraceWeather({ tempC: 20 }), 1);
  assert.ok(terraceWeather({ tempC: 6 }) < 0.5 && terraceWeather({ tempC: 0 }) === 0.2);
  assert.ok(terraceWeather({ tempC: 20, wind: 60 }) < 1);
  for (const [rain, terrace] of [[0, 1], [0.5, 1], [0, 0.4], [0.7, 0.6], [0.4, 0.5]]) {
    const x = terraceRain(rain, terrace);
    assert.ok(x >= 0 && x <= 1);
    assert.ok(Math.abs((1 - 0.85 * x) - (1 - 0.85 * rain) * terrace) < 1e-9, 'the terraces see rain x cold');
  }
  assert.ok(Math.abs(terraceRain(0.3, 1) - 0.3) < 1e-9, 'a mild day: just the rain');
  assert.equal(terraceRain(1, 0.2), 1, 'beyond what the terraces can show: as empty as rain makes them');
});

test('who decides: the URL, then the live reading near real time, else a dry mild day', () => {
  assert.deepEqual(hashWeather('#rain=0.8&temp=-2&t=9'), { rain: 0.8, tempC: -2 });
  assert.deepEqual(hashWeather('#rain=5'), { rain: 1 });
  assert.deepEqual(hashWeather('#view=markt'), {});
  const live = { rain: 0.6, tempC: 4, cloud: 1, wind: 20 };
  const near = weatherState({ live, near: true });
  assert.equal(near.rain, 0.6); assert.equal(near.live, true);
  assert.ok(near.terrace < 0.5 && near.crowd < 1);
  const away = weatherState({ live, near: false });
  assert.equal(away.rain, 0); assert.equal(away.tempC, MILD.tempC); assert.equal(away.live, false);
  assert.equal(away.terrace, 1); assert.equal(away.crowd, 1);
  const url = weatherState({ hash: { rain: 0 }, live, near: true });
  assert.equal(url.rain, 0); assert.equal(url.live, false);
  assert.equal(weatherState({ ctxRain: 0.4 }).rain, 0.4);
  const offline = weatherState({ live: null, near: true });
  assert.equal(offline.rain, 0); assert.equal(offline.live, false);
});

test('near real time: the clock within 5 minutes of Maastricht time', () => {
  const c = new LifeClock({ day: 2, sec: 36000 });
  assert.equal(clockOffset(c, { day: 2, sec: 36000 + 120 }), 120);
  assert.equal(clockOffset(new LifeClock({ day: 6, sec: 86390 }), { day: 0, sec: 10 }), 20, 'across Sunday midnight');
  assert.ok(clockOffset(c, { day: 5, sec: 36000 }) > 300);
});

test('the feed: polls, keeps the last reading through hiccups, fails quietly offline', async () => {
  let fail = false, calls = 0;
  const fetchImpl = async (url) => {
    calls++;
    assert.equal(url, WEATHER_URL);
    if (fail) throw new Error('offline');
    return { ok: true, json: async () => answer({ precipitation: 1, temperature_2m: 9 }) };
  };
  const f = new WeatherFeed(fetchImpl);
  assert.equal(f.now, null);
  await f.poll(1000);
  assert.equal(f.now.tempC, 9);
  fail = true;
  assert.equal((await f.poll(1000 + 60)).tempC, 9, 'kept');
  assert.equal(await f.poll(1000 + STALE_S + 1), null, 'forgotten when stale');
  const bad = new WeatherFeed(async () => ({ ok: false, status: 500 }));
  assert.equal(await bad.poll(5), null);
  const junk = new WeatherFeed(async () => ({ ok: true, json: async () => ({ error: true }) }));
  assert.equal(await junk.poll(5), null);
  assert.equal(calls, 3);
});
