// Maastricht Blox relay (Cloudflare Worker). The site is static (GitHub Pages) and the open
// transit feeds can't be read from a browser (no CORS), so this small Worker:
//   GET  /live?lines=ARR_21004,...   Arriva/OVapi delays per journey (cached 20 s)
//   GET  /trains?stations=MT,MTR     NS departures with delays (needs the NS_KEY secret)
//   POST /report                     a "Report a mistake" -> GitHub issue (needs GITHUB_TOKEN)
//   GET  /health                     what is configured
// Secrets: GITHUB_TOKEN (fine-grained, this repo only: Contents + Issues read/write), NS_KEY.
import { OVAPI, lineKeys, journeyDelays } from './ovapi.js';
import { NS_DEPARTURES, STATIONS, stationCodes, departures } from './ns.js';
import { checkReport, bodyWithImages, rateLimiter } from './report.js';

const CACHE_S = 20;
const allowReport = rateLimiter(5);

function cors(req, env) {
  const origin = req.headers.get('Origin') || '';
  const ok = (env.SITE_ORIGINS || '').split(',').map((s) => s.trim()).includes(origin);
  return { 'Access-Control-Allow-Origin': ok ? origin : 'https://tadiwa-m.github.io', 'Vary': 'Origin',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' };
}

const json = (data, status, headers, maxAge = 0) => new Response(JSON.stringify(data), { status,
  headers: { 'Content-Type': 'application/json', 'Cache-Control': maxAge ? `public, max-age=${maxAge}` : 'no-store', ...headers } });

/** GET with Cloudflare's edge cache: one upstream call per CACHE_S for everyone. */
async function cachedJson(url, init, ctx) {
  const cache = caches.default, key = new Request(url);
  const hit = await cache.match(key);
  if (hit) return hit.json();
  const r = await fetch(url, init);
  if (!r.ok) throw new Error(`upstream ${r.status}`);
  const data = await r.json();
  ctx.waitUntil(cache.put(key, new Response(JSON.stringify(data), { headers: { 'Cache-Control': `max-age=${CACHE_S}` } })));
  return data;
}

async function live(url, env, ctx, h) {
  const keys = lineKeys(url.searchParams.get('lines'));
  if (!keys.length) return json({ error: 'lines=ARR_21004,... required' }, 400, h);
  const doc = await cachedJson(`${OVAPI}/line/${keys.join(',')}`, { headers: { 'User-Agent': 'maastricht-blox-relay' } }, ctx);
  return json({ at: Math.floor(Date.now() / 1000), journeys: journeyDelays(doc) }, 200, h, CACHE_S);
}

async function trains(url, env, ctx, h) {
  if (!env.NS_KEY) return json({ error: 'NS_KEY not configured' }, 501, h);
  const out = {};
  for (const code of stationCodes(url.searchParams.get('stations'))) {
    const doc = await cachedJson(`${NS_DEPARTURES}?station=${code}&maxJourneys=25`,
      { headers: { 'Ocp-Apim-Subscription-Key': env.NS_KEY } }, ctx);
    out[code] = { name: STATIONS[code], departures: departures(doc) };
  }
  return json({ at: Math.floor(Date.now() / 1000), stations: out }, 200, h, CACHE_S);
}

async function gh(env, path, init = {}) {
  const r = await fetch(`https://api.github.com/repos/${env.REPO}${path}`, { ...init, headers: {
    Authorization: `Bearer ${env.GITHUB_TOKEN}`, Accept: 'application/vnd.github+json', 'User-Agent': 'maastricht-blox-relay',
    'X-GitHub-Api-Version': '2022-11-28', ...(init.body ? { 'Content-Type': 'application/json' } : {}) } });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`GitHub ${r.status}: ${data.message || ''}`);
  return data;
}

async function ensureBranch(env) {
  try { await gh(env, `/git/ref/heads/${env.REPORT_BRANCH}`); return; } catch { /* create it below */ }
  const repo = await gh(env, '');
  const base = await gh(env, `/git/ref/heads/${repo.default_branch}`);
  await gh(env, '/git/refs', { method: 'POST', body: JSON.stringify({ ref: `refs/heads/${env.REPORT_BRANCH}`, sha: base.object.sha }) });
}

async function report(req, env, h) {
  if (!env.GITHUB_TOKEN) return json({ error: 'reports are not configured yet' }, 501, h);
  const ip = req.headers.get('CF-Connecting-IP') || 'unknown';
  if (!allowReport(ip)) return json({ error: 'too many reports from here, try again in an hour' }, 429, h);
  const r = checkReport(await req.json().catch(() => null));
  if (!r.ok) return json({ error: r.error }, 400, h);
  const links = {};
  if (r.images.length) {
    await ensureBranch(env);
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    for (const img of r.images) {
      const path = `reports/${stamp.slice(0, 10)}/${stamp}-${img.name}.jpg`;
      await gh(env, `/contents/${path}`, { method: 'PUT', body: JSON.stringify({ message: `map report image ${path}`,
        content: img.b64, branch: env.REPORT_BRANCH }) });
      links[img.name] = `https://raw.githubusercontent.com/${env.REPO}/${env.REPORT_BRANCH}/${path}`;
    }
  }
  const post = (labels) => gh(env, '/issues', { method: 'POST', body: JSON.stringify({ title: r.title,
    body: bodyWithImages(r.body, links), ...(labels ? { labels } : {}) }) });
  // a token without label rights can't create new labels: then file it without them
  const issue = await post(r.labels).catch(() => post(null));
  return json({ number: issue.number, url: issue.html_url }, 201, h);
}

export default {
  async fetch(req, env, ctx) {
    const h = cors(req, env);
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: h });
    const url = new URL(req.url);
    try {
      if (req.method === 'GET' && url.pathname === '/live') return await live(url, env, ctx, h);
      if (req.method === 'GET' && url.pathname === '/trains') return await trains(url, env, ctx, h);
      if (req.method === 'POST' && url.pathname === '/report') return await report(req, env, h);
      if (url.pathname === '/health') return json({ ok: true, reports: !!env.GITHUB_TOKEN, trains: !!env.NS_KEY }, 200, h);
      return json({ error: 'not found' }, 404, h);
    } catch (err) {
      return json({ error: String(err.message || err) }, 502, h);
    }
  },
};
