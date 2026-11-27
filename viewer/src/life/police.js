// The police car, a small easter egg: now and then one patrol car (an original toy design: white
// with blue stripes and a light bar, src/figure/vehicles.js) joins the traffic near the camera
// and drives like any other car. Rarely it switches its lights on: it drives a little faster
// along the middle of the road, cars ahead of it pull over to the right and slow down, cars at
// junctions let it through, and it does not wait at red lights (it still never drives into
// anyone). Pure (no three.js), tested in test/life.police.test.mjs; traffic.js applies the rules.

export const POLICE = {
  everyS: 150, // mean seconds between patrol cars (when none is about)
  sirenOnSpawn: 0.4, // chance it arrives with its lights on
  sirenEveryS: 90, // while patrolling: mean seconds until the lights go on
  sirenS: [25, 45], // how long the lights stay on (s)
  boost: 1.3, // speed factor with lights on
  passM: 0.9, // with lights on it drives this far left of its lane
  pullM: 1.2, // cars it comes up behind pull this far to the right
  slow: 0.35, // ... and slow to this share of their speed
  behindM: 45, // a car pulls over when the police car is within this distance behind it ...
  besideM: 7, // ... and stays over until it is this far past
  passLat: 0.95, // the police car passes a car once that has pulled over this far (m)
  junctionM: 40, // cars at a junction wait while it is this close to it
  flashHz: 2.5, // light bar: left and right alternate this many times a second
};

/** Seconds until the next patrol car. */
export function nextPatrolIn(rand) {
  return POLICE.everyS * (0.5 + rand());
}

/** Lights on or off for a police car c ({ siren, sirenT }) after dt seconds. */
export function sirenStep(c, dt, rand) {
  if (c.siren) {
    c.sirenT -= dt;
    if (c.sirenT <= 0) { c.siren = false; c.sirenT = 0; }
  } else if (rand() < dt / POLICE.sirenEveryS) switchOn(c, rand);
}

/** Lights on, for a random while. */
export function switchOn(c, rand) {
  c.siren = true;
  c.sirenT = POLICE.sirenS[0] + rand() * (POLICE.sirenS[1] - POLICE.sirenS[0]);
}

/**
 * Should the car at pose (Unity { x, z, yaw }) pull over for the police car at pp? Yes when the
 * police car is behind it in the same lane (within behindM) or passing it, heading the same way.
 */
export function pullsOver(pose, pp) {
  const r = (pp.yaw * Math.PI) / 180, fx = Math.sin(r), fz = Math.cos(r);
  const dx = pose.x - pp.x, dz = pose.z - pp.z;
  const along = dx * fx + dz * fz, across = dx * fz - dz * fx;
  const turn = Math.abs(((pose.yaw - pp.yaw + 540) % 360) - 180);
  return along > -POLICE.besideM && along < POLICE.behindM && Math.abs(across) < 3 && turn < 50;
}

/** Light bar at time t (s): [left lit, right lit]; dark when the lights are off. */
export function beacons(on, t) {
  if (!on) return [false, false];
  const k = Math.floor(t * POLICE.flashHz * 2) % 2;
  return [k === 0, k === 1];
}
