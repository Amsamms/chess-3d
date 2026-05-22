import * as THREE from 'three';
import { Environment } from './Environment';
import { Quality } from '../engine/Quality';

/**
 * Frozen tundra at dusk — glacial blue sky with aurora ribbons, snowy
 * ground, crystal spires, gently drifting snowflakes.
 */
export class IceRealm extends Environment {
  private snow!: THREE.Points;
  private snowVel!: Float32Array;
  private aurora!: THREE.Mesh;
  private auroraTime = 0;
  private elapsed = 0;

  constructor() { super('Ice Realm'); }

  build(scene: THREE.Scene): void {
    scene.background = new THREE.Color(0x0a1a2e);
    scene.fog = new THREE.FogExp2(0x1a3050, 0.015);

    // --- Sky dome with aurora gradient
    const skyGeo = new THREE.SphereGeometry(140, 32, 16);
    const skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: {
        topColor: { value: new THREE.Color(0x040a1a) },
        midColor: { value: new THREE.Color(0x163a55) },
        horizonColor: { value: new THREE.Color(0x4488aa) },
        groundColor: { value: new THREE.Color(0x081a2a) },
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

    // --- Stars
    const starGeo = new THREE.BufferGeometry();
    const N = Math.round(1800 * Quality.particleScale());
    const pos = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      const y = Math.cos(phi);
      if (y < 0.10) { i--; continue; }
      const r = 115;
      pos[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      pos[i * 3 + 1] = r * y;
      pos[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);
    }
    starGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.group.add(new THREE.Points(
      starGeo,
      new THREE.PointsMaterial({ size: 0.32, color: 0xc8e8ff, transparent: true, opacity: 0.85, sizeAttenuation: true, depthWrite: false }),
    ));

    // --- Aurora ribbon (curved plane high in the sky)
    const auroraGeo = new THREE.PlaneGeometry(120, 32, 40, 12);
    this.aurora = new THREE.Mesh(
      auroraGeo,
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        uniforms: { time: { value: 0 } },
        vertexShader: /* glsl */ `
          uniform float time;
          varying vec2 vUv;
          void main() {
            vUv = uv;
            vec3 p = position;
            p.z += sin(p.x * 0.06 + time * 0.6) * 4.0;
            p.y += sin(p.x * 0.1 + time) * 2.0;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
          }`,
        fragmentShader: /* glsl */ `
          varying vec2 vUv;
          uniform float time;
          void main() {
            float v = smoothstep(0.0, 0.3, vUv.y) * smoothstep(1.0, 0.7, vUv.y);
            float n = sin(vUv.x * 14.0 + time * 0.5) * 0.5 + 0.5;
            vec3 col = mix(vec3(0.10, 0.85, 0.55), vec3(0.45, 0.30, 0.90), n);
            gl_FragColor = vec4(col, v * 0.5);
          }`,
      }),
    );
    this.aurora.position.set(0, 38, -60);
    this.aurora.rotation.x = 0.6;
    this.group.add(this.aurora);

    // --- Lights
    const hemi = new THREE.HemisphereLight(0xc0e0ff, 0x224060, 0.55);
    this.group.add(hemi);

    const moon = new THREE.DirectionalLight(0xc8e8ff, 1.3);
    moon.position.set(10, 18, -8);
    moon.castShadow = true;
    const shadowSize = Quality.shadowMapSize();
    moon.shadow.mapSize.set(shadowSize, shadowSize);
    moon.shadow.camera.near = 0.5;
    moon.shadow.camera.far = 70;
    const s = 19;
    moon.shadow.camera.left = -s;
    moon.shadow.camera.right = s;
    moon.shadow.camera.top = s;
    moon.shadow.camera.bottom = -s;
    moon.shadow.bias = -0.0002;
    moon.shadow.normalBias = 0.04;
    this.group.add(moon);
    this.group.add(moon.target);

    const fill = new THREE.DirectionalLight(0x6688aa, 0.45);
    fill.position.set(-6, 5, 8);
    this.group.add(fill);

