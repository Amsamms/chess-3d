import * as THREE from 'three';
import {
  BloomEffect,
  EffectComposer,
  EffectPass,
  RenderPass,
  VignetteEffect,
  KernelSize,
  BlendFunction,
} from 'postprocessing';

/**
 * Wraps the renderer with a post-processing chain:
 * RenderPass → BloomEffect (selective on emissive) → VignetteEffect.
 * Replaces direct renderer.render() with composer.render().
 *
 * Mobile/low-quality path: setBypass(true) skips the composer entirely and
 * calls the raw three.js renderer — avoids the bloom mip chain + vignette pass.
 */
export class PostFX {
  readonly composer: EffectComposer;
  readonly bloom: BloomEffect;
  readonly vignette: VignetteEffect;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene: THREE.Scene;
  private readonly camera: THREE.Camera;
  private bypass = false;

  constructor(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera) {
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;

    this.composer = new EffectComposer(renderer);
    this.composer.addPass(new RenderPass(scene, camera));

    this.bloom = new BloomEffect({
      intensity: 1.25,
      luminanceThreshold: 0.45,
      luminanceSmoothing: 0.4,
      kernelSize: KernelSize.LARGE,
      mipmapBlur: true,
    });

    this.vignette = new VignetteEffect({
      darkness: 0.55,
      offset: 0.35,
      blendFunction: BlendFunction.NORMAL,
    });

    this.composer.addPass(new EffectPass(camera, this.bloom, this.vignette));
  }

  setSize(w: number, h: number) {
    this.composer.setSize(w, h);
  }

  /** Toggle the post-FX chain. When true, render() calls the raw renderer instead. */
  setBypass(bypass: boolean) {
    this.bypass = bypass;
  }

  render(dtSec: number) {
    if (this.bypass) {
      this.renderer.render(this.scene, this.camera);
    } else {
      this.composer.render(dtSec);
    }
  }
}
