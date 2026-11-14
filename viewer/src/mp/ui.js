// Multiplayer screens: the round Play button on the right edge, the lobby panel beside it
// (nickname, create a room or join one by its code, the two teams, Start for the host), and in a
// match the score and clock pill at the top centre, toasts under it and the boundary warning.
// Tap or click only (no new keys); hidden on the title screen. Typing never walks the player.
import { TEAM_HEX, TEAM_NAMES, clock } from './model.js';
import { cleanNick, parseCode } from './protocol.js';
import { heatProject } from './weapons.js';

const CSS = `
#mp-open { position: fixed; right: calc(14px + env(safe-area-inset-right, 0px)); bottom: calc(196px + env(safe-area-inset-bottom, 0px));
  z-index: 5; width: 44px; height: 44px; border-radius: 50%; padding: 0; cursor: pointer;
  background: rgba(18,22,30,.72); border: 1px solid rgba(255,255,255,.25); color: #f6f3ea;
  font: 400 12px/1 'Anton', Impact, sans-serif; letter-spacing: .06em; }
#mp-open:hover, #mp-open.on { border-color: #F2A900; color: #F2A900; }
#mp-open.soon { opacity: .6; }
#mp-open .dot { position: absolute; top: 3px; right: 3px; width: 9px; height: 9px; border-radius: 50%; background: #3fbf6f; display: none; }
#mp-open.in .dot { display: block; }
#mp-panel { position: fixed; right: calc(70px + env(safe-area-inset-right, 0px)); bottom: calc(110px + env(safe-area-inset-bottom, 0px));
  z-index: 6; width: min(320px, calc(100vw - 98px)); max-height: calc(100vh - 140px - env(safe-area-inset-top, 0px) - env(safe-area-inset-bottom, 0px));
  overflow: auto; box-sizing: border-box; background: #11143a; color: #f6f3ea; border-radius: 14px; padding: 14px 16px;
  font: 13px/1.4 system-ui, sans-serif; box-shadow: 0 20px 50px rgba(0,0,0,.5); display: grid; gap: 10px; }
#mp-panel[hidden] { display: none; }
#mp-panel h3 { margin: 0; font: 400 22px/1 'Anton', Impact, sans-serif; letter-spacing: .06em; }
#mp-panel .rules { color: #b9bcc4; font-size: 12px; margin: 0; }
#mp-panel input { width: 100%; box-sizing: border-box; border-radius: 9px; border: 0; padding: 9px 11px;
  background: rgba(255,255,255,.1); color: #fff; font: 14px system-ui, sans-serif; }
#mp-panel input.code { text-transform: uppercase; letter-spacing: .3em; font-weight: 700; }
#mp-panel .row { display: flex; gap: 8px; align-items: center; }
#mp-panel .row > * { flex: 1; }
#mp-panel button { border: 0; border-radius: 9px; padding: 9px 12px; font: 700 13px system-ui, sans-serif; cursor: pointer;
  background: rgba(255,255,255,.1); color: #fff; }
#mp-panel button.go { background: #F2A900; color: #10153a; }
#mp-panel button:disabled { opacity: .45; cursor: default; }
#mp-panel .code-big { font: 400 34px/1 'Anton', Impact, sans-serif; letter-spacing: .25em; text-align: center; }
#mp-panel .teams { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
#mp-panel .team { border-radius: 9px; padding: 8px; background: rgba(255,255,255,.05); border-top: 4px solid; min-height: 60px; }
#mp-panel .team b { display: block; font-size: 11px; letter-spacing: .12em; text-transform: uppercase; margin-bottom: 4px; }
#mp-panel .team div { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
#mp-panel .team .you { font-weight: 700; }
#mp-panel .team .off { opacity: .45; }
#mp-panel .msg { font-weight: 600; min-height: 1em; }
#mp-panel .note { color: #8d91ad; font-size: 11px; }
#mp-pill { position: fixed; top: calc(14px + env(safe-area-inset-top, 0px)); left: 50%; transform: translateX(-50%); z-index: 5;
  display: flex; align-items: center; gap: 10px; padding: 6px 14px; border-radius: 999px; background: rgba(18,22,30,.8);
  color: #fff; font: 400 18px/1 'Anton', Impact, sans-serif; letter-spacing: .06em; pointer-events: none; white-space: nowrap; }
#mp-pill[hidden] { display: none; }
#mp-pill .sc { display: inline-grid; place-items: center; min-width: 30px; height: 26px; border-radius: 7px; color: #10153a; }
#mp-pill .t { font: 600 14px system-ui, sans-serif; letter-spacing: 0; min-width: 40px; text-align: center; }
#mp-pill .me { width: 9px; height: 9px; border-radius: 50%; }
#mp-toast { position: fixed; top: calc(60px + env(safe-area-inset-top, 0px)); left: 50%; transform: translateX(-50%); z-index: 5;
  padding: 7px 14px; border-radius: 10px; background: rgba(18,22,30,.82); color: #fff; font: 600 14px system-ui, sans-serif;
  pointer-events: none; max-width: calc(100vw - 40px); text-align: center; transition: opacity .3s; }
#mp-toast.big { font: 400 24px/1.1 'Anton', Impact, sans-serif; letter-spacing: .05em; padding: 10px 18px; }
#mp-toast.gone { opacity: 0; }
#mp-warn { position: fixed; left: 50%; top: 34%; transform: translate(-50%, -50%); z-index: 5; pointer-events: none; text-align: center;
  padding: 12px 20px; border-radius: 12px; background: rgba(160,28,40,.85); color: #fff; font: 400 22px/1.2 'Anton', Impact, sans-serif; letter-spacing: .05em; }
#mp-warn small { display: block; font: 600 13px system-ui, sans-serif; letter-spacing: 0; }
#mp-warn[hidden] { display: none; }
#mp-names { position: fixed; inset: 0; pointer-events: none; z-index: 4; overflow: hidden; }
#mp-names .mp-name { position: absolute; left: 0; top: 0; padding: 2px 7px; border-radius: 7px; background: rgba(18,22,30,.7);
  color: #fff; font: 600 12px system-ui, sans-serif; border-bottom: 3px solid; white-space: nowrap; will-change: transform; }
body.mp-match #pl-street { visibility: hidden; }
/* in a match only the fight's own HUD: no brick info, no side buttons or footer under the fire buttons
   (the room panel stays reachable from the pause menu: Multiplayer) */
body.mp-match #info, body.mp-match #foot, body.mp-match #rd-open, body.mp-match #ex-open, body.mp-match #rp-open,
body.mp-match #mp-open, body.mp-match #pl-bar { display: none !important; }
@media (max-width: 560px) { /* narrow phones: below the title box and the Map button, not on them */
  #mp-pill { top: calc(62px + env(safe-area-inset-top, 0px)); }
  #mp-toast { top: calc(104px + env(safe-area-inset-top, 0px)); }
}
body.title #mp-open, body.title #mp-panel, body.title #mp-pill, body.title #mp-toast, body.title #mp-warn, body.title #mp-names,
body.shot #mp-open, body.shot #mp-panel { visibility: hidden; }
`;

