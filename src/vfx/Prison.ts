import * as THREE from 'three';
import { gsap } from 'gsap';
import { PieceColor } from '../pieces/PieceFactory';
import { Piece } from '../pieces/Piece';
import { BOARD_DIM } from '../board/coordinates';

/**
 * Prison cage areas to the left/right of the board.
 * Captured white pieces go to the right of the board (where black "keeps trophies"),
 * captured black pieces go to the left.
 * Pieces are flown to a cell, slumped slightly, and dimmed.
 */
export class Prison {
  readonly group = new THREE.Group();
  private blackPrison: PrisonCage; // holds captured WHITE pieces
  private whitePrison: PrisonCage; // holds captured BLACK pieces

  constructor() {
    const halfBoard = BOARD_DIM / 2;
    const prisonX = halfBoard + 3.4;
    this.blackPrison = new PrisonCage('w'); // displays captured whites — themed dark/black side
    this.whitePrison = new PrisonCage('b'); // displays captured blacks — themed light/white side

    this.blackPrison.root.position.set(prisonX, 0, 0);
    this.whitePrison.root.position.set(-prisonX, 0, 0);

    this.group.add(this.blackPrison.root, this.whitePrison.root);
  }

  /**
   * Move a captured piece into the appropriate prison cage with a "dragged in" trajectory.
   * The piece is parented to the prison once it lands so it stays put.
   */
  async imprison(piece: Piece): Promise<void> {
    const cage = piece.color === 'w' ? this.blackPrison : this.whitePrison;
    const slot = cage.nextSlot();
    if (!slot) return;

    // World-space target
    const targetLocal = slot.position.clone();
    const targetWorld = slot.localToWorld(new THREE.Vector3(0, 0, 0));

    // Detach piece from current parent (scene) and animate to the target world pos.
    const mesh = piece.mesh;
    const startWorld = mesh.position.clone();
    const peak = startWorld.clone().lerp(targetWorld, 0.5);
    peak.y += 1.6;

    mesh.visible = true; // make sure it's visible
    // Restore scale (capture might have shrunk it pre-Phase-4; we want full size in prison)
    mesh.scale.set(0.85, 0.85, 0.85);
    mesh.userData.piece = piece;

    await new Promise<void>((resolve) => {
      const proxy = { t: 0 };
      gsap.to(proxy, {
        t: 1,
        duration: 1.3,
        ease: 'power2.in',
        onUpdate: () => {
          const a = startWorld.clone().lerp(peak, proxy.t);
          const b = peak.clone().lerp(targetWorld, proxy.t);
          const p = a.lerp(b, proxy.t);
          mesh.position.copy(p);
          mesh.rotation.y += 0.04;
        },
        onComplete: resolve,
      });
    });

    // Re-parent to the cage slot so further world transforms apply.
    cage.root.attach(mesh);
    mesh.position.copy(targetLocal);
    mesh.rotation.set(0, Math.random() * Math.PI * 2, 0);

    // Hunch / lean — small random tilt to suggest defeat.
    gsap.to(mesh.rotation, {
      z: (Math.random() - 0.5) * 0.3,
      x: 0.05 + Math.random() * 0.05,
      duration: 0.4,
    });

    // Dust puff on landing
    // (Caller's VFXManager handles particle burst; Prison just lands the piece.)
  }
}

/**
 * One side's prison: a stone platform + iron bars overhead + dimmed lighting.
 * Has up to 16 slots arranged in a 4x4 grid.
 */
class PrisonCage {
  readonly root = new THREE.Group();
  private slots: THREE.Group[] = [];
  private nextIdx = 0;

  constructor(side: PieceColor) {
    this.build(side);
  }

