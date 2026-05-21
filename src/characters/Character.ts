import * as THREE from 'three';
import { Palette } from './Anatomy';

export type AnimationState = 'idle' | 'walk' | 'cast' | 'capture';

/**
 * Base wrapper for a character. Owns a THREE.Group root that the Piece
 * places on the board, and exposes per-type animation hooks.
 *
 * Subclasses can implement onIdle / onWalk to animate joints.
 */
export abstract class Character {
  readonly root: THREE.Group;
  readonly palette: Palette;
  state: AnimationState = 'idle';
  /** Phase used by walk cycle (in seconds). Advanced only while walking. */
  walkPhase = 0;
  /** Phase used by idle (always advancing). */
  idlePhase = Math.random() * Math.PI * 2;

  constructor(palette: Palette) {
    this.palette = palette;
    this.root = new THREE.Group();
  }

  /** Advance animation. dt in seconds. */
  update(dt: number) {
    this.idlePhase += dt;
    if (this.state === 'walk') {
      this.walkPhase += dt;
      this.onWalk(this.walkPhase);
    } else {
      this.onIdle(this.idlePhase);
    }
  }

  /** Subclasses override to animate idle pose (breath, sway, weapon shimmer). */
  protected onIdle(_t: number) { /* default: noop */ }
  /** Subclasses override for walking. */
  protected onWalk(_t: number) { /* default: noop */ }

  /** Subclasses can override to provide a unique entrance pose (e.g. wizard floats). */
  baseY(): number {
    return 0;
  }

  dispose() {
    this.root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        m.geometry?.dispose();
        const mat = m.material as THREE.Material | THREE.Material[];
        if (Array.isArray(mat)) mat.forEach((mm) => mm.dispose());
        else mat?.dispose();
      }
    });
  }
}
