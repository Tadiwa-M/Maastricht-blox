// Text labels as camera-facing sprites (used by the piece gallery).
import * as THREE from 'three';

/** Sprite showing `text`, `height` metres tall, centred at `pos`. */
export function label(text, pos, height = 0.4, color = '#1d2330', bg = 'rgba(255,255,255,0.85)') {
  const px = 48, c = document.createElement('canvas');
  const g = c.getContext('2d');
  g.font = `600 ${px}px system-ui, sans-serif`;
  const w = Math.ceil(g.measureText(text).width) + px * 0.6;
  c.width = w; c.height = Math.ceil(px * 1.4);
  g.font = `600 ${px}px system-ui, sans-serif`;
  g.fillStyle = bg;
  g.fillRect(0, 0, c.width, c.height);
  g.fillStyle = color;
  g.textBaseline = 'middle';
  g.fillText(text, px * 0.3, c.height / 2);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthWrite: false, toneMapped: false, fog: false }));
  s.scale.set((height * c.width) / c.height, height, 1);
  s.position.copy(pos);
  return s;
}
