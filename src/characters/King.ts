import * as THREE from 'three';
import { Character } from './Character';
import {
  Palette,
  makeBeard,
  makeCape,
  makeCrown,
  makeRobe,
  makeScepter,
} from './Anatomy';
import { enableShadows } from './Soldier';

/**
 * King — bearded ruler in royal robes, large crown with cross, holding orb-scepter.
 * Cape with fur trim, broader silhouette than the queen.
 */
export class King extends Character {
  private robe: THREE.Mesh;
  private head: THREE.Group;
  private crown: THREE.Group;
  private cape: THREE.Mesh;
  private scepter: THREE.Group;

  constructor(palette: Palette) {
    super(palette);

    // Royal robe — slightly wider/taller than the queen's gown
    this.robe = makeRobe(palette, 1.42, 0.22, 0.48);
    this.root.add(this.robe);

    // Royal sash across the chest (diagonal cylinder)
    const sash = new THREE.Mesh(
      new THREE.CylinderGeometry(0.04, 0.04, 0.42, 12),
      palette.metalAccent,
    );
    sash.position.y = 1.05;
    sash.rotation.z = 0.55;
    this.root.add(sash);

    // Broader torso under the robe
    const torso = new THREE.Mesh(
      new THREE.CylinderGeometry(0.25, 0.24, 0.40, 18),
      palette.cloth,
    );
    torso.position.y = 1.02;
    this.root.add(torso);

    // Cape behind w/ fur trim
    this.cape = makeCape(palette, 1.10, 0.78);
    this.cape.position.set(0, 0.90, -0.14);
    this.cape.rotation.x = -0.16;
    this.root.add(this.cape);

    // Fur trim along cape top — small spheres in a row
    for (let i = -3; i <= 3; i++) {
      const fur = new THREE.Mesh(
        new THREE.SphereGeometry(0.05, 10, 8),
        new THREE.MeshStandardMaterial({ color: 0xefdcb0, roughness: 0.9 }),
      );
      fur.position.set(i * 0.10, 1.42, -0.14);
      this.root.add(fur);
    }

    // Head
    this.head = new THREE.Group();
    this.head.position.y = 1.50;
    this.root.add(this.head);

    const headMesh = new THREE.Mesh(
      new THREE.SphereGeometry(0.14, 20, 16),
      palette.skin,
    );
    headMesh.scale.set(1.0, 1.1, 1.0);
    this.head.add(headMesh);

    // Beard
    const beard = makeBeard(palette, 0.22);
    beard.position.set(0, -0.06, 0.05);
    this.head.add(beard);

    // Eyes
    for (const sx of [-1, 1]) {
      const eye = new THREE.Mesh(
        new THREE.SphereGeometry(0.015, 8, 8),
        new THREE.MeshStandardMaterial({ color: 0x080404, roughness: 0.3 }),
      );
      eye.position.set(sx * 0.05, 0.02, 0.125);
      this.head.add(eye);
    }

    // Hair / brow
    const brow = new THREE.Mesh(
      new THREE.SphereGeometry(0.13, 18, 12, 0, Math.PI * 2, 0, Math.PI / 2.4),
      palette.hair,
    );
    brow.position.y = 0.04;
    this.head.add(brow);

    // Crown — larger, with central cross
    this.crown = makeCrown(palette, 4, 0.18, 0.14);
    this.crown.position.y = 0.14;
    this.head.add(this.crown);

    // Cross atop the crown
    const crossBar = new THREE.Mesh(
      new THREE.BoxGeometry(0.06, 0.30, 0.06),
      palette.metalAccent,
    );
    crossBar.position.y = 0.36;
    this.head.add(crossBar);
    const crossH = new THREE.Mesh(
      new THREE.BoxGeometry(0.20, 0.06, 0.06),
      palette.metalAccent,
    );
    crossH.position.y = 0.36;
    this.head.add(crossH);
    const crossOrb = new THREE.Mesh(
      new THREE.SphereGeometry(0.04, 14, 12),
      palette.jewel,
    );
    crossOrb.position.y = 0.52;
    this.head.add(crossOrb);

    // Sleeves & hands
    for (const sx of [-1, 1]) {
      const sleeve = new THREE.Mesh(
        new THREE.ConeGeometry(0.13, 0.40, 14, 1, true),
        palette.cloth.clone(),
      );
      sleeve.material.side = THREE.DoubleSide;
      sleeve.position.set(sx * 0.25, 1.02, 0);
      sleeve.rotation.z = sx * 0.42;
      this.root.add(sleeve);

      const hand = new THREE.Mesh(
        new THREE.SphereGeometry(0.04, 10, 8),
        palette.skin,
      );
      hand.position.set(sx * 0.40, 0.84, 0);
      this.root.add(hand);
    }

    // Orb-scepter in right hand
    this.scepter = new THREE.Group();
    const scepterInner = makeScepter(palette, 0.60);
    scepterInner.position.y = 0.30;
    this.scepter.add(scepterInner);
    // Add a larger orb on the scepter top (royal orb)
    const royalOrb = new THREE.Mesh(
      new THREE.SphereGeometry(0.06, 16, 14),
      palette.metalAccent,
    );
    royalOrb.position.y = 0.66;
    this.scepter.add(royalOrb);
    const orbCross = new THREE.Mesh(
      new THREE.BoxGeometry(0.018, 0.07, 0.018),
      palette.metalAccent,
    );
    orbCross.position.y = 0.72;
    this.scepter.add(orbCross);
    this.scepter.position.set(0.40, 0.68, 0.0);
    this.scepter.rotation.z = -0.12;
    this.root.add(this.scepter);

    enableShadows(this.root);
  }

  protected override onIdle(t: number) {
    this.head.rotation.y = Math.sin(t * 0.4) * 0.05;
    this.cape.rotation.y = Math.sin(t * 0.6) * 0.04;
    this.robe.rotation.y = Math.sin(t * 0.35) * 0.02;

    // Crown jewels and orb pulse
    this.crown.children.forEach((c, i) => {
      if (c instanceof THREE.Mesh) {
        const m = c.material as THREE.MeshStandardMaterial;
        if (m.emissiveIntensity !== undefined && m.emissive.getHex() !== 0) {
          m.emissiveIntensity = 0.6 + Math.sin(t * 2 + i) * 0.2;
        }
      }
    });
  }

  protected override onWalk(t: number) {
    this.robe.rotation.z = Math.sin(t * 3.5) * 0.035;
    this.cape.rotation.x = -0.16 + Math.sin(t * 3.5) * 0.07;
    this.root.position.y = Math.abs(Math.sin(t * 3.5)) * 0.05;
  }
}
