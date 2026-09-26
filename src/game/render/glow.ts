// Selective glow (WebGL): only the emissive effects (bolts, additive particles, blast rings)
// are drawn again, on their own layer, into a quarter-size target; UnrealBloomPass blurs them and
// the blur is added over the finished frame. The scene itself is never re-rendered or
// post-processed, so native MSAA and tone mapping stay as they are.
import * as THREE from 'three';
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';

/** Layer of the objects that glow (layers 1 and 2 are WebXR's eyes). */
export const GLOW_LAYER = 10;

export class Glow {
  private readonly target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType });
  private readonly bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.55, 0.3, 0);
  private readonly quad: FullScreenQuad;
  private readonly size = new THREE.Vector2();
  private readonly clearColor = new THREE.Color();

  constructor(private readonly renderer: THREE.WebGLRenderer) {
    this.quad = new FullScreenQuad(
      new THREE.MeshBasicMaterial({ map: this.bloomTexture, blending: THREE.AdditiveBlending, depthTest: false, depthWrite: false, transparent: true, toneMapped: false }),
    );
  }

  private get bloomTexture(): THREE.Texture {
    // UnrealBloomPass leaves the blurred mips, composited, in its first horizontal target.
    return this.bloom.renderTargetsHorizontal[0].texture;
  }

  /** Follows the canvas's drawing-buffer size (call after resizes and pixel-ratio changes). */
  resize(): void {
    this.renderer.getDrawingBufferSize(this.size);
    const w = Math.max(1, Math.round(this.size.x / 4));
    const h = Math.max(1, Math.round(this.size.y / 4));
    this.target.setSize(w, h);
    this.bloom.setSize(w, h);
  }

  /**
   * Adds the glow of `sources` (the groups holding glowing objects) over what is already on
   * screen. Rendering just those groups, not the scene, skips walking every unit and tree again.
   */
  render(sources: readonly THREE.Object3D[], camera: THREE.Camera): void {
    const r = this.renderer;
    const mask = camera.layers.mask;
    const autoClear = r.autoClear;
    r.getClearColor(this.clearColor);
    const clearAlpha = r.getClearAlpha();
    camera.layers.set(GLOW_LAYER);
    r.setRenderTarget(this.target);
    r.setClearColor(0x000000, 0);
    r.clear();
    r.autoClear = false;
    for (const group of sources) {
      // The main render just updated these matrices.
      const autoUpdate = group.matrixWorldAutoUpdate;
      group.matrixWorldAutoUpdate = false;
      r.render(group, camera);
      group.matrixWorldAutoUpdate = autoUpdate;
    }
    camera.layers.mask = mask;
    this.bloom.render(r, this.target, this.target, 0, false);
    r.setRenderTarget(null);
    this.quad.render(r);
    r.autoClear = autoClear;
    r.setClearColor(this.clearColor, clearAlpha);
  }

  dispose(): void {
    this.target.dispose();
    this.bloom.dispose();
    this.quad.material.dispose();
    this.quad.dispose();
  }
}
