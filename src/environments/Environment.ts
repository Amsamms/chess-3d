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
        disposeMaterials(m.material);
      } else if ((o as THREE.Points).isPoints) {
        const p = o as THREE.Points;
        p.geometry?.dispose();
        disposeMaterials(p.material);
      }
    });
    this.group.parent?.remove(this.group);
  }
}

/**
 * Dispose a material (or array of materials) AND every CanvasTexture / Texture
 * hung off it. Plain material.dispose() does not free GPU textures, so the
 * procedurally generated stone / grass / snow / rock canvas textures leaked
 * roughly a few MB of VRAM on every realm switch. We walk the known PBR texture
 * slots so all four environments benefit without per-environment bookkeeping.
 */
const TEXTURE_SLOTS = [
  'map', 'normalMap', 'roughnessMap', 'metalnessMap',
  'emissiveMap', 'aoMap', 'alphaMap', 'bumpMap',
  'displacementMap', 'lightMap', 'envMap', 'specularMap',
] as const;

function disposeMaterials(mat: THREE.Material | THREE.Material[] | undefined): void {
  if (!mat) return;
  if (Array.isArray(mat)) {
    mat.forEach(disposeOneMaterial);
  } else {
    disposeOneMaterial(mat);
  }
}

function disposeOneMaterial(mat: THREE.Material): void {
  const anyMat = mat as unknown as Record<string, unknown>;
  for (const slot of TEXTURE_SLOTS) {
    const tex = anyMat[slot] as THREE.Texture | null | undefined;
    if (tex && typeof (tex as THREE.Texture).dispose === 'function') {
      tex.dispose();
    }
  }
  mat.dispose();
}

export type EnvironmentName = 'gothic-night' | 'garden-day' | 'ice-realm' | 'volcano';
