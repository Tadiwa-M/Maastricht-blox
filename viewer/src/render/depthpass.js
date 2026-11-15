// The scene render, keeping its depth (the painted looks read it for focus, outlines and the sky).
// Renders into its own target with a depth texture, then copies the colour on to the composer's
// buffer: one full-screen copy instead of rendering the scene a second time (the AO pass's normal
// render did that, and doubled the draw calls at street level).
import * as THREE from 'three';
import { Pass, FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';
import { CopyShader } from 'three/examples/jsm/shaders/CopyShader.js';

export class DepthRenderPass extends Pass {
  constructor(scene, camera) {
    super();
    this.scene = scene; this.camera = camera;
    this.needsSwap = false; // like RenderPass: the result lands in the read buffer
    this.target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType });
    this.target.depthTexture = new THREE.DepthTexture(1, 1, THREE.UnsignedIntType);
    this.copy = new FullScreenQuad(new THREE.ShaderMaterial({ ...CopyShader, uniforms: THREE.UniformsUtils.clone(CopyShader.uniforms), depthTest: false, depthWrite: false }));
    this.copy.material.uniforms.tDiffuse.value = this.target.texture;
  }

  get depthTexture() { return this.target.depthTexture; }

  setSize(w, h) { this.target.setSize(w, h); }

  render(renderer, writeBuffer, readBuffer) {
    renderer.setRenderTarget(this.target);
    renderer.clear();
    renderer.render(this.scene, this.camera);
    renderer.setRenderTarget(this.renderToScreen ? null : readBuffer);
    this.copy.render(renderer);
  }

  dispose() { this.target.dispose(); this.copy.dispose(); }
}
