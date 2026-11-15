// Your own music while you play: paste a Spotify playlist, album, track, artist, show or episode
// link and Spotify's own player sits in a small dock at the bottom left (it keeps playing while
// you walk, drive and shoot). Signed in to Spotify in this browser, it plays whole tracks;
// otherwise Spotify plays previews. The city's own sounds step back while the music plays
// (Spotify's iFrame API tells us play and pause). No account data passes through the game: the
// player is Spotify's, in its own frame. The last link is remembered on this device.
//
// (A full "log in with Spotify" connection, the Web Playback SDK, needs a Spotify Developer app,
// Premium for every listener and Spotify's approval past 25 users: not worth it for this.)

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

const CSS = `
#music-dock { position: fixed; left: calc(12px + env(safe-area-inset-left, 0px)); bottom: calc(74px + env(safe-area-inset-bottom, 0px));
  z-index: 5; width: min(340px, calc(100vw - 24px)); font: 13px/1.4 system-ui, sans-serif; color: #f6f3ea; }
#music-dock .bar { display: flex; gap: 6px; align-items: center; }
#music-dock button { border: 0; border-radius: 9px; padding: 7px 10px; font: 700 12px system-ui, sans-serif; cursor: pointer;
  background: rgba(18,22,30,.78); color: #f6f3ea; }
#music-dock button.go { background: #1ed760; color: #0b0f0c; }
#music-dock .panel { margin-top: 6px; background: #11143a; border-radius: 12px; padding: 10px; display: grid; gap: 8px; box-shadow: 0 14px 40px rgba(0,0,0,.45); }
#music-dock .panel[hidden] { display: none; }
#music-dock input { width: 100%; box-sizing: border-box; border-radius: 9px; border: 0; padding: 8px 10px; font: 13px system-ui, sans-serif; }
#music-dock .note { color: #9da1bd; font-size: 11px; }
#music-dock .player { border-radius: 12px; overflow: hidden; height: 80px; margin-top: 6px; }
#music-dock .player.min { height: 0; margin: 0; } /* still playing, out of the way */
body.title #music-dock, body.shot #music-dock { visibility: hidden; }
`;

/** The dock. audio: window.__bloxAudio (for ducking). store: localStorage (or null). */
export function initMusic({ store = safeLocal(), audio = () => window.__bloxAudio } = {}) {
  if (typeof document === 'undefined') return null;
  const style = document.createElement('style'); style.textContent = CSS; document.head.append(style);
  const dock = document.createElement('div');
  dock.id = 'music-dock';
  dock.innerHTML = `<div class="bar"><button class="toggle" title="Your music (Spotify)">♫ Music</button><button class="mini" hidden>▾</button></div>
    <div class="panel" hidden>
      <b>Play your Spotify while you play</b>
      <input name="link" placeholder="Paste a Spotify playlist, album or track link" autocomplete="off">
      <div class="bar"><button class="go play">Play</button><button class="close">Close</button></div>
      <div class="note">Signed in to Spotify in this browser: whole songs. Otherwise previews. The city's sounds step back while it plays.</div>
      <div class="msg note"></div>
    </div>
    <div class="player min"></div>`;
  document.body.append(dock);
  for (const e of ['keydown', 'keyup']) dock.addEventListener(e, (ev) => ev.stopPropagation()); // typing must not walk
  const $ = (s) => dock.querySelector(s);
  const panel = $('.panel'), input = $('[name=link]'), player = $('.player'), mini = $('.mini');
  let saved = '';
  try { saved = store?.getItem(MUSIC_KEY) || ''; } catch { /* blocked */ }
  input.value = saved;
  let controller = null, apiReady = null;

  const show = (on) => { panel.hidden = !on; if (on) { window.__bloxPlayer?.input?.releaseLock?.(); input.focus(); } };
  $('.toggle').onclick = () => show(panel.hidden);
  $('.close').onclick = () => show(false);
  mini.onclick = () => { player.classList.toggle('min'); mini.textContent = player.classList.contains('min') ? '▴' : '▾'; };

  // Spotify's iFrame API: one controller; play/pause events duck the city
  function loadApi() {
    if (apiReady) return apiReady;
    apiReady = new Promise((resolve) => {
      window.onSpotifyIframeApiReady = (IFrameAPI) => resolve(IFrameAPI);
      const s = document.createElement('script');
      s.src = 'https://open.spotify.com/embed/iframe-api/v1'; s.async = true;
      s.onerror = () => resolve(null);
      document.head.append(s);
    });
    return apiReady;
  }

  async function play() {
    const p = parseSpotify(input.value);
    if (!p) { $('.msg').textContent = 'That is not a Spotify link. Copy it from Share > Copy link.'; return; }
    $('.msg').textContent = '';
    try { store?.setItem(MUSIC_KEY, input.value.trim()); } catch { /* blocked */ }
    player.classList.remove('min'); mini.hidden = false; mini.textContent = '▾';
    show(false);
    const api = await loadApi();
    if (api && !controller) {
      const el = document.createElement('div'); player.innerHTML = ''; player.append(el);
      api.createController(el, { uri: p.uri, width: '100%', height: 80 }, (c) => {
        controller = c;
        c.addListener('playback_update', (e) => audio()?.duck?.(!e.data.isPaused));
        c.play?.();
      });
    } else if (controller) { controller.loadUri(p.uri); controller.play?.(); }
    else player.innerHTML = `<iframe src="${embedUrl(p)}" width="100%" height="80" frameborder="0" allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture" loading="lazy" title="Spotify"></iframe>`;
  }
  $('.play').onclick = play;
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') play(); });
  return { open: () => show(true) };
}

function safeLocal() { try { return typeof localStorage !== 'undefined' ? localStorage : null; } catch { return null; } }
