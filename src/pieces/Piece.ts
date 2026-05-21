import * as THREE from 'three';
import { gsap } from 'gsap';
import { PieceColor, PieceType } from './PieceFactory';
import { SquareCoord, squareToWorld } from '../board/coordinates';
import { Character } from '../characters/Character';
import { MovementStyle, PieceSetName } from '../sets/PieceSet';
import { buildPiece } from '../sets/PieceSetFactory';

let nextId = 1;

/**
 * A chess piece: pairs a visual (either a Character with animation,
 * or a procedural mesh) with its board state.
 */
export class Piece {
  readonly id: number;
  readonly color: PieceColor;
  readonly type: PieceType;
  readonly set: PieceSetName;
  readonly character: Character | null;
  /** Three.js root group exposed to the scene/raycaster. */
  readonly mesh: THREE.Group;
  readonly motion: MovementStyle;
  readonly baseY: number;
  coord: SquareCoord;
  private selectedGlowTween?: gsap.core.Tween;
  alive = true;

  constructor(color: PieceColor, type: PieceType, coord: SquareCoord, set: PieceSetName) {
    this.id = nextId++;
    this.color = color;
    this.type = type;
    this.set = set;
    this.coord = coord;

    const build = buildPiece(set, type, color);
    this.character = build.character;
    this.mesh = build.mesh;
    this.motion = build.motion;
    this.baseY = build.baseY;

    this.mesh.rotation.y = color === 'w' ? Math.PI : 0;
    const pos = squareToWorld(coord, this.baseY);
    this.mesh.position.copy(pos);

    this.mesh.userData = { kind: 'piece', piece: this };
    this.mesh.traverse((o) => {
      o.userData.piece = this;
      o.userData.kind = 'piece';
    });
  }

  update(dtSec: number) {
    this.character?.update(dtSec);
  }

  /** Move to a new square using this piece's motion style. */
  async moveTo(coord: SquareCoord, durationMs = 900): Promise<void> {
    this.coord = coord;
    const target = squareToWorld(coord, this.baseY);
    const start = this.mesh.position.clone();
    if (this.character) this.character.state = 'walk';

    try {
      switch (this.motion) {
        case 'march':    await this._motionMarch(start, target, durationMs); break;
        case 'leap':     await this._motionLeap(start, target, durationMs); break;
        case 'spin':     await this._motionSpin(start, target, durationMs); break;
        case 'roll':     await this._motionRoll(start, target, durationMs); break;
        case 'levitate': await this._motionLevitate(start, target, durationMs); break;
        case 'hover':    await this._motionHover(start, target, durationMs); break;
        case 'gallop':   await this._motionArc(start, target, durationMs * 0.85, /*yaw*/ true, /*hopMul*/ 0.6); break;
        case 'arc':
        default:         await this._motionArc(start, target, durationMs, /*yaw*/ true, /*hopMul*/ 1.0); break;
      }
    } finally {
      if (this.character) this.character.state = 'idle';
    }
  }

  // ----- Motion implementations -----

  private async _motionArc(start: THREE.Vector3, target: THREE.Vector3, durationMs: number, yaw: boolean, hopMul: number): Promise<void> {
    const peak = start.clone().lerp(target, 0.5);
    const dist = start.distanceTo(target);
    peak.y += Math.min(0.55, 0.2 + dist * 0.06) * hopMul;
    const dir = new THREE.Vector3().subVectors(target, start).setY(0);
    const desiredYaw = yaw && dir.lengthSq() > 1e-6 ? Math.atan2(dir.x, dir.z) : this.mesh.rotation.y;

    await this._tween({ t: 0, yaw: this.mesh.rotation.y }, { t: 1, yaw: desiredYaw }, durationMs, 'power2.inOut', (s) => {
      const a = start.clone().lerp(peak, s.t);
      const b = peak.clone().lerp(target, s.t);
      this.mesh.position.copy(a.lerp(b, s.t));
      if (yaw) this.mesh.rotation.y = s.yaw;
    });
    this.mesh.position.copy(target);
    if (yaw) this.mesh.rotation.y = desiredYaw;
  }

