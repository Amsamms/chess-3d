import * as THREE from 'three';

/**
 * One realm of look-and-feel (sky / lights / ground / fog / ambient particles).
 * The EnvironmentManager swaps environments by disposing the old group and
 * adopting the new one. Each environment owns ALL its scene additions
 * (lights included) under `group` so disposal is clean.
 */
export abstract class Environment {
  readonly group = new THREE.Group();
  readonly name: string;

  constructor(name: string) {
    this.name = name;
  }

  abstract build(scene: THREE.Scene): void;
  /** Called every frame. dt in seconds. */
  update(_dt: number): void { /* default noop */ }

  dispose() {
    this.group.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        m.geometry?.dispose();
        const mat = m.material as THREE.Material | THREE.Material[];
        if (Array.isArray(mat)) mat.forEach((mm) => mm.dispose());
        else mat?.dispose();
      } else if ((o as THREE.Points).isPoints) {
        const p = o as THREE.Points;
        p.geometry?.dispose();
        (p.material as THREE.Material).dispose();
      }
    });
    this.group.parent?.remove(this.group);
  }
}

export type EnvironmentName = 'gothic-night' | 'garden-day' | 'ice-realm' | 'volcano';