const el = (tag, props = {}, html = '') => Object.assign(document.createElement(tag), props, html ? { innerHTML: html } : {});
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** The after-match heat map: knock-outs as glowing blobs between the two bases (north up). */
function drawHeat(canvas, kills, cfg) {
  const g = canvas.getContext('2d'), n = canvas.width, at = heatProject(cfg.bases, cfg.arenaR || 120, n);
  g.fillStyle = '#0b0d2a'; g.fillRect(0, 0, n, n);
  g.globalCompositeOperation = 'lighter';
  for (const k of kills) {
    const [x, y] = at(k.at), r = n * 0.09, grad = g.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, 'rgba(255,190,60,.75)'); grad.addColorStop(0.4, 'rgba(255,80,30,.35)'); grad.addColorStop(1, 'rgba(255,0,0,0)');
    g.fillStyle = grad; g.fillRect(x - r, y - r, 2 * r, 2 * r);
  }
  g.globalCompositeOperation = 'source-over';
  for (const t of ['blue', 'yellow']) {
    const [x, y] = at(cfg.bases[t].at);
    g.fillStyle = TEAM_HEX[t]; g.beginPath(); g.arc(x, y, 6, 0, 7); g.fill();
    g.fillStyle = '#f6f3ea'; g.font = '10px system-ui'; g.textAlign = 'center'; g.fillText(cfg.bases[t].name, Math.max(40, Math.min(n - 40, x)), y > n - 24 ? y - 10 : y + 18);
  }
}

