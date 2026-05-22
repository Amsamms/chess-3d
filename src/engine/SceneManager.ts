import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { PostFX } from './PostFX';
import { EnvironmentManager } from '../environments/EnvironmentManager';
import { EnvironmentName } from '../environments/Environment';
import { Quality, QualityMode } from './Quality';

export class SceneManager {
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly renderer: THREE.WebGLRenderer;
  readonly controls: OrbitControls;
  readonly post: PostFX;
  readonly env: EnvironmentManager;
  private readonly clock = new THREE.Clock();
  private currentEnvName: EnvironmentName = 'gothic-night';

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: 'high-performance',
      stencil: false,
      preserveDrawingBuffer: true, // allows canvas.toDataURL() for screenshots
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, Quality.pixelRatioCap()));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = Quality.shadowsEnabled();
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.1;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 240);
    this.camera.position.set(0, 18, 22);
    this.camera.lookAt(0, 0, 0);

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.minDistance = 8;
    this.controls.maxDistance = 55;
    this.controls.maxPolarAngle = Math.PI * 0.49;
    this.controls.minPolarAngle = Math.PI * 0.08;
    this.controls.target.set(0, 0.5, 0);

    this.env = new EnvironmentManager(this.scene);
    this.env.set('gothic-night'); // default — restored to the look the user originally approved

    this.post = new PostFX(this.renderer, this.scene, this.camera);
    this.post.setSize(window.innerWidth, window.innerHeight);
    this.post.setBypass(!Quality.bloomEnabled());

    // Initial framing so portrait phones get the whole board on first paint.
    this.applyAspect(window.innerWidth, window.innerHeight);

    window.addEventListener('resize', () => this.onResize());
    window.addEventListener('orientationchange', () => this.onResize());
  }

  setEnvironment(name: EnvironmentName) {
    this.currentEnvName = name;
    this.env.set(name);
    // Re-tune renderer exposure / fog density depending on environment vibe.
    // (Done inside the Environment via scene.background/fog; renderer-level tuning here.)
    switch (name) {
      case 'garden-day':   this.renderer.toneMappingExposure = 1.25; break;
      case 'gothic-night': this.renderer.toneMappingExposure = 1.10; break;
      case 'ice-realm':    this.renderer.toneMappingExposure = 1.15; break;
      case 'volcano':      this.renderer.toneMappingExposure = 1.05; break;
    }
  }

  /**
   * Switch quality preset. Updates Quality singleton, toggles renderer
   * shadows + PostFX bypass + pixel ratio, then rebuilds the current
   * environment so its lights pick up the new shadow map size and its
   * particle systems rebuild at the new density.
   */
  setQuality(mode: QualityMode) {
    Quality.set(mode);
    this.renderer.shadowMap.enabled = Quality.shadowsEnabled();
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, Quality.pixelRatioCap()));
    this.post.setBypass(!Quality.bloomEnabled());
    // Rebuild the live environment so lights re-init their shadow maps and
    // particle systems re-build at the new density.
    this.env.set(this.currentEnvName);
  }

  /**
   * Adjust camera FOV so the board horizontally fits across narrow (portrait)
   * viewports. Keeps the fixed-position camera but widens the vertical FOV
   * when the aspect ratio drops below desktop-ish, which is equivalent to a
   * minimum horizontal FOV guarantee.
   */
  private applyAspect(w: number, h: number) {
    const aspect = w / h;
    this.camera.aspect = aspect;
    // Guarantee at least ~60° of horizontal FOV so the board edges don't fall off
    // the sides on tall portrait phones.
    const minHorizontalFovRad = THREE.MathUtils.degToRad(60);
    const computedVerticalRad = 2 * Math.atan(Math.tan(minHorizontalFovRad / 2) / aspect);
    const computedVerticalDeg = THREE.MathUtils.radToDeg(computedVerticalRad);
    this.camera.fov = Math.max(45, Math.min(95, computedVerticalDeg));
    this.camera.updateProjectionMatrix();
  }

  private onResize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.applyAspect(w, h);
    this.renderer.setSize(w, h);
    this.post.setSize(w, h);
  }

  update(_dt: number) {
    this.controls.update();
    const dt = this.clock.getDelta();
    this.env.update(dt);
  }

  render() {
    const dt = this.clock.getDelta();
    this.post.render(dt);
  }
}
