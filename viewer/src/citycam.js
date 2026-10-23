// Map-mode camera for a whole city (Google Maps feel) on top of three.js MapControls:
//   - wheel/pinch zooms toward the cursor, from the whole city down to street level
//   - tilt follows the zoom: far out the view is nearly top-down, close in it can lean almost
//     horizontal, so the sky stays in the frame at street level (src/sky.js); while zooming the
//     tilt eases toward a preferred angle for that distance, and you can still orbit freely
//     within the allowed range (right drag)
//   - the orbit target rides on the ground (city.groundHeight, else the baked per-chunk ground),
//     stays inside the city box, and the camera never dips under the bricks
//   - near/far clip planes scale with distance (depth precision from 3 m to 4 km)
// The pure parts (tiltFor, clampTarget) are tested in test/citycam.test.mjs.
import * as THREE from 'three';

const DEG = Math.PI / 180;
export const NEAR_DIST = 25, FAR_DIST = 2600; // metres: street level .. whole city

/** 0 at street level .. 1 at the whole-city distance (log scale). */
export function zoomT(dist) {
  return THREE.MathUtils.clamp(Math.log(dist / NEAR_DIST) / Math.log(FAR_DIST / NEAR_DIST), 0, 1);
}

/** { maxPolar, preferred } polar angles (radians from straight down... i.e. from +y) for a distance. */
export function tiltFor(dist) {
  const t = zoomT(dist);
  return {
    maxPolar: THREE.MathUtils.lerp(87, 52, t ** 1.6) * DEG, // how far you may lean toward the horizon
    preferred: THREE.MathUtils.lerp(80, 40, t * t * (3 - 2 * t)) * DEG, // where zooming eases to
  };
}

/** Keep a target point inside box (three.js) grown by margin metres. Mutates and returns p. */
export function clampTarget(p, box, margin = 50) {
  p.x = THREE.MathUtils.clamp(p.x, box.min.x - margin, box.max.x + margin);
  p.z = THREE.MathUtils.clamp(p.z, box.min.z - margin, box.max.z + margin);
  return p;
}

export class CityCamera {
  /**
   * groundAt(x, z, fromY?) -> y metres (always a number): the top of the ground at or below
   * fromY (default: the top of the column); box: THREE.Box3 of the city.
   */
  constructor(camera, controls, { box, groundAt }) {
    Object.assign(this, { camera, controls, box, groundAt });
    controls.zoomToCursor = true;
    controls.screenSpacePanning = false;
    controls.minDistance = 3;
    controls.maxDistance = Math.max(600, box.getSize(new THREE.Vector3()).length() * 1.3);
    controls.minPolarAngle = 0;
    controls.enableDamping = true;
    controls.dampingFactor = 0.1;
    controls.zoomSpeed = 1.2;
    this.autoTilt = 0;
    controls.domElement.addEventListener('wheel', () => { this.autoTilt = performance.now() + 700; }, { passive: true });
    this.sph = new THREE.Spherical();
    this.off = new THREE.Vector3();
  }

  /** Call after controls.update() each frame. */
  update() {
    const { camera, controls } = this;
    const t = controls.target;
    clampTarget(t, this.box);
    // target rides on the ground (at eye height when close): move target and camera together
    const lift = 1.7 * (1 - zoomT(camera.position.distanceTo(t)));
    const gy = this.groundAt(t.x, t.z, t.y + 2) + lift;
    const dy = (gy - t.y) * 0.25;
    if (Math.abs(dy) > 1e-3) { t.y += dy; camera.position.y += dy; }
    this.off.copy(camera.position).sub(t);
    this.sph.setFromVector3(this.off);
    const dist = this.sph.radius;
    const { maxPolar, preferred } = tiltFor(dist);
    controls.maxPolarAngle = maxPolar;
    let phi = Math.min(this.sph.phi, maxPolar);
    if (performance.now() < this.autoTilt) phi += (preferred - phi) * 0.12;
    if (phi !== this.sph.phi) {
      this.sph.phi = phi;
      this.off.setFromSpherical(this.sph);
      camera.position.copy(t).add(this.off);
    }
    // never under the bricks
    const cg = this.groundAt(camera.position.x, camera.position.z, camera.position.y + 1);
    if (camera.position.y < cg + 1.6) camera.position.y = cg + 1.6;
    const near = THREE.MathUtils.clamp(dist * 0.004, 0.15, 8);
    const far = Math.max(3000, dist * 2.5 + 2500);
    if (Math.abs(near - camera.near) > camera.near * 0.2 || Math.abs(far - camera.far) > camera.far * 0.2) {
      camera.near = near; camera.far = far;
      camera.updateProjectionMatrix();
    }
    camera.lookAt(t);
    return dist;
  }
}