export class MpUi {
  /** on: { open(), create(nick), join(nick, code), start(), leave() }. */
  constructor(on, { nick = '', code = '' } = {}) {
    this.on = on;
    document.head.append(el('style', { textContent: CSS }));
    this.btn = el('button', { id: 'mp-open', title: 'Play capture the flag with friends' }, 'PLAY<span class="dot"></span>');
    this.panel = el('div', { id: 'mp-panel', hidden: true });
    this.pillEl = el('div', { id: 'mp-pill', hidden: true });
    this.toastEl = el('div', { id: 'mp-toast', className: 'gone' });
    this.warnEl = el('div', { id: 'mp-warn', hidden: true });
    document.body.append(this.btn, this.panel, this.pillEl, this.toastEl, this.warnEl);
    for (const e of ['keydown', 'keyup']) this.panel.addEventListener(e, (ev) => ev.stopPropagation()); // typing must not walk
    this.btn.addEventListener('click', () => { this.show(this.panel.hidden); if (!this.panel.hidden) on.open(); });
    this.nick = nick; this.code = code; this.view = 'start'; this.availability = 'unknown';
    this.toastT = 0;
  }

  show(on) {
    this.panel.hidden = !on;
    this.btn.classList.toggle('on', on);
    if (on) window.__bloxPlayer?.input?.releaseLock?.();
  }

  /** 'ok' | 'soon' | 'offline' (net.js probe). */
  setAvailability(a) {
    this.availability = a;
    this.btn.classList.toggle('soon', a !== 'ok');
    this.btn.title = a === 'ok' ? 'Play capture the flag with friends' : a === 'soon' ? 'Multiplayer coming soon' : 'Multiplayer is offline right now';
    if (this.view !== 'room') this.renderStart();
  }

  renderStart(msg = '') {
    this.view = 'start';
    this.btn.classList.remove('in');
    if (this.availability !== 'ok') {
      const soon = this.availability === 'soon' || this.availability === 'unknown';
      this.panel.innerHTML = `<h3>CAPTURE THE FLAG</h3>
        <p class="rules">${soon ? 'Multiplayer coming soon: race your friends from the Markt to the Vrijthof and back.' : 'The game server cannot be reached right now. Try again in a minute.'}</p>`;
      return;
    }
    this.panel.innerHTML = `<h3>CAPTURE THE FLAG</h3>
      <p class="rules">Two teams, 2 to 8 players. Blue defends the Markt, yellow the Vrijthof. Walk onto the other
      team's flag, carry it to your base while your own flag is home. Run into a carrier to knock them down.
      First to 3, or most in 8 minutes.</p>
      <input name="nick" maxlength="12" placeholder="Your nickname" autocomplete="nickname" value="${esc(this.nick)}">
      <button class="go create">Create a room</button>
      <div class="row"><input name="code" class="code" maxlength="4" placeholder="CODE" autocomplete="off" value="${esc(this.code)}"><button class="join">Join</button></div>
      <div class="msg">${esc(msg)}</div>`;
    const nick = this.panel.querySelector('[name=nick]'), code = this.panel.querySelector('[name=code]');
    const name = () => { this.nick = cleanNick(nick.value); return this.nick; };
    const need = () => { if (name()) return true; this.message('Choose a nickname first'); nick.focus(); return false; };
    this.panel.querySelector('.create').onclick = () => { if (need()) this.on.create(this.nick); };
    const join = () => {
      if (!need()) return;
      const c = parseCode(code.value);
      if (!c) { this.message('A room code is 4 letters'); code.focus(); return; }
      this.code = c;
      this.on.join(this.nick, c);
    };
    this.panel.querySelector('.join').onclick = join;
    code.addEventListener('keydown', (e) => { if (e.key === 'Enter') join(); });
  }

  message(text) { const m = this.panel.querySelector('.msg'); if (m) m.textContent = text; }

