import * as THREE from 'three';

/**
 * One-shot particle burst. Each call adds a Points object to the scene
 * that lives for `lifetimeMs` then removes & disposes itself.
 *
 * `kind` controls visual: 'sparkle' = bright twinkling motes,
 * 'smoke' = soft expanding puff, 'magic' = colored swirling streamers,
 * 'dust' = dirty rising flecks.
 */
export type ParticleKind = 'sparkle' | 'smoke' | 'magic' | 'dust' | 'shadow';

export interface BurstOpts {
  count?: number;
  origin: THREE.Vector3;
  color?: number;
  color2?: number;
  spread?: number;
  speed?: number;
  upward?: number;
  lifetimeMs?: number;
  gravity?: number;
  size?: number;
}

export class ParticleBurst {
  readonly points: THREE.Points;
  private readonly velocities: Float32Array;
  private readonly startTime = performance.now();
  private readonly lifetimeMs: number;
  private readonly gravity: number;
  private readonly material: THREE.PointsMaterial;
  private done = false;

  constructor(scene: THREE.Scene, kind: ParticleKind, opts: BurstOpts) {
    const count = opts.count ?? defaultCountFor(kind);
    const positions = new Float32Array(count * 3);
    this.velocities = new Float32Array(count * 3);
    const spread = opts.spread ?? 0.2;
    const speed = opts.speed ?? 1.6;
    const upward = opts.upward ?? 0.4;

    for (let i = 0; i < count; i++) {
      positions[i * 3] = opts.origin.x + (Math.random() - 0.5) * spread;
      positions[i * 3 + 1] = opts.origin.y + (Math.random() - 0.5) * spread * 0.5;
      positions[i * 3 + 2] = opts.origin.z + (Math.random() - 0.5) * spread;

      const a = Math.random() * Math.PI * 2;
      const r = Math.random();
      const horizontal = speed * (0.4 + r * 0.6);
      this.velocities[i * 3] = Math.cos(a) * horizontal;
      this.velocities[i * 3 + 1] = upward + (Math.random() - 0.3) * speed;
      this.velocities[i * 3 + 2] = Math.sin(a) * horizontal;
    }

    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));

    const color = opts.color ?? defaultColorFor(kind);
    this.material = new THREE.PointsMaterial({
      color,
      size: opts.size ?? defaultSizeFor(kind),
      transparent: true,
      opacity: 1.0,
      depthWrite: false,
      blending: kind === 'sparkle' || kind === 'magic' ? THREE.AdditiveBlending : THREE.NormalBlending,
      sizeAttenuation: true,
      map: spriteTexture(kind),
    });
    this.points = new THREE.Points(geom, this.material);
    scene.add(this.points);

    this.lifetimeMs = opts.lifetimeMs ?? defaultLifetimeFor(kind);
    this.gravity = opts.gravity ?? defaultGravityFor(kind);
  }

  /** Step forward — call once per frame. Returns true if still alive. */
  tick(dtMs: number, scene: THREE.Scene): boolean {
    if (this.done) return false;
    const dt = dtMs * 0.001;
    const age = performance.now() - this.startTime;
    const lifeT = age / this.lifetimeMs;
    if (lifeT >= 1) {
      this.done = true;
      scene.remove(this.points);
      this.points.geometry.dispose();
      this.material.dispose();
      return false;
    }
    const pos = this.points.geometry.attributes.position!.array as Float32Array;
    for (let i = 0; i < pos.length; i += 3) {
      pos[i] += this.velocities[i] * dt;
      pos[i + 1] += this.velocities[i + 1] * dt;
      pos[i + 2] += this.velocities[i + 2] * dt;
      this.velocities[i + 1] -= this.gravity * dt;
    }
    this.points.geometry.attributes.position!.needsUpdate = true;

    // Fade out over second half of life
    if (lifeT > 0.5) {
      this.material.opacity = Math.max(0, 1 - (lifeT - 0.5) * 2);
    }
    return true;
  }
}

function defaultCountFor(k: ParticleKind): number {
  return ({ sparkle: 80, magic: 120, smoke: 60, dust: 50, shadow: 100 })[k];
}
function defaultColorFor(k: ParticleKind): number {
  return ({
    sparkle: 0xfff1cc,
    magic: 0xa872ff,
    smoke: 0x6a5060,
    dust: 0x7a6a52,
    shadow: 0x2a0c4a,
  })[k];
}
function defaultSizeFor(k: ParticleKind): number {
  return ({ sparkle: 0.10, magic: 0.18, smoke: 0.35, dust: 0.16, shadow: 0.25 })[k];
}
function defaultLifetimeFor(k: ParticleKind): number {
  return ({ sparkle: 1100, magic: 1600, smoke: 1800, dust: 1300, shadow: 1500 })[k];
}
function defaultGravityFor(k: ParticleKind): number {
  return ({ sparkle: 1.2, magic: 0.4, smoke: -0.4, dust: 0.6, shadow: 0.2 })[k];
}

// Sprite textures cached per kind.
const spriteCache = new Map<ParticleKind, THREE.Texture>();
function spriteTexture(kind: ParticleKind): THREE.Texture {
  const hit = spriteCache.get(kind);
  if (hit) return hit;
  const size = 64;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d')!;
  const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  if (kind === 'sparkle') {
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.3, 'rgba(255,230,170,0.8)');
    grad.addColorStop(1, 'rgba(255,200,80,0)');
  } else if (kind === 'magic') {
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.4, 'rgba(180,120,255,0.85)');
    grad.addColorStop(1, 'rgba(80,20,140,0)');
  } else if (kind === 'smoke') {
    grad.addColorStop(0, 'rgba(170,150,160,0.85)');
    grad.addColorStop(0.6, 'rgba(80,60,80,0.35)');
    grad.addColorStop(1, 'rgba(20,10,20,0)');
  } else if (kind === 'dust') {
    grad.addColorStop(0, 'rgba(200,180,140,0.9)');
    grad.addColorStop(0.6, 'rgba(120,100,80,0.35)');
    grad.addColorStop(1, 'rgba(20,14,8,0)');
  } else {
    // shadow
    grad.addColorStop(0, 'rgba(80,40,140,0.95)');
    grad.addColorStop(0.5, 'rgba(40,10,90,0.5)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
  }
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  spriteCache.set(kind, tex);
  return tex;
}
