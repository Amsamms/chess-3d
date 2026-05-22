/**
 * Global, listener-based quality preset.
 *
 * Two modes:
 *   - 'high': desktop default — full bloom + vignette, 1024 shadow map, full
 *             particle counts, devicePixelRatio capped at 2.
 *   - 'low':  phone-friendly — PostFX bypassed (no bloom/vignette), shadows
 *             disabled at the renderer level, particle counts ~35%,
 *             devicePixelRatio capped at 1.
 *
 * Environments read shadowMapSize() / particleScale() at build time, so
 * switching quality mid-game is followed by a SceneManager.setQuality() call
 * that rebuilds the current environment to pick up the new numbers.
 */

export type QualityMode = 'high' | 'low';

class QualityState {
  current: QualityMode = 'high';
  private listeners: Array<(q: QualityMode) => void> = [];

  set(mode: QualityMode) {
    if (this.current === mode) return;
    this.current = mode;
    for (const fn of this.listeners) fn(mode);
  }

  onChange(fn: (q: QualityMode) => void): () => void {
    this.listeners.push(fn);
    return () => {
      const i = this.listeners.indexOf(fn);
      if (i >= 0) this.listeners.splice(i, 1);
    };
  }

  shadowsEnabled(): boolean { return this.current === 'high'; }
  shadowMapSize(): number   { return this.current === 'high' ? 1024 : 512; }
  particleScale(): number   { return this.current === 'high' ? 1.0  : 0.35; }
  bloomEnabled(): boolean   { return this.current === 'high'; }
  pixelRatioCap(): number   { return this.current === 'high' ? 2    : 1; }
}

export const Quality = new QualityState();

/**
 * Pick a sensible default at boot. Coarse pointer + small viewport ⇒ low.
 * The user can override with the Quality HUD button afterwards.
 */
export function autoDetectQuality(): QualityMode {
  if (typeof window === 'undefined') return 'high';
  const coarsePointer = window.matchMedia?.('(pointer: coarse)').matches ?? false;
  const smallViewport = Math.min(window.innerWidth, window.innerHeight) <= 768;
  return (coarsePointer && smallViewport) ? 'low' : 'high';
}
