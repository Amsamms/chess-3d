import * as THREE from 'three';
import { Environment } from './Environment';

/**
 * The original purple-night look — moon-key light, purple rim, flickering
 * torch, starfield, mossy stone dais with gold ring, exponential fog.
 */
export class GothicNight extends Environment {
  private torch!: THREE.PointLight;
  private key!: THREE.DirectionalLight;
  private lastTime = 0;

  constructor() {
    super('Gothic Night');
  }

  build(scene: THREE.Scene): void {
    scene.background = new THREE.Color(0x07050c);
    scene.fog = new THREE.FogExp2(0x0a0612, 0.018);

    // --- Sky shader dome
    const skyGeo = new THREE.SphereGeometry(140, 32, 16);
    const skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: {
        topColor: { value: new THREE.Color(0x0a0418) },
        midColor: { value: new THREE.Color(0x2a143e) },
        horizonColor: { value: new THREE.Color(0x4a1f3c) },
        groundColor: { value: new THREE.Color(0x100612) },
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
            vec3 lower = mix(horizonColor, midColor, smoothstep(0.0, 0.35, y));
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
    const N = 1400;
    const pos = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      const y = Math.cos(phi);
      if (y < 0.05) { i--; continue; }
      const r = 110;
      pos[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      pos[i * 3 + 1] = r * y;
      pos[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);
    }
    starGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.group.add(new THREE.Points(
      starGeo,
      new THREE.PointsMaterial({ size: 0.4, color: 0xf7e6a9, transparent: true, opacity: 0.9, sizeAttenuation: true, depthWrite: false }),
    ));

    // --- Lights
    const hemi = new THREE.HemisphereLight(0xffe5b0, 0x1a0d28, 0.55);
    this.group.add(hemi);

    this.key = new THREE.DirectionalLight(0xfff1cc, 1.4);
    this.key.position.set(8, 16, 6);
    this.key.castShadow = true;
    this.key.shadow.mapSize.set(1024, 1024);
    this.key.shadow.camera.near = 0.5;
    this.key.shadow.camera.far = 60;
    const s = 19;
    this.key.shadow.camera.left = -s;
    this.key.shadow.camera.right = s;
    this.key.shadow.camera.top = s;
    this.key.shadow.camera.bottom = -s;
    this.key.shadow.bias = -0.0002;
    this.key.shadow.normalBias = 0.04;
    this.group.add(this.key);
    this.group.add(this.key.target);

    const rim = new THREE.DirectionalLight(0x9462ff, 0.5);
    rim.position.set(-8, 6, -10);
    this.group.add(rim);

    this.torch = new THREE.PointLight(0xff9a4a, 1.8, 22, 1.6);
    this.torch.position.set(-7, 4, 6);
    this.group.add(this.torch);

    // --- Ground (stone dais + gold ring)
    const stoneTex = makeStoneTexture(1024, '#3a2c40', '#160820');
    stoneTex.colorSpace = THREE.SRGBColorSpace;
    stoneTex.wrapS = THREE.RepeatWrapping;
    stoneTex.wrapT = THREE.RepeatWrapping;
    stoneTex.repeat.set(6, 6);
    stoneTex.anisotropy = 8;

    const ground = new THREE.Mesh(
      new THREE.CircleGeometry(50, 64),
      new THREE.MeshStandardMaterial({ map: stoneTex, roughness: 0.92, metalness: 0.05, color: 0x4a3a52 }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.5;
    ground.receiveShadow = true;
    this.group.add(ground);

    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(11, 0.2, 16, 96),
      new THREE.MeshStandardMaterial({ color: 0x6b4a2a, roughness: 0.55, metalness: 0.75, emissive: 0x180a04 }),
    );
    ring.rotation.x = Math.PI / 2;
    ring.position.y = -0.48;
    ring.receiveShadow = true;
    ring.castShadow = true;
    this.group.add(ring);
  }

  override update(dt: number): void {
    this.lastTime += dt;
    // Torch flicker
    this.torch.intensity = 1.5 + Math.sin(this.lastTime * 7) * 0.2 + (Math.random() - 0.5) * 0.15;
    // Slow drift of the key light
    this.key.position.x = 8 + Math.sin(this.lastTime * 0.15) * 1.2;
  }
}

// --- helpers ---
function makeStoneTexture(size: number, base: string, dark: string): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = size; c.height = size;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, size, size);
  const img = ctx.getImageData(0, 0, size, size);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (Math.random() - 0.5) * 36;
    img.data[i] = Math.max(0, Math.min(255, img.data[i] + n));
    img.data[i + 1] = Math.max(0, Math.min(255, img.data[i + 1] + n * 0.8));
    img.data[i + 2] = Math.max(0, Math.min(255, img.data[i + 2] + n * 0.9));
  }
  ctx.putImageData(img, 0, 0);
  ctx.strokeStyle = dark;
  ctx.lineWidth = 2;
  for (let i = 0; i < 30; i++) {
    ctx.beginPath();
    const x = Math.random() * size, y = Math.random() * size;
    ctx.moveTo(x, y);
    ctx.lineTo(x + (Math.random() - 0.5) * size * 0.7, y + (Math.random() - 0.5) * size * 0.7);
    ctx.stroke();
  }
  return new THREE.CanvasTexture(c);
}
