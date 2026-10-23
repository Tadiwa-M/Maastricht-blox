// The player's figure: the same smooth toy figure as the city's people (src/figure/, an
// original design, never a toy minifigure shape), drawn as a one-figure FigureCrowd and posed
// by the shared rig: walk cycle driven by distance, a longer stride and forward lean when
// running, idle sway when standing. #figure=<seed> picks another look.
import * as THREE from 'three';
import { FigureCrowd } from '../figure/crowd.js';
import { makeVariant } from '../figure/variants.js';
import { MODE } from '../figure/rig.js';

export const PLAYER_SEED = 52;

function seedFromHash() {
  if (typeof location === 'undefined') return PLAYER_SEED;
  const v = new URLSearchParams(location.hash.replace(/^#/, '')).get('figure');
  return v && /^\d+$/.test(v) ? +v : PLAYER_SEED;
}

export class Character {
  /** models/world are accepted for the old signature; the figure needs neither. */
  constructor(models, world, { seed = seedFromHash() } = {}) {
    void models; void world;
    this.variant = makeVariant(seed, { kind: 'adult' });
    this.variant.acc = this.variant.acc === 'bag' ? 'none' : this.variant.acc;
    this.crowd = new FigureCrowd(1, { lod: false });
    this.group = new THREE.Group(); // position + yaw live in the instance matrices; the group just holds the meshes
    this.group.name = 'player';
    this.group.add(this.crowd.group);
    this.phase = 0; this.t = 0; this.speed = 0;
    this.pose = { x: 0, y: 0, z: 0, rotY: 0, mode: MODE.IDLE, phase: 0, speed: 0, t: 0 };
  }

  /** feet: [x, y, z] three.js; yaw: compass radians; speed m/s; travelled m this frame. */
  update(feet, yaw, speed, travelled, dt) {
    this.t += dt;
    this.speed += (speed - this.speed) * Math.min(1, dt * 10);
    const stride = speed > 2.5 ? 1.15 : 0.75;
    this.phase += (travelled / (stride * this.variant.scale)) * Math.PI;
    Object.assign(this.pose, { x: feet[0], y: feet[1], z: feet[2], rotY: -yaw,
      mode: this.speed > 0.08 ? MODE.WALK : MODE.IDLE, phase: this.phase, speed: this.speed, t: this.t });
    this.crowd.begin();
    this.crowd.add(this.variant, this.pose);
    this.crowd.end();
  }
}
