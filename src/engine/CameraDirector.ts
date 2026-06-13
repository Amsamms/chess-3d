import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { gsap } from 'gsap';

/**
 * CameraDirector: owns all climactic camera cinematics (F13):
 *   1. an intro slow-orbit that eases into the play position on first load,
 *   2. capture juice (a tiny FOV punch + camera shake scaled by piece value),
 *   3. a checkmate sequence (dolly to the mated king, slow-mo, victory orbit),
 *      and a gentler push-in for draws.
 *
 * Two distinct mechanisms keep cinematics from ever fighting OrbitControls or
 * accumulating drift:
 *
 *  - DRIVE cinematics (intro orbit, checkmate dolly + victory orbit) DISABLE
 *    OrbitControls and GSAP-tween camera.position + controls.target directly.
 *    On finish/skip we re-sync controls (target stays where the camera looks)
 *    and re-enable, so OrbitControls never sees a jump.
 *
 *  - OFFSET cinematics (capture shake + FOV punch) leave OrbitControls fully in
 *    charge of the base transform. Each frame the director ADDS a positional
 *    offset + FOV delta AFTER controls.update(), then REVERTS them at the start
 *    of the next frame BEFORE controls.update() runs. OrbitControls therefore
 *    only ever sees the clean base transform, so the offsets can never drift or
 *    accumulate, and a drag in progress simply rides on top of them.
 *
 * A global timeScale (driven during slow-mo) is exposed via getTimeScale() so
 * the render loop can scale dt for the VFX/particles, giving the brief slow-mo
 * feel without touching game logic. Game state is never blocked: cinematics are
 * pure presentation, and devMove / reset cancel any running sequence cleanly.
 */
export class CameraDirector {
  private readonly camera: THREE.PerspectiveCamera;
  private readonly controls: OrbitControls;

  /** The resting FOV OrbitControls expects (set once we know the framed FOV). */
  private baseFov: number;

  /** True while ANY cinematic (intro / capture juice / endgame) is running. */
  private active = false;
  /** True only for a DRIVE cinematic (intro / dolly / orbit), where controls are off. */
  private driving = false;

  /** Positional shake offset currently applied on top of the base transform. */
  private readonly shakeOffset = new THREE.Vector3();
  /** Additive FOV delta currently applied on top of the base FOV. */
  private fovOffset = 0;
  /** The exact offset we applied LAST frame, reverted before controls.update(). */
  private readonly appliedShake = new THREE.Vector3();
  private appliedFov = 0;

  /** Live shake state: remaining time, total duration, and amplitude. */
  private shakeRemaining = 0;
  private shakeDuration = 0;
  private shakeAmplitude = 0;
  /** Live FOV-punch state (a quick inward punch that decays back to zero). */
  private fovPunchRemaining = 0;
  private fovPunchDuration = 0;
  private fovPunchAmount = 0;

  /** Global slow-mo time scale (1 = normal). Read by the loop to scale dt. */
  private timeScale = 1;

  /** Honour the OS reduced-motion preference: skip orbits/shakes/sequences. */
  private readonly reducedMotion: boolean;

  /** Tweens we own, killed on cancel so a reset never leaves a sequence running. */
  private activeTweens: gsap.core.Tween[] = [];
  private pendingTimers: number[] = [];

  /** True once the user has skipped the intro (or it finished); blocks re-running. */
  private introConsumed = false;

  constructor(camera: THREE.PerspectiveCamera, controls: OrbitControls) {
    this.camera = camera;
    this.controls = controls;
    this.baseFov = camera.fov;
    this.reducedMotion =
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  }

  // ------------------------------------------------------------------ queries

  /** True while any cinematic is running (testers read window.chess3d.cinematicActive). */
  isActive(): boolean {
    return this.active;
  }

  /**
   * True while a DRIVE cinematic (intro orbit / endgame dolly / victory orbit)
   * owns the camera directly. SceneManager MUST skip controls.update() while this
   * is true: OrbitControls.update() recomputes camera.position from its target +
   * spherical every call (ignoring the enabled flag), which would otherwise fight
   * the drive tween. Capture-juice offsets are NOT a drive, so they return false.
   */
  isDriving(): boolean {
    return this.driving;
  }

  /** Current slow-mo factor (1 = normal speed). The loop multiplies dt by this. */
  getTimeScale(): number {
    return this.timeScale;
  }

  /** OrbitControls owns the resting FOV; SceneManager re-publishes it on resize. */
  setBaseFov(fov: number): void {
    this.baseFov = fov;
  }

