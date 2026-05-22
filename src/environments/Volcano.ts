import * as THREE from 'three';
import { Environment } from './Environment';
import { Quality } from '../engine/Quality';

/**
 * Lava-pit arena — angry red sky, ash-fall, distant volcanos, glowing lava
 * fissures in the ground, rising embers, smoldering rocks.
 */
export class Volcano extends Environment {
  private embers!: THREE.Points;
  private emberVel!: Float32Array;
  private ash!: THREE.Points;
  private ashVel!: Float32Array;
  private fissures: THREE.Mesh[] = [];
  private elapsed = 0;

  constructor() { super('Volcano'); }

  build(scene: THREE.Scene): void {
    scene.background = new THREE.Color(0x1a0608);
    scene.fog = new THREE.FogExp2(0x2a0a08, 0.025);

    // --- Sky dome with hellish glow
    const skyGeo = new THREE.SphereGeometry(140, 32, 16);
    const skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: {
        topColor: { value: new THREE.Color(0x100204) },
        midColor: { value: new THREE.Color(0x5a1208) },
        horizonColor: { value: new THREE.Color(0xc24010) },
        groundColor: { value: new THREE.Color(0x200404) },
      },
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        void main() {
          vDir = normalize((modelMatrix * vec4(position,1.0)).xyz);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0);
        }`,
      fragmentShader: /* glsl */ `
        varying vec3 vDir;
        uniform vec3 topColor; uniform vec3 midColor;
        uniform vec3 horizonColor; uniform vec3 groundColor;
        void main() {
          float y = vDir.y;
          vec3 col;
          if (y >= 0.0) {
            float t = smoothstep(0.0, 0.55, y);
            vec3 lower = mix(horizonColor, midColor, smoothstep(0.0, 0.30, y));
            col = mix(lower, topColor, t);
          } else {
            col = mix(horizonColor, groundColor, smoothstep(0.0, -0.4, y));
          }
          gl_FragColor = vec4(col, 1.0);
        }`,
    });
    this.group.add(new THREE.Mesh(skyGeo, skyMat));

    // --- Distant volcano silhouettes
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + 0.4;
      const r = 60;
      const volcano = new THREE.Mesh(
        new THREE.ConeGeometry(8 + Math.random() * 4, 12 + Math.random() * 5, 10),
        new THREE.MeshStandardMaterial({ color: 0x180404, roughness: 0.95, emissive: 0x180404 }),
      );
      volcano.position.set(Math.cos(a) * r, 5, Math.sin(a) * r);
      this.group.add(volcano);
      // Glow at peak
      const peak = new THREE.Mesh(
        new THREE.SphereGeometry(0.55, 12, 10),
        new THREE.MeshStandardMaterial({ color: 0xff4a10, emissive: 0xff4a10, emissiveIntensity: 2.4 }),
      );
      peak.position.copy(volcano.position).add(new THREE.Vector3(0, 7, 0));
      this.group.add(peak);
    }

    // --- Lights
    const hemi = new THREE.HemisphereLight(0xff6a2a, 0x1a0202, 0.6);
    this.group.add(hemi);

    const key = new THREE.DirectionalLight(0xff8a3a, 1.5);
    key.position.set(8, 14, 6);
    key.castShadow = true;
    const shadowSize = Quality.shadowMapSize();
    key.shadow.mapSize.set(shadowSize, shadowSize);
    key.shadow.camera.near = 0.5;
    key.shadow.camera.far = 70;
    const s = 19;
    key.shadow.camera.left = -s;
    key.shadow.camera.right = s;
    key.shadow.camera.top = s;
    key.shadow.camera.bottom = -s;
    key.shadow.bias = -0.0002;
    key.shadow.normalBias = 0.04;
    this.group.add(key);
    this.group.add(key.target);

    const rim = new THREE.DirectionalLight(0xff2400, 0.6);
    rim.position.set(-6, 5, -10);
    this.group.add(rim);

    // Glowing lava lights at cardinal points
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2;
      const lava = new THREE.PointLight(0xff5510, 1.4, 16, 1.6);
      lava.position.set(Math.cos(a) * 10, 0.5, Math.sin(a) * 10);
      this.group.add(lava);
    }

    // --- Charred rocky ground
    const rockTex = makeVolcanoTexture(1024);
    rockTex.colorSpace = THREE.SRGBColorSpace;
    rockTex.wrapS = THREE.RepeatWrapping;
    rockTex.wrapT = THREE.RepeatWrapping;
    rockTex.repeat.set(8, 8);
    rockTex.anisotropy = 8;

    const ground = new THREE.Mesh(
      new THREE.CircleGeometry(50, 64),
      new THREE.MeshStandardMaterial({ map: rockTex, roughness: 0.95, metalness: 0.0, color: 0x2a1612 }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.5;
    ground.receiveShadow = true;
    this.group.add(ground);

    // --- Lava fissures: glowing radial slits
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2 + Math.random() * 0.2;
      const r = 9 + Math.random() * 14;
      const len = 1.5 + Math.random() * 2.5;
      const fissure = new THREE.Mesh(
        new THREE.PlaneGeometry(len, 0.4),
        new THREE.MeshStandardMaterial({
          color: 0xff6610,
          emissive: 0xff4400,
          emissiveIntensity: 1.6,
          transparent: true,
          opacity: 0.95,
        }),
      );
      fissure.rotation.x = -Math.PI / 2;
      fissure.position.set(Math.cos(a) * r, -0.48, Math.sin(a) * r);
      fissure.rotation.z = a + Math.PI / 2;
      this.group.add(fissure);
      this.fissures.push(fissure);
    }

    // Decorative ring — molten metal
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(11, 0.22, 14, 96),
      new THREE.MeshStandardMaterial({ color: 0x6a1408, roughness: 0.5, metalness: 0.85, emissive: 0xa83214 }),
    );
    ring.rotation.x = Math.PI / 2;
    ring.position.y = -0.46;
    ring.castShadow = true;
    ring.receiveShadow = true;
    this.group.add(ring);

    // Charred rocks scattered around
    for (let i = 0; i < 14; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = 9 + Math.random() * 18;
      const rock = makeCharRock();
      rock.position.set(Math.cos(a) * r, -0.4, Math.sin(a) * r);
      rock.rotation.y = Math.random() * Math.PI;
      this.group.add(rock);
    }

    // --- Embers + ash
    this.makeEmbers();
    this.makeAsh();
  }

  private makeEmbers() {
    const N = Math.round(260 * Quality.particleScale());
    const positions = new Float32Array(N * 3);
    const colors = new Float32Array(N * 3);
    this.emberVel = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      positions[i * 3]     = (Math.random() - 0.5) * 50;
      positions[i * 3 + 1] = Math.random() * 6;
      positions[i * 3 + 2] = (Math.random() - 0.5) * 50;
      this.emberVel[i * 3]     = (Math.random() - 0.5) * 0.4;
      this.emberVel[i * 3 + 1] = 0.6 + Math.random() * 0.8;
      this.emberVel[i * 3 + 2] = (Math.random() - 0.5) * 0.4;
      const hue = 0.04 + Math.random() * 0.06;
      const c = new THREE.Color().setHSL(hue, 1.0, 0.55);
      colors[i * 3]     = c.r;
      colors[i * 3 + 1] = c.g;
      colors[i * 3 + 2] = c.b;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('color',    new THREE.BufferAttribute(colors, 3));
    this.embers = new THREE.Points(
      geo,
      new THREE.PointsMaterial({
        size: 0.13,
        vertexColors: true,
        transparent: true,
        opacity: 0.95,
        sizeAttenuation: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    this.group.add(this.embers);
  }

  private makeAsh() {
    const N = Math.round(350 * Quality.particleScale());
    const positions = new Float32Array(N * 3);
    this.ashVel = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      positions[i * 3]     = (Math.random() - 0.5) * 70;
      positions[i * 3 + 1] = 4 + Math.random() * 18;
      positions[i * 3 + 2] = (Math.random() - 0.5) * 70;
      this.ashVel[i * 3]     = (Math.random() - 0.5) * 0.35;
      this.ashVel[i * 3 + 1] = -0.20 - Math.random() * 0.10;
      this.ashVel[i * 3 + 2] = (Math.random() - 0.5) * 0.35;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.ash = new THREE.Points(
      geo,
      new THREE.PointsMaterial({
        size: 0.16,
        color: 0x6a5048,
        transparent: true,
        opacity: 0.55,
        sizeAttenuation: true,
        depthWrite: false,
      }),
    );
    this.group.add(this.ash);
  }

  override update(dt: number): void {
    this.elapsed += dt;

    // Ember motion
    if (this.embers) {
      const pos = this.embers.geometry.attributes.position!.array as Float32Array;
      for (let i = 0; i < pos.length; i += 3) {
        pos[i]     += this.emberVel[i] * dt + Math.sin(this.elapsed * 0.7 + i) * 0.005;
        pos[i + 1] += this.emberVel[i + 1] * dt;
        pos[i + 2] += this.emberVel[i + 2] * dt;
        if (pos[i + 1] > 12) {
          pos[i + 1] = -0.4 + Math.random() * 0.6;
          pos[i]     = (Math.random() - 0.5) * 50;
          pos[i + 2] = (Math.random() - 0.5) * 50;
        }
      }
      this.embers.geometry.attributes.position!.needsUpdate = true;
    }

    // Ash drifting down
    if (this.ash) {
      const pos = this.ash.geometry.attributes.position!.array as Float32Array;
      for (let i = 0; i < pos.length; i += 3) {
        pos[i]     += this.ashVel[i] * dt;
        pos[i + 1] += this.ashVel[i + 1] * dt;
        pos[i + 2] += this.ashVel[i + 2] * dt;
        if (pos[i + 1] < -0.4) {
          pos[i + 1] = 22 + Math.random() * 6;
          pos[i]     = (Math.random() - 0.5) * 70;
          pos[i + 2] = (Math.random() - 0.5) * 70;
        }
      }
      this.ash.geometry.attributes.position!.needsUpdate = true;
    }

    // Lava fissures pulse
    for (const f of this.fissures) {
      const mat = f.material as THREE.MeshStandardMaterial;
      mat.emissiveIntensity = 1.4 + Math.sin(this.elapsed * 2 + f.id) * 0.4;
    }
  }
}

// ---- helpers ----
function makeVolcanoTexture(size: number): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = size; c.height = size;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#2a1408';
  ctx.fillRect(0, 0, size, size);
  const img = ctx.getImageData(0, 0, size, size);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (Math.random() - 0.5) * 28;
    img.data[i]     = Math.max(20, Math.min(255, img.data[i]     + n * 0.9));
    img.data[i + 1] = Math.max(10, Math.min(255, img.data[i + 1] + n * 0.5));
    img.data[i + 2] = Math.max(5, Math.min(255, img.data[i + 2] + n * 0.4));
  }
  ctx.putImageData(img, 0, 0);
  // Cracks
  ctx.strokeStyle = 'rgba(255,100,30,0.45)';
  ctx.lineWidth = 1;
  for (let i = 0; i < 26; i++) {
    ctx.beginPath();
    let x = Math.random() * size, y = Math.random() * size;
    ctx.moveTo(x, y);
    for (let s = 0; s < 8; s++) {
      x += (Math.random() - 0.5) * 50;
      y += (Math.random() - 0.5) * 50;
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  // Dark blotches
  for (let i = 0; i < 14; i++) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    const r = 10 + Math.random() * 30;
    const grad = ctx.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, 'rgba(0,0,0,0.7)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  return new THREE.CanvasTexture(c);
}

function makeCharRock(): THREE.Group {
  const g = new THREE.Group();
  const rock = new THREE.Mesh(
    new THREE.DodecahedronGeometry(0.6 + Math.random() * 0.4, 0),
    new THREE.MeshStandardMaterial({
      color: 0x261410,
      roughness: 0.97,
      emissive: 0x381404,
      emissiveIntensity: 0.25,
    }),
  );
  rock.castShadow = true;
  rock.receiveShadow = true;
  rock.rotation.set(Math.random() * 1.0, Math.random() * Math.PI * 2, Math.random() * 1.0);
  g.add(rock);
  // Lava cracks (small emissive bands)
  for (let i = 0; i < 2; i++) {
    const crack = new THREE.Mesh(
      new THREE.SphereGeometry(0.08 + Math.random() * 0.04, 8, 6),
      new THREE.MeshStandardMaterial({ color: 0xff5210, emissive: 0xff3a00, emissiveIntensity: 1.4 }),
    );
    crack.scale.set(1.0, 0.25, 0.25);
    crack.position.set(
      (Math.random() - 0.5) * 0.6,
      (Math.random() - 0.5) * 0.3,
      (Math.random() - 0.5) * 0.6,
    );
    crack.rotation.y = Math.random() * Math.PI;
    g.add(crack);
  }
  return g;
}
