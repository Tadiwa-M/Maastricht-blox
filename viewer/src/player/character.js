// The player's figure: the same smooth toy figure as the city's people (src/figure/, an
// original design, never a toy minifigure shape), drawn as a one-figure FigureCrowd and posed
// by the shared rig with the motion layer (motion.js): walk and idle blend by speed, stride
// matched to speed, lean into acceleration, bank into turns, jump and landing poses.
// The character creator (creator.js, figure/custom.js) sets the look; #figure=<seed> picks a
// random one instead.
import * as THREE from 'three';
import { FigureCrowd } from '../figure/crowd.js';
import { makeVariant } from '../figure/variants.js';
import { customVariant } from '../figure/custom.js';
import { MODE, captureParts } from '../figure/rig.js';
import { MotionState } from './motion.js';

export const PLAYER_SEED = 52;

function seedFromHash() {
  if (typeof location === 'undefined') return PLAYER_SEED;
  const v = new URLSearchParams(location.hash.replace(/^#/, '')).get('figure');
  return v && /^\d+$/.test(v) ? +v : PLAYER_SEED;
}

export class Character {
  /** models/world are accepted for the old signature; the figure needs neither. */
  constructor(models, world, { seed = seedFromHash(), look = null } = {}) {
    void models; void world;
    if (look) this.variant = customVariant(look); // the character creator's choices
    else {
      this.variant = makeVariant(seed, { kind: 'adult' });
      this.variant.acc = this.variant.acc === 'bag' ? 'none' : this.variant.acc;
    }
    this.crowd = new FigureCrowd(1, { lod: false });
    this.group = new THREE.Group(); // position + yaw live in the instance matrices; the group just holds the meshes
    this.group.name = 'player';
    this.group.add(this.crowd.group);
    this.motion = new MotionState();
    this.pose = { x: 0, y: 0, z: 0, rotY: 0, mode: MODE.IDLE, phase: 0, speed: 0, t: 0 };
  }

  /** The figure's parts posed standing at feet facing yaw (where scattered pieces reassemble). */
  partsAt(feet, yaw) {
    return captureParts(this.variant, { x: feet[0], y: feet[1], z: feet[2], rotY: -yaw, mode: MODE.IDLE, t: 0 });
  }

  /** The current pose's parts (where a knock-down starts). */
  currentParts() { return captureParts(this.variant, this.pose); }

  /** Draw loose parts instead of the posed figure (scatter.js). */
  drawParts(parts) {
    this.crowd.begin();
    this.crowd.addParts(this.variant, parts);
    this.crowd.end();
  }

  /** Swap the figure's look (character creator); a fresh variant object (the crowd caches per variant). */
  setVariant(v) { this.variant = v; }

  /**
   * feet: [x, y, z] three.js; yaw: compass radians; speed m/s; travelled m this frame;
   * body: { angVel, accel, steer, grounded, vy } from the controller (motion.js: lean, bank,
   * blend, air, landing); without it the figure still walks, just without those layers.
   */
  update(feet, yaw, speed, travelled, dt, body = null) {
    const m = this.motion.update(dt, { speed, travelled, angVel: 0, accel: 0, steer: 0, grounded: true, vy: 0, ...body },
      this.variant.scale);
    Object.assign(this.pose, { x: feet[0], y: feet[1], z: feet[2], rotY: -yaw }, m);
    this.crowd.begin();
    this.crowd.add(this.variant, this.pose);
    this.crowd.end();
  }
}
