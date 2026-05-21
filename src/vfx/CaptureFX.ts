import * as THREE from 'three';
import { gsap } from 'gsap';
import { Piece } from '../pieces/Piece';
import { VFXManager } from './VFXManager';
import { Prison } from './Prison';

/**
 * Piece-type-specific capture sequences. Each is a coroutine: the attacker
 * does its signature animation, VFX play on the target, the target reacts,
 * then it's transported to the prison.
 *
 * Called by Game._executeMove right after chess.js state has been updated
 * but before the piece map is re-keyed.
 */
export class CaptureFX {
  constructor(
    _scene: THREE.Scene,
    private readonly vfx: VFXManager,
    private readonly prison: Prison,
  ) {
    void _scene;
  }

  /**
   * Play the attacker's capture animation against target, then imprison target.
   * `attacker` has already moved to `target`'s square — but this is called
   * BEFORE that move animation completes (see Game.executeMove for ordering).
   *
   * Returns once the target has landed in prison.
   */
  async play(attacker: Piece, target: Piece): Promise<void> {
    const targetPos = target.mesh.position.clone();
    targetPos.y += 0.8;

    switch (attacker.type) {
      case 'b': return this.bishopMagic(attacker, target);
      case 'n': return this.knightCharge(attacker, target);
      case 'p': return this.pawnStab(attacker, target);
      case 'r': return this.rookSmash(attacker, target);
      case 'q': return this.queenExplosion(attacker, target);
      case 'k': return this.kingExecute(attacker, target);
    }
  }

  // ===== BISHOP: launches magic ball, target dissolves in sparkles =====
  private async bishopMagic(attacker: Piece, target: Piece) {
    // Caster: raises staff (raise mesh briefly), bright orb pulses
    const attackerWorld = attacker.mesh.position.clone();
    const targetWorld = target.mesh.position.clone();

    // Origin slightly above attacker (where staff orb is)
    const origin = attackerWorld.clone();
    origin.y += 1.6;
    const dest = targetWorld.clone();
    dest.y += 0.6;

    // Brief charge-up at caster
    this.vfx.burst('magic', {
      origin: origin.clone(),
      count: 30,
      spread: 0.2,
      speed: 0.6,
      upward: 0.4,
      lifetimeMs: 700,
    });

    // Projectile flies from caster to target
    await this.vfx.projectile(origin, dest, { color: 0xa872ff, trail: 'magic', durationMs: 700 });

    // IMPACT — big magic burst at target
    this.vfx.burst('magic', {
      origin: dest.clone(),
      count: 200,
      spread: 0.3,
      speed: 3.5,
      upward: 1.4,
      lifetimeMs: 1400,
    });
    this.vfx.burst('sparkle', {
      origin: dest.clone(),
      count: 100,
      spread: 0.4,
      speed: 2.5,
      upward: 1.0,
      lifetimeMs: 1200,
    });

    // Target dissolves: scale down to a flat puck then sweep to prison
    await this.dissolve(target, 0.7);
    await this.prison.imprison(target);
  }

  // ===== KNIGHT: gallops, sword swing on impact =====
  private async knightCharge(attacker: Piece, target: Piece) {
    const targetWorld = target.mesh.position.clone();

    // Wait a beat (knight's gallop is its move arc — already in progress).
    await wait(120);

    // Slash effect at target: arc of sparkles + impact dust
    this.vfx.burst('sparkle', {
      origin: targetWorld.clone().add(new THREE.Vector3(0, 0.7, 0)),
      count: 80,
      spread: 0.15,
      speed: 3.2,
      upward: 0.6,
      lifetimeMs: 700,
      color: 0xfff0c0,
    });
    this.vfx.burst('dust', {
      origin: targetWorld.clone(),
      count: 60,
      spread: 0.35,
      speed: 1.8,
      upward: 0.6,
      lifetimeMs: 1200,
    });
    // Camera-like screen-shake by jolting attacker briefly
    gsap.fromTo(attacker.mesh.position,
      { y: attacker.mesh.position.y + 0.15 },
      { y: attacker.mesh.position.y, duration: 0.4, ease: 'bounce.out' });

    // Target topples — rotate forward + sink
    await this.topple(target, 0.6);
    await this.prison.imprison(target);
  }

  // ===== PAWN: spear thrust =====
  private async pawnStab(attacker: Piece, target: Piece) {
    const targetWorld = target.mesh.position.clone();

    // Lunge: small forward stab of attacker
    const start = attacker.mesh.position.clone();
    const lunge = start.clone().lerp(targetWorld, 0.6);
    await new Promise<void>((resolve) => {
      gsap.to(attacker.mesh.position, {
        x: lunge.x, z: lunge.z,
        duration: 0.18,
        yoyo: true, repeat: 1,
        ease: 'power3.inOut',
        onComplete: resolve,
      });
    });

    // Blood-ish red sparks + dust
    this.vfx.burst('sparkle', {
      origin: targetWorld.clone().add(new THREE.Vector3(0, 0.5, 0)),
      count: 50,
      spread: 0.18,
      speed: 2.4,
      upward: 0.5,
      lifetimeMs: 700,
      color: 0xff5544,
    });
    this.vfx.burst('dust', {
      origin: targetWorld.clone(),
      count: 30,
      spread: 0.2,
      speed: 1.2,
      lifetimeMs: 900,
    });

    await this.topple(target, 0.5);
    await this.prison.imprison(target);
  }

