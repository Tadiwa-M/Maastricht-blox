// Street-life audit: counts what makes the city look broken in one snapshot. People through
// people, people inside vehicles, people on roofs, bikes and cars inside buses, cars inside
// cars. Pure; tools/life-audit.mjs takes snapshots of the running game and sums them, tests in
// test/life.audit.test.mjs. All positions Unity metres (x east, z north), yaw degrees clockwise
// from north; footprints { x, z, yaw, halfW, halfL }.

export const AUDIT = { personR: 0.22, bikeHalf: [0.3, 0.85], roofM: 2.5 }; // roofM: steps and raised squares are up to ~2 m

/** Is (px, pz) inside footprint f grown by `margin`? */
export function inFootprint(f, px, pz, margin = 0) {
  const r = (f.yaw * Math.PI) / 180, fx = Math.sin(r), fz = Math.cos(r);
  const dx = px - f.x, dz = pz - f.z;
  const along = dx * fx + dz * fz, across = dx * fz - dz * fx;
  return Math.abs(along) <= f.halfL + margin && Math.abs(across) <= f.halfW + margin;
}

/** Corners and centre of a footprint (for footprint-in-footprint tests). */
function points(f) {
  const r = (f.yaw * Math.PI) / 180, fx = Math.sin(r), fz = Math.cos(r), rx = fz, rz = -fx;
  const out = [[f.x, f.z]];
  for (const a of [-1, 1]) for (const b of [-1, 1]) out.push([f.x + fx * f.halfL * a + rx * f.halfW * b, f.z + fz * f.halfL * a + rz * f.halfW * b]);
  return out;
}
const overlaps = (a, b) => points(a).some(([x, z]) => inFootprint(b, x, z)) || points(b).some(([x, z]) => inFootprint(a, x, z));

/**
 * snap: { people: [{ x, z, y, g }] (g: group id), buses: [footprint], cars: [footprint],
 * bikes: [{ x, z, yaw }], street(x, z) -> street-level y near (x, z) | null }.
 * -> counts { people, peopleOverlap (pairs), peopleInVehicles, peopleOnRoofs, bikes,
 *    bikesInVehicles, bikesOverlap (pairs), carsInBuses, carsOverlap (pairs) }.
 */
export function auditLife({ people = [], buses = [], cars = [], bikes = [], street = null }) {
  const out = { people: people.length, peopleOverlap: 0, peopleInVehicles: 0, peopleOnRoofs: 0,
    bikes: bikes.length, bikesInVehicles: 0, bikesOverlap: 0, carsInBuses: 0, carsOverlap: 0 };
  const cell = 2, grid = new Map(), key = (i, j) => `${i},${j}`;
  people.forEach((p, n) => {
    const k = key(Math.floor(p.x / cell), Math.floor(p.z / cell));
    if (!grid.has(k)) grid.set(k, []);
    grid.get(k).push(n);
  });
  const near = 2 * AUDIT.personR;
  people.forEach((p, n) => {
    const i0 = Math.floor(p.x / cell), j0 = Math.floor(p.z / cell);
    for (let i = i0 - 1; i <= i0 + 1; i++) for (let j = j0 - 1; j <= j0 + 1; j++) {
      for (const m of grid.get(key(i, j)) || []) {
        if (m <= n || people[m].g === p.g) continue; // a group walks close together on purpose
        if (Math.hypot(people[m].x - p.x, people[m].z - p.z) < near) out.peopleOverlap++;
      }
    }
  });
  const vehicles = buses.concat(cars);
  for (const p of people) {
    if (vehicles.some((f) => inFootprint(f, p.x, p.z))) out.peopleInVehicles++;
    const s = street?.(p.x, p.z);
    if (Number.isFinite(s) && Number.isFinite(p.y) && p.y - s > AUDIT.roofM) out.peopleOnRoofs++;
  }
  const bikeF = bikes.map((b) => ({ x: b.x, z: b.z, yaw: b.yaw ?? 0, halfW: AUDIT.bikeHalf[0], halfL: AUDIT.bikeHalf[1] }));
  for (const b of bikeF) if (vehicles.some((f) => overlaps(f, b))) out.bikesInVehicles++;
  for (let a = 0; a < bikeF.length; a++) for (let b = a + 1; b < bikeF.length; b++) {
    if (Math.abs(bikeF[a].x - bikeF[b].x) < 2 && Math.abs(bikeF[a].z - bikeF[b].z) < 2 && overlaps(bikeF[a], bikeF[b])) out.bikesOverlap++;
  }
  for (const c of cars) if (buses.some((f) => overlaps(f, c))) out.carsInBuses++;
  for (let a = 0; a < cars.length; a++) for (let b = a + 1; b < cars.length; b++) {
    if (Math.abs(cars[a].x - cars[b].x) < 8 && Math.abs(cars[a].z - cars[b].z) < 8 && overlaps(cars[a], cars[b])) out.carsOverlap++;
  }
  return out;
}