  /** The lobby / match panel for a room (model.js). status: connection status line. */
  renderRoom(model, status = '') {
    this.view = 'room';
    this.btn.classList.add('in');
    const room = model.room;
    if (!room) { this.panel.innerHTML = `<h3>JOINING...</h3><div class="msg">${esc(status)}</div>`; return; }
    const cfg = model.config || {};
    const teams = ['blue', 'yellow'].map((t) => {
      const names = room.players.filter((p) => p.team === t).map((p) =>
        `<div class="${p.id === model.me ? 'you' : ''} ${p.on ? '' : 'off'}">${p.id === room.host ? '★ ' : ''}${esc(p.name)}${p.caps ? ` ⚑${p.caps}` : ''}${p.kills || p.deaths ? ` <small>${p.kills || 0}/${p.deaths || 0}</small>` : ''}</div>`).join('');
      return `<div class="team" style="border-color:${TEAM_HEX[t]}"><b>${TEAM_NAMES[t]} · ${esc(cfg.bases?.[t]?.name || '')}</b>${names || '<div class="off">nobody yet</div>'}</div>`;
    }).join('');
    const n = room.players.filter((p) => p.on).length, min = cfg.minPlayers || 2;
    let action = '';
    if (room.phase === 'play') action = '<div class="note">Match on: see the score at the top.</div>';
    else if (model.isHost) action = `<button class="go start" ${n < min ? 'disabled' : ''}>${room.phase === 'over' ? 'Play again' : 'Start the match'}</button>
      ${n < min ? `<div class="note">Waiting for at least ${min} players: send them the code.</div>` : ''}`;
    else action = '<div class="note">Waiting for the host to start.</div>';
    const over = room.phase === 'over' && room.winner
      ? `<div class="msg">${room.winner === 'draw' ? 'A draw!' : room.winner === model.team ? 'Your team won!' : `${TEAM_NAMES[room.winner]} won`} ${room.score.blue}-${room.score.yellow}</div>${model.kills?.length ? '<canvas class="heat" width="220" height="220" style="display:block;margin:8px auto;border-radius:10px"></canvas><div class="note">Where the knock-outs happened</div>' : ''}` : '';
    this.panel.innerHTML = `<h3>ROOM</h3><div class="code-big">${esc(room.code)}</div>
      <div class="note">Friends join with this code (Play, then Join). You are on <b style="color:${TEAM_HEX[model.team] || '#fff'}">${TEAM_NAMES[model.team] || '...'}</b>.</div>
      <div class="teams">${teams}</div>${over}${action}
      <div class="msg">${esc(status)}</div>
      <button class="leave">Leave the room</button>`;
    const heat = this.panel.querySelector('.heat');
    if (heat && cfg.bases) drawHeat(heat, model.kills, cfg);
    this.panel.querySelector('.start')?.addEventListener('click', () => this.on.start());
    this.panel.querySelector('.leave').addEventListener('click', () => this.on.leave());
  }

  /** The top pill: blue score, clock, yellow score; null model hides it. */
  pill(model, now) {
    const on = !!model && model.phase === 'play';
    this.pillEl.hidden = !on;
    document.body.classList.toggle('mp-match', on);
    if (!on) return;
    const s = model.room.score;
    const mine = model.carrying(model.me) ? ' ⚑' : '';
    const html = `<span class="me" style="background:${TEAM_HEX[model.team]}"></span>
      <span class="sc" style="background:${TEAM_HEX.blue}">${s.blue}</span><span class="t">${clock(model.timeLeft(now))}${mine}</span>
      <span class="sc" style="background:${TEAM_HEX.yellow}">${s.yellow}</span>`;
    if (html !== this.lastPill) { this.pillEl.innerHTML = html; this.lastPill = html; }
  }

  toast(text, big = false) {
    this.toastEl.textContent = text;
    this.toastEl.classList.toggle('big', big);
    this.toastEl.classList.remove('gone');
    clearTimeout(this.toastT);
    this.toastT = setTimeout(() => this.toastEl.classList.add('gone'), big ? 3500 : 2600);
  }

  /** The boundary warning: seconds left, or null to hide. */
  warn(seconds, base) {
    this.warnEl.hidden = seconds === null;
    if (seconds !== null) this.warnEl.innerHTML = `BACK TO THE OLD TOWN! ${seconds}<small>or you go back to the ${esc(base)}</small>`;
  }
}