  /** Stiff hop-step march — 2-3 small hops to destination. */
  private async _motionMarch(start: THREE.Vector3, target: THREE.Vector3, durationMs: number): Promise<void> {
    const dir = new THREE.Vector3().subVectors(target, start).setY(0);
    const desiredYaw = dir.lengthSq() > 1e-6 ? Math.atan2(dir.x, dir.z) : this.mesh.rotation.y;
    // Rotate toward target first
    await this._tween({ y: this.mesh.rotation.y }, { y: desiredYaw }, 150, 'power1.out', (s) => {
      this.mesh.rotation.y = s.y;
    });
    // Hop-step: 2 hops with brief plant in between
    const mid = start.clone().lerp(target, 0.5);
    await this._stepHop(start, mid, durationMs * 0.45);
    await this._stepHop(mid, target, durationMs * 0.55);
  }

  private async _stepHop(from: THREE.Vector3, to: THREE.Vector3, ms: number): Promise<void> {
    const peak = from.clone().lerp(to, 0.5);
    peak.y += 0.18;
    await this._tween({ t: 0 }, { t: 1 }, ms, 'power1.inOut', (s) => {
      const a = from.clone().lerp(peak, s.t);
      const b = peak.clone().lerp(to, s.t);
      this.mesh.position.copy(a.lerp(b, s.t));
    });
  }

  /** L-shape leap for knight: huge arc with mid-air yaw change toward final direction. */
  private async _motionLeap(start: THREE.Vector3, target: THREE.Vector3, durationMs: number): Promise<void> {
    const dx = target.x - start.x;
    const dz = target.z - start.z;
    // Pick the "long arm" of the L: whichever axis has the larger delta is traversed first.
    const longerOnX = Math.abs(dx) > Math.abs(dz);
    const elbow = longerOnX
      ? new THREE.Vector3(target.x, start.y, start.z)
      : new THREE.Vector3(start.x, start.y, target.z);
    const peakY = Math.max(start.y, target.y) + 1.4;
    const apex = elbow.clone().lerp(target, 0.5);
    apex.y = peakY;

    // Yaw toward the LONG arm first, then to the final target
    const long = new THREE.Vector3().subVectors(elbow, start).setY(0);
    const final = new THREE.Vector3().subVectors(target, elbow).setY(0);
    const longYaw  = long.lengthSq()  > 1e-6 ? Math.atan2(long.x, long.z)  : this.mesh.rotation.y;
    const finalYaw = final.lengthSq() > 1e-6 ? Math.atan2(final.x, final.z) : longYaw;

    // First half: rise, travel along long arm, midair pivot toward final
    await this._tween({ t: 0 }, { t: 1 }, durationMs * 0.55, 'power2.out', (s) => {
      // Cubic bezier-ish: start → apex (over the elbow area)
      const e = start.clone().lerp(elbow, s.t);
      e.y = start.y + (peakY - start.y) * (s.t * (2 - s.t));
      this.mesh.position.copy(e);
      // Yaw blends start → long
      this.mesh.rotation.y = lerpAngle(this.mesh.rotation.y, longYaw, s.t);
    });
    // Second half: drop from apex to target
    await this._tween({ t: 0 }, { t: 1 }, durationMs * 0.45, 'power2.in', (s) => {
      const from = apex.clone();
      const to = target.clone();
      const p = from.lerp(to, s.t);
      p.y = peakY + (target.y - peakY) * (s.t * s.t);
      this.mesh.position.copy(p);
      this.mesh.rotation.y = lerpAngle(longYaw, finalYaw, s.t);
    });
    this.mesh.position.copy(target);
    this.mesh.rotation.y = finalYaw;
  }

  /** Bishop spin — pirouette once full rotation while gliding diagonally. */
  private async _motionSpin(start: THREE.Vector3, target: THREE.Vector3, durationMs: number): Promise<void> {
    const peak = start.clone().lerp(target, 0.5);
    peak.y += 0.5;
    const startYaw = this.mesh.rotation.y;
    const endYaw = startYaw + Math.PI * 2; // full pirouette

    await this._tween({ t: 0, y: startYaw }, { t: 1, y: endYaw }, durationMs, 'power1.inOut', (s) => {
      const a = start.clone().lerp(peak, s.t);
      const b = peak.clone().lerp(target, s.t);
      this.mesh.position.copy(a.lerp(b, s.t));
      this.mesh.rotation.y = s.y;
    });
    this.mesh.position.copy(target);
    this.mesh.rotation.y = endYaw % (Math.PI * 2);
  }

