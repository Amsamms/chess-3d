import * as THREE from 'three';
import { Character } from './Character';
import {
  HumanoidJoints,
  Palette,
  buildHumanoid,
  makeHelmet,
  makeShield,
  makeSpear,
} from './Anatomy';

/**
 * Pawn → Common soldier. Light armor, conical helmet, spear in right hand,
 * round shield strapped to left forearm.
 */
export class Soldier extends Character {
  private joints: HumanoidJoints;

  constructor(palette: Palette) {
    super(palette);

    const bodyMat = palette.leather.clone();
    bodyMat.color.set(palette.leather.color);
    const armMat = palette.cloth.clone();

    this.joints = buildHumanoid({
      height: 1.35,
      shoulderWidth: 0.28,
      bodyMat: armMat,
      headMat: palette.skin,
      legMat: bodyMat,
      armMat,
    });
    this.root.add(this.joints.root);

    // Helmet on head
    const helmet = makeHelmet(palette, false);
    helmet.scale.setScalar(0.95);
    this.joints.head.add(helmet);

    // Chest plate over torso
    const breast = new THREE.Mesh(
      new THREE.SphereGeometry(0.20, 18, 12),
      palette.metal,
    );
    breast.scale.set(1.05, 0.85, 0.7);
    breast.position.y = 0.22;
    this.joints.torso.add(breast);

    // Belt
    const belt = new THREE.Mesh(
      new THREE.CylinderGeometry(0.21, 0.21, 0.05, 18),
      palette.leather,
    );
    belt.position.y = 0.02;
    this.joints.torso.add(belt);

    // Tunic skirt below belt
    const skirt = new THREE.Mesh(
      new THREE.CylinderGeometry(0.22, 0.28, 0.16, 18, 1, true),
      palette.clothAccent,
    );
    skirt.position.y = -0.06;
    this.joints.torso.add(skirt);

    // Spear in right hand — drop it in then offset rotation
    const spear = makeSpear(palette, 0.85);
    spear.position.set(0, 0.40, 0);
    spear.rotation.z = 0.05;
    this.joints.rightHand.add(spear);

    // Shield strapped to left forearm
    const shield = makeShield(palette, 0.18, 0.26);
    shield.position.set(-0.05, 0.02, 0.04);
    shield.rotation.y = 0.4;
    this.joints.leftHand.add(shield);

    // Arms hang slightly outward by default
    this.joints.leftShoulder.rotation.z = 0.1;
    this.joints.rightShoulder.rotation.z = -0.1;
    // Right arm bent up to hold spear
    this.joints.rightShoulder.rotation.x = -0.35;

    enableShadows(this.root);
  }

  protected override onIdle(t: number) {
    // Subtle breathing — torso scales tiny bit and head bobs.
    const b = Math.sin(t * 1.6) * 0.012;
    this.joints.torso.position.y = b;
    this.joints.head.rotation.y = Math.sin(t * 0.7) * 0.05;
  }

  protected override onWalk(t: number) {
    const swing = Math.sin(t * 9) * 0.55;
    this.joints.leftHip.rotation.x = swing;
    this.joints.rightHip.rotation.x = -swing;
    // Opposite arm swing
    this.joints.leftShoulder.rotation.x = -swing * 0.5 + 0.1;
    this.joints.rightShoulder.rotation.x = swing * 0.5 - 0.35;
    // Body bob
    this.joints.hips.position.y = 0.42 * 1.35 + Math.abs(Math.sin(t * 9)) * 0.05;
  }
}

/**
 * Selective shadow setup. Only meshes whose bounding-sphere radius exceeds
 * `castThreshold` cast shadows — small accents (eyes, jewels, hand bones,
 * crown points) merely receive. Halves shadow-pass draw cost without losing
 * the silhouette shadow under each character.
 */
export function enableShadows(root: THREE.Object3D, castThreshold = 0.08) {
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    m.receiveShadow = true;
    if (!m.geometry.boundingSphere) m.geometry.computeBoundingSphere();
    const r = m.geometry.boundingSphere?.radius ?? 0;
    m.castShadow = r >= castThreshold;
  });
}
