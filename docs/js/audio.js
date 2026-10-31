/**
 * RETRO-NET BBS - Web Audio Sound Engine
 * Synthesizes mechanical keyboard clicks, terminal bell, and authentic modem connect squeals.
 */

class RetroAudio {
  constructor() {
    this.ctx = null;
    this.enabled = true;
    this.noiseBuffer = null;

    // Load sound preference
    try {
      const saved = localStorage.getItem('bbs_sound_enabled');
      if (saved !== null) {
        this.enabled = saved === 'true';
      }
    } catch (e) {
      // localStorage might fail in private browsing
    }
  }

  init() {
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx) {
        this.ctx = new AudioCtx();
        this._generateNoiseBuffer();
      }
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
  }

  _generateNoiseBuffer() {
    if (!this.ctx) return;
    const bufferSize = this.ctx.sampleRate * 1.5;
    this.noiseBuffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const output = this.noiseBuffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      output[i] = Math.random() * 2 - 1;
    }
  }

  toggle() {
    this.enabled = !this.enabled;
    try {
      localStorage.setItem('bbs_sound_enabled', String(this.enabled));
    } catch (e) {}
    if (this.enabled) {
      this.init();
      this.playBell(1000);
    }
    return this.enabled;
  }

  playKeyClick() {
    if (!this.enabled) return;
    this.init();
    if (!this.ctx) return;

    try {
      const t = this.ctx.currentTime;

      // Mechanical switch click pop (low thud)
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(140 + Math.random() * 40, t);
      osc.frequency.exponentialRampToValueAtTime(30, t + 0.025);

      gain.gain.setValueAtTime(0.12, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.025);

      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start(t);
      osc.stop(t + 0.03);

      // High crisp mechanical snap (filtered noise burst)
      if (this.noiseBuffer) {
        const noiseSource = this.ctx.createBufferSource();
        noiseSource.buffer = this.noiseBuffer;

        const filter = this.ctx.createBiquadFilter();
        filter.type = 'bandpass';
        filter.frequency.setValueAtTime(3200 + Math.random() * 600, t);
        filter.Q.setValueAtTime(3, t);

        const noiseGain = this.ctx.createGain();
        noiseGain.gain.setValueAtTime(0.06, t);
        noiseGain.gain.exponentialRampToValueAtTime(0.001, t + 0.015);

        noiseSource.connect(filter);
        filter.connect(noiseGain);
        noiseGain.connect(this.ctx.destination);

        noiseSource.start(t, Math.random() * 0.5);
        noiseSource.stop(t + 0.02);
      }
    } catch (e) {
      // AudioContext policy suppression fallback
    }
  }

  playBell(freq = 780) {
    if (!this.enabled) return;
    this.init();
    if (!this.ctx) return;

    try {
      const t = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, t);

      gain.gain.setValueAtTime(0.2, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.3);

      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start(t);
      osc.stop(t + 0.32);
    } catch (e) {}
  }

  playBlip() {
    if (!this.enabled) return;
    this.init();
    if (!this.ctx) return;

    try {
      const t = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = 'square';
      osc.frequency.setValueAtTime(1200, t);
      osc.frequency.setValueAtTime(1800, t + 0.03);

      gain.gain.setValueAtTime(0.05, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.06);

      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start(t);
      osc.stop(t + 0.07);
    } catch (e) {}
  }

  playModemConnect() {
    if (!this.enabled) return;
    this.init();
    if (!this.ctx) return;

    try {
      const t = this.ctx.currentTime;

      // 1. V.25 Answer Tone (2100 Hz pure tone for 250ms)
      const tone1 = this.ctx.createOscillator();
      const gain1 = this.ctx.createGain();
      tone1.type = 'sine';
      tone1.frequency.setValueAtTime(2100, t);
      gain1.gain.setValueAtTime(0.15, t);
      gain1.gain.setValueAtTime(0.15, t + 0.22);
      gain1.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
      tone1.connect(gain1);
      gain1.connect(this.ctx.destination);
      tone1.start(t);
      tone1.stop(t + 0.26);

      // 2. FSK Dual Frequency Negotiation Warble (0.25s - 0.75s)
      const fskOsc = this.ctx.createOscillator();
      const fskGain = this.ctx.createGain();
      fskOsc.type = 'sawtooth';

      const fskStart = t + 0.25;
      fskGain.gain.setValueAtTime(0, t);
      fskGain.gain.setValueAtTime(0.12, fskStart);

      // Rapid frequency steps mimicking modem FSK negotiation
      const freqs = [1300, 2100, 980, 1650, 1800, 1200, 2400, 1400, 2225];
      let stepTime = fskStart;
      for (let i = 0; i < 16; i++) {
        const freq = freqs[i % freqs.length] + (Math.random() * 50 - 25);
        fskOsc.frequency.setValueAtTime(freq, stepTime);
        stepTime += 0.03;
      }
      fskGain.gain.setValueAtTime(0.12, fskStart + 0.45);
      fskGain.gain.exponentialRampToValueAtTime(0.001, fskStart + 0.5);

      const fskFilter = this.ctx.createBiquadFilter();
      fskFilter.type = 'lowpass';
      fskFilter.frequency.setValueAtTime(2600, t);

      fskOsc.connect(fskFilter);
      fskFilter.connect(fskGain);
      fskGain.connect(this.ctx.destination);
      fskOsc.start(fskStart);
      fskOsc.stop(fskStart + 0.52);

      // 3. Scrambled carrier white noise burst (0.75s - 1.25s)
      if (this.noiseBuffer) {
        const noiseStart = t + 0.75;
        const noiseSource = this.ctx.createBufferSource();
        noiseSource.buffer = this.noiseBuffer;

        const noiseFilter = this.ctx.createBiquadFilter();
        noiseFilter.type = 'bandpass';
        noiseFilter.frequency.setValueAtTime(1700, noiseStart);
        noiseFilter.Q.setValueAtTime(1.5, noiseStart);

        const noiseGain = this.ctx.createGain();
        noiseGain.gain.setValueAtTime(0, t);
        noiseGain.gain.setValueAtTime(0.09, noiseStart);
        noiseGain.gain.setValueAtTime(0.09, noiseStart + 0.4);
        noiseGain.gain.exponentialRampToValueAtTime(0.001, noiseStart + 0.5);

        noiseSource.connect(noiseFilter);
        noiseFilter.connect(noiseGain);
        noiseGain.connect(this.ctx.destination);

        noiseSource.start(noiseStart);
        noiseSource.stop(noiseStart + 0.52);
      }

      // 4. Final carrier lock chime (1.3s - 1.5s)
      const lockStart = t + 1.25;
      const lockOsc = this.ctx.createOscillator();
      const lockGain = this.ctx.createGain();
      lockOsc.type = 'sine';
      lockOsc.frequency.setValueAtTime(1800, lockStart);
      lockOsc.frequency.setValueAtTime(2400, lockStart + 0.1);

      lockGain.gain.setValueAtTime(0.15, lockStart);
      lockGain.gain.exponentialRampToValueAtTime(0.001, lockStart + 0.25);

      lockOsc.connect(lockGain);
      lockGain.connect(this.ctx.destination);
      lockOsc.start(lockStart);
      lockOsc.stop(lockStart + 0.26);
    } catch (e) {}
  }
}

export const retroAudio = new RetroAudio();
