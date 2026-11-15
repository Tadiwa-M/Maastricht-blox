// Spotify login for a static site: Authorization Code with PKCE (no client secret, no server).
// The owner's Spotify Developer app (the same one as Melody Search) needs this site's address as
// a Redirect URI and the Web API + Web Playback SDK ticked; its Client ID is public by design and
// comes in through window.BLOX_SITE.spotifyClientId (viewer/build.mjs). Tokens stay on this device
// (localStorage). Pure helpers are tested in test/spotify.test.mjs; the rest needs a browser.

export const SCOPES = ['streaming', 'user-read-email', 'user-read-private', 'user-read-playback-state',
  'user-modify-playback-state', 'playlist-read-private', 'playlist-read-collaborative'];
export const TOKEN_KEY = 'blox.spotify';
const PKCE_KEY = 'blox.spotify.pkce';

/** base64url without padding. */
export function b64url(bytes) {
  let s = '';
  for (const b of new Uint8Array(bytes)) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** A random PKCE verifier (43-128 chars of A-Z a-z 0-9 - _). */
export function makeVerifier(bytes = crypto.getRandomValues(new Uint8Array(48))) { return b64url(bytes); }

/** The S256 challenge for a verifier. */
export async function challengeOf(verifier) {
  return b64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
}

/** This page's address without the query or hash: what Spotify sends the player back to. */
export const redirectUri = (loc) => `${loc.origin}${loc.pathname}`;

/** The Spotify login address. */
export function authUrl({ clientId, redirect, challenge, state, scopes = SCOPES }) {
  const q = new URLSearchParams({ client_id: clientId, response_type: 'code', redirect_uri: redirect,
    code_challenge_method: 'S256', code_challenge: challenge, state, scope: scopes.join(' ') });
  return `https://accounts.spotify.com/authorize?${q}`;
}

/** Back from Spotify: { code, state } or { error } from the query string, or null. */
export function parseCallback(search) {
  const q = new URLSearchParams(search || '');
  if (q.get('error')) return { error: q.get('error'), state: q.get('state') || '' };
  if (q.get('code')) return { code: q.get('code'), state: q.get('state') || '' };
  return null;
}

/** Tokens from Spotify's answer, with the time they run out (ms). */
export const tokensFrom = (r, now = Date.now(), old = null) => ({
  access: r.access_token, refresh: r.refresh_token || old?.refresh || '', until: now + (r.expires_in || 3600) * 1000 - 60_000,
});

export const fresh = (t, now = Date.now()) => !!t?.access && now < t.until;

/** Go to Spotify's login (the page reloads on the way back; the hash keeps the game's settings). */
export async function login(clientId, loc = location, store = sessionStorage) {
  const verifier = makeVerifier(), state = makeVerifier(crypto.getRandomValues(new Uint8Array(12)));
  store.setItem(PKCE_KEY, JSON.stringify({ verifier, state, hash: loc.hash }));
  loc.assign(authUrl({ clientId, redirect: redirectUri(loc), challenge: await challengeOf(verifier), state }));
}

async function tokenCall(body) {
  const r = await fetch('https://accounts.spotify.com/api/token', { method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(body) });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error_description || data.error || `Spotify said ${r.status}`);
  return data;
}

/**
 * If this page load is the way back from Spotify, finish the login (code -> tokens), tidy the
 * address and return the tokens; else null. Throws on a refused or tampered login.
 */
export async function finishLogin(clientId, loc = location, session = sessionStorage, local = localStorage) {
  const cb = parseCallback(loc.search);
  if (!cb) return null;
  let saved = null;
  try { saved = JSON.parse(session.getItem(PKCE_KEY) || 'null'); } catch { saved = null; }
  session.removeItem(PKCE_KEY);
  history.replaceState(null, '', `${loc.pathname}${saved?.hash || loc.hash || ''}`);
  if (cb.error) throw new Error(cb.error === 'access_denied' ? 'Spotify login was cancelled' : `Spotify: ${cb.error}`);
  if (!saved || saved.state !== cb.state) throw new Error('Spotify login did not match: try again');
  const t = tokensFrom(await tokenCall({ grant_type: 'authorization_code', code: cb.code, redirect_uri: redirectUri(loc),
    client_id: clientId, code_verifier: saved.verifier }));
  local.setItem(TOKEN_KEY, JSON.stringify(t));
  return t;
}

/** Saved tokens, refreshed when they ran out; null when logged out (or the refresh was refused). */
export async function getTokens(clientId, local = localStorage) {
  let t = null;
  try { t = JSON.parse(local.getItem(TOKEN_KEY) || 'null'); } catch { t = null; }
  if (!t) return null;
  if (fresh(t)) return t;
  if (!t.refresh) return null;
  try {
    const n = tokensFrom(await tokenCall({ grant_type: 'refresh_token', refresh_token: t.refresh, client_id: clientId }), Date.now(), t);
    local.setItem(TOKEN_KEY, JSON.stringify(n));
    return n;
  } catch { local.removeItem(TOKEN_KEY); return null; }
}

export function logout(local = localStorage) { local.removeItem(TOKEN_KEY); }