  // ------------------------------------------------------------------ intro

  /**
   * Play the one-time intro orbit: a slow ~5s sweep that eases into the standard
   * play position. Any user input (pointerdown / wheel / key) skips it instantly
   * and hands a clean transform back to OrbitControls. Honours reduced-motion
   * (no-op) and only ever runs once.
   */
  playIntro(): void {
    if (this.introConsumed) return;
    this.introConsumed = true;
    if (this.reducedMotion) return;

    // Remember exactly where OrbitControls wants to end up.
    const finalPos = this.camera.position.clone();
    const finalTarget = this.controls.target.clone();

    // Hand control to the director for the duration of the sweep.
    this.beginDrive();

    // Start wide, high, and rotated off to one side; orbit in to the rest pose.
    const radius = finalPos.distanceTo(finalTarget);
    const startAngle = Math.atan2(finalPos.x - finalTarget.x, finalPos.z - finalTarget.z) - 1.15;
    const startRadius = radius * 1.35;
    const startHeight = finalPos.y + 7;

    const startPos = new THREE.Vector3(
      finalTarget.x + Math.sin(startAngle) * startRadius,
      startHeight,
      finalTarget.z + Math.cos(startAngle) * startRadius,
    );

    this.camera.position.copy(startPos);
    this.controls.target.copy(finalTarget);
    this.camera.lookAt(finalTarget);

    // Skip-on-input: the first user gesture during the intro snaps to the end.
    const skip = () => this.skipIntro(finalPos, finalTarget, listeners);
    const listeners: Array<[keyof WindowEventMap, EventListener]> = [
      ['pointerdown', skip],
      ['wheel', skip],
      ['keydown', skip],
      ['touchstart', skip],
    ];
    for (const [ev, fn] of listeners) {
      window.addEventListener(ev, fn, { once: true, passive: true } as AddEventListenerOptions);
    }

    const proxy = { t: 0 };
    const tween = gsap.to(proxy, {
      t: 1,
      duration: 5.0,
      ease: 'power2.inOut',
      onUpdate: () => {
        const p = startPos.clone().lerp(finalPos, proxy.t);
        // Keep the sweep on a smooth arc by easing the radius/height separately.
        this.camera.position.copy(p);
        this.camera.lookAt(finalTarget);
      },
      onComplete: () => {
        this.removeIntroListeners(listeners);
        this.endDrive(finalPos, finalTarget);
      },
    });
    this.activeTweens.push(tween);
  }

  private skipIntro(
    finalPos: THREE.Vector3,
    finalTarget: THREE.Vector3,
    listeners: Array<[keyof WindowEventMap, EventListener]>,
  ): void {
    if (!this.driving) return;
    this.removeIntroListeners(listeners);
    this.killTweens();
    this.endDrive(finalPos, finalTarget);
  }

  private removeIntroListeners(
    listeners: Array<[keyof WindowEventMap, EventListener]>,
  ): void {
    for (const [ev, fn] of listeners) window.removeEventListener(ev, fn);
  }

  // ------------------------------------------------------------------ capture juice

  /**
   * Capture juice (item 2): a subtle FOV punch + camera shake scaled by the
   * captured piece's value (pawn tiny, queen big). Implemented purely as additive
   * offsets that decay, so it never fights OrbitControls and never drifts. Skipped
   * entirely under reduced-motion or while the user is actively dragging the camera.
   */
  capturePunch(pieceValue: number): void {
    if (this.reducedMotion) return;
    // Never punch the camera mid-drag: it would feel like the orbit is being
    // wrestled away from the user.
    if (this.isDragging()) return;
    if (this.driving) return; // do not perturb an intro / endgame drive

    // Map value (pawn 1 .. queen 9) to a 0..1 strength with a gentle floor.
    const v = Math.max(1, Math.min(9, pieceValue));
    const strength = 0.25 + (v - 1) / 8 * 0.75; // 0.25 (pawn) .. 1.0 (queen)

    // Shake: short, snappy, amplitude scales with strength. Capped so a queen
    // capture is punchy but never nauseating.
    this.shakeAmplitude = Math.max(this.shakeAmplitude, 0.05 + strength * 0.22);
    this.shakeDuration = 0.18 + strength * 0.22;
    this.shakeRemaining = this.shakeDuration;

    // FOV punch: quick inward "thunk" of a few degrees, decays back out.
    this.fovPunchAmount = -(1.0 + strength * 3.5);
    this.fovPunchDuration = 0.10 + strength * 0.16;
    this.fovPunchRemaining = this.fovPunchDuration;

    this.active = true;
  }

