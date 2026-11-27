// Multiplayer room routes of the Worker (the rooms themselves are BloxRoom Durable Objects,
// room.js; the rules are ctf.js). Without the ROOMS binding every route answers 404, so the
// site shows "Multiplayer coming soon" until the owner deploys with it.
//   GET  /room          { rooms: true, version }  (the site's feature check)
//   POST /room          { code } of a fresh room (4 letters, no I or O)
//   GET  /room/ABCD     { code, phase, players, full } or 404 (checked before connecting:
//                       a failed WebSocket tells the browser nothing)
//   GET  /room/ABCD     with Upgrade: websocket ?pid=&name=&look=   the room's socket
import { CTF } from './ctf.js';
import { rateLimiter } from './report.js';

export const CODE_LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const allowCreate = rateLimiter(30);

/** A random room code. rand: () => [0, 1). */
export function makeCode(rand = Math.random) {
  let s = '';
  for (let q = 0; q < 4; q++) s += CODE_LETTERS[Math.floor(rand() * CODE_LETTERS.length)];
  return s;
}

/** A typed code -> 'ABCD', or null. */
export function parseCode(s) {
  const c = String(s ?? '').trim().toUpperCase();
  return c.length === 4 && [...c].every((ch) => CODE_LETTERS.includes(ch)) ? c : null;
}

const json = (data, status, headers) => new Response(JSON.stringify(data), { status,
  headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers } });

const allowedOrigin = (req, env) => {
  const origin = req.headers.get('Origin');
  return !origin || (env.SITE_ORIGINS || '').split(',').map((s) => s.trim()).includes(origin);
};

/** Handles /room and /room/<code>; h = CORS headers. */
export async function rooms(req, env, url, h) {
  if (!env.ROOMS) return json({ error: 'multiplayer is not available yet' }, 404, h);
  const stub = (code) => env.ROOMS.get(env.ROOMS.idFromName(code));
  if (url.pathname === '/room') {
    if (req.method === 'GET') return json({ rooms: true, version: CTF.version }, 200, h);
    if (req.method !== 'POST') return json({ error: 'not found' }, 404, h);
    if (!allowedOrigin(req, env)) return json({ error: 'not allowed' }, 403, h);
    if (!allowCreate(req.headers.get('CF-Connecting-IP') || 'unknown')) return json({ error: 'too many rooms from here, try again later' }, 429, h);
    for (let tries = 0; tries < 6; tries++) {
      const code = makeCode();
      const r = await stub(code).fetch(`https://room/create?code=${code}`, { method: 'POST' });
      if (r.status === 201) return json({ code }, 201, h);
    }
    return json({ error: 'no free room code, try again' }, 503, h);
  }
  const code = parseCode(url.pathname.slice('/room/'.length));
  if (!code) return json({ error: 'no room with that code' }, 404, h);
  if (req.headers.get('Upgrade') === 'websocket') {
    if (!allowedOrigin(req, env)) return new Response('not allowed', { status: 403 });
    return stub(code).fetch(req);
  }
  const r = await stub(code).fetch(`https://room/?code=${code}`);
  return json(await r.json(), r.status, h);
}
