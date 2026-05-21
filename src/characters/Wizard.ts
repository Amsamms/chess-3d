import * as THREE from 'three';
import { Character } from './Character';
import {
  Palette,
  makeRobe,
  makeStaff,
  makeWizardHat,
  makeBeard,
} from './Anatomy';
import { enableShadows } from './Soldier';

/**
 * Bishop → Wizard / Magician. Long robe, pointed hat, glowing staff,
 * floats slightly off the ground. The orb at top of staff is the primary glow source.
 */
export class Wizard extends Character {
  private robe: THREE.Mesh;
  private head: THREE.Group;
  private staffGroup: THREE.Group;
  private orbLight: THREE.PointLight;
  private orbMesh: THREE.Mesh;
  private hat: THREE.Group;
  private floatBase = 0.04;

  constructor(palette: Palette) {
    super(palette);

    // Robe
    this.robe = makeRobe(palette, 1.15, 0.16, 0.40);
    this.robe.position.y = 0;
    this.root.add(this.robe);

    // Inside the robe top — head + beard
    this.head = new THREE.Group();
    this.head.position.y = 1.10;
    this.root.add(this.head);

    const headMesh = new THREE.Mesh(
      new THREE.SphereGeometry(0.13, 18, 16),
      palette.skin,
    );
    headMesh.scale.set(1.0, 1.05, 1.0);
    this.head.add(headMesh);

    // Beard
    const beard = makeBeard(palette, 0.20);
    beard.position.set(0, -0.04, 0.04);
    this.head.add(beard);

    // Tiny black eyes
    for (const sx of [-1, 1]) {
      const eye = new THREE.Mesh(
        new THREE.SphereGeometry(0.014, 8, 8),
        new THREE.MeshStandardMaterial({ color: 0x080404, roughness: 0.3 }),
      );
      eye.position.set(sx * 0.05, 0.03, 0.115);
      this.head.add(eye);
    }

    // Hat sits on top
    this.hat = makeWizardHat(palette);
    this.hat.position.y = 0.10;
    this.head.add(this.hat);

    // Sleeves of the robe — wide cones extending from the body
    for (const sx of [-1, 1]) {
      const sleeve = new THREE.Mesh(
        new THREE.ConeGeometry(0.14, 0.45, 14, 1, true),
        palette.cloth.clone(),
      );
      sleeve.material.side = THREE.DoubleSide;
      sleeve.position.set(sx * 0.22, 0.80, 0);
      sleeve.rotation.z = sx * 0.45;
      this.root.add(sleeve);

      // Hand peeking out
      const hand = new THREE.Mesh(
        new THREE.SphereGeometry(0.04, 10, 8),
        palette.skin,
      );
      hand.position.set(sx * 0.40, 0.60, 0);
      this.root.add(hand);
    }

    // Staff — held in the right hand
    this.staffGroup = new THREE.Group();
    const staff = makeStaff(palette, 1.45);
    staff.position.y = 0.72;
    this.staffGroup.add(staff);
    this.staffGroup.position.set(0.40, 0, 0);
    this.staffGroup.rotation.z = -0.05;
    this.root.add(this.staffGroup);

    // Capture orb reference for animation + add a real point light to it
    this.orbMesh = staff.children.find(
      (c) => c instanceof THREE.Mesh && (c.geometry as THREE.SphereGeometry).parameters?.radius === 0.08,
    ) as THREE.Mesh;
    this.orbLight = new THREE.PointLight(
      palette.glow.color.getHex(),
      0.6,
      6,
      2,
    );
    this.orbLight.position.copy(this.orbMesh ? this.orbMesh.position : new THREE.Vector3(0, 1.6, 0));
    this.staffGroup.add(this.orbLight);

    enableShadows(this.root);
  }

  override baseY(): number {
    return this.floatBase;
  }

  protected override onIdle(t: number) {
    // Float up and down slowly
    this.root.position.y = this.floatBase + Math.sin(t * 1.4) * 0.04;
    // Hat sways a little
    this.hat.rotation.z = Math.sin(t * 0.8) * 0.05;
    // Robe shimmer — gentle scale breathing
    const b = 1 + Math.sin(t * 1.0) * 0.008;
    this.robe.scale.set(b, 1, b);

    // Orb pulse
    if (this.orbMesh) {
      const mat = this.orbMesh.material as THREE.MeshStandardMaterial;
      mat.emissiveIntensity = 1.4 + Math.sin(t * 2.5) * 0.6;
    }
    this.orbLight.intensity = 0.5 + Math.sin(t * 2.5) * 0.2;

    // Slow rotation of staff
    this.staffGroup.rotation.y = Math.sin(t * 0.3) * 0.06;
  }

  protected override onWalk(t: number) {
    // Drift forward by floating — bigger Y bob & cape ripple
    this.root.position.y = this.floatBase + 0.08 + Math.sin(t * 5) * 0.04;
    // Robe sway
    this.robe.rotation.y = Math.sin(t * 2.2) * 0.08;
    // Staff orb glows brighter while moving
    if (this.orbMesh) {
      const mat = this.orbMesh.material as THREE.MeshStandardMaterial;
      mat.emissiveIntensity = 2.4 + Math.sin(t * 6) * 0.4;
    }
    this.orbLight.intensity = 1.2 + Math.sin(t * 6) * 0.3;
  }
}
