import * as THREE from 'three';
import { gsap } from 'gsap';
import { PieceColor, PieceType } from './PieceFactory';
import { SquareCoord, squareToWorld } from '../board/coordinates';
import { Character } from '../characters/Character';
import { createCharacter } from '../characters/CharacterFactory';

let nextId = 1;

/**
 * A chess piece: pairs a Character (visual + animation) with its board state.
 */
export class Piece {
  readonly id: number;
  readonly color: PieceColor;
  readonly type: PieceType;
  readonly character: Character;
  /** Three.js root group exposed to the scene/raycaster. */
  readonly mesh: THREE.Group;
  coord: SquareCoord;
  private selectedGlowTween?: gsap.core.Tween;
  alive = true;

  constructor(color: PieceColor, type: PieceType, coord: SquareCoord) {
    this.id = nextId++;
    this.color = color;
    this.type = type;
    this.coord = coord;
    this.character = createCharacter(type, color);
    this.mesh = this.character.root;

    // Face the opponent (white looks toward -Z, black toward +Z).
    this.mesh.rotation.y = color === 'w' ? Math.PI : 0;

    const pos = squareToWorld(coord, this.character.baseY());
    this.mesh.position.copy(pos);

    // Attach back-pointer for raycasting (recursive — every child carries it).
    this.mesh.userData = { kind: 'piece', piece: this };
    this.mesh.traverse((o) => {
      o.userData.piece = this;
      o.userData.kind = 'piece';
    });
  }

  update(dtSec: number) {
    this.character.update(dtSec);
  }

  /** Move to a new square. Character state switches to 'walk' for the duration. */
  async moveTo(coord: SquareCoord, durationMs = 900): Promise<void> {
    this.coord = coord;
    const baseY = this.character.baseY();
    const target = squareToWorld(coord, baseY);
    const start = this.mesh.position.clone();

    // Hop arc + face direction
    const peak = start.clone().lerp(target, 0.5);
    const dist = start.distanceTo(target);
    peak.y += Math.min(0.55, 0.2 + dist * 0.06);

    const dir = new THREE.Vector3().subVectors(target, start).setY(0);
    const desiredYaw = dir.lengthSq() > 1e-6 ? Math.atan2(dir.x, dir.z) : this.mesh.rotation.y;

    this.character.state = 'walk';

    await new Promise<void>((resolve) => {
      const proxy = { t: 0, yaw: this.mesh.rotation.y };
      gsap.to(proxy, {
        t: 1,
        yaw: desiredYaw,
        duration: durationMs / 1000,
        ease: 'power2.inOut',
        onUpdate: () => {
          const a = start.clone().lerp(peak, proxy.t);
          const b = peak.clone().lerp(target, proxy.t);
          const p = a.lerp(b, proxy.t);
          this.mesh.position.copy(p);
          this.mesh.rotation.y = proxy.yaw;
        },
        onComplete: () => {
          this.mesh.position.copy(target);
          this.mesh.rotation.y = desiredYaw;
          this.character.state = 'idle';
          resolve();
        },
      });
    });
  }

  /** Per-instance selection — gentle scale + Y bob (materials are shared, can't pulse them). */
  setSelected(selected: boolean) {
    this.selectedGlowTween?.kill();
    if (selected) {
      this.selectedGlowTween = gsap.to(this.mesh.scale, {
        x: 1.08, y: 1.08, z: 1.08,
        duration: 0.55,
        repeat: -1,
        yoyo: true,
        ease: 'sine.inOut',
      });
    } else {
      gsap.killTweensOf(this.mesh.scale);
      gsap.to(this.mesh.scale, { x: 1, y: 1, z: 1, duration: 0.25, ease: 'power2.out' });
    }
  }

  /** Simple capture: shrink, sink, fade then dispose. (Phase 4 will replace with epic VFX.) */
  async capture(): Promise<void> {
    this.alive = false;
    this.character.state = 'capture';
    await new Promise<void>((resolve) => {
      gsap.to(this.mesh.scale, {
        x: 0.01, y: 0.01, z: 0.01,
        duration: 0.7,
        ease: 'power2.in',
      });
      gsap.to(this.mesh.position, {
        y: this.mesh.position.y - 0.3,
        duration: 0.7,
        ease: 'power1.in',
        onComplete: resolve,
      });
    });
  }

  dispose() {
    this.character.dispose();
  }
}
