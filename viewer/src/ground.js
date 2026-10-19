// The table the diorama stands on: a huge baseplate with a faint stud pattern, fading into
// the sky haze with distance (scene fog uses the horizon colour).
//
// The stud pattern is drawn once on a small canvas (one stud per tile) and repeated every
// 0.5 m, so no image files are needed. Mipmaps blur it to a flat colour far away.
import * as THREE from 'three';

const BASE = '#3d6334';

function studTile(px = 64) {
  const c = document.createElement('canvas');
  c.width = c.height = px;
  const g = c.getContext('2d');
  g.fillStyle = BASE;
  g.fillRect(0, 0, px, px);
  const m = px / 2, r = px * 0.3;
  g.fillStyle = 'rgba(0,0,0,0.22)'; // soft contact shadow, offset away from the light
  g.beginPath(); g.arc(m + px * 0.05, m + px * 0.06, r * 1.05, 0, Math.PI * 2); g.fill();
  const grad = g.createLinearGradient(m - r, m - r, m + r, m + r);
  grad.addColorStop(0, '#5a8a4c'); grad.addColorStop(1, '#30522a');
  g.fillStyle = grad;
  g.beginPath(); g.arc(m, m, r, 0, Math.PI * 2); g.fill();
  g.fillStyle = BASE;
  g.beginPath(); g.arc(m, m, r * 0.78, 0, Math.PI * 2); g.fill(); // flat stud top
  return c;
}

/** Ground mesh centred at (x, z) with its top at y. studM = stud pitch in metres. */
export function makeGround(x, y, z, studM, size = 4000) {
  const tex = new THREE.CanvasTexture(studTile());
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(size / studM, size / studM);
  tex.anisotropy = 8;
  // offset so stud centres line up with the brick grid (grid origin at a cell corner)
  tex.offset.set(((x - size / 2) / studM) % 1, ((z - size / 2) / studM) % 1);
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(size, size),
    new THREE.MeshStandardMaterial({ color: 0xffffff, map: tex, roughness: 0.85 }),
  );
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.set(x, y, z);
  mesh.receiveShadow = true;
  mesh.name = 'ground';
  return mesh;
}
