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
