// "Report a mistake" button and dialog (docs/guide/06-viewer.md, "Reporting mistakes").
// The player describes the problem, optionally keeps a screenshot of the current view (on by
// default) and adds a photo of their own. With the relay (window.BLOX_SITE.relay, relay/README.md)
// the report becomes a GitHub issue without the reporter needing an account. Without a relay, or
// when it has no GITHUB_TOKEN (501) or can't be reached, a pre-filled GitHub issue opens and the
// screenshot downloads to attach by hand.
import { buildReport, issueUrl, CATEGORIES } from './report.js';
import { streetFinder } from '../player/streets.js';

const MAX_W = 1280, JPEG_Q = 0.8, MAX_PHOTO_BYTES = 6e6;

const CSS = `
#rp-open { position: fixed; right: 14px; bottom: 92px; z-index: 5; width: 44px; height: 44px; border-radius: 50%;
  background: rgba(18,22,30,.72); border: 1px solid rgba(255,255,255,.25); color: #f6f3ea; cursor: pointer;
  display: grid; place-items: center; padding: 0; }
#rp-open:hover { border-color: #F2A900; color: #F2A900; }
#rp-dlg { position: fixed; inset: 0; z-index: 12; display: grid; place-items: center; background: rgba(4,5,16,.55); }
#rp-dlg[hidden] { display: none; }
#rp-dlg form { width: min(460px, calc(100vw - 28px)); max-height: calc(100vh - 28px); overflow: auto; box-sizing: border-box;
  background: #11143a; color: #f6f3ea; border-radius: 14px; padding: 16px 18px; font: 13px/1.4 system-ui, sans-serif;
  box-shadow: 0 20px 50px rgba(0,0,0,.5); display: grid; gap: 10px; }
#rp-dlg h3 { margin: 0; font: 400 22px/1 'Anton', Impact, sans-serif; letter-spacing: .06em; }
#rp-dlg .where { color: #b9bcc4; font-size: 12px; }
#rp-dlg select, #rp-dlg textarea { width: 100%; box-sizing: border-box; border-radius: 9px; border: 0; padding: 9px 11px;
  background: rgba(255,255,255,.1); color: #fff; font: 14px system-ui, sans-serif; }
#rp-dlg select option { color: #111; }
#rp-dlg textarea { min-height: 96px; resize: vertical; }
#rp-dlg label.chk { display: flex; align-items: center; gap: 8px; }
#rp-dlg img.prev { width: 100%; border-radius: 8px; display: block; }
#rp-dlg .row { display: flex; gap: 8px; justify-content: flex-end; flex-wrap: wrap; }
#rp-dlg button { border: 0; border-radius: 9px; padding: 9px 14px; font: 700 13px system-ui, sans-serif; cursor: pointer; }
#rp-dlg button.go { background: #F2A900; color: #10153a; }
#rp-dlg button.no { background: rgba(255,255,255,.1); color: #fff; }
#rp-dlg .note { color: #8d91ad; font-size: 11px; }
#rp-dlg .msg { font-weight: 600; }
body.title #rp-open, body.riding #rp-open, body.shot #rp-open { display: none; }
`;
const FLAG = '<svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M5 3h1v18H5V3Zm2 1h11l-2.5 4L18 12H7V4Z"/></svg>';
const el = (tag, props = {}, html = '') => Object.assign(document.createElement(tag), props, html ? { innerHTML: html } : {});

