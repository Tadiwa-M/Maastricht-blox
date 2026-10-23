// The player's figure: the original blocky character (contract/models/character.json, built
// at contract scale by src/models.js, never a minifigure shape), with the walk cycle from
// src/mover.js, a longer stride and forward lean when running, and a small idle sway.
import * as THREE from 'three';
import { buildModel } from '../models.js';
import { WalkCycle } from '../mover.js';
import { MaterialSet } from '../materials.js';
import { placeholderModels } from '../placeholders.js';

export class Character {
  /** models: { name: model JSON } (data.models); world: for palette + catalogue. */
  constructor(models, world) {
    const json = models?.character || placeholderModels().walker_a;
    this.mats = new MaterialSet();
    this.model = buildModel(json, { palette: world.palette, types: world.types, mats: this.mats, studM: world.studM, plateM: world.plateM });
    this.model.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    this.group = new THREE.Group(); // position + yaw
    this.group.name = 'player';
    this.group.add(this.model); // lean
    this.walk = new WalkCycle(this.model.userData.parts);
    this.t = 0;
  }

  /** feet: [x, y, z] three.js; yaw: compass radians; speed m/s; travelled m this frame. */
  update(feet, yaw, speed, travelled, dt) {
    this.t += dt;
    this.group.position.set(feet[0], feet[1], feet[2]);
    this.group.rotation.set(0, -yaw, 0);
    this.walk.stride = speed > 2.5 ? 1.1 : 0.7;
    this.walk.update(travelled, speed);
    const lean = -0.09 * Math.min(1, speed / 4);
    this.model.rotation.x += (lean - this.model.rotation.x) * Math.min(1, dt * 8);
    const idle = Math.max(0, 1 - speed / 0.3);
    if (idle > 0) {
      const p = this.model.userData.parts, s = Math.sin(this.t * 1.8) * 0.05 * idle;
      if (p.arm_l) p.arm_l.rotation.x += s;
      if (p.arm_r) p.arm_r.rotation.x -= s;
    }
  }
}
