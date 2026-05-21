/**
 * Procedural sound engine. Uses Web Audio API oscillators + noise + envelopes
 * so we ship without bundling MP3/WAV assets. Each sound is short enough that
 * synthesizing live is cheap.
 *
 * SoundEngine.unlock() must be called from a user gesture (click, key).
 */
export class SoundEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private musicGain: GainNode | null = null;
  private muted = false;
  private ambientStarted = false;

  unlock() {
    if (this.ctx) return;
    const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    this.ctx = new Ctor();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.6;
    this.master.connect(this.ctx.destination);
    this.musicGain = this.ctx.createGain();
    this.musicGain.gain.value = 0.0;
    this.musicGain.connect(this.master);
  }

  setMuted(m: boolean) {
    this.muted = m;
    if (this.master) this.master.gain.value = m ? 0 : 0.6;
  }
  isMuted() { return this.muted; }

  startAmbient() {
    if (!this.ctx || !this.musicGain) return;
    if (this.ambientStarted) return;
    this.ambientStarted = true;

    // Drifting "wind" via filtered noise
    const noise = this.makeNoise();
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 220;
    bp.Q.value = 1.4;
    const nGain = this.ctx.createGain();
    nGain.gain.value = 0.012;
    noise.connect(bp).connect(nGain).connect(this.musicGain);

    // Slow modulating sine drone
    const drone1 = this.ctx.createOscillator();
    drone1.type = 'sine';
    drone1.frequency.value = 110;
    const drone2 = this.ctx.createOscillator();
    drone2.type = 'sine';
    drone2.frequency.value = 165;
    const lfo = this.ctx.createOscillator();
    lfo.frequency.value = 0.08;
    const lfoGain = this.ctx.createGain();
    lfoGain.gain.value = 0.7;
    lfo.connect(lfoGain).connect(drone1.frequency);

    const dG = this.ctx.createGain();
    dG.gain.value = 0.025;
    drone1.connect(dG).connect(this.musicGain);
    drone2.connect(dG);

    drone1.start();
    drone2.start();
    lfo.start();

    // Fade in
    this.musicGain.gain.setValueAtTime(0, this.ctx.currentTime);
    this.musicGain.gain.linearRampToValueAtTime(0.25, this.ctx.currentTime + 3);
  }

  // ---- Discrete SFX ----

  /** Click + soft whoosh — generic piece movement. */
  playMoveStep() {
    if (!this.ctx || !this.master) return;
    const c = this.ctx;
    const t = c.currentTime;
    const osc = c.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(380, t);
    osc.frequency.exponentialRampToValueAtTime(200, t + 0.18);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0, t);
    g.gain.linearRampToValueAtTime(0.12, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
    osc.connect(g).connect(this.master);
    osc.start(t);
    osc.stop(t + 0.25);
  }

  /** Bishop magic — high shimmer + ascending tone. */
  playMagicCast() {
    if (!this.ctx || !this.master) return;
    const c = this.ctx;
    const t = c.currentTime;
    // shimmer noise
    const noise = this.makeNoise();
    const hp = c.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 2400;
    const ng = c.createGain();
    ng.gain.setValueAtTime(0.0, t);
    ng.gain.linearRampToValueAtTime(0.14, t + 0.06);
    ng.gain.exponentialRampToValueAtTime(0.001, t + 0.9);
    noise.connect(hp).connect(ng).connect(this.master);

    // glissando
    const osc = c.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(440, t);
    osc.frequency.exponentialRampToValueAtTime(1760, t + 0.6);
    const g = c.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.10, t + 0.05);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.7);
    osc.connect(g).connect(this.master);
    osc.start(t);
    osc.stop(t + 0.8);
    setTimeout(() => noise.disconnect(), 1000);
  }

  /** Sharp impact — sword strike / knight charge. */
  playImpact() {
    if (!this.ctx || !this.master) return;
    const c = this.ctx;
    const t = c.currentTime;
    // metallic clang via short noise + bandpass
    const noise = this.makeNoise();
    const bp = c.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1400;
    bp.Q.value = 8;
    const ng = c.createGain();
    ng.gain.setValueAtTime(0.0, t);
    ng.gain.linearRampToValueAtTime(0.32, t + 0.005);
    ng.gain.exponentialRampToValueAtTime(0.001, t + 0.45);
    noise.connect(bp).connect(ng).connect(this.master);
    // thump body
    const osc = c.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(160, t);
    osc.frequency.exponentialRampToValueAtTime(45, t + 0.18);
    const og = c.createGain();
    og.gain.setValueAtTime(0.3, t);
    og.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
    osc.connect(og).connect(this.master);
    osc.start(t);
    osc.stop(t + 0.3);
    setTimeout(() => noise.disconnect(), 500);
  }

  /** Heavy stone crash — rook smash. */
  playStoneSmash() {
    if (!this.ctx || !this.master) return;
    const c = this.ctx;
    const t = c.currentTime;
    const noise = this.makeNoise();
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 1100;
    const ng = c.createGain();
    ng.gain.setValueAtTime(0.0, t);
    ng.gain.linearRampToValueAtTime(0.50, t + 0.01);
    ng.gain.exponentialRampToValueAtTime(0.001, t + 0.8);
    noise.connect(lp).connect(ng).connect(this.master);
    // deep boom
    const osc = c.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(70, t);
    osc.frequency.exponentialRampToValueAtTime(35, t + 0.6);
    const og = c.createGain();
    og.gain.setValueAtTime(0.45, t);
    og.gain.exponentialRampToValueAtTime(0.001, t + 0.7);
    osc.connect(og).connect(this.master);
    osc.start(t);
    osc.stop(t + 0.8);
    setTimeout(() => noise.disconnect(), 1000);
  }

  /** Dark vortex — queen's capture. */
  playQueenVortex() {
    if (!this.ctx || !this.master) return;
    const c = this.ctx;
    const t = c.currentTime;
    // descending shimmer
    const osc = c.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(880, t);
    osc.frequency.exponentialRampToValueAtTime(110, t + 0.9);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0, t);
    g.gain.linearRampToValueAtTime(0.12, t + 0.05);
    g.gain.exponentialRampToValueAtTime(0.001, t + 1.0);
    // detuned dark hum
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 1800;
    osc.connect(lp).connect(g).connect(this.master);
    osc.start(t);
    osc.stop(t + 1.05);

    // sub bass thump
    const sub = c.createOscillator();
    sub.type = 'sine';
    sub.frequency.value = 55;
    const sg = c.createGain();
    sg.gain.setValueAtTime(0.0, t);
    sg.gain.linearRampToValueAtTime(0.45, t + 0.02);
    sg.gain.exponentialRampToValueAtTime(0.001, t + 0.9);
    sub.connect(sg).connect(this.master);
    sub.start(t);
    sub.stop(t + 1.0);
  }

  /** Check warning chime — sharp ascending two-note. */
  playCheck() {
    if (!this.ctx || !this.master) return;
    const c = this.ctx;
    const t = c.currentTime;
    const notes = [880, 1320];
    notes.forEach((freq, i) => {
      const osc = c.createOscillator();
      osc.type = 'triangle';
      osc.frequency.value = freq;
      const g = c.createGain();
      const start = t + i * 0.16;
      g.gain.setValueAtTime(0.0, start);
      g.gain.linearRampToValueAtTime(0.18, start + 0.02);
      g.gain.exponentialRampToValueAtTime(0.001, start + 0.4);
      osc.connect(g).connect(this.master!);
      osc.start(start);
      osc.stop(start + 0.42);
    });
  }

  /** Checkmate fanfare — descending major triad with long sustain. */
  playCheckmate() {
    if (!this.ctx || !this.master) return;
    const c = this.ctx;
    const t = c.currentTime;
    const chord = [659, 523, 392];
    chord.forEach((freq, i) => {
      const osc = c.createOscillator();
      osc.type = 'triangle';
      osc.frequency.value = freq;
      const g = c.createGain();
      const start = t + i * 0.22;
      g.gain.setValueAtTime(0.0, start);
      g.gain.linearRampToValueAtTime(0.22, start + 0.06);
      g.gain.exponentialRampToValueAtTime(0.001, start + 2.0);
      osc.connect(g).connect(this.master!);
      osc.start(start);
      osc.stop(start + 2.2);
    });
  }

  // ---- noise helper ----
  private makeNoise(): AudioBufferSourceNode {
    if (!this.ctx) throw new Error('AudioContext not unlocked');
    const buffer = this.ctx.createBuffer(1, this.ctx.sampleRate, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = true;
    src.start();
    return src;
  }
}
