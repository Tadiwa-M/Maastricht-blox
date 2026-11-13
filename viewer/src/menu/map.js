// The full-screen 2D map of the pause menu: built city, river, streets and walkways, landmarks,
// bus stops, you (position and heading). Pan and zoom by mouse (drag, wheel) and touch (drag,
// pinch); a tap on a stop, a landmark or a street inside the built city offers fast travel there.
// Drawn only when something changed (not every frame).
import { MapView, isTap } from './view.js';
import { tilesIn, pickMarker, labelLevel } from './mapdata.js';

const TILE_M = 256;
const COL = { bg: '#10143a', built: '#1d2458', street: 'rgba(222,224,240,.62)', river: '#3567d6', stop: '#F2A900',
  mark: '#EF3340', found: '#ffcf5a', me: '#ffffff', text: '#f6f3ea' };

export class MapScreen {
  /** page: the map page element; onTravel(target) when a place is confirmed; canTravel() -> '' or why not. */
  constructor(page, { onTravel, canTravel = () => '' } = {}) {
    this.page = page; this.onTravel = onTravel; this.canTravel = canTravel;
    this.canvas = page.querySelector('canvas');
    this.ctx = this.canvas.getContext('2d');
    this.sheet = page.querySelector('.bx-sheet');
    this.view = new MapView({ scale: 0.5, min: 0.05, max: 8 });
    this.data = { tiles: new Map(), grid: null, stops: [], landmarks: [], river: null, built: null, inside: () => true };
    this.me = null; this.pick = null; this.dirty = false; this.placed = false;
    this.bindGestures();
    page.querySelector('.zin').onclick = () => this.zoomBy(1.6);
    page.querySelector('.zout').onclick = () => this.zoomBy(1 / 1.6);
    page.querySelector('.me').onclick = () => { if (this.me) { this.view.centre(this.me.x, this.me.z); this.redraw(); } };
    this.sheet.querySelector('.no').onclick = () => this.choose(null);
    this.sheet.querySelector('.go').onclick = () => { const p = this.pick; if (p && !this.canTravel()) { this.choose(null); this.onTravel?.(p); } };
  }

  setData(d) { Object.assign(this.data, d); this.redraw(); }

  /** Shown: size the canvas, centre on you the first time. me: { x, z, yaw } Unity metres, compass radians. */
  open(me) {
    this.me = me;
    this.resize();
    if (!this.placed && me) { this.view.centre(me.x, me.z); this.view.scale = 0.7; this.placed = true; }
    this.choose(null);
    this.redraw();
  }

  setMe(me) {
    const o = this.me;
    if (o && me && Math.abs(o.x - me.x) < 0.2 && Math.abs(o.z - me.z) < 0.2 && Math.abs((o.yaw || 0) - (me.yaw || 0)) < 0.01) return;
    this.me = me; this.redraw();
  }

  resize() {
    const r = this.page.getBoundingClientRect(), dpr = Math.min(2, window.devicePixelRatio || 1);
    this.view.resize(r.width, r.height);
    this.canvas.width = Math.round(r.width * dpr); this.canvas.height = Math.round(r.height * dpr);
    this.dpr = dpr; this.redraw();
  }

  zoomBy(f) { this.view.zoomAt(this.view.w / 2, this.view.h / 2, f); this.redraw(); }

  redraw() {
    if (this.dirty) return;
    this.dirty = true;
    requestAnimationFrame(() => { this.dirty = false; if (!this.page.hidden) this.draw(); });
  }