/** A JPEG data URL of the canvas as drawn now, at most MAX_W wide. render(): draws one frame. */
function snapshot(canvas, render) {
  render();
  const s = Math.min(1, MAX_W / canvas.width);
  const c = Object.assign(document.createElement('canvas'), { width: Math.round(canvas.width * s), height: Math.round(canvas.height * s) });
  c.getContext('2d').drawImage(canvas, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', JPEG_Q);
}

/** A photo file -> JPEG data URL, at most MAX_W wide (phone photos are 4000 px and several MB). */
function photoData(file) {
  return new Promise((ok, fail) => {
    if (!file) return ok(null);
    if (file.size > MAX_PHOTO_BYTES * 4) return fail(new Error('That photo is too big.'));
    const img = new Image();
    img.onload = () => {
      const s = Math.min(1, MAX_W / img.width);
      const c = Object.assign(document.createElement('canvas'), { width: Math.round(img.width * s), height: Math.round(img.height * s) });
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(img.src);
      ok(c.toDataURL('image/jpeg', JPEG_Q));
    };
    img.onerror = () => fail(new Error('That file is not an image.'));
    img.src = URL.createObjectURL(file);
  });
}

export async function initReport(ctx) {
  if (ctx.still || typeof document === 'undefined') return null;
  const { stage, controls } = ctx;
  const camera = ctx.camera || stage.camera;
  const canvas = stage.renderer.domElement;
  const site = window.BLOX_SITE || {};
  const relay = (site.relay || '').replace(/\/$/, '');
  const streetAt = ctx.features ? streetFinder(ctx.features.values()) : () => '';
  document.head.append(el('style', { textContent: CSS }));
  const open = el('button', { id: 'rp-open', title: 'Report a mistake on the map' }, FLAG);
  const dlg = el('div', { id: 'rp-dlg', hidden: true });
  dlg.innerHTML = `<form>
    <h3>REPORT A MISTAKE</h3><div class="where"></div>
    <select name="cat">${CATEGORIES.map(([k, t]) => `<option value="${k}">${t}</option>`).join('')}</select>
    <textarea name="text" placeholder="What is wrong here? e.g. the bus platforms at the station are missing" required></textarea>
    <label class="chk"><input type="checkbox" name="shot" checked> Include a screenshot of this view</label>
    <img class="prev" alt="Screenshot of the current view">
    <label class="chk">Add your own photo (optional): <input type="file" name="photo" accept="image/*"></label>
    <div class="msg"></div>
    <div class="row"><button type="button" class="no">Cancel</button><button type="submit" class="go">Send report</button></div>
    <div class="note">Reports are public on GitHub so they can be fixed. Don't include faces or personal details in photos.</div>
  </form>`;
  document.body.append(open, dlg);
  const form = dlg.querySelector('form'), prev = dlg.querySelector('img.prev'), msg = dlg.querySelector('.msg');
  let where = null, shot = null;
  for (const e of ['keydown', 'keyup']) form.addEventListener(e, (ev) => ev.stopPropagation()); // typing must not walk

  function locate() {
    const p = window.__bloxPlayer?.state?.();
    const walking = p?.mode === 'walk';
    const x = walking ? p.pos[0] : controls.target.x, z = walking ? -p.pos[2] : -controls.target.z;
    const studM = 0.5;
    return { x, z, mode: walking ? 'walk' : 'map', yaw: walking ? (p.yaw * 180) / Math.PI : 0,
      dist: camera.position.distanceTo(controls.target), street: (walking && p.street) || streetAt(Math.floor(x / studM), Math.floor(z / studM)),
      originRD: site.originRD || ctx.originRD || null, studM };
  }

  open.addEventListener('click', () => {
    where = locate();
    shot = snapshot(canvas, () => stage.render(controls.target));
    prev.src = shot;
    prev.hidden = !form.shot.checked;
    dlg.querySelector('.where').textContent = `Near ${where.street || 'here'}: the spot and a link to it are added for you.`;
    msg.textContent = '';
    window.__bloxPlayer?.input?.releaseLock?.();
    dlg.hidden = false;
    form.text.focus();
  });
  form.shot.addEventListener('change', () => { prev.hidden = !form.shot.checked; });
  dlg.querySelector('button.no').addEventListener('click', () => { dlg.hidden = true; });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const go = form.querySelector('button.go');
    go.disabled = true;
    msg.textContent = 'Sending…';
    try {
      const photo = await photoData(form.photo.files?.[0]);
      const pics = { screenshot: form.shot.checked ? shot : null, photo };
      const base = { text: form.text.value, category: form.cat.value, where, build: site.build || '', ua: navigator.userAgent };
      // a relay without the GITHUB_TOKEN secret answers 501, and some networks block workers.dev:
      // then GitHub's own form, as without a relay
      const r = relay ? await fetch(`${relay}/report`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...buildReport(base), images: pics }) }).catch(() => null) : null;
      if (r && r.status !== 501) {
        const out = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(out.error || `The report server said ${r.status}.`);
        msg.innerHTML = `Thanks! Your report is <a href="${out.url}" target="_blank" rel="noopener" style="color:#F2A900">issue #${out.number}</a>.`;
      } else { // no relay (or no reports on it): GitHub's own form; images are attached by hand
        for (const [name, data] of Object.entries(pics)) {
          if (data) Object.assign(document.createElement('a'), { href: data, download: `maastricht-blox-${name}.jpg` }).click();
        }
        window.open(issueUrl(buildReport({ ...base, screenshot: pics.screenshot ? '_(attach the downloaded screenshot here)_' : null,
          photo: pics.photo ? '_(attach the downloaded photo here)_' : null })), '_blank', 'noopener');
        msg.textContent = 'GitHub opened in a new tab: drag the downloaded image(s) into the issue, then submit it.';
      }
      form.text.value = ''; form.photo.value = '';
      setTimeout(() => { dlg.hidden = true; }, 4000);
    } catch (err) {
      msg.textContent = `Could not send: ${err.message}`;
    } finally {
      go.disabled = false;
    }
  });
  return null; // nothing to do per frame
}
