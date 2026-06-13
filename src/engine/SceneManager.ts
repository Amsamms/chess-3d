import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { PostFX } from './PostFX';
import { CameraDirector } from './CameraDirector';
import { EnvironmentManager } from '../environments/EnvironmentManager';
import { EnvironmentName } from '../environments/Environment';
import { Quality, QualityMode } from './Quality';

/**
 * Per-realm image-based-lighting intensity. Image based lighting (IBL) makes
 * metalness 0.85-0.95 surfaces read as real metal instead of flat plastic, so
 * every realm gets a tuned scene.environmentIntensity:
 *   - gothic-night: low so the moody near-black mood survives.
 *   - garden-day: bright, sunny daylight bounce.
 *   - ice-realm: cool, crisp reflections.
 *   - volcano: moderate so glowing emissives are not washed out by bloom.
 */
const ENV_INTENSITY: Record<EnvironmentName, number> = {
  'gothic-night': 0.55,
  'garden-day': 1.0,
  'ice-realm': 0.8,
  'volcano': 0.6,
};

/** Largest dt (seconds) we ever feed to time-based updates. A backgrounded
 * tab pauses requestAnimationFrame, so the first frame back can report a huge
 * delta; clamping it keeps ambient particles from teleporting offscreen. */
const MAX_DT = 0.1;

export class SceneManager {
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly renderer: THREE.WebGLRenderer;
  readonly controls: OrbitControls;
  readonly post: PostFX;
  readonly env: EnvironmentManager;
  /** Owns all climactic camera cinematics (intro orbit, capture juice, endgame). */
  readonly director: CameraDirector;
  private readonly clock = new THREE.Clock();
  private currentEnvName: EnvironmentName = 'gothic-night';
  /** dt (seconds) sampled once per frame in update(), reused by render(). */
  private frameDt = 0;

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
    this.renderer.toneMappingExposure = 1.3; // gothic-night default; setEnvironment() re-tunes per realm
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    // --- Image based lighting (IBL) ---
    // Bake a soft room environment into a PMREM once at boot and use it as the
    // scene environment map. Without this, metalness 0.85-0.95 gold/silver/molten
    // surfaces have nothing to reflect and read as flat plastic. environmentIntensity
    // is re-tuned per realm in setEnvironment() so each mood is preserved.
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    pmrem.compileEquirectangularShader();
    const roomScene = new RoomEnvironment();
    this.scene.environment = pmrem.fromScene(roomScene, 0.04).texture;
    this.scene.environmentIntensity = ENV_INTENSITY['gothic-night'];
    roomScene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) m.geometry?.dispose();
    });
    pmrem.dispose();

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

    // Camera cinematics director (F13). It either drives the camera directly
    // (intro orbit / endgame dolly, with controls disabled) or layers decaying
    // additive offsets on top of OrbitControls (capture shake / FOV punch).
    this.director = new CameraDirector(this.camera, this.controls);

    this.env = new EnvironmentManager(this.scene);
    this.env.set('gothic-night'); // default: restored to the look the user originally approved

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
    // Re-tune renderer exposure + IBL intensity / fog density depending on the
    // environment vibe. (Sky/fog colors are owned by the Environment via
    // scene.background/fog; renderer-level + IBL tuning lives here.)
    this.scene.environmentIntensity = ENV_INTENSITY[name];
    switch (name) {
      case 'garden-day':   this.renderer.toneMappingExposure = 1.25; break;
      case 'gothic-night': this.renderer.toneMappingExposure = 1.30; break;
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
    // Publish the resting FOV so the director's FOV-punch offsets decay back to
    // the correct framed value (it changes on portrait phones / resize).
    this.director?.setBaseFov(this.camera.fov);
  }

  private onResize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.applyAspect(w, h);
    this.renderer.setSize(w, h);
    this.post.setSize(w, h);
  }

  update(_dt: number) {
    // Sample the frame delta exactly once per frame here. render() reuses the
    // same value, so getDelta() is never called twice (the second caller used
    // to get ~0). Clamp so a backgrounded-tab catch-up frame does not explode
    // ambient particle positions inside env.update().
    this.frameDt = Math.min(this.clock.getDelta(), MAX_DT);

    // Cinematics (F13): revert last frame's additive shake/FOV BEFORE controls
    // integrate, so OrbitControls always works from the clean base transform
    // (zero drift), then re-apply the decaying offsets AFTER controls.update().
    // While a DRIVE cinematic is running we MUST skip controls.update() entirely:
    // OrbitControls.update() recomputes camera.position from target + spherical on
    // every call regardless of its enabled flag, which would overwrite the drive
    // tween. The director owns the camera directly during a drive.
    this.director.preControlsUpdate();
    if (!this.director.isDriving()) this.controls.update();
    this.director.update(this.frameDt);

    this.env.update(this.frameDt);
  }

  render() {
    this.post.render(this.frameDt);
  }
}