  private build(side: PieceColor) {
    const platformMat = new THREE.MeshStandardMaterial({
      color: side === 'w' ? 0x1a0e08 : 0x281828,
      roughness: 0.9,
      metalness: 0.08,
    });
    const barsMat = new THREE.MeshStandardMaterial({
      color: 0x3a3a44,
      roughness: 0.5,
      metalness: 0.85,
      emissive: 0x080608,
    });

    // Stone platform
    const platformW = 2.6;
    const platformD = 2.6;
    const platform = new THREE.Mesh(
      new THREE.BoxGeometry(platformW, 0.2, platformD),
      platformMat,
    );
    platform.position.y = -0.1;
    platform.receiveShadow = true;
    this.root.add(platform);

    // Inner floor inlay
    const innerFloor = new THREE.Mesh(
      new THREE.BoxGeometry(platformW * 0.85, 0.04, platformD * 0.85),
      new THREE.MeshStandardMaterial({
        color: side === 'w' ? 0x2a1c14 : 0x382438,
        roughness: 0.95,
      }),
    );
    innerFloor.position.y = 0.02;
    innerFloor.receiveShadow = true;
    this.root.add(innerFloor);

    // Corner pillars + horizontal bars top
    const pillarH = 1.6;
    const pillarOff = platformW / 2 - 0.18;
    for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]] as const) {
      const pillar = new THREE.Mesh(
        new THREE.CylinderGeometry(0.06, 0.07, pillarH, 10),
        barsMat,
      );
      pillar.position.set(sx * pillarOff, pillarH / 2, sz * pillarOff);
      pillar.castShadow = true;
      this.root.add(pillar);
    }

    // Vertical bars on the four sides
    for (let i = -3; i <= 3; i++) {
      // Front + back walls
      for (const z of [-pillarOff, pillarOff]) {
        const bar = new THREE.Mesh(
          new THREE.CylinderGeometry(0.025, 0.025, pillarH, 8),
          barsMat,
        );
        bar.position.set((i * pillarOff) / 3.5, pillarH / 2, z);
        this.root.add(bar);
      }
      // Left + right walls
      for (const x of [-pillarOff, pillarOff]) {
        const bar = new THREE.Mesh(
          new THREE.CylinderGeometry(0.025, 0.025, pillarH, 8),
          barsMat,
        );
        bar.position.set(x, pillarH / 2, (i * pillarOff) / 3.5);
        this.root.add(bar);
      }
    }

    // Top crossbeams
    for (const z of [-pillarOff, pillarOff]) {
      const beam = new THREE.Mesh(
        new THREE.BoxGeometry(platformW - 0.2, 0.06, 0.06),
        barsMat,
      );
      beam.position.set(0, pillarH + 0.03, z);
      this.root.add(beam);
    }
    for (const x of [-pillarOff, pillarOff]) {
      const beam = new THREE.Mesh(
        new THREE.BoxGeometry(0.06, 0.06, platformW - 0.2),
        barsMat,
      );
      beam.position.set(x, pillarH + 0.03, 0);
      this.root.add(beam);
    }

    // Eerie low light inside
    const cageLight = new THREE.PointLight(
      side === 'w' ? 0xff7a2a : 0x9a4adc,
      0.35, 4, 1.8,
    );
    cageLight.position.set(0, 1.2, 0);
    this.root.add(cageLight);

    // 16 prison slots in a 4x4 grid
    const grid = 4;
    const cell = (platformW * 0.78) / grid;
    for (let i = 0; i < grid; i++) {
      for (let j = 0; j < grid; j++) {
        const slot = new THREE.Group();
        slot.position.set(
          (i - (grid - 1) / 2) * cell,
          0.04,
          (j - (grid - 1) / 2) * cell,
        );
        this.root.add(slot);
        this.slots.push(slot);
      }
    }
  }

  nextSlot(): THREE.Group | null {
    return this.slots[this.nextIdx++] ?? null;
  }

  reset() {
    this.nextIdx = 0;
    // Note: doesn't remove children; Game disposes pieces on reset and clears their meshes.
    for (const s of this.slots) {
      for (let i = s.children.length - 1; i >= 0; i--) s.remove(s.children[i]!);
    }
  }
}
