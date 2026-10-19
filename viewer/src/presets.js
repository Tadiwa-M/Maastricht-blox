// Camera presets derived from the world bounds and building features (not hard-coded).
// Azimuths are compass degrees (0 = north, 90 = east); three.js north is -z.
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

/** Building whose street-side corridor (south of its facade) is the least cluttered. */
function clearestFacade(world, houses) {
  let best = null, bestN = Infinity;
  for (const f of houses) {
    const [I0, J0, I1] = f.bboxIJ;
    let n = 0;
    for (let I = I0; I <= I1; I++)
      for (let J = J0 - 16; J < J0; J++)
        for (let K = world.groundK + 1; K < world.groundK + 20; K++) n += world.occupied(I, J, K) ? 1 : 0;
    const score = n / (I1 - I0 + 1);
    if (score < bestN) { bestN = score; best = f; }
  }
  return best;
}

/** Distance at which a sphere of radius r fills the view. */
function fitDist(r, fovDeg, aspect) {
  const v = THREE.MathUtils.degToRad(fovDeg) / 2;
  const h = Math.atan(Math.tan(v) * aspect);
  return r / Math.sin(Math.min(v, h));
}

export function makePresets(world, box, aspect = 1.6) {
  const S = world.studM;
  const groundY = world.groundK * world.plateM;
  const c = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  const { box: bb, list } = buildingsBox(world);
  const front = bb.isEmpty() ? c.z : bb.max.z; // south facades (largest z)
  const houses = list.filter((f) => f.kind === 'building').sort((a, b) => a.centroid[0] - b.centroid[0]);
  const pick = clearestFacade(world, houses) || list[0];
  const r = Math.hypot(size.x, size.z) / 2;

  // hero: the whole diorama from the south-southwest, a little toward the facades
  const hero = new THREE.Vector3(c.x, groundY + Math.min(size.y * 0.25, 8), (c.z + front) / 2);
  const presets = {
    hero: { target: hero, cam: hero.clone().add(offset(206, 30, fitDist(r, 32, aspect) * 0.8)), fov: 32 },
    map: (() => {
      const t = new THREE.Vector3(c.x, groundY + (box.max.y - groundY) * 0.3, c.z);
      const r3 = Math.hypot(size.x, size.z, box.max.y - groundY) / 2;
      return { target: t, cam: t.clone().add(offset(180, 70, fitDist(r3, 28, aspect) * 0.8)), fov: 28 };
    })(),
  };
  // river: low over the water looking north at the facades (shows water reflections)
  {
    const t = new THREE.Vector3(c.x, groundY + 2, c.z + size.z * 0.15);
    presets.river = { target: t, cam: t.clone().add(offset(192, 9, size.z * 0.75)), fov: 40 };
  }
  // gallery / generic overview: from the south, steep enough to see every slot
  presets.gallery = { target: c.clone(), cam: c.clone().add(offset(192, 55, fitDist(Math.hypot(size.x, size.z) / 2, 30, aspect) * 0.72)), fov: 30 };
  if (pick) {
    const [I0, J0, I1] = pick.bboxIJ;
    const t = new THREE.Vector3((I0 + I1 + 1) / 2 * S, groundY + 3.2, -J0 * S + 0.5);
    presets.facade = { target: t, cam: t.clone().add(offset(198, 6, 6.5)), fov: 50 };
  } else {
    presets.facade = presets.hero;
  }
  return presets;
}
