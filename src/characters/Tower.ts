import * as THREE from 'three';
import { Character } from './Character';
import { Palette } from './Anatomy';
import { enableShadows } from './Soldier';

/**
 * Rook → Stylized fortress tower. Stone cylinder with crenellations, windows,
 * flagpole + flag on top. Doesn't "walk" — slides with subtle stone sway.
 */
export class Tower extends Character {
  private flag: THREE.Mesh;
  private flagBase: THREE.Group;

  constructor(palette: Palette) {
    super(palette);

    // Materials
    const stone = new THREE.MeshStandardMaterial({
      color: palette.cloth.color.getHex() === 0xefdcb0 ? 0x9a8a78 : 0x4a3a4a,
      roughness: 0.88,
      metalness: 0.06,
    });
    const stoneAccent = new THREE.MeshStandardMaterial({
      color: palette.cloth.color.getHex() === 0xefdcb0 ? 0x6a5a48 : 0x2a1a2a,
      roughness: 0.92,
      metalness: 0.06,
    });

    // Wide base
    const base = new THREE.Mesh(
      new THREE.CylinderGeometry(0.48, 0.56, 0.18, 18),
      stoneAccent,
    );
    base.position.y = 0.09;
    this.root.add(base);

    // Main body
    const body = new THREE.Mesh(
      new THREE.CylinderGeometry(0.38, 0.42, 0.95, 22),
      stone,
    );
    body.position.y = 0.18 + 0.475;
    this.root.add(body);

    // Door (dark recess box on the front)
    const door = new THREE.Mesh(
      new THREE.BoxGeometry(0.20, 0.30, 0.04),
      new THREE.MeshStandardMaterial({ color: 0x0a0604, roughness: 0.7 }),
    );
    door.position.set(0, 0.28, 0.40);
    this.root.add(door);

    // Door frame
    const doorFrame = new THREE.Mesh(
      new THREE.BoxGeometry(0.26, 0.36, 0.05),
      stoneAccent,
    );
    doorFrame.position.set(0, 0.28, 0.42);
    this.root.add(doorFrame);

    // Windows (4 small dark squares)
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2;
      const window = new THREE.Mesh(
        new THREE.BoxGeometry(0.06, 0.10, 0.04),
        new THREE.MeshStandardMaterial({
          color: 0xffcc66,
          emissive: 0xff9933,
          emissiveIntensity: 0.4,
          roughness: 0.4,
        }),
      );
      window.position.set(Math.cos(a) * 0.40, 0.78, Math.sin(a) * 0.40);
      window.lookAt(0, 0.78, 0);
      this.root.add(window);
    }

    // Capstone ring
    const cap = new THREE.Mesh(
      new THREE.CylinderGeometry(0.44, 0.40, 0.10, 20),
      stoneAccent,
    );
    cap.position.y = 1.20;
    this.root.add(cap);

    // Crenellations (10 small boxes)
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      const cre = new THREE.Mesh(
        new THREE.BoxGeometry(0.12, 0.14, 0.16),
        stone,
      );
      cre.position.set(Math.cos(a) * 0.40, 1.33, Math.sin(a) * 0.40);
      cre.lookAt(0, 1.33, 0);
      this.root.add(cre);
    }

    // Inner roof — slight dome
    const roof = new THREE.Mesh(
      new THREE.ConeGeometry(0.35, 0.20, 16),
      palette.clothAccent,
    );
    roof.position.y = 1.42;
    this.root.add(roof);

    // Flagpole
    const pole = new THREE.Mesh(
      new THREE.CylinderGeometry(0.012, 0.012, 0.45, 8),
      palette.metalAccent,
    );
    pole.position.y = 1.74;
    this.root.add(pole);

    // Flag — billowy plane attached to a small group so it can wave.
    this.flagBase = new THREE.Group();
    this.flagBase.position.set(0, 1.85, 0);
    this.root.add(this.flagBase);

    const flagGeo = new THREE.PlaneGeometry(0.28, 0.18, 12, 6);
    this.flag = new THREE.Mesh(
      flagGeo,
      new THREE.MeshStandardMaterial({
        color: palette.clothAccent.color,
        roughness: 0.6,
        side: THREE.DoubleSide,
        emissive: palette.clothAccent.emissive,
      }),
    );
    this.flag.position.set(0.14, 0, 0);
    this.flagBase.add(this.flag);

    enableShadows(this.root);
  }

  protected override onIdle(t: number) {
    // Flag waves
    const pos = (this.flag.geometry as THREE.PlaneGeometry).attributes.position!;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const wave = Math.sin(t * 3 + x * 12) * 0.04 * Math.max(0, x + 0.14);
      pos.setZ(i, wave);
    }
    pos.needsUpdate = true;
  }

  protected override onWalk(t: number) {
    // Stronger flag wave during motion + slight body sway
    this.root.rotation.z = Math.sin(t * 6) * 0.03;
    const pos = (this.flag.geometry as THREE.PlaneGeometry).attributes.position!;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const wave = Math.sin(t * 7 + x * 12) * 0.08 * Math.max(0, x + 0.14);
      pos.setZ(i, wave);
    }
    pos.needsUpdate = true;
  }
}
