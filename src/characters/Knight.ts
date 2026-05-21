import * as THREE from 'three';
import { Character } from './Character';
import {
  HorseJoints,
  HumanoidJoints,
  Palette,
  buildHorse,
  buildHumanoid,
  makeHelmet,
  makeShield,
} from './Anatomy';
import { enableShadows } from './Soldier';

/**
 * Knight on horseback. Full plate armor rider, lance in right hand,
 * shield on left, banner pennant trailing from lance.
 */
export class Knight extends Character {
  private horse: HorseJoints;
  private rider: HumanoidJoints;

  constructor(palette: Palette) {
    super(palette);

    this.horse = buildHorse(palette);
    this.root.add(this.horse.root);

    // ---- Rider — humanoid sitting on saddle
    this.rider = buildHumanoid({
      height: 1.10,
      shoulderWidth: 0.24,
      bodyMat: palette.metal,
      headMat: palette.skin,
      legMat: palette.metal,
      armMat: palette.metal,
    });
    this.rider.root.position.set(0, 1.05, -0.05);
    this.horse.root.add(this.rider.root);

    // Sit pose — legs forward
    this.rider.leftHip.rotation.x = -1.2;
    this.rider.rightHip.rotation.x = -1.2;
    this.rider.leftHip.rotation.z = -0.18;
    this.rider.rightHip.rotation.z = 0.18;

    // Helmet
    const helmet = makeHelmet(palette, true);
    helmet.scale.setScalar(0.9);
    this.rider.head.add(helmet);

    // Shoulder pauldrons
    for (const sgrp of [this.rider.leftShoulder, this.rider.rightShoulder]) {
      const pauld = new THREE.Mesh(
        new THREE.SphereGeometry(0.10, 14, 10, 0, Math.PI * 2, 0, Math.PI / 2),
        palette.metalAccent,
      );
      pauld.scale.set(1.1, 0.85, 1.1);
      sgrp.add(pauld);
    }

    // Chest plate
    const chest = new THREE.Mesh(
      new THREE.SphereGeometry(0.18, 18, 14),
      palette.metalAccent,
    );
    chest.scale.set(1.0, 0.85, 0.65);
    chest.position.y = 0.18;
    this.rider.torso.add(chest);

    // Cape behind rider
    const capeGeo = new THREE.PlaneGeometry(0.55, 0.7, 6, 10);
    {
      const pos = capeGeo.attributes.position!;
      for (let i = 0; i < pos.count; i++) {
        const y = pos.getY(i);
        const t = (y + 0.35) / 0.7;
        pos.setZ(i, Math.sin(t * Math.PI) * 0.08);
      }
      pos.needsUpdate = true;
      capeGeo.computeVertexNormals();
    }
    const capeMat = palette.clothAccent.clone();
    capeMat.side = THREE.DoubleSide;
    const cape = new THREE.Mesh(capeGeo, capeMat);
    cape.position.set(0, 0.10, -0.16);
    this.rider.torso.add(cape);

    // Lance in right hand — long, with pennant
    const lance = new THREE.Group();
    const shaft = new THREE.Mesh(
      new THREE.CylinderGeometry(0.020, 0.024, 1.4, 10),
      palette.leather,
    );
    lance.add(shaft);
    const tip = new THREE.Mesh(
      new THREE.ConeGeometry(0.045, 0.18, 10),
      palette.metal,
    );
    tip.position.y = 0.80;
    lance.add(tip);
    // Pennant flag near top
    const pennantGeo = new THREE.PlaneGeometry(0.20, 0.10);
    const pennantMat = palette.clothAccent.clone();
    pennantMat.side = THREE.DoubleSide;
    const pennant = new THREE.Mesh(pennantGeo, pennantMat);
    pennant.position.set(0.10, 0.65, 0);
    lance.add(pennant);

    lance.position.set(0, 0.35, 0);
    lance.rotation.z = 0.20;
    lance.rotation.x = -0.25;
    this.rider.rightHand.add(lance);

    // Shield on left
    const shield = makeShield(palette, 0.22, 0.32);
    shield.position.set(-0.05, 0.05, 0.06);
    shield.rotation.y = 0.4;
    this.rider.leftHand.add(shield);

    // Hold reins — arms slightly forward
    this.rider.rightShoulder.rotation.x = -0.45;
    this.rider.leftShoulder.rotation.x = -0.20;
    this.rider.leftShoulder.rotation.z = 0.15;

    // Knight + horse is the longest piece (~1.5u deep) — shrink so it fits comfortably in a square.
    this.root.scale.setScalar(0.85);

    enableShadows(this.root);
  }

  protected override onIdle(t: number) {
    // Horse breathes
    this.horse.body.position.y = 0.85 + Math.sin(t * 1.5) * 0.012;
    // Horse head sways
    this.horse.head.rotation.y = Math.sin(t * 0.5) * 0.07;
    // Tail / mane sway happens via individual segments — skip for now
  }

  protected override onWalk(t: number) {
    const gallop = t * 6;
    // Front-left / back-right pair, front-right / back-left pair (canter)
    const a = Math.sin(gallop);
    const b = Math.sin(gallop + Math.PI);
    this.horse.legFL.rotation.x = a * 0.6;
    this.horse.legBR.rotation.x = a * 0.6;
    this.horse.legFR.rotation.x = b * 0.6;
    this.horse.legBL.rotation.x = b * 0.6;
    // Body lift
    this.horse.body.position.y = 0.85 + Math.abs(a) * 0.10;
    this.horse.body.rotation.x = Math.sin(gallop * 0.5) * 0.05;
    // Rider bounces slightly with the horse
    this.rider.root.position.y = 1.05 + Math.abs(a) * 0.06;
  }
}
