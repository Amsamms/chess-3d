import * as THREE from 'three';
import { gsap } from 'gsap';

/**
 * Topple the mated king (F13): the checkmated king tips over with a GSAP
 * rotation and a small settling bounce, as if defeated. Pure presentation on the
 * piece's existing mesh; it does not remove the piece from the board (the board
 * is reset on the next game). Honours reduced-motion by simply not running.
 *
 * The fall axis is chosen to lean the king away from the camera-ish forward so
 * the topple reads clearly from a typical vantage; a tiny random sideways skew
 * keeps it from looking mechanical.
 */
export function toppleKing(mesh: THREE.Object3D): void {
  const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  if (reduced) return;

  // Kill any lingering tweens on this mesh so a topple over a mid-move glide or a
  // previous topple does not stack rotations.
  gsap.killTweensOf(mesh.rotation);
  gsap.killTweensOf(mesh.position);

  const baseY = mesh.position.y;
  // Lean direction: bias toward one side with a small random skew so successive
  // games do not look identical.
  const skew = (Math.random() - 0.5) * 0.6;

  const tl = gsap.timeline();
  // Quick teeter, then the fall.
  tl.to(mesh.rotation, {
    z: -0.12 + skew * 0.1,
    duration: 0.18,
    ease: 'power1.out',
  });
  tl.to(mesh.rotation, {
    x: Math.PI * 0.5,
    z: skew,
    duration: 0.55,
    ease: 'power2.in',
  });
  // Small settling bounce as it hits the board.
  tl.to(mesh.position, {
    y: baseY + 0.12,
    duration: 0.12,
    ease: 'power1.out',
  }, '-=0.12');
  tl.to(mesh.position, {
    y: baseY,
    duration: 0.18,
    ease: 'bounce.out',
  });
}