    // Soft cyan glow points around board
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
      const glow = new THREE.PointLight(0x5cc8ff, 0.5, 12, 1.6);
      glow.position.set(Math.cos(a) * 9, 1, Math.sin(a) * 9);
      this.group.add(glow);
    }

    // --- Snowy ground
    const snowTex = makeSnowTexture(1024);
    snowTex.colorSpace = THREE.SRGBColorSpace;
    snowTex.wrapS = THREE.RepeatWrapping;
    snowTex.wrapT = THREE.RepeatWrapping;
    snowTex.repeat.set(6, 6);
    snowTex.anisotropy = 8;

    const ground = new THREE.Mesh(
      new THREE.CircleGeometry(50, 64),
      new THREE.MeshStandardMaterial({ map: snowTex, roughness: 0.9, metalness: 0.05, color: 0xb8d6e8 }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.5;
    ground.receiveShadow = true;
    this.group.add(ground);

    // Decorative ring — ice/silver
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(11, 0.22, 14, 96),
      new THREE.MeshStandardMaterial({ color: 0x8eb8d8, roughness: 0.32, metalness: 0.78, emissive: 0x102032 }),
    );
    ring.rotation.x = Math.PI / 2;
    ring.position.y = -0.46;
    ring.castShadow = true;
    ring.receiveShadow = true;
    this.group.add(ring);

    // --- Crystal spires
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + 0.4;
      const r = 14 + Math.random() * 6;
      const spire = makeCrystalSpire();
      spire.position.set(Math.cos(a) * r, -0.5, Math.sin(a) * r);
      spire.rotation.y = Math.random() * Math.PI;
      this.group.add(spire);
    }

    // Pine trees with snow
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2 + 0.9;
      const r = 22;
      const t = makeSnowyPine();
      t.position.set(Math.cos(a) * r, -0.5, Math.sin(a) * r);
      this.group.add(t);
    }

    // --- Snowflakes
    this.makeSnowflakes();
  }

  private makeSnowflakes() {
    const N = Math.round(600 * Quality.particleScale());
    const positions = new Float32Array(N * 3);
    this.snowVel = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      positions[i * 3]     = (Math.random() - 0.5) * 70;
      positions[i * 3 + 1] = Math.random() * 24;
      positions[i * 3 + 2] = (Math.random() - 0.5) * 70;
      this.snowVel[i * 3]     = (Math.random() - 0.5) * 0.3;
      this.snowVel[i * 3 + 1] = -0.35 - Math.random() * 0.15;
      this.snowVel[i * 3 + 2] = (Math.random() - 0.5) * 0.3;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.snow = new THREE.Points(
      geo,
      new THREE.PointsMaterial({
        size: 0.10,
        color: 0xffffff,
        transparent: true,
        opacity: 0.85,
        sizeAttenuation: true,
        depthWrite: false,
      }),
    );
    this.group.add(this.snow);
  }

  override update(dt: number): void {
    this.elapsed += dt;
    this.auroraTime += dt;
    if (this.aurora) {
      (this.aurora.material as THREE.ShaderMaterial).uniforms.time!.value = this.auroraTime;
    }
    if (!this.snow) return;
    const pos = this.snow.geometry.attributes.position!.array as Float32Array;
    for (let i = 0; i < pos.length; i += 3) {
      pos[i]     += this.snowVel[i] * dt + Math.sin(this.elapsed * 0.7 + i) * 0.005;
      pos[i + 1] += this.snowVel[i + 1] * dt;
      pos[i + 2] += this.snowVel[i + 2] * dt;
      if (pos[i + 1] < -0.4) {
        pos[i + 1] = 22 + Math.random() * 6;
        pos[i]     = (Math.random() - 0.5) * 70;
        pos[i + 2] = (Math.random() - 0.5) * 70;
      }
    }
    this.snow.geometry.attributes.position!.needsUpdate = true;
  }
}

// ---- helpers ----
function makeSnowTexture(size: number): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = size; c.height = size;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#c8e0f0';
  ctx.fillRect(0, 0, size, size);
  // Speckle blue-white
  const img = ctx.getImageData(0, 0, size, size);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (Math.random() - 0.5) * 28;
    img.data[i]     = Math.max(180, Math.min(255, img.data[i]     + n * 0.6));
    img.data[i + 1] = Math.max(200, Math.min(255, img.data[i + 1] + n * 0.7));
    img.data[i + 2] = Math.max(220, Math.min(255, img.data[i + 2] + n * 0.4));
  }
  ctx.putImageData(img, 0, 0);
  // Footprint / crack lines
  for (let i = 0; i < 20; i++) {
    ctx.strokeStyle = 'rgba(140,170,200,0.4)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    const x = Math.random() * size;
    const y = Math.random() * size;
    ctx.moveTo(x, y);
    ctx.lineTo(x + (Math.random() - 0.5) * 60, y + (Math.random() - 0.5) * 60);
    ctx.stroke();
  }
  return new THREE.CanvasTexture(c);
}

function makeCrystalSpire(): THREE.Group {
  const g = new THREE.Group();
  // Cluster of 3-4 angular cones
  for (let i = 0; i < 3 + Math.floor(Math.random() * 2); i++) {
    const h = 1.4 + Math.random() * 1.4;
    const r = 0.22 + Math.random() * 0.12;
    const cone = new THREE.Mesh(
      new THREE.ConeGeometry(r, h, 5, 1),
      new THREE.MeshStandardMaterial({
        color: 0x9ed4f5,
        emissive: 0x102b48,
        emissiveIntensity: 0.45,
        roughness: 0.18,
        metalness: 0.25,
        transparent: true,
        opacity: 0.85,
      }),
    );
    cone.position.set(
      (Math.random() - 0.5) * 0.45,
      h / 2,
      (Math.random() - 0.5) * 0.45,
    );
    cone.rotation.z = (Math.random() - 0.5) * 0.25;
    cone.castShadow = true;
    g.add(cone);
  }
  return g;
}

function makeSnowyPine(): THREE.Group {
  const g = new THREE.Group();
  const trunk = new THREE.Mesh(
    new THREE.CylinderGeometry(0.18, 0.26, 1.6, 8),
    new THREE.MeshStandardMaterial({ color: 0x5a3a22, roughness: 0.95 }),
  );
  trunk.position.y = 0.8;
  trunk.castShadow = true;
  g.add(trunk);
  // Pine — stacked cones with snow caps
  for (let i = 0; i < 3; i++) {
    const r = 1.2 - i * 0.28;
    const h = 1.0;
    const cone = new THREE.Mesh(
      new THREE.ConeGeometry(r, h, 10),
      new THREE.MeshStandardMaterial({ color: 0x2a5a3a, roughness: 0.9 }),
    );
    cone.position.y = 1.5 + i * 0.8;
    cone.castShadow = true;
    g.add(cone);
    // Snow cap (small white cone above)
    const snow = new THREE.Mesh(
      new THREE.ConeGeometry(r * 0.95, h * 0.45, 10),
      new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6 }),
    );
    snow.position.y = 1.5 + i * 0.8 + h * 0.25;
    g.add(snow);
  }
  return g;
}