  /** Rook roll — tumbles forward (rotates around the axis perpendicular to motion). */
  private async _motionRoll(start: THREE.Vector3, target: THREE.Vector3, durationMs: number): Promise<void> {
    const dir = new THREE.Vector3().subVectors(target, start).setY(0);
    const dist = dir.length();
    if (dist < 1e-6) return;
    const yaw = Math.atan2(dir.x, dir.z);
    // Rotation axis = world-X-axis but in the piece's local frame after yaw alignment.
    // Easier: rotate the WHOLE group around its own X after temporary yaw rotation.
    // We'll keep yaw, and accumulate "tumble" via mesh.rotation.x.
    // Number of full forward tumbles based on distance — 1 tumble per ~1.4 board unit.
    const tumbles = Math.max(1, Math.round(dist / 1.4));
    const startX = this.mesh.rotation.x;
    const endX = startX + tumbles * Math.PI * 2;

    const peak = start.clone().lerp(target, 0.5);
    peak.y += 0.15;

    // Pre-align yaw so X-rotation tumbles forward through the direction of travel
    await this._tween({ y: this.mesh.rotation.y }, { y: yaw }, 140, 'power1.out', (s) => {
      this.mesh.rotation.y = s.y;
    });

    await this._tween({ t: 0, x: startX }, { t: 1, x: endX }, durationMs, 'power1.inOut', (s) => {
      const a = start.clone().lerp(peak, s.t);
      const b = peak.clone().lerp(target, s.t);
      this.mesh.position.copy(a.lerp(b, s.t));
      this.mesh.rotation.x = s.x;
    });
    this.mesh.position.copy(target);
    this.mesh.rotation.x = 0; // snap back to upright
  }

  /** Levitate — rises high, hovers slightly, descends gracefully. */
  private async _motionLevitate(start: THREE.Vector3, target: THREE.Vector3, durationMs: number): Promise<void> {
    const liftY = Math.max(start.y, target.y) + 1.6;
    // Phase 1: rise straight up (35%)
    await this._tween({ t: 0 }, { t: 1 }, durationMs * 0.35, 'power2.out', (s) => {
      const p = start.clone();
      p.y = start.y + (liftY - start.y) * s.t;
      this.mesh.position.copy(p);
    });
    // Phase 2: glide across at altitude with gentle sway (40%)
    await this._tween({ t: 0 }, { t: 1 }, durationMs * 0.40, 'sine.inOut', (s) => {
      const p = new THREE.Vector3().lerpVectors(start, target, s.t);
      p.y = liftY + Math.sin(s.t * Math.PI) * 0.15;
      this.mesh.position.copy(p);
    });
    // Phase 3: descend (25%)
    await this._tween({ t: 0 }, { t: 1 }, durationMs * 0.25, 'power2.in', (s) => {
      const p = target.clone();
      p.y = liftY + (target.y - liftY) * s.t;
      this.mesh.position.copy(p);
    });
    this.mesh.position.copy(target);
  }

  /** Hover — Neon style: smooth linear glide just above board with subtle bob. */
  private async _motionHover(start: THREE.Vector3, target: THREE.Vector3, durationMs: number): Promise<void> {
    const dir = new THREE.Vector3().subVectors(target, start).setY(0);
    const desiredYaw = dir.lengthSq() > 1e-6 ? Math.atan2(dir.x, dir.z) : this.mesh.rotation.y;
    await this._tween({ t: 0, y: this.mesh.rotation.y }, { t: 1, y: desiredYaw }, durationMs, 'power1.inOut', (s) => {
      const p = start.clone().lerp(target, s.t);
      p.y += Math.sin(s.t * Math.PI) * 0.18;
      this.mesh.position.copy(p);
      this.mesh.rotation.y = s.y;
    });
    this.mesh.position.copy(target);
    this.mesh.rotation.y = desiredYaw;
  }

  private _tween<T extends Record<string, number>>(from: T, to: T, ms: number, ease: string, onUpdate: (s: T) => void): Promise<void> {
    return new Promise((resolve) => {
      const proxy: Record<string, number> = { ...from };
      gsap.to(proxy, {
        ...to,
        duration: ms / 1000,
        ease,
        onUpdate: () => onUpdate(proxy as T),
        onComplete: () => resolve(),
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

  async capture(): Promise<void> {
    this.alive = false;
    if (this.character) this.character.state = 'capture';
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
    if (this.character) {
      this.character.dispose();
    } else {
      // Manually dispose mesh resources
      this.mesh.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) {
          m.geometry?.dispose();
          const mat = m.material as THREE.Material | THREE.Material[];
          if (Array.isArray(mat)) mat.forEach((mm) => mm.dispose());
          else mat?.dispose();
        }
      });
    }
  }
}

function lerpAngle(a: number, b: number, t: number): number {
  // Shortest-path angle lerp
  let diff = b - a;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  return a + diff * t;
}
