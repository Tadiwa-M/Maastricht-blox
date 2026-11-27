// The journal's overview map: dark until you walk; every walked cell glows softly (the cells
// are drawn one pixel each on a small canvas, then scaled up smoothly). Discovered places are
// gold dots, the walker a white arrow. Window and projection: logic.js mapWindow / toMap.
import { CELL_M, cellCentre, mapWindow, toMap } from './logic.js';

/**
 * canvas: the journal's <canvas>; state: explore state; places: discovered landmarks;
 * me: { x, z, yaw } or null (Unity metres, yaw radians clockwise from north); base: the
 * minimum window [x0, z0, x1, z1].
 */
export function drawMap(canvas, state, places, me, base) {
  const px = canvas.width, g = canvas.getContext('2d');
  if (!g) return;
  const win = mapWindow(state.cells, [...places.map((p) => p.at), ...(me ? [[me.x, me.z]] : [])], base);
  g.fillStyle = '#070914';
  g.fillRect(0, 0, px, px);
  // lit cells: one pixel per cell on a scratch canvas the size of the window in cells
  const n = Math.max(1, Math.ceil(win.size / CELL_M));
  const lo = Object.assign(document.createElement('canvas'), { width: n, height: n });
  const lg = lo.getContext('2d');
  const img = lg.createImageData(n, n);
  for (const k of state.cells) {
    const [x, z] = cellCentre(k);
    const i = Math.floor((x - win.x0) / CELL_M), j = n - 1 - Math.floor((z - win.z0) / CELL_M);
    if (i < 0 || j < 0 || i >= n || j >= n) continue;
    const o = (j * n + i) * 4;
    img.data[o] = 246; img.data[o + 1] = 214; img.data[o + 2] = 140; img.data[o + 3] = 255;
  }
  lg.putImageData(img, 0, 0);
  g.save();
  g.imageSmoothingEnabled = true;
  g.globalAlpha = 0.35;
  g.filter = 'blur(3px)'; // soft halo (ignored where unsupported)
  g.drawImage(lo, 0, 0, px, px);
  g.filter = 'none';
  g.globalAlpha = 0.9;
  g.drawImage(lo, 0, 0, px, px);
  g.restore();
  // discovered places
  g.fillStyle = '#F2A900';
  for (const p of places) {
    const [x, y] = toMap(win, px, p.at[0], p.at[1]);
    g.beginPath();
    g.arc(x, y, 3.2, 0, Math.PI * 2);
    g.fill();
  }
  if (me) {
    const [x, y] = toMap(win, px, me.x, me.z);
    g.save();
    g.translate(x, y);
    g.rotate(me.yaw);
    g.fillStyle = '#ffffff';
    g.strokeStyle = '#10153a';
    g.lineWidth = 1.5;
    g.beginPath();
    g.moveTo(0, -7); g.lineTo(5, 5); g.lineTo(0, 2.5); g.lineTo(-5, 5); g.closePath();
    g.fill(); g.stroke();
    g.restore();
  }
  // north and scale
  g.fillStyle = 'rgba(246,243,234,.7)';
  g.font = '600 11px system-ui, sans-serif';
  g.fillText('N', px - 16, 16);
  const barM = win.size > 3000 ? 1000 : 500, barPx = (barM / win.size) * px;
  g.fillRect(10, px - 12, barPx, 2);
  g.fillText(barM >= 1000 ? `${barM / 1000} km` : `${barM} m`, 10, px - 18);
}
