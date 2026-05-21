import * as THREE from 'three';
import { Character } from './Character';
import {
  Palette,
  makeCape,
  makeCrown,
  makeRobe,
  makeScepter,
} from './Anatomy';
import { enableShadows } from './Soldier';

/**
 * Queen — regal woman in long gown, ornate crown with jewels, scepter in right hand.
 * Long flowing hair, cape behind.
 */
export class Queen extends Character {
  private gown: THREE.Mesh;
  private head: THREE.Group;
  private crown: THREE.Group;
  private scepter: THREE.Group;
  private cape: THREE.Mesh;

  constructor(palette: Palette) {
    super(palette);

    // Gown — taller than wizard robe, flares more at bottom
    this.gown = makeRobe(palette, 1.30, 0.18, 0.42);
    this.root.add(this.gown);

    // Bodice — fitted upper torso (lighter accent color)
    const bodice = new THREE.Mesh(
      new THREE.CylinderGeometry(0.19, 0.21, 0.35, 18),
      palette.clothAccent,
    );
    bodice.position.y = 1.00;
    this.root.add(bodice);

    // Hair behind the head — long, flowing curve
    const hair = new THREE.Mesh(
      new THREE.CylinderGeometry(0.10, 0.16, 0.42, 14, 1, true, Math.PI * 0.25, Math.PI * 1.5),
      palette.hair,
    );
    hair.position.y = 1.10;
    hair.position.z = -0.06;
    this.root.add(hair);

    // Head
    this.head = new THREE.Group();
    this.head.position.y = 1.34;
    this.root.add(this.head);

    const headMesh = new THREE.Mesh(
      new THREE.SphereGeometry(0.12, 20, 18),
      palette.skin,
    );
    headMesh.scale.set(0.95, 1.05, 0.95);
    this.head.add(headMesh);

    // Eyes
    for (const sx of [-1, 1]) {
      const eye = new THREE.Mesh(
        new THREE.SphereGeometry(0.013, 8, 8),
        new THREE.MeshStandardMaterial({ color: 0x080404, roughness: 0.3 }),
      );
      eye.position.set(sx * 0.045, 0.015, 0.105);
      this.head.add(eye);
    }
    // Lips
    const lips = new THREE.Mesh(
      new THREE.SphereGeometry(0.020, 8, 6),
      new THREE.MeshStandardMaterial({ color: 0x8a2a2a, roughness: 0.3 }),
    );
    lips.scale.set(1, 0.4, 0.6);
    lips.position.set(0, -0.04, 0.108);
    this.head.add(lips);

    // Hair fringe on top
    const fringe = new THREE.Mesh(
      new THREE.SphereGeometry(0.13, 18, 12, 0, Math.PI * 2, 0, Math.PI / 2.6),
      palette.hair,
    );
    fringe.scale.set(1.0, 0.7, 1.0);
    fringe.position.y = 0.02;
    this.head.add(fringe);

    // Crown
    this.crown = makeCrown(palette, 8, 0.16, 0.10);
    this.crown.position.y = 0.10;
    this.head.add(this.crown);

    // Cape behind, attached at shoulders
    this.cape = makeCape(palette, 0.95, 0.65);
    this.cape.position.set(0, 0.82, -0.12);
    this.cape.rotation.x = -0.15;
    this.root.add(this.cape);

    // Sleeves (cones flaring outward)
    for (const sx of [-1, 1]) {
      const sleeve = new THREE.Mesh(
        new THREE.ConeGeometry(0.12, 0.35, 14, 1, true),
        palette.cloth.clone(),
      );
      sleeve.material.side = THREE.DoubleSide;
      sleeve.position.set(sx * 0.22, 0.95, 0);
      sleeve.rotation.z = sx * 0.42;
      this.root.add(sleeve);

      // Hand
      const hand = new THREE.Mesh(
        new THREE.SphereGeometry(0.035, 10, 8),
        palette.skin,
      );
      hand.position.set(sx * 0.36, 0.78, 0);
      this.root.add(hand);
    }

    // Scepter in right hand
    this.scepter = new THREE.Group();
    const scepterInner = makeScepter(palette, 0.55);
    scepterInner.position.y = 0.28;
    this.scepter.add(scepterInner);
    this.scepter.position.set(0.36, 0.65, 0.0);
    this.scepter.rotation.z = -0.12;
    this.root.add(this.scepter);

    enableShadows(this.root);
  }

  protected override onIdle(t: number) {
    // Subtle sway of cape & gown
    this.cape.rotation.y = Math.sin(t * 0.8) * 0.05;
    this.gown.rotation.y = Math.sin(t * 0.4) * 0.03;
    this.head.rotation.y = Math.sin(t * 0.5) * 0.06;

    // Crown jewels pulse subtly
    this.crown.children.forEach((c, i) => {
      if (c instanceof THREE.Mesh && (c.material as THREE.MeshStandardMaterial).emissive) {
        const mat = c.material as THREE.MeshStandardMaterial;
        if (mat.emissive && mat.emissiveIntensity !== undefined) {
          mat.emissiveIntensity = 0.6 + Math.sin(t * 2 + i) * 0.2;
        }
      }
    });

    // Scepter jewel pulses
    const jewel = this.scepter.children[0]?.children?.find(
      (c) => c instanceof THREE.Mesh && (c.material as THREE.MeshStandardMaterial).emissiveIntensity !== undefined,
    ) as THREE.Mesh | undefined;
    if (jewel) {
      const m = jewel.material as THREE.MeshStandardMaterial;
      m.emissiveIntensity = 0.8 + Math.sin(t * 2.5) * 0.3;
    }
  }

  protected override onWalk(t: number) {
    // Glide forward — gown swishes side to side
    this.gown.rotation.z = Math.sin(t * 4) * 0.04;
    this.cape.rotation.x = -0.15 + Math.sin(t * 4) * 0.06;
    // Slight body bob
    this.root.position.y = Math.abs(Math.sin(t * 4)) * 0.04;
  }
}
