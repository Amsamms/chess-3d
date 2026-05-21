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
 */
export class PostFX {
  readonly composer: EffectComposer;
  readonly bloom: BloomEffect;
  readonly vignette: VignetteEffect;

  constructor(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera) {
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

  render(dtSec: number) {
    this.composer.render(dtSec);
  }
}