  // ------------------------------------------------------------------ endgame

  /**
   * Checkmate cinematic (item 3): dolly toward the mated king, brief slow-mo,
   * a celebratory hint (the king topple + winner particles are emitted by the
   * caller), then a short victory orbit. Calls onDone() when finished OR when
   * the user clicks to skip (whichever comes first), at most `maxMs` after start.
   * Under reduced-motion this resolves on the next tick (straight to the modal).
   *
   * @param kingWorld world position of the mated king (orbit/dolly focus).
   * @param maxMs hard ceiling before onDone fires no matter what (<= 4000).
   * @param onDone invoked exactly once when the sequence ends or is skipped.
   */
  playCheckmate(kingWorld: THREE.Vector3, maxMs: number, onDone: () => void): void {
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      this.removeSkipListener(skip);
      this.setLetterbox(false);
      this.timeScale = 1;
      onDone();
    };

    if (this.reducedMotion) {
      // No camera sequence; let the modal appear immediately on the next tick.
      const id = window.setTimeout(finish, 0);
      this.pendingTimers.push(id);
      return;
    }
    this.setLetterbox(true);

    // Hard ceiling: the modal must never be gated for more than maxMs.
    const ceiling = window.setTimeout(() => {
      this.killTweens();
      this.endDriveToCurrent();
      finish();
    }, Math.min(4000, maxMs));
    this.pendingTimers.push(ceiling);

    // Any click during the sequence skips straight to the modal.
    const skip = () => {
      this.killTweens();
      this.endDriveToCurrent();
      finish();
    };
    window.addEventListener('pointerdown', skip, { once: true } as AddEventListenerOptions);

