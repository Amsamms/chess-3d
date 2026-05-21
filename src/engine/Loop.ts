export class Loop {
  private rafId = 0;
  private last = performance.now();
  constructor(private readonly onFrame: (dtMs: number) => void) {}

  start() {
    const tick = () => {
      const now = performance.now();
      const dt = Math.min(50, now - this.last);
      this.last = now;
      this.onFrame(dt);
      this.rafId = requestAnimationFrame(tick);
    };
    this.last = performance.now();
    this.rafId = requestAnimationFrame(tick);
  }

  stop() {
    cancelAnimationFrame(this.rafId);
  }
}