  // ---- input ----------------------------------------------------------------------------
  bindGestures() {
    const c = this.canvas, pts = new Map();
    let down = null, multi = false;
    const local = (e) => { const r = c.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
    c.addEventListener('pointerdown', (e) => {
      c.setPointerCapture?.(e.pointerId);
      pts.set(e.pointerId, local(e));
      if (pts.size === 1) { const [x, y] = local(e); down = { x, y, t: performance.now() }; multi = false; } else multi = true;
      c.classList.add('drag');
    });
    c.addEventListener('pointermove', (e) => {
      if (!pts.has(e.pointerId)) return;
      const prev = pts.get(e.pointerId), now = local(e);
      if (pts.size === 1) this.view.pan(now[0] - prev[0], now[1] - prev[1]);
      else if (pts.size === 2) {
        const [ida, idb] = [...pts.keys()], other = pts.get(ida === e.pointerId ? idb : ida);
        this.view.pinch(prev, other, now, other);
      }
      pts.set(e.pointerId, now);
      this.redraw();
    });
    const up = (e) => {
      if (!pts.has(e.pointerId)) return;
      const [x, y] = local(e);
      pts.delete(e.pointerId);
      if (!pts.size) c.classList.remove('drag');
      if (!pts.size && down && !multi && e.type === 'pointerup' && isTap(down, { x, y, t: performance.now() })) this.tap(x, y);
      if (!pts.size) down = null;
    };
    c.addEventListener('pointerup', up);
    c.addEventListener('pointercancel', up);
    c.addEventListener('wheel', (e) => {
      e.preventDefault();
      const [x, y] = local(e);
      this.view.zoomAt(x, y, Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0015)));
      this.redraw();
    }, { passive: false });
    c.addEventListener('dblclick', (e) => { const [x, y] = local(e); this.view.zoomAt(x, y, 2); this.redraw(); });
  }

  /** A tap: a marker, else the nearest street point inside the built city. */
  tap(sx, sy) {
    const d = this.data;
    const hit = pickMarker([...d.landmarks, ...d.stops], sx, sy, this.view, 22);
    if (hit) return this.choose({ ...hit });
    const [x, z] = this.view.toWorld(sx, sy);
    if (!d.inside(x, z)) return this.choose({ kind: 'none', name: 'Outside the built city', x, z });
    const s = d.grid?.nearest(x, z, Math.max(12, 28 / this.view.scale));
    if (!s) return this.choose({ kind: 'none', name: 'No street just there', x, z });
    return this.choose({ kind: 'street', name: 'This street', x: s.x, z: s.z });
  }

  /** Show (or hide, null) the travel sheet for a picked place. */
  choose(p) {
    this.pick = p && p.kind !== 'none' ? p : null;
    const sh = this.sheet;
    sh.hidden = !p;
    if (p) {
      const why = this.canTravel();
      const sub = p.kind === 'none' ? 'Tap a street, a stop or a landmark' : why || (p.kind === 'stop' ? 'Bus stop' : p.kind === 'landmark' ? 'Landmark' : 'Street');
      sh.querySelector('.t').innerHTML = `<b></b><small></small>`;
      sh.querySelector('.t b').textContent = p.name;
      sh.querySelector('.t small').textContent = sub;
      sh.querySelector('.go').hidden = !this.pick || !!why;
    }
    this.redraw();
  }

  // ---- drawing --------------------------------------------------------------------------
  draw() {
    const { ctx, view: v, data: d } = this, dpr = this.dpr || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = COL.bg; ctx.fillRect(0, 0, v.w, v.h);
    // the built city: one pixel per chunk, scaled up without smoothing
    if (d.built) {
      const b = d.built, [x0, y0] = v.toScreen(b.x0, b.z0 + b.rows * b.cm);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(b.canvas, x0, y0, b.cols * b.cm * v.scale, b.rows * b.cm * v.scale);
      ctx.imageSmoothingEnabled = true;
    }
    if (d.river?.path?.length >= 4) {
      const p = d.river.path;
      ctx.beginPath();
      for (let q = 0; q + 1 < p.length; q += 2) { const [x, y] = v.toScreen(p[q], p[q + 1]); if (q) ctx.lineTo(x, y); else ctx.moveTo(x, y); }
      ctx.strokeStyle = COL.river; ctx.lineWidth = Math.max(4, (d.river.widthM || 100) * v.scale);
      ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.stroke();
    }
    this.drawStreets();
    const lv = labelLevel(v.scale);
    ctx.font = '600 12px system-ui, sans-serif'; ctx.textBaseline = 'middle';
    for (const s of d.stops) this.marker(s, 'stop', lv.stops);
    for (const l of d.landmarks) this.marker(l, 'landmark', lv.landmarks);
    if (this.pick) this.ring(this.pick);
    if (this.me) this.arrow(this.me);
    this.scaleBar();
  }

  drawStreets() {
    const { ctx, view: v, data: d } = this;
    const keys = tilesIn(v.bounds(20), TILE_M);
    // whole city in view: thinner and fainter, so the network reads as texture, not noise
    const far = v.scale < 0.4;
    ctx.beginPath();
    const s = v.scale, ox = v.w / 2 - v.cx * s, oy = v.h / 2 + v.cz * s;
    for (const k of keys) {
      const a = d.tiles.get(k);
      if (!a) continue;
      for (let q = 0; q < a.length; q += 4) {
        ctx.moveTo(a[q] * s + ox, oy - a[q + 1] * s);
        ctx.lineTo(a[q + 2] * s + ox, oy - a[q + 3] * s);
      }
    }
    ctx.strokeStyle = far ? 'rgba(222,224,240,.38)' : COL.street;
    ctx.lineWidth = far ? 0.7 : Math.min(7, Math.max(1.2, 3 * s));
    ctx.lineCap = 'round';
    ctx.stroke();
  }

  marker(it, kind, label) {
    const { ctx } = this, [x, y] = this.view.toScreen(it.x, it.z);
    if (x < -40 || y < -40 || x > this.view.w + 40 || y > this.view.h + 40) return;
    if (kind === 'stop') {
      ctx.fillStyle = COL.stop; ctx.strokeStyle = '#11143a'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.roundRect ? ctx.roundRect(x - 5, y - 5, 10, 10, 2) : ctx.rect(x - 5, y - 5, 10, 10); ctx.fill(); ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,.55)'; ctx.beginPath(); ctx.arc(x, y, 2, 0, 7); ctx.fill(); // a stud
    } else {
      ctx.fillStyle = it.found ? COL.found : COL.mark; ctx.strokeStyle = '#fff'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(x, y - 8); ctx.lineTo(x + 7, y); ctx.lineTo(x, y + 8); ctx.lineTo(x - 7, y); ctx.closePath();
      ctx.fill(); ctx.stroke();
    }
    if (label) {
      const t = it.name, w = ctx.measureText(t).width;
      ctx.fillStyle = 'rgba(4,5,16,.7)'; ctx.fillRect(x + 10, y - 9, w + 8, 18);
      ctx.fillStyle = COL.text; ctx.fillText(t, x + 14, y);
    }
  }

  ring(p) {
    const { ctx } = this, [x, y] = this.view.toScreen(p.x, p.z);
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(x, y, 15, 0, 7); ctx.stroke();
    ctx.strokeStyle = COL.stop; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(x, y, 15, 0, 7); ctx.stroke();
  }

  arrow(me) {
    const { ctx } = this, [x, y] = this.view.toScreen(me.x, me.z);
    ctx.save(); ctx.translate(x, y); ctx.rotate(me.yaw || 0); // compass yaw: clockwise from north (screen up)
    ctx.fillStyle = 'rgba(255,255,255,.18)'; ctx.beginPath(); ctx.arc(0, 0, 18, 0, 7); ctx.fill();
    ctx.beginPath(); ctx.moveTo(0, -13); ctx.lineTo(9, 9); ctx.lineTo(0, 4); ctx.lineTo(-9, 9); ctx.closePath();
    ctx.fillStyle = COL.me; ctx.strokeStyle = '#F2A900'; ctx.lineWidth = 2.5; ctx.fill(); ctx.stroke();
    ctx.restore();
  }

  scaleBar() {
    const { ctx, view: v } = this;
    const want = 110 / v.scale, p = 10 ** Math.floor(Math.log10(want)), m = [5, 2, 1].map((k) => k * p).find((n) => n <= want) || p;
    const w = m * v.scale, x = v.w - w - 74, y = v.h - 22;
    if (x < 10) return;
    ctx.strokeStyle = COL.text; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(x, y - 5); ctx.lineTo(x, y); ctx.lineTo(x + w, y); ctx.lineTo(x + w, y - 5); ctx.stroke();
    ctx.fillStyle = COL.text; ctx.font = '600 11px system-ui, sans-serif'; ctx.textAlign = 'center';
    ctx.fillText(m >= 1000 ? `${m / 1000} km` : `${m} m`, x + w / 2, y - 9); ctx.textAlign = 'left';
  }
}

/** The built city's chunk mask as a tiny canvas (one pixel per chunk), or null. */
export function builtMask(city, doc = document) {
  if (!city?.bounded || !city.hasChunk || !city.box) return null;
  const cm = (city.chunkStuds || 64) * (city.studM || 0.5), b = city.box;
  const i0 = Math.floor(b.min.x / cm), i1 = Math.ceil(b.max.x / cm), j0 = Math.floor(-b.max.z / cm), j1 = Math.ceil(-b.min.z / cm);
  const cols = i1 - i0, rows = j1 - j0;
  if (cols <= 0 || rows <= 0 || cols * rows > 4e6) return null;
  const canvas = doc.createElement('canvas');
  canvas.width = cols; canvas.height = rows;
  const g = canvas.getContext('2d'), img = g.createImageData(cols, rows);
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      if (!city.hasChunk(i0 + i, j0 + j)) continue;
      const o = ((rows - 1 - j) * cols + i) * 4; // north up
      img.data[o] = 0x1d; img.data[o + 1] = 0x24; img.data[o + 2] = 0x58; img.data[o + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  return { canvas, x0: i0 * cm, z0: j0 * cm, cols, rows, cm };
}
