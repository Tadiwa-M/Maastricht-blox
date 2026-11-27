// Postcards: the current view (window.__bloxCapture, else the renderer canvas) in a paper
// frame with the place name and date, as a PNG; shared through the Web Share API when the
// browser can share files, else downloaded. Layout numbers come from logic.js postcardLayout.
import { postcardLayout, formatDate } from './logic.js';

function loadImage(url) {
  return new Promise((ok, fail) => {
    const img = new Image();
    img.onload = () => ok(img);
    img.onerror = () => fail(new Error('could not read the view'));
    img.src = url;
  });
}

/** A data URL of the view as drawn now. render(): draws one frame first (canvas fallback). */
export function captureView(canvas, render) {
  const cap = window.__bloxCapture?.();
  if (cap?.url) return cap.url;
  render?.();
  return canvas.toDataURL('image/png');
}

/** Compose the postcard; resolves to a PNG Blob. */
export async function makePostcard(viewUrl, place, date = new Date()) {
  const img = await loadImage(viewUrl);
  const L = postcardLayout(img.naturalWidth || img.width, img.naturalHeight || img.height);
  const c = Object.assign(document.createElement('canvas'), { width: L.W, height: L.H });
  const g = c.getContext('2d');
  g.fillStyle = '#f6f1e4';
  g.fillRect(0, 0, L.W, L.H);
  g.drawImage(img, L.photo.x, L.photo.y, L.photo.w, L.photo.h);
  g.strokeStyle = 'rgba(16,21,58,.25)';
  g.lineWidth = Math.max(1, L.pad * 0.08);
  g.strokeRect(L.photo.x, L.photo.y, L.photo.w, L.photo.h);
  // caption: place on the left, date and the game's name on the right; a gold stud as the stamp
  const mid = L.caption.y + L.caption.h * 0.5;
  g.fillStyle = '#10153a';
  g.textBaseline = 'middle';
  g.font = `${L.title}px Anton, Impact, 'Arial Narrow', sans-serif`;
  const stampR = L.title * 0.42;
  const sx = L.caption.x + stampR, tx = sx + stampR * 1.9;
  g.fillText(place.toUpperCase(), tx, mid, L.caption.w * 0.6);
  g.textAlign = 'right';
  g.font = `${L.small}px system-ui, sans-serif`;
  g.fillStyle = '#4a4e6a';
  const rx = L.caption.x + L.caption.w;
  g.fillText(formatDate(date), rx, mid - L.small * 0.62);
  g.fillText('Maastricht Blox', rx, mid + L.small * 0.62);
  g.beginPath();
  g.arc(sx, mid, stampR, 0, Math.PI * 2);
  g.fillStyle = '#F2A900';
  g.fill();
  g.beginPath();
  g.arc(sx, mid, stampR * 0.62, 0, Math.PI * 2);
  g.strokeStyle = 'rgba(16,21,58,.35)';
  g.lineWidth = Math.max(1, stampR * 0.12);
  g.stroke();
  return new Promise((ok, fail) => c.toBlob((b) => (b ? ok(b) : fail(new Error('could not make the postcard'))), 'image/png'));
}

/** Share the postcard (Web Share with files) or download it. Returns 'shared' | 'saved' | 'cancelled'. */
export async function sharePostcard(blob, place, date = new Date()) {
  const name = `maastricht-blox-${place.toLowerCase().normalize('NFD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'postcard'}-${date.toISOString().slice(0, 10)}.png`;
  const file = typeof File === 'function' ? new File([blob], name, { type: 'image/png' }) : null;
  if (file && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: `${place} · Maastricht Blox` });
      return 'shared';
    } catch (e) {
      if (e?.name === 'AbortError') return 'cancelled';
      // share refused (no user gesture left, policy): fall back to a download
    }
  }
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  return 'saved';
}
