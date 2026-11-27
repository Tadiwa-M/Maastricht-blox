import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSpotify, embedUrl } from '../src/music/spotify.js';

test('Spotify links of every kind are understood; anything else is not', () => {
  assert.deepEqual(parseSpotify('https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M?si=abc123'), { type: 'playlist', id: '37i9dQZF1DXcBWIGoYBM5M', uri: 'spotify:playlist:37i9dQZF1DXcBWIGoYBM5M' });
  assert.equal(parseSpotify('https://open.spotify.com/intl-nl/album/4aawyAB9vmqN3uQ7FjRGTy').type, 'album');
  assert.equal(parseSpotify('open.spotify.com/track/11dFghVXANMlKmJXsNCbNl').type, 'track');
  assert.equal(parseSpotify('spotify:artist:0OdUWJ0sBjDrqHygGUXeCF').uri, 'spotify:artist:0OdUWJ0sBjDrqHygGUXeCF');
  assert.equal(parseSpotify('https://example.com/playlist/37i9dQZF1DXcBWIGoYBM5M'), null);
  assert.equal(parseSpotify('https://open.spotify.com/user/someone'), null);
  assert.equal(parseSpotify(''), null);
  assert.match(embedUrl({ type: 'playlist', id: 'abcdefghij' }), /^https:\/\/open\.spotify\.com\/embed\/playlist\/abcdefghij\?/);
});

test('Spotify login (PKCE): the login address, the way back, token times', async () => {
  const { b64url, authUrl, parseCallback, tokensFrom, fresh, redirectUri, challengeOf, makeVerifier, SCOPES } = await import('../src/music/auth.js');
  assert.equal(b64url(new Uint8Array([251, 255, 0])), '-_8A');
  const v = makeVerifier();
  assert.match(v, /^[A-Za-z0-9_-]{43,128}$/);
  // RFC 7636 appendix B
  assert.equal(await challengeOf('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'), 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
  const u = new URL(authUrl({ clientId: 'abc', redirect: 'https://tadiwa-m.github.io/Maastricht_larper/', challenge: 'xyz', state: 's1' }));
  assert.equal(u.origin + u.pathname, 'https://accounts.spotify.com/authorize');
  assert.equal(u.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(u.searchParams.get('redirect_uri'), 'https://tadiwa-m.github.io/Maastricht_larper/');
  assert.equal(u.searchParams.get('scope'), SCOPES.join(' '));
  assert.deepEqual(parseCallback('?code=C&state=S'), { code: 'C', state: 'S' });
  assert.equal(parseCallback('?error=access_denied&state=S').error, 'access_denied');
  assert.equal(parseCallback('?t=12'), null);
  assert.equal(redirectUri({ origin: 'https://tadiwa-m.github.io', pathname: '/Maastricht_larper/' }), 'https://tadiwa-m.github.io/Maastricht_larper/');
  assert.equal(redirectUri({ origin: 'https://tadiwa-m.github.io', pathname: '/Maastricht_larper/index.html' }), 'https://tadiwa-m.github.io/Maastricht_larper/');
  assert.equal(redirectUri({ origin: 'https://tadiwa-m.github.io', pathname: '/Maastricht_larper' }), 'https://tadiwa-m.github.io/Maastricht_larper/');
  assert.equal(redirectUri({ origin: 'http://127.0.0.1:8080', pathname: '/' }), 'http://127.0.0.1:8080/');
  const t = tokensFrom({ access_token: 'A', refresh_token: 'R', expires_in: 3600 }, 0);
  assert.ok(fresh(t, 1000) && !fresh(t, 3600 * 1000));
  assert.equal(tokensFrom({ access_token: 'B', expires_in: 3600 }, 0, t).refresh, 'R', 'a refresh keeps the old refresh token');
});
