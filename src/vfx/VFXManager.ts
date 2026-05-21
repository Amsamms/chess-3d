import * as THREE from 'three';
import { ParticleBurst, ParticleKind, BurstOpts } from './Particles';

/**
 * Lifecycle owner of all live particle bursts.
 * Game.update calls tick(dt) each frame; bursts self-destruct on expiry.
 */
export class VFXManager {
  private bursts: ParticleBurst[] = [];

  constructor(private readonly scene: THREE.Scene) {}

  burst(kind: ParticleKind, opts: BurstOpts) {
    const b = new ParticleBurst(this.scene, kind, opts);
    this.bursts.push(b);
    return b;
  }

  /**
   * Spawn a glowing projectile that flies from `from` to `to` over `durationMs`,
   * trailing magic particles, then resolves. Adds a transient point light along the way.
   */
  async projectile(
    from: THREE.Vector3,
    to: THREE.Vector3,
    opts: {
      color?: number;
      trail?: ParticleKind;
      durationMs?: number;
      orbScale?: number;
    } = {},
  ): Promise<void> {
    const color = opts.color ?? 0xa872ff;
    const trail = opts.trail ?? 'magic';
    const duration = opts.durationMs ?? 800;
    const orbScale = opts.orbScale ?? 0.18;

    const orb = new THREE.Mesh(
      new THREE.SphereGeometry(orbScale, 14, 12),
      new THREE.MeshStandardMaterial({
        color, emissive: color, emissiveIntensity: 2.5, roughness: 0.2,
      }),
    );
    const light = new THREE.PointLight(color, 1.6, 4, 1.6);
    orb.add(light);
    orb.position.copy(from);
    this.scene.add(orb);

    const start = performance.now();
    return new Promise((resolve) => {
      const tick = () => {
        const t = Math.min(1, (performance.now() - start) / duration);
        // Arc trajectory: lift slightly toward midpoint
        const p = from.clone().lerp(to, t);
        p.y += Math.sin(t * Math.PI) * 0.4;
        orb.position.copy(p);

        // Trail particles
        if (Math.random() < 0.6) {
          this.burst(trail, {
            origin: p.clone(),
            count: 4,
            spread: 0.1,
            speed: 0.5,
            upward: 0.1,
            lifetimeMs: 600,
            color,
            size: 0.10,
            gravity: 0.0,
          });
        }

        if (t < 1) {
          requestAnimationFrame(tick);
        } else {
          this.scene.remove(orb);
          (orb.geometry as THREE.BufferGeometry).dispose();
          (orb.material as THREE.Material).dispose();
          resolve();
        }
      };
      requestAnimationFrame(tick);
    });
  }

  tick(dtMs: number) {
    for (let i = this.bursts.length - 1; i >= 0; i--) {
      const alive = this.bursts[i]!.tick(dtMs, this.scene);
      if (!alive) this.bursts.splice(i, 1);
    }
  }
}
