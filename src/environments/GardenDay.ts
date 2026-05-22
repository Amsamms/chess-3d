import * as THREE from 'three';
import { Environment } from './Environment';
import { Quality } from '../engine/Quality';

/**
 * Sunlit garden — bright blue sky, soft white clouds, green grass plaza
 * with wildflowers, warm sunlight, gentle breeze in the form of floating
 * petals. Cheerful counterpoint to Gothic Night.
 */
export class GardenDay extends Environment {
  private petals!: THREE.Points;
  private petalVel!: Float32Array;
  private elapsed = 0;

  constructor() { super('Garden Day'); }

  build(scene: THREE.Scene): void {
    scene.background = new THREE.Color(0xa8d8ff);
    scene.fog = new THREE.FogExp2(0xcfe8ff, 0.012);

    // --- Sky dome with sun
    const skyGeo = new THREE.SphereGeometry(140, 32, 16);
    const skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: {
        topColor: { value: new THREE.Color(0x4a8cd4) },
        horizonColor: { value: new THREE.Color(0xffd99a) },
        groundColor: { value: new THREE.Color(0x88c8a8) },
        sunDir: { value: new THREE.Vector3(0.55, 0.55, 0.4).normalize() },
      },
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        void main() {
          vDir = normalize((modelMatrix * vec4(position,1.0)).xyz);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0);
        }`,
      fragmentShader: /* glsl */ `
        varying vec3 vDir;
        uniform vec3 topColor; uniform vec3 horizonColor; uniform vec3 groundColor;
        uniform vec3 sunDir;
        void main() {
          float y = vDir.y;
          vec3 col;
          if (y >= 0.0) {
            col = mix(horizonColor, topColor, smoothstep(0.0, 0.45, y));
          } else {
            col = mix(horizonColor, groundColor, smoothstep(0.0, -0.4, y));
          }
          // Sun disk
          float sun = dot(vDir, sunDir);
          float disc = smoothstep(0.9975, 1.0, sun);
          float halo = smoothstep(0.95, 1.0, sun) * 0.45;
          col = mix(col, vec3(1.0, 0.96, 0.85), disc);
          col += vec3(1.0, 0.93, 0.7) * halo;
          gl_FragColor = vec4(col, 1.0);
        }`,
    });
    this.group.add(new THREE.Mesh(skyGeo, skyMat));

    // --- Cloud puffs (oriented planes high above)
    for (let i = 0; i < 12; i++) {
      const cloud = new THREE.Mesh(
        new THREE.SphereGeometry(2.5 + Math.random() * 2, 14, 10),
        new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.78, depthWrite: false }),
      );
      const r = 65;
      const a = Math.random() * Math.PI * 2;
      cloud.position.set(Math.cos(a) * r, 32 + Math.random() * 12, Math.sin(a) * r);
      cloud.scale.set(2.4, 1.0, 2.4);
      this.group.add(cloud);
    }

    // --- Lights
    const hemi = new THREE.HemisphereLight(0xfff2c8, 0x6ba076, 0.95);
    this.group.add(hemi);

    const sun = new THREE.DirectionalLight(0xfff4d0, 2.1);
    sun.position.set(11, 22, 8);
    sun.castShadow = true;
    const shadowSize = Quality.shadowMapSize();
    sun.shadow.mapSize.set(shadowSize, shadowSize);
    sun.shadow.camera.near = 0.5;
    sun.shadow.camera.far = 80;
    const s = 19;
    sun.shadow.camera.left = -s;
    sun.shadow.camera.right = s;
    sun.shadow.camera.top = s;
    sun.shadow.camera.bottom = -s;
    sun.shadow.bias = -0.0002;
    sun.shadow.normalBias = 0.04;
    this.group.add(sun);
    this.group.add(sun.target);

    const fill = new THREE.DirectionalLight(0xc8e8ff, 0.35);
    fill.position.set(-8, 8, -10);
    this.group.add(fill);

    // --- Grass ground
    const grassTex = makeGrassTexture(1024);
    grassTex.colorSpace = THREE.SRGBColorSpace;
    grassTex.wrapS = THREE.RepeatWrapping;
    grassTex.wrapT = THREE.RepeatWrapping;
    grassTex.repeat.set(8, 8);
    grassTex.anisotropy = 8;

    const ground = new THREE.Mesh(
      new THREE.CircleGeometry(50, 64),
      new THREE.MeshStandardMaterial({ map: grassTex, roughness: 0.95, metalness: 0.0, color: 0x6ea15a }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.5;
    ground.receiveShadow = true;
    this.group.add(ground);

    // Stone path encircling the board
    const stoneRing = new THREE.Mesh(
      new THREE.RingGeometry(8.5, 12, 64, 1),
      new THREE.MeshStandardMaterial({ color: 0xc9b89a, roughness: 0.85 }),
    );
    stoneRing.rotation.x = -Math.PI / 2;
    stoneRing.position.y = -0.49;
    stoneRing.receiveShadow = true;
    this.group.add(stoneRing);

    // Decorative ring (now a wreath of leaves)
    const wreath = new THREE.Mesh(
      new THREE.TorusGeometry(11, 0.22, 14, 96),
      new THREE.MeshStandardMaterial({ color: 0x3e6a32, roughness: 0.85, metalness: 0.0 }),
    );
    wreath.rotation.x = Math.PI / 2;
    wreath.position.y = -0.46;
    wreath.castShadow = true;
    wreath.receiveShadow = true;
    this.group.add(wreath);

    // --- Flowers scattered around the edge
    for (let i = 0; i < 60; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = 9 + Math.random() * 18;
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      // Skip points inside the prison area on the X axis
      if (Math.abs(x) > 7 && Math.abs(z) < 3.5) continue;
      const flower = makeFlower();
      flower.position.set(x, -0.48, z);
      flower.rotation.y = Math.random() * Math.PI;
      this.group.add(flower);
    }

    // --- Decorative trees in 4 cardinal-ish positions
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + 0.5;
      const r = 22;
      const t = makeTree();
      t.position.set(Math.cos(a) * r, -0.5, Math.sin(a) * r);
      t.rotation.y = Math.random() * Math.PI;
      this.group.add(t);
    }

    // --- Floating petals (ambient particles)
    this.makePetals();
  }

  private makePetals() {
    const N = Math.round(220 * Quality.particleScale());
    const positions = new Float32Array(N * 3);
    const colors = new Float32Array(N * 3);
    this.petalVel = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      positions[i * 3]     = (Math.random() - 0.5) * 60;
      positions[i * 3 + 1] = 5 + Math.random() * 18;
      positions[i * 3 + 2] = (Math.random() - 0.5) * 60;
      this.petalVel[i * 3]     = (Math.random() - 0.5) * 0.4;
      this.petalVel[i * 3 + 1] = -0.20 - Math.random() * 0.10;
      this.petalVel[i * 3 + 2] = (Math.random() - 0.5) * 0.4;
      const hue = 0.92 + Math.random() * 0.10; // pink/white
      const c = new THREE.Color().setHSL(hue % 1, 0.6, 0.85);
      colors[i * 3]     = c.r;
      colors[i * 3 + 1] = c.g;
      colors[i * 3 + 2] = c.b;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('color',    new THREE.BufferAttribute(colors, 3));
    this.petals = new THREE.Points(
      geo,
      new THREE.PointsMaterial({
        size: 0.16,
        vertexColors: true,
        transparent: true,
        opacity: 0.85,
        sizeAttenuation: true,
        depthWrite: false,
      }),
    );
    this.group.add(this.petals);
  }

  override update(dt: number): void {
    this.elapsed += dt;
    if (!this.petals) return;
    const pos = this.petals.geometry.attributes.position!.array as Float32Array;
    for (let i = 0; i < pos.length; i += 3) {
      pos[i]     += this.petalVel[i] * dt + Math.sin(this.elapsed * 0.5 + i) * 0.01;
      pos[i + 1] += this.petalVel[i + 1] * dt;
      pos[i + 2] += this.petalVel[i + 2] * dt;
      if (pos[i + 1] < -0.4) {
        pos[i + 1] = 15 + Math.random() * 8;
        pos[i]     = (Math.random() - 0.5) * 60;
        pos[i + 2] = (Math.random() - 0.5) * 60;
      }
    }
    this.petals.geometry.attributes.position!.needsUpdate = true;
  }
}

// ---- helpers ----
function makeGrassTexture(size: number): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = size; c.height = size;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#5a8c44';
  ctx.fillRect(0, 0, size, size);
  // Noise
  const img = ctx.getImageData(0, 0, size, size);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (Math.random() - 0.5) * 36;
    img.data[i]     = Math.max(0, Math.min(255, img.data[i]     + n * 0.4));
    img.data[i + 1] = Math.max(0, Math.min(255, img.data[i + 1] + n));
    img.data[i + 2] = Math.max(0, Math.min(255, img.data[i + 2] + n * 0.5));
  }
  ctx.putImageData(img, 0, 0);
  // Tiny grass blades
  for (let i = 0; i < 600; i++) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    const h = 4 + Math.random() * 8;
    const dark = Math.random() < 0.4;
    ctx.strokeStyle = dark ? 'rgba(40,70,30,0.85)' : 'rgba(120,180,90,0.7)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + (Math.random() - 0.5) * 3, y - h);
    ctx.stroke();
  }
  return new THREE.CanvasTexture(c);
}

function makeFlower(): THREE.Group {
  const g = new THREE.Group();
  // Stem
  const stem = new THREE.Mesh(
    new THREE.CylinderGeometry(0.018, 0.020, 0.28, 6),
    new THREE.MeshStandardMaterial({ color: 0x3d7035, roughness: 0.9 }),
  );
  stem.position.y = 0.14;
  g.add(stem);
  // Petals — 5 around a center
  const color = pickFlowerColor();
  const petalMat = new THREE.MeshStandardMaterial({ color, roughness: 0.6, side: THREE.DoubleSide });
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    const petal = new THREE.Mesh(
      new THREE.SphereGeometry(0.04, 8, 6),
      petalMat,
    );
    petal.scale.set(1.2, 0.4, 1.2);
    petal.position.set(Math.cos(a) * 0.05, 0.30, Math.sin(a) * 0.05);
    g.add(petal);
  }
  // Center
  const center = new THREE.Mesh(
    new THREE.SphereGeometry(0.025, 8, 6),
    new THREE.MeshStandardMaterial({ color: 0xffcc44, emissive: 0x442200, roughness: 0.5 }),
  );
  center.position.y = 0.31;
  g.add(center);
  return g;
}

function pickFlowerColor(): number {
  const c = [0xffffff, 0xffd0e0, 0xff6b6b, 0xffaa33, 0xc080ff, 0xffe066];
  return c[Math.floor(Math.random() * c.length)]!;
}

function makeTree(): THREE.Group {
  const g = new THREE.Group();
  const trunk = new THREE.Mesh(
    new THREE.CylinderGeometry(0.22, 0.34, 2.2, 10),
    new THREE.MeshStandardMaterial({ color: 0x6a4628, roughness: 0.95 }),
  );
  trunk.position.y = 1.1;
  trunk.castShadow = true;
  trunk.receiveShadow = true;
  g.add(trunk);
  // Foliage — three overlapping spheres
  for (let i = 0; i < 4; i++) {
    const foliage = new THREE.Mesh(
      new THREE.SphereGeometry(0.9 + Math.random() * 0.4, 12, 10),
      new THREE.MeshStandardMaterial({ color: 0x4a8a3a + Math.floor(Math.random() * 0x202020), roughness: 0.85 }),
    );
    foliage.position.set(
      (Math.random() - 0.5) * 0.7,
      2.2 + Math.random() * 0.4,
      (Math.random() - 0.5) * 0.7,
    );
    foliage.castShadow = true;
    g.add(foliage);
  }
  return g;
}
