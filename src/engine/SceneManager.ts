import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { PostFX } from './PostFX';

export class SceneManager {
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly renderer: THREE.WebGLRenderer;
  readonly controls: OrbitControls;
  readonly post: PostFX;
  private readonly clock = new THREE.Clock();
  readonly tickables: Array<(dt: number) => void> = [];

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: 'high-performance',
      stencil: false,
      preserveDrawingBuffer: true, // allows canvas.toDataURL() for screenshots
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.1;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.scene.background = new THREE.Color(0x07050c);
    this.scene.fog = new THREE.FogExp2(0x0a0612, 0.025);

    this.camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 200);
    this.camera.position.set(0, 14, 16);
    this.camera.lookAt(0, 0, 0);

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.minDistance = 6;
    this.controls.maxDistance = 36;
    this.controls.maxPolarAngle = Math.PI * 0.49;
    this.controls.minPolarAngle = Math.PI * 0.08;
    this.controls.target.set(0, 0.5, 0);

    this.buildEnvironment();
    this.buildLighting();
    this.buildGround();

    this.post = new PostFX(this.renderer, this.scene, this.camera);
    this.post.setSize(window.innerWidth, window.innerHeight);

    window.addEventListener('resize', () => this.onResize());
  }

  private buildEnvironment() {
    // Procedural night-temple sky dome with a moon and stars (a tinted gradient sphere + sprite stars).
    const skyGeo = new THREE.SphereGeometry(120, 32, 16);
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
        varying vec3 vWorldDir;
        void main() {
          vWorldDir = normalize((modelMatrix * vec4(position, 1.0)).xyz);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        varying vec3 vWorldDir;
        uniform vec3 topColor;
        uniform vec3 midColor;
        uniform vec3 horizonColor;
        uniform vec3 groundColor;
        void main() {
          float y = vWorldDir.y;
          vec3 col;
          if (y >= 0.0) {
            float t = smoothstep(0.0, 0.55, y);
            vec3 lower = mix(horizonColor, midColor, smoothstep(0.0, 0.35, y));
            col = mix(lower, topColor, t);
          } else {
            col = mix(horizonColor, groundColor, smoothstep(0.0, -0.4, y));
          }
          gl_FragColor = vec4(col, 1.0);
        }
      `,
    });
    this.scene.add(new THREE.Mesh(skyGeo, skyMat));

    // Stars
    const starGeo = new THREE.BufferGeometry();
    const starCount = 1400;
    const starPos = new Float32Array(starCount * 3);
    for (let i = 0; i < starCount; i++) {
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      // Only upper hemisphere stars
      const y = Math.cos(phi);
      if (y < 0.05) {
        i--;
        continue;
      }
      const r = 100;
      starPos[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      starPos[i * 3 + 1] = r * y;
      starPos[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);
    }
    starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
    const starMat = new THREE.PointsMaterial({
      size: 0.35,
      color: 0xf7e6a9,
      transparent: true,
      opacity: 0.9,
      sizeAttenuation: true,
      depthWrite: false,
    });
    this.scene.add(new THREE.Points(starGeo, starMat));
  }

  private buildLighting() {
    // Ambient hemisphere — warm above, cool below.
    const hemi = new THREE.HemisphereLight(0xffe5b0, 0x1a0d28, 0.55);
    this.scene.add(hemi);

    // Key light — the "moon" / sun. Casts the sharp shadow.
    const key = new THREE.DirectionalLight(0xfff1cc, 1.4);
    key.position.set(8, 14, 6);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.camera.near = 0.5;
    key.shadow.camera.far = 50;
    const s = 14;
    key.shadow.camera.left = -s;
    key.shadow.camera.right = s;
    key.shadow.camera.top = s;
    key.shadow.camera.bottom = -s;
    key.shadow.bias = -0.0002;
    key.shadow.normalBias = 0.04;
    this.scene.add(key);
    this.scene.add(key.target);

    // Rim light — purple from the back, gives volumetric edge to pieces.
    const rim = new THREE.DirectionalLight(0x9462ff, 0.5);
    rim.position.set(-8, 6, -10);
    this.scene.add(rim);

    // Warm fill — flickering torch on the side.
    const torch = new THREE.PointLight(0xff9a4a, 1.8, 22, 1.6);
    torch.position.set(-6, 4, 5);
    this.scene.add(torch);

    // Animate torch flicker.
    this.tickables.push((dt) => {
      torch.intensity = 1.5 + Math.sin(performance.now() * 0.007) * 0.2 + (Math.random() - 0.5) * 0.15;
      // Slow drift on key light for a sense of moving sky.
      key.position.x = 8 + Math.sin(performance.now() * 0.00015) * 1.2;
      void dt;
    });
  }

  private buildGround() {
    // Stone-flag dais surrounding the board. Subtle texture via canvas.
    const tex = makeStoneTexture(1024);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(6, 6);
    tex.anisotropy = 8;

    const mat = new THREE.MeshStandardMaterial({
      map: tex,
      roughness: 0.92,
      metalness: 0.05,
      color: 0x4a3a52,
    });
    const ground = new THREE.Mesh(new THREE.CircleGeometry(40, 64), mat);
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.5;
    ground.receiveShadow = true;
    this.scene.add(ground);

    // Decorative ring around the dais.
    const ringMat = new THREE.MeshStandardMaterial({
      color: 0x6b4a2a,
      roughness: 0.55,
      metalness: 0.75,
      emissive: 0x180a04,
    });
    const ring = new THREE.Mesh(new THREE.TorusGeometry(8, 0.16, 16, 96), ringMat);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = -0.48;
    ring.receiveShadow = true;
    ring.castShadow = true;
    this.scene.add(ring);
  }

  private onResize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    this.post.setSize(w, h);
  }

  update(_dt: number) {
    this.controls.update();
    const dt = this.clock.getDelta();
    for (const fn of this.tickables) fn(dt);
  }

  render() {
    const dt = this.clock.getDelta();
    this.post.render(dt);
  }
}

function makeStoneTexture(size: number): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#3a2c40';
  ctx.fillRect(0, 0, size, size);

  // Speckle noise
  const img = ctx.getImageData(0, 0, size, size);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (Math.random() - 0.5) * 36;
    img.data[i] = Math.max(0, Math.min(255, img.data[i] + n));
    img.data[i + 1] = Math.max(0, Math.min(255, img.data[i + 1] + n * 0.8));
    img.data[i + 2] = Math.max(0, Math.min(255, img.data[i + 2] + n * 0.9));
  }
  ctx.putImageData(img, 0, 0);

  // Cracks / mortar lines (random Voronoi-ish flagstones)
  ctx.strokeStyle = 'rgba(10,6,14,0.55)';
  ctx.lineWidth = 2;
  for (let i = 0; i < 24; i++) {
    ctx.beginPath();
    const x = Math.random() * size;
    const y = Math.random() * size;
    ctx.moveTo(x, y);
    ctx.lineTo(x + (Math.random() - 0.5) * size * 0.7, y + (Math.random() - 0.5) * size * 0.7);
    ctx.stroke();
  }

  return new THREE.CanvasTexture(c);
}