    this.beginDrive();
    this.runDramaticPush(kingWorld, /*victoryOrbit*/ true, finish);
  }

  /**
   * Gentler endgame for stalemate / draws (item 3): a slow push-in toward the
   * board centre, no topple, no victory orbit. Same skip + ceiling contract.
   */
  playDraw(focusWorld: THREE.Vector3, maxMs: number, onDone: () => void): void {
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      this.removeSkipListener(skip);
      this.setLetterbox(false);
      this.timeScale = 1;
      onDone();
    };

    if (this.reducedMotion) {
      const id = window.setTimeout(finish, 0);
      this.pendingTimers.push(id);
      return;
    }
    this.setLetterbox(true);

    const ceiling = window.setTimeout(() => {
      this.killTweens();
      this.endDriveToCurrent();
      finish();
    }, Math.min(4000, maxMs));
    this.pendingTimers.push(ceiling);

    const skip = () => {
      this.killTweens();
      this.endDriveToCurrent();
      finish();
    };
    window.addEventListener('pointerdown', skip, { once: true } as AddEventListenerOptions);

    this.beginDrive();
    this.runDramaticPush(focusWorld, /*victoryOrbit*/ false, finish);
  }

  /**
   * Shared dolly toward a focus point, optionally followed by a short victory
   * orbit. Uses a brief slow-mo (timeScale dip) for the checkmate variant. All
   * camera motion is driven directly on camera.position + controls.target while
   * controls are disabled, so nothing fights OrbitControls.
   */
  private runDramaticPush(focusWorld: THREE.Vector3, victoryOrbit: boolean, finish: () => void): void {
    const startPos = this.camera.position.clone();
    const startTarget = this.controls.target.clone();

    // Dolly to a close-but-not-clipping vantage looking down at the focus.
    const dir = startPos.clone().sub(focusWorld).setY(0);
    if (dir.lengthSq() < 1e-4) dir.set(0, 0, 1);
    dir.normalize();
    const dollyDist = victoryOrbit ? 6.5 : 9.0;
    const dollyPos = focusWorld.clone()
      .add(dir.multiplyScalar(dollyDist))
      .add(new THREE.Vector3(0, victoryOrbit ? 4.2 : 6.0, 0));

    // Brief slow-mo only for the dramatic checkmate push.
    if (victoryOrbit) {
      const slow = { s: 1 };
      const slowTween = gsap.to(slow, {
        s: 0.35,
        duration: 0.5,
        ease: 'power2.out',
        yoyo: true,
        repeat: 1,
        repeatDelay: 0.7,
        onUpdate: () => { this.timeScale = slow.s; },
        onComplete: () => { this.timeScale = 1; },
      });
      this.activeTweens.push(slowTween);
    }

    const proxy = { t: 0 };
    const dollyTween = gsap.to(proxy, {
      t: 1,
      duration: victoryOrbit ? 1.1 : 1.0,
      ease: 'power3.inOut',
      onUpdate: () => {
        this.camera.position.copy(startPos.clone().lerp(dollyPos, proxy.t));
        this.controls.target.copy(startTarget.clone().lerp(focusWorld, proxy.t));
        this.camera.lookAt(this.controls.target);
      },
      onComplete: () => {
        if (victoryOrbit) {
          this.runVictoryOrbit(focusWorld, dollyPos, finish);
        } else {
          this.endDriveToCurrent();
          finish();
        }
      },
    });
    this.activeTweens.push(dollyTween);
  }

  /** A short partial orbit around the mated king to celebrate the win. */
  private runVictoryOrbit(focusWorld: THREE.Vector3, fromPos: THREE.Vector3, finish: () => void): void {
    const rel = fromPos.clone().sub(focusWorld);
    const radius = Math.hypot(rel.x, rel.z);
    const height = rel.y;
    const startAngle = Math.atan2(rel.x, rel.z);
    const sweep = Math.PI * 0.6; // ~108 degrees of celebratory orbit

    const proxy = { t: 0 };
    const orbitTween = gsap.to(proxy, {
      t: 1,
      duration: 1.6,
      ease: 'sine.inOut',
      onUpdate: () => {
        const a = startAngle + sweep * proxy.t;
        this.camera.position.set(
          focusWorld.x + Math.sin(a) * radius,
          focusWorld.y + height,
          focusWorld.z + Math.cos(a) * radius,
        );
        this.controls.target.copy(focusWorld);
        this.camera.lookAt(focusWorld);
      },
      onComplete: () => {
        this.endDriveToCurrent();
        finish();
      },
    });
    this.activeTweens.push(orbitTween);
  }

  // ------------------------------------------------------------------ per-frame

  /**
   * Called every frame by SceneManager, AFTER controls.update() has positioned
   * the camera from the clean base transform. We apply the live shake + FOV
   * offsets here on top of the base transform. The previous frame's offsets were
   * already reverted in preControlsUpdate(), so nothing accumulates.
   *
   * @param dtSec real (un-slowed) frame delta in seconds.
   */
  update(dtSec: number): void {
    // Decay the shake.
    if (this.shakeRemaining > 0) {
      this.shakeRemaining = Math.max(0, this.shakeRemaining - dtSec);
      const k = this.shakeDuration > 0 ? this.shakeRemaining / this.shakeDuration : 0;
      const amp = this.shakeAmplitude * k * k; // ease-out (quadratic) decay
      // Random jitter per axis, slightly damped on Y so it reads as a recoil.
      this.shakeOffset.set(
        (Math.random() - 0.5) * 2 * amp,
        (Math.random() - 0.5) * 2 * amp * 0.6,
        (Math.random() - 0.5) * 2 * amp,
      );
      if (this.shakeRemaining === 0) {
        this.shakeOffset.set(0, 0, 0);
        this.shakeAmplitude = 0;
      }
    } else {
      this.shakeOffset.set(0, 0, 0);
    }

    // Decay the FOV punch.
    if (this.fovPunchRemaining > 0) {
      this.fovPunchRemaining = Math.max(0, this.fovPunchRemaining - dtSec);
      const k = this.fovPunchDuration > 0 ? this.fovPunchRemaining / this.fovPunchDuration : 0;
      this.fovOffset = this.fovPunchAmount * k; // linear decay back to 0
      if (this.fovPunchRemaining === 0) this.fovOffset = 0;
    } else {
      this.fovOffset = 0;
    }

    // While driving (intro / endgame), the tweens own the camera fully; do not
    // layer offsets on top. The offset bookkeeping below is for the OrbitControls
    // case only.
    if (!this.driving) {
      // Apply the offsets on top of the base transform.
      if (this.shakeOffset.lengthSq() > 0) this.camera.position.add(this.shakeOffset);
      this.appliedShake.copy(this.shakeOffset);

      if (this.fovOffset !== 0) {
        this.camera.fov = this.baseFov + this.fovOffset;
        this.camera.updateProjectionMatrix();
      } else if (this.appliedFov !== 0) {
        // Just returned to rest: make sure FOV is exactly the base again.
        this.camera.fov = this.baseFov;
        this.camera.updateProjectionMatrix();
      }
      this.appliedFov = this.fovOffset;
    } else {
      this.appliedShake.set(0, 0, 0);
      this.appliedFov = 0;
    }

    // active stays true until everything has settled.
    this.active =
      this.driving ||
      this.shakeRemaining > 0 ||
      this.fovPunchRemaining > 0 ||
      this.timeScale !== 1;
  }

  /**
   * Called every frame by SceneManager BEFORE controls.update(). Reverts the
   * offsets we layered on last frame so OrbitControls always integrates from the
   * clean base transform: this is what guarantees zero accumulation / drift.
   */
  preControlsUpdate(): void {
    if (this.driving) return; // controls are disabled while driving
    if (this.appliedShake.lengthSq() > 0) {
      this.camera.position.sub(this.appliedShake);
      this.appliedShake.set(0, 0, 0);
    }
    if (this.appliedFov !== 0) {
      this.camera.fov = this.baseFov;
      this.camera.updateProjectionMatrix();
      this.appliedFov = 0;
    }
  }

  // ------------------------------------------------------------------ drive helpers

  /** Take exclusive control of the camera: disable OrbitControls for a drive. */
  private beginDrive(): void {
    // Clear any offset bookkeeping so we start from a clean base.
    this.preControlsUpdate();
    this.driving = true;
    this.active = true;
    this.controls.enabled = false;
  }

  /**
   * Finish a drive at a known final transform: snap the camera + target there,
   * restore the base FOV, then re-enable OrbitControls. controls.update() on the
   * next frame integrates cleanly because target sits exactly where we look.
   */
  private endDrive(finalPos: THREE.Vector3, finalTarget: THREE.Vector3): void {
    this.camera.position.copy(finalPos);
    this.controls.target.copy(finalTarget);
    this.camera.lookAt(finalTarget);
    this.camera.fov = this.baseFov;
    this.camera.updateProjectionMatrix();
    this.finishDrive();
  }

  /** Finish a drive in place: hand back control wherever the camera currently is. */
  private endDriveToCurrent(): void {
    if (!this.driving) return;
    this.camera.fov = this.baseFov;
    this.camera.updateProjectionMatrix();
    this.finishDrive();
  }

  private finishDrive(): void {
    this.driving = false;
    this.controls.enabled = true;
    this.controls.update();
    this.appliedShake.set(0, 0, 0);
    this.appliedFov = 0;
    this.active =
      this.shakeRemaining > 0 || this.fovPunchRemaining > 0 || this.timeScale !== 1;
  }

  // ------------------------------------------------------------------ cancel

  /**
   * Cancel any running cinematic and restore clean camera control. Called on a
   * new game / reset / mode switch. Idempotent. Does NOT move the camera (so a
   * reset mid-orbit leaves the view wherever it is and simply re-enables drag).
   */
  cancel(): void {
    this.killTweens();
    this.clearTimers();
    this.setLetterbox(false);
    this.timeScale = 1;
    this.shakeRemaining = 0;
    this.shakeDuration = 0;
    this.shakeAmplitude = 0;
    this.fovPunchRemaining = 0;
    this.fovPunchDuration = 0;
    this.fovPunchAmount = 0;
    this.fovOffset = 0;
    if (this.driving) {
      this.endDriveToCurrent();
    } else {
      // Make sure no leftover offset is baked into the live transform.
      this.preControlsUpdate();
    }
    this.shakeOffset.set(0, 0, 0);
    this.appliedShake.set(0, 0, 0);
    this.appliedFov = 0;
    this.active = false;
  }

  private killTweens(): void {
    for (const t of this.activeTweens) t.kill();
    this.activeTweens = [];
  }

  private clearTimers(): void {
    for (const id of this.pendingTimers) window.clearTimeout(id);
    this.pendingTimers = [];
  }

  private removeSkipListener(fn: EventListener): void {
    window.removeEventListener('pointerdown', fn);
  }

  /** Toggle the cinematic letterbox bars (CSS) during an endgame sequence. */
  private setLetterbox(on: boolean): void {
    document.body.classList.toggle('cinematic-endgame', on);
  }

  /** True while the user is actively dragging the camera (any OrbitControls drag). */
  private isDragging(): boolean {
    // OrbitControls exposes its internal interaction state; a drag means a
    // non-NONE state. We read it defensively in case the field name shifts.
    const state = (this.controls as unknown as { state?: number }).state;
    return typeof state === 'number' && state !== -1;
  }
}
