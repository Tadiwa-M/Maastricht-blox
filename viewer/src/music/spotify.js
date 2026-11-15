// Your own music while you play (docs/guide/21-music.md). Pause menu > Music opens the music
// panel; while something plays, a small now-playing chip (cover, song, play/pause) sits at the
// bottom left and opens the panel.
//   Connected (Spotify login, music/auth.js; Premium): Spotify's Web Playback SDK makes the game a
//   Spotify device: your playlists, play/pause, skip, volume, right here.
//   Not connected, not Premium, or no Spotify app configured: pick one of your playlists or paste
//   a link, and Spotify's embedded player plays it (whole songs when signed in to Spotify in this
//   browser, else previews).
// The city's own sounds step back while music plays (window.__bloxAudio.duck).
import { login, finishLogin, getTokens, logout, redirectUri } from './auth.js';

export const MUSIC_KEY = 'blox.music';
const TYPES = ['playlist', 'album', 'track', 'artist', 'show', 'episode'];

/** { type, id, uri } from a Spotify link (open.spotify.com/..., spotify:type:id), or null. */
export function parseSpotify(link) {
  const s = String(link || '').trim();
  let m = /^spotify:(playlist|album|track|artist|show|episode):([A-Za-z0-9]{10,40})$/.exec(s);
  if (!m) m = /^(?:https?:\/\/)?open\.spotify\.com\/(?:intl-[a-z-]+\/)?(?:embed\/)?(playlist|album|track|artist|show|episode)\/([A-Za-z0-9]{10,40})(?:[/?#].*)?$/.exec(s);
  if (!m || !TYPES.includes(m[1])) return null;
  return { type: m[1], id: m[2], uri: `spotify:${m[1]}:${m[2]}` };
}

/** The embed address for a parsed link (dark theme). */
export const embedUrl = ({ type, id }) => `https://open.spotify.com/embed/${type}/${id}?utm_source=maastricht-blox&theme=0`;

const GREEN = '#1ed760';
const ICON = {
  note: '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M12 3v10.55A4 4 0 1 0 14 17V7h4V3h-6z"/></svg>',
  play: '<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>',
  pause: '<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M6 5h4v14H6zm8 0h4v14h-4z"/></svg>',
  prev: '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M6 6h2v12H6zm3.5 6L18 18V6z"/></svg>',
  next: '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M16 6h2v12h-2zM6 18l8.5-6L6 6z"/></svg>',
};

const CSS = `
#music-chip { position: fixed; left: calc(12px + env(safe-area-inset-left, 0px)); bottom: calc(76px + env(safe-area-inset-bottom, 0px));
  z-index: 5; display: flex; align-items: center; gap: 8px; max-width: min(300px, calc(100vw - 24px)); padding: 5px 6px 5px 5px;
  border-radius: 999px; background: rgba(14,17,40,.82); color: #f6f3ea; font: 600 12px/1.2 system-ui, sans-serif;
  box-shadow: 0 8px 24px rgba(0,0,0,.35); cursor: pointer; backdrop-filter: blur(6px); border: 1px solid rgba(255,255,255,.12); }
#music-chip[hidden] { display: none; }
#music-chip img, #music-chip .art { width: 30px; height: 30px; border-radius: 50%; object-fit: cover; background: #2a2f55; flex: none;
  display: grid; place-items: center; color: ${GREEN}; }
#music-chip .t { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; min-width: 0; }
#music-chip .t small { display: block; color: #9da1bd; font-weight: 500; }
#music-chip button { flex: none; width: 30px; height: 30px; border-radius: 50%; border: 0; background: ${GREEN}; color: #0b0f0c; display: grid; place-items: center; cursor: pointer; padding: 0; }
#music-panel { position: fixed; inset: 0; z-index: 30; display: grid; place-items: center; background: rgba(6,8,22,.55); backdrop-filter: blur(3px); }
#music-panel[hidden] { display: none; }
#music-panel .card { width: min(440px, calc(100vw - 24px)); max-height: calc(100vh - 40px); overflow: auto; box-sizing: border-box;
  background: #11143a; color: #f6f3ea; border-radius: 18px; padding: 18px; font: 13px/1.45 system-ui, sans-serif; display: grid; gap: 12px;
  box-shadow: 0 24px 60px rgba(0,0,0,.5); position: relative; }
#music-panel h3 { margin: 0; font: 400 26px/1 'Anton', Impact, sans-serif; letter-spacing: .05em; }
#music-panel .x { position: absolute; top: 12px; right: 12px; width: 34px; height: 34px; border-radius: 50%; border: 0; background: rgba(255,255,255,.1); color: #f6f3ea; font-size: 20px; cursor: pointer; }
#music-panel .connect { border: 0; border-radius: 999px; padding: 13px 18px; background: ${GREEN}; color: #0b0f0c; font: 800 14px system-ui, sans-serif;
  letter-spacing: .02em; cursor: pointer; display: flex; gap: 8px; justify-content: center; align-items: center; }
#music-panel .note { color: #9da1bd; font-size: 12px; }
#music-panel .now { display: grid; grid-template-columns: 64px 1fr; gap: 12px; align-items: center; }
#music-panel .now img, #music-panel .now .art { width: 64px; height: 64px; border-radius: 10px; object-fit: cover; background: #2a2f55; }
#music-panel .now b { display: block; font-size: 15px; }
#music-panel .ctl { display: flex; gap: 10px; justify-content: center; align-items: center; }
#music-panel .ctl button { width: 40px; height: 40px; border-radius: 50%; border: 0; background: rgba(255,255,255,.1); color: #f6f3ea; display: grid; place-items: center; cursor: pointer; }
#music-panel .ctl button.pp { width: 50px; height: 50px; background: ${GREEN}; color: #0b0f0c; }
#music-panel input[type=range] { width: 100%; accent-color: ${GREEN}; }
#music-panel .lists { display: grid; grid-template-columns: repeat(auto-fill, minmax(92px, 1fr)); gap: 10px; }
#music-panel .lists button { border: 0; background: none; color: #f6f3ea; padding: 0; text-align: left; cursor: pointer; font: 600 11px/1.3 system-ui, sans-serif; }
#music-panel .lists img, #music-panel .lists .art { width: 100%; aspect-ratio: 1; border-radius: 8px; object-fit: cover; background: #2a2f55; display: block; margin-bottom: 4px; }
#music-panel .lists span { display: block; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
#music-panel .link { color: #9da1bd; background: none; border: 0; font: 12px system-ui, sans-serif; text-decoration: underline; cursor: pointer; justify-self: start; padding: 0; }
#music-panel .paste { display: flex; gap: 6px; }
#music-panel .paste[hidden] { display: none; }
#music-panel .paste input { flex: 1; border-radius: 9px; border: 0; padding: 9px 11px; font: 13px system-ui, sans-serif; }
#music-panel .paste button { border: 0; border-radius: 9px; padding: 9px 12px; background: ${GREEN}; color: #0b0f0c; font: 700 12px system-ui, sans-serif; cursor: pointer; }
#music-panel .msg { color: #ffb4a8; font-size: 12px; min-height: 1em; }
#music-embed { position: fixed; left: -10000px; top: 0; width: 300px; height: 80px; } /* the embedded player plays out of sight */
#music-embed.show { position: static; width: auto; height: 80px; border-radius: 12px; overflow: hidden; }
body.title #music-chip, body.shot #music-chip { visibility: hidden; }
`;

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const safe = (k) => { try { return window[k]; } catch { return null; } };

/** The music panel and chip. clientId: the Spotify app's (window.BLOX_SITE.spotifyClientId), or '' for links only. */
export function initMusic({ clientId = window.BLOX_SITE?.spotifyClientId || '', audio = () => window.__bloxAudio } = {}) {
  if (typeof document === 'undefined') return null;
  const local = safe('localStorage'), session = safe('sessionStorage');
  document.head.append(Object.assign(document.createElement('style'), { textContent: CSS }));
  const chip = Object.assign(document.createElement('div'), { id: 'music-chip', hidden: true });
  const panel = Object.assign(document.createElement('div'), { id: 'music-panel', hidden: true });
  const embedBox = Object.assign(document.createElement('div'), { id: 'music-embed' });
  document.body.append(chip, panel);
  for (const el of [chip, panel]) for (const e of ['keydown', 'keyup']) el.addEventListener(e, (ev) => { if (ev.key !== 'Escape') ev.stopPropagation(); });

  const st = { tokens: null, sdk: null, device: '', track: null, paused: true, volume: 0.6, lists: null, premium: null, msg: '', pasting: false, embed: null };

  // ---- the embedded player (links, and playlists without Premium)
  let controller = null, apiReady = null;
  function loadEmbedApi() {
    if (apiReady) return apiReady;
    apiReady = new Promise((resolve) => {
      window.onSpotifyIframeApiReady = (api) => resolve(api);
      const s = Object.assign(document.createElement('script'), { src: 'https://open.spotify.com/embed/iframe-api/v1', async: true });
      s.onerror = () => resolve(null);
      document.head.append(s);
    });
    return apiReady;
  }
  async function playEmbed(p, name = '') {
    st.embed = { ...p, name };
    try { local?.setItem(MUSIC_KEY, p.uri); } catch { /* blocked */ }
    const api = await loadEmbedApi();
    if (api && !controller) {
      const el = document.createElement('div'); embedBox.innerHTML = ''; embedBox.append(el);
      api.createController(el, { uri: p.uri, width: '100%', height: 80 }, (c) => {
        controller = c;
        c.addListener('playback_update', (e) => { st.paused = !!e.data.isPaused; audio()?.duck?.(!st.paused); draw(); });
        c.play?.();
      });
    } else if (controller) { controller.loadUri(p.uri); controller.play?.(); }
    else embedBox.innerHTML = `<iframe src="${embedUrl(p)}" width="100%" height="80" frameborder="0" allow="autoplay; encrypted-media" title="Spotify"></iframe>`;
    st.paused = false; draw();
  }

  // ---- Spotify Web API and the Web Playback SDK (Premium)
  async function api(path, opts = {}) {
    st.tokens = await getTokens(clientId, local);
    if (!st.tokens) { st.sdk?.disconnect(); st.sdk = null; draw(); throw new Error('Logged out of Spotify'); }
    const r = await fetch(`https://api.spotify.com/v1${path}`, { ...opts, headers: { Authorization: `Bearer ${st.tokens.access}`, 'Content-Type': 'application/json', ...(opts.headers || {}) } });
    if (r.status === 204) return null;
    if (r.status === 403 && !path.startsWith('/me/player')) throw Object.assign(new Error('not on the list'), { notListed: true }); // development mode: only allowlisted accounts
    const data = await r.json().catch(() => null);
    if (!r.ok) throw new Error(data?.error?.message || `Spotify said ${r.status}`);
    return data;
  }
  async function loadLists() {
    try {
      const d = await api('/me/playlists?limit=24');
      st.lists = (d?.items || []).filter(Boolean).map((p) => ({ uri: p.uri, id: p.id, name: p.name, img: p.images?.[0]?.url || '' }));
      const me = await api('/me');
      st.premium = me?.product === 'premium';
    } catch (e) {
      if (e.notListed) { // the app's development mode lets only the owner's guest list in
        logout(local); st.sdk?.disconnect(); Object.assign(st, { sdk: null, tokens: null, device: '', lists: null, pasting: true });
        st.msg = 'Spotify only lets accounts on this game\'s guest list connect for now. Paste a Spotify link below to play your music anyway.';
      } else st.msg = e.message;
    }
    draw();
  }
  function startSdk() {
    if (st.sdk || !st.tokens) return;
    const go = () => {
      const p = new window.Spotify.Player({ name: 'Maastricht Blox', volume: st.volume,
        getOAuthToken: async (cb) => { const t = await getTokens(clientId, local); if (t) cb(t.access); } });
      p.addListener('ready', ({ device_id: id }) => { st.device = id; draw(); });
      p.addListener('not_ready', () => { st.device = ''; draw(); });
      p.addListener('account_error', () => { st.premium = false; st.msg = 'Playing inside the game needs Spotify Premium: your playlists play in the small Spotify player instead.'; draw(); });
      p.addListener('authentication_error', () => { logout(local); st.tokens = null; st.msg = 'Spotify logged you out: connect again.'; draw(); });
      p.addListener('player_state_changed', (s) => {
        if (!s) return;
        const t = s.track_window?.current_track;
        st.track = t ? { name: t.name, artist: (t.artists || []).map((a) => a.name).join(', '), img: t.album?.images?.[0]?.url || '' } : null;
        st.paused = s.paused; audio()?.duck?.(!s.paused); draw();
      });
      p.connect();
      st.sdk = p;
    };
    if (window.Spotify?.Player) go();
    else {
      window.onSpotifyWebPlaybackSDKReady = go;
      document.head.append(Object.assign(document.createElement('script'), { src: 'https://sdk.scdn.co/spotify-player.js', async: true }));
    }
  }
  async function playList(l) {
    st.msg = '';
    if (st.sdk && st.device && st.premium !== false) {
      try { await api(`/me/player/play?device_id=${st.device}`, { method: 'PUT', body: JSON.stringify({ context_uri: l.uri }) }); st.paused = false; }
      catch (e) { st.msg = e.message; }
      draw();
    } else playEmbed({ type: 'playlist', id: l.id, uri: l.uri }, l.name);
  }
  const usingSdk = () => !!(st.sdk && st.device && st.track && st.premium !== false);
  async function toggle() {
    if (usingSdk()) st.sdk.togglePlay();
    else if (controller) controller.togglePlay();
  }

  // ---- drawing
  function nowPlaying() {
    if (usingSdk()) return st.track;
    if (st.embed) return { name: st.embed.name || 'Spotify', artist: 'in the Spotify player below', img: '' };
    return null;
  }
  function draw() {
    const np = nowPlaying();
    chip.hidden = !np || !panel.hidden;
    if (np) chip.innerHTML = `${np.img ? `<img src="${esc(np.img)}" alt="">` : `<span class="art">${ICON.note}</span>`}
      <span class="t">${esc(np.name)}<small>${esc(np.artist)}</small></span><button class="pp" aria-label="${st.paused ? 'Play' : 'Pause'}">${st.paused ? ICON.play : ICON.pause}</button>`;
    if (panel.hidden) return;
    const connected = !!st.tokens;
    const lists = st.lists?.length ? `<div class="note">Your playlists</div><div class="lists">${st.lists.map((l, i) =>
      `<button data-i="${i}">${l.img ? `<img src="${esc(l.img)}" alt="" loading="lazy">` : '<span class="art"></span>'}<span>${esc(l.name)}</span></button>`).join('')}</div>` : '';
    const now = np ? `<div class="now">${np.img ? `<img src="${esc(np.img)}" alt="">` : `<span class="art"></span>`}<div><b>${esc(np.name)}</b><span class="note">${esc(np.artist)}</span></div></div>
      <div class="ctl">${usingSdk() ? `<button class="prev" aria-label="Previous">${ICON.prev}</button>` : ''}<button class="pp" aria-label="Play or pause">${st.paused ? ICON.play : ICON.pause}</button>${usingSdk() ? `<button class="next" aria-label="Next">${ICON.next}</button>` : ''}</div>
      ${usingSdk() ? `<input type="range" class="vol" min="0" max="1" step="0.05" value="${st.volume}" aria-label="Volume">` : ''}` : '';
    const top = connected ? '' : clientId
      ? `<button class="connect">${ICON.note} Connect Spotify</button><div class="note">Log in once. With Premium your music plays right here in the game; without it, through Spotify's small player.</div>
        <div class="note" style="opacity:.7">Spotify app Redirect URI for this page: <code style="user-select:all">${esc(redirectUri(location))}</code></div>`
      : '<div class="note">Play a Spotify playlist, album or song while you explore.</div>';
    panel.innerHTML = `<div class="card"><button class="x" aria-label="Close">&times;</button><h3>MUSIC</h3>${top}${now}${lists}
      <div id="music-embed-slot"></div>
      <button class="link paste-toggle">${st.pasting ? 'Hide' : 'Play a Spotify link instead'}</button>
      <div class="paste" ${st.pasting ? '' : 'hidden'}><input name="link" placeholder="Paste a Spotify link" autocomplete="off"><button class="go">Play</button></div>
      <div class="msg">${esc(st.msg)}</div>
      ${connected ? '<button class="link out">Disconnect Spotify</button>' : ''}</div>`;
    // the embedded player shows in the panel while it is open (and plays out of sight when not)
    if (st.embed && !usingSdk()) { embedBox.classList.add('show'); panel.querySelector('#music-embed-slot').append(embedBox); }
  }
  function hidePanel() {
    if (embedBox.parentNode !== document.body) { embedBox.classList.remove('show'); document.body.append(embedBox); }
    panel.hidden = true; draw();
  }
  document.body.append(embedBox);

  panel.addEventListener('click', async (e) => {
    const b = e.target.closest('button');
    if (e.target === panel || b?.classList.contains('x')) { hidePanel(); return; }
    if (!b) return;
    if (b.classList.contains('connect')) { st.msg = ''; try { await login(clientId, location, session); } catch (er) { st.msg = er.message; draw(); } }
    else if (b.classList.contains('pp')) toggle();
    else if (b.classList.contains('prev')) st.sdk?.previousTrack();
    else if (b.classList.contains('next')) st.sdk?.nextTrack();
    else if (b.dataset.i) playList(st.lists[+b.dataset.i]);
    else if (b.classList.contains('paste-toggle')) { st.pasting = !st.pasting; draw(); if (st.pasting) panel.querySelector('[name=link]').focus(); }
    else if (b.classList.contains('go')) {
      const p = parseSpotify(panel.querySelector('[name=link]').value);
      if (!p) { st.msg = 'That is not a Spotify link: in Spotify use Share > Copy link.'; draw(); return; }
      st.pasting = false; playEmbed(p);
    } else if (b.classList.contains('out')) { logout(local); st.sdk?.disconnect(); Object.assign(st, { sdk: null, tokens: null, device: '', track: null, lists: null }); audio()?.duck?.(false); draw(); }
  });
  panel.addEventListener('input', (e) => { if (e.target.classList.contains('vol')) { st.volume = +e.target.value; st.sdk?.setVolume(st.volume); } });
  panel.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.name === 'link') panel.querySelector('.paste .go')?.click(); if (e.key === 'Escape') hidePanel(); });
  chip.addEventListener('click', (e) => { if (e.target.closest('.pp')) { toggle(); return; } open(); });

  function open() { panel.hidden = false; window.__bloxPlayer?.input?.releaseLock?.(); draw(); }

  // back from Spotify's login, or logged in before: connect
  (async () => {
    if (!clientId) return;
    try {
      st.tokens = (await finishLogin(clientId, location, session, local)) || (await getTokens(clientId, local));
      if (st.tokens) { startSdk(); loadLists(); if (location.search === '' && document.referrer.includes('accounts.spotify.com')) open(); }
    } catch (e) { st.msg = e.message; open(); }
  })();
  draw();
  return { open, get state() { return st; } };
}
