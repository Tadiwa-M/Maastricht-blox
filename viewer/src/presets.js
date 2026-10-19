// Camera presets derived from the world bounds and building features (not hard-coded).
import * as THREE from 'three';

function buildingsBox(world) {
  const S = world.studM;
  const b = new THREE.Box3();
  const list = [];
  for (const f of world.features.values()) {
    if (!f.bboxIJ || !['building', 'landmark'].includes(f.kind)) continue;
    const [I0, J0, I1, J1] = f.bboxIJ;
    list.push(f);
    b.expandByPoint(new THREE.Vector3(I0 * S, 0, -(J1 + 1) * S));
    b.expandByPoint(new THREE.Vector3((I1 + 1) * S, 0, -J0 * S));
  }
  return { box: b, list };
}

/** Direction from target to camera for a compass azimuth (0 = north) and elevation. */
function offset(azDeg, elDeg, dist) {
  const az = THREE.MathUtils.degToRad(azDeg), el = THREE.MathUtils.degToRad(elDeg);
  return new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el))
    .multiplyScalar(dist);
}

export function makePresets(world, box) {
  const S = world.studM;
  const groundY = world.groundK * world.plateM;
  const c = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  const span = Math.max(size.x, size.z);
  const { box: bb, list } = buildingsBox(world);
  const front = bb.isEmpty() ? c.z : bb.max.z; // south facades (largest z)
  const houses = list.filter((f) => f.kind === 'building').sort((a, b) => a.centroid[0] - b.centroid[0]);
  const pick = houses[Math.floor(houses.length / 2)] || list[0];

  const hero = new THREE.Vector3(c.x, groundY + 4, Math.min(front + span * 0.12, box.max.z));
  const presets = {
    hero: { target: hero, cam: hero.clone().add(offset(205, 30, span * 1.05)), fov: 35 },
    map: { target: new THREE.Vector3(c.x, groundY, c.z), cam: new THREE.Vector3(c.x, groundY, c.z)
      .add(offset(180, 62, span * 1.55)), fov: 35 },
  };
  if (pick) {
    const [I0, J0, I1] = pick.bboxIJ;
    const t = new THREE.Vector3((I0 + I1 + 1) / 2 * S, groundY + 3.2, -J0 * S + 0.5);
    presets.facade = { target: t, cam: t.clone().add(offset(197, 9, 11)), fov: 40 };
  } else {
    presets.facade = presets.hero;
  }
  return presets;
}
