import * as THREE from 'three';
import { VFXManager } from './VFXManager';

/**
 * Celebratory particle burst for the winner on checkmate (F13). Reuses the
 * existing VFXManager particle bursts (so it is dt-capped + self-disposing like
 * every other burst) and emits a fountain of bright sparkles plus a couple of
 * colored magic puffs around the mated king. Honours reduced-motion (no-op).
 *
 * Colors are themed to the winner: warm gold for White, cool violet for Black,
 * with a shared bright-white core so it pops under bloom in every realm.
 */
export function celebrate(
  vfx: VFXManager,
  origin: THREE.Vector3,
  winner: 'White' | 'Black',
): void {
  const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  if (reduced) return;

  const warm = 0xffd56b;
  const cool = 0xb27bff;
  const themed = winner === 'White' ? warm : cool;

  // Main upward fountain of sparkles from just above the board.
  const base = origin.clone();
  base.y += 0.6;
  vfx.burst('sparkle', {
    origin: base.clone(),
    count: 140,
    spread: 0.6,
    speed: 3.2,
    upward: 3.0,
    lifetimeMs: 1500,
    gravity: 2.4,
    size: 0.12,
  });

  // A themed colored puff layered over the white sparkles.
  vfx.burst('magic', {
    origin: base.clone(),
    count: 90,
    spread: 0.5,
    speed: 2.4,
    upward: 2.2,
    lifetimeMs: 1700,
    gravity: 1.2,
    color: themed,
    size: 0.16,
  });

  // A couple of staggered secondary pops a touch higher for a fireworks feel.
  const second = base.clone();
  second.y += 1.4;
  setTimeout(() => {
    vfx.burst('sparkle', {
      origin: second.clone(),
      count: 90,
      spread: 1.0,
      speed: 2.6,
      upward: 1.0,
      lifetimeMs: 1300,
      gravity: 2.0,
      color: themed,
      size: 0.13,
    });
  }, 260);
}
