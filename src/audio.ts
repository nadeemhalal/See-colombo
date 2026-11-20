/** Tiny synthesised sound: tuk-tuk engine, horns, bumps. No audio files needed. */
export class Sound {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private engGain: GainNode | null = null;
  private engOsc: OscillatorNode | null = null;
  private engLfo: OscillatorNode | null = null;
  private engFilter: BiquadFilterNode | null = null;
  muted = false;

  /** must be called from a user gesture (click / key) */
  unlock() {
    if (this.ctx) { if (this.ctx.state === 'suspended') void this.ctx.resume(); return; }
    try {
      const ctx = new AudioContext();
      this.ctx = ctx;
      this.master = ctx.createGain();
      this.master.gain.value = 0.6;
      this.master.connect(ctx.destination);

      // two-stroke putter: sawtooth, amplitude-chopped by a square LFO, low-passed
      this.engOsc = ctx.createOscillator();
      this.engOsc.type = 'sawtooth';
      this.engOsc.frequency.value = 45;
      this.engFilter = ctx.createBiquadFilter();
      this.engFilter.type = 'lowpass';
      this.engFilter.frequency.value = 500;
      const chop = ctx.createGain();
      chop.gain.value = 0.5;
      this.engLfo = ctx.createOscillator();
      this.engLfo.type = 'square';
      this.engLfo.frequency.value = 14;
      const lfoAmt = ctx.createGain();
      lfoAmt.gain.value = 0.45;
      this.engLfo.connect(lfoAmt).connect(chop.gain);
      this.engGain = ctx.createGain();
      this.engGain.gain.value = 0;
      this.engOsc.connect(this.engFilter).connect(chop).connect(this.engGain).connect(this.master);
      this.engOsc.start();
      this.engLfo.start();
    } catch {
      this.ctx = null;
    }
  }

  setMuted(m: boolean) {
    this.muted = m;
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(m ? 0 : 0.6, this.ctx.currentTime, 0.05);
  }

  /** on: player is in a vehicle. speed in m/s, throttle 0..1 */
  engine(on: boolean, speed: number, throttle: number) {
    if (!this.ctx || !this.engGain || !this.engOsc || !this.engLfo || !this.engFilter) return;
    const t = this.ctx.currentTime;
    const rpm = 0.25 + Math.min(1, Math.abs(speed) / 16) * 0.6 + throttle * 0.15;
    this.engGain.gain.setTargetAtTime(on ? 0.07 + throttle * 0.05 : 0, t, 0.08);
    this.engOsc.frequency.setTargetAtTime(38 + rpm * 70, t, 0.05);
    this.engLfo.frequency.setTargetAtTime(10 + rpm * 30, t, 0.05);
    this.engFilter.frequency.setTargetAtTime(350 + rpm * 900, t, 0.05);
  }

  /** two-tone horn; volume 0..1 */
  horn(volume = 1, pitch = 1) {
    if (!this.ctx || !this.master || volume <= 0.01) return;
    const t = this.ctx.currentTime;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.06 * volume, t + 0.02);
    g.gain.setValueAtTime(0.06 * volume, t + 0.3);
    g.gain.linearRampToValueAtTime(0, t + 0.38);
    g.connect(this.master);
    for (const f of [410 * pitch, 515 * pitch]) {
      const o = this.ctx.createOscillator();
      o.type = 'square';
      o.frequency.value = f;
      o.connect(g);
      o.start(t);
      o.stop(t + 0.4);
    }
  }

  /** long, low two-tone train horn; volume 0..1 */
  trainHorn(volume = 1, long = false) {
    if (!this.ctx || !this.master || volume <= 0.01) return;
    const t = this.ctx.currentTime;
    const dur = long ? 1.6 : 0.8;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.05 * volume, t + 0.08);
    g.gain.setValueAtTime(0.05 * volume, t + dur);
    g.gain.linearRampToValueAtTime(0, t + dur + 0.25);
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 1400;
    g.connect(f).connect(this.master);
    for (const hz of [233, 277, 349]) {
      const o = this.ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = hz;
      o.connect(g);
      o.start(t);
      o.stop(t + dur + 0.3);
    }
  }

  bump(strength: number) {
    if (!this.ctx || !this.master) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.setValueAtTime(90, t);
    o.frequency.exponentialRampToValueAtTime(35, t + 0.18);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(Math.min(0.25, 0.04 * strength), t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + 0.22);
  }
}