  // ===== ROOK: massive stone-smash =====
  private async rookSmash(_attacker: Piece, target: Piece) {
    const targetWorld = target.mesh.position.clone();
    // Heavy dust burst, dark/heavy
    this.vfx.burst('dust', {
      origin: targetWorld.clone(),
      count: 160,
      spread: 0.5,
      speed: 2.4,
      upward: 0.9,
      lifetimeMs: 1500,
    });
    this.vfx.burst('smoke', {
      origin: targetWorld.clone(),
      count: 80,
      spread: 0.45,
      speed: 1.4,
      upward: 0.5,
      lifetimeMs: 1700,
    });
    // Stone-chip sparkle
    this.vfx.burst('sparkle', {
      origin: targetWorld.clone().add(new THREE.Vector3(0, 0.4, 0)),
      count: 40,
      spread: 0.3,
      speed: 1.6,
      lifetimeMs: 900,
      color: 0xc0a070,
    });

    await this.crushDown(target, 0.7);
    await this.prison.imprison(target);
  }

  // ===== QUEEN: dark void explosion =====
  private async queenExplosion(_attacker: Piece, target: Piece) {
    const targetWorld = target.mesh.position.clone();

    // Shadow vortex
    this.vfx.burst('shadow', {
      origin: targetWorld.clone(),
      count: 220,
      spread: 0.35,
      speed: 3.6,
      upward: 1.4,
      lifetimeMs: 1700,
    });
    this.vfx.burst('magic', {
      origin: targetWorld.clone(),
      count: 100,
      spread: 0.25,
      speed: 2.6,
      lifetimeMs: 1300,
      color: 0xe04acc,
    });
    this.vfx.burst('sparkle', {
      origin: targetWorld.clone().add(new THREE.Vector3(0, 0.5, 0)),
      count: 70,
      spread: 0.35,
      speed: 2.2,
      lifetimeMs: 1100,
      color: 0xffdcff,
    });

    await this.dissolve(target, 0.85);
    await this.prison.imprison(target);
  }

  // ===== KING: rare — overwhelming aura =====
  private async kingExecute(_attacker: Piece, target: Piece) {
    const targetWorld = target.mesh.position.clone();
    this.vfx.burst('sparkle', {
      origin: targetWorld.clone().add(new THREE.Vector3(0, 0.6, 0)),
      count: 160,
      spread: 0.4,
      speed: 2.8,
      upward: 1.0,
      lifetimeMs: 1500,
      color: 0xfff1cc,
    });
    this.vfx.burst('magic', {
      origin: targetWorld.clone(),
      count: 100,
      spread: 0.3,
      speed: 2.0,
      lifetimeMs: 1300,
      color: 0xffe09a,
    });
    await this.topple(target, 0.8);
    await this.prison.imprison(target);
  }

  // ---------- Reactions ----------
  private async dissolve(target: Piece, ms: number) {
    target.alive = false;
    return new Promise<void>((resolve) => {
      gsap.to(target.mesh.scale, {
        x: 0.05, y: 0.05, z: 0.05,
        duration: ms,
        ease: 'power2.in',
      });
      gsap.to(target.mesh.rotation, {
        y: target.mesh.rotation.y + Math.PI * 2,
        duration: ms,
        ease: 'power2.in',
        onComplete: resolve,
      });
    });
  }

  private async topple(target: Piece, ms: number) {
    target.alive = false;
    return new Promise<void>((resolve) => {
      gsap.to(target.mesh.rotation, {
        x: -Math.PI / 2.2,
        duration: ms,
        ease: 'power1.in',
      });
      gsap.to(target.mesh.position, {
        y: target.mesh.position.y - 0.2,
        duration: ms,
        ease: 'power1.in',
        onComplete: resolve,
      });
    });
  }

  private async crushDown(target: Piece, ms: number) {
    target.alive = false;
    return new Promise<void>((resolve) => {
      gsap.to(target.mesh.scale, {
        x: 1.3, y: 0.15, z: 1.3,
        duration: ms,
        ease: 'power2.in',
      });
      gsap.to(target.mesh.position, {
        y: target.mesh.position.y - 0.3,
        duration: ms,
        ease: 'power2.in',
        onComplete: resolve,
      });
    });
  }
}

function wait(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
