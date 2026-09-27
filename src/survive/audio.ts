// ============================================================
// GREY CORRIDOR — procedural WebAudio engine (no audio assets)
// Engine, ambience, footsteps, doors, gunfire, stings — all synthesized.
// ============================================================

import type { ChapterId } from './types';

export type Mood = 'calm' | 'suspicion' | 'detention' | 'training' | 'combat';

function gainForDistance(dist: number, ref = 12): number {
  return Math.max(0, Math.min(1, ref / (ref + dist)));
}

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private muted = false;
  private ambNodes: AudioNode[] = [];
  private ambGain: GainNode | null = null;
  private engOsc: OscillatorNode[] = [];
  private engGain: GainNode | null = null;
  private engFilter: BiquadFilterNode | null = null;
  private pulseTimer: number | null = null;
  mood: Mood = 'calm';

  get isMuted(): boolean {
    return this.muted;
  }

  /** Must be called from a user gesture at least once. */
  resume(): void {
    try {
      if (!this.ctx) {
        const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        if (!AC) return;
        this.ctx = new AC();
        this.master = this.ctx.createGain();
        this.master.gain.value = this.muted ? 0 : 0.9;
        this.master.connect(this.ctx.destination);
        this.startEngineLoop();
      }
      if (this.ctx.state === 'suspended') void this.ctx.resume();
    } catch {
      /* audio unavailable */
    }
  }

  setMuted(m: boolean): void {
    this.muted = m;
    if (this.ctx && this.master) {
      this.master.gain.setTargetAtTime(m ? 0 : 0.9, this.ctx.currentTime, 0.05);
    }
  }

  // ---------------- ambience ----------------
  setChapterAmbience(chapter: ChapterId): void {
    if (!this.ctx || !this.master) return;
    this.stopAmbience();
    const ctx = this.ctx;
    this.ambGain = ctx.createGain();
    this.ambGain.gain.value = 0;
    this.ambGain.connect(this.master);
    this.ambGain.gain.setTargetAtTime(chapter === 'frontline' ? 0.16 : 0.1, ctx.currentTime, 2);

    const noise = this.loopedNoise(2, chapter === 'city' || chapter === 'minibus' ? 400 : 900);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = chapter === 'city' ? 500 : 1100;
    noise.connect(lp).connect(this.ambGain);
    this.ambNodes.push(noise, lp);

    // city traffic rumble: slow LFO on a low osc
    if (chapter === 'city' || chapter === 'minibus') {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = 55;
      const og = ctx.createGain();
      og.gain.value = 0.05;
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 0.13;
      const lg = ctx.createGain();
      lg.gain.value = 0.03;
      lfo.connect(lg).connect(og.gain);
      osc.connect(og).connect(this.ambGain);
      osc.start();
      lfo.start();
      this.ambNodes.push(osc, lfo, og, lg);
    }
    // frontline: distant rumble thumps
    if (chapter === 'frontline') {
      const rumble = () => {
        if (!this.ctx || !this.ambGain) return;
        this.thump(0.05 + Math.random() * 0.06, 40 + Math.random() * 25);
        this.pulseTimer = window.setTimeout(rumble, 5000 + Math.random() * 9000);
      };
      this.pulseTimer = window.setTimeout(rumble, 3000);
    }
  }

  private stopAmbience(): void {
    for (const n of this.ambNodes) {
      try {
        if (n instanceof OscillatorNode || n instanceof AudioBufferSourceNode) n.stop();
        n.disconnect();
      } catch {
        /* ignore */
      }
    }
    this.ambNodes = [];
    if (this.pulseTimer !== null) {
      window.clearTimeout(this.pulseTimer);
      this.pulseTimer = null;
    }
  }

  private loopedNoise(seconds: number, filterFreq: number): AudioBufferSourceNode {
    const ctx = this.ctx!;
    const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * seconds), ctx.sampleRate);
    const data = buf.getChannelData(0);
    let last = 0;
    const alpha = Math.min(0.98, Math.max(0.02, 1 - filterFreq / 4000));
    for (let i = 0; i < data.length; i++) {
      const white = Math.random() * 2 - 1;
      last = last * alpha + white * (1 - alpha);
      data[i] = last * 2.2;
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    src.start();
    return src;
  }

  // ---------------- minibus engine (positional) ----------------
  private startEngineLoop(): void {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    this.engGain = ctx.createGain();
    this.engGain.gain.value = 0;
    this.engFilter = ctx.createBiquadFilter();
    this.engFilter.type = 'lowpass';
    this.engFilter.frequency.value = 320;
    this.engGain.connect(this.engFilter).connect(this.master);
    for (const [type, freq] of [['sawtooth', 62], ['square', 31]] as Array<[OscillatorType, number]>) {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = freq;
      const g = ctx.createGain();
      g.gain.value = type === 'sawtooth' ? 0.5 : 0.35;
      o.connect(g).connect(this.engGain);
      o.start();
      this.engOsc.push(o);
    }
  }

  /** rpm 0..1, dist in meters. Call every frame. */
  updateEngine(rpm: number, dist: number, audible: boolean): void {
    if (!this.ctx || !this.engGain || !this.engFilter) return;
    const t = this.ctx.currentTime;
    const vol = audible ? gainForDistance(dist, 26) * (0.05 + rpm * 0.1) : 0;
    this.engGain.gain.setTargetAtTime(vol, t, 0.15);
    this.engFilter.frequency.setTargetAtTime(220 + rpm * 900, t, 0.2);
    this.engOsc[0]?.frequency.setTargetAtTime(55 + rpm * 90, t, 0.15);
    this.engOsc[1]?.frequency.setTargetAtTime(27 + rpm * 45, t, 0.15);
  }

  // ---------------- one-shots ----------------
  private blip(freq: number, dur: number, vol: number, type: OscillatorType = 'sine', slideTo?: number): void {
    if (!this.ctx || !this.master || this.muted) return;
    try {
      const ctx = this.ctx;
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.setValueAtTime(freq, ctx.currentTime);
      if (slideTo !== undefined) o.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), ctx.currentTime + dur);
      const g = ctx.createGain();
      g.gain.setValueAtTime(vol, ctx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur);
      o.connect(g).connect(this.master);
      o.start();
      o.stop(ctx.currentTime + dur + 0.02);
    } catch {
      /* ignore */
    }
  }

  private thump(vol: number, freq: number): void {
    this.blip(freq, 0.5, vol, 'sine', 28);
  }

  footstep(run: boolean, surface: 'asphalt' | 'dirt' | 'wood' | 'metal' = 'asphalt'): void {
    if (!this.ctx || !this.master || this.muted) return;
    try {
      const ctx = this.ctx;
      const dur = 0.09;
      const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * dur), ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
      const src = ctx.createBufferSource();
      src.buffer = buf;
      const f = ctx.createBiquadFilter();
      f.type = 'bandpass';
      f.frequency.value = surface === 'metal' ? 2400 : surface === 'wood' ? 900 : surface === 'dirt' ? 350 : 700;
      const g = ctx.createGain();
      g.gain.value = run ? 0.22 : 0.13;
      src.connect(f).connect(g).connect(this.master);
      src.start();
    } catch {
      /* ignore */
    }
  }

  gunshot(dist: number, enemy = false): void {
    if (!this.ctx || !this.master || this.muted) return;
    try {
      const ctx = this.ctx;
      const vol = enemy ? gainForDistance(dist, 40) * 0.5 : 0.6;
      if (vol < 0.02) return;
      const dur = 0.22;
      const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * dur), ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 2.2);
      const src = ctx.createBufferSource();
      src.buffer = buf;
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = enemy ? 1400 : 3200;
      const g = ctx.createGain();
      g.gain.value = vol;
      src.connect(f).connect(g).connect(this.master);
      src.start();
      this.blip(enemy ? 130 : 180, 0.12, vol * 0.5, 'square', 50);
    } catch {
      /* ignore */
    }
  }

  explosion(dist: number): void {
    if (!this.ctx || !this.master || this.muted) return;
    const vol = gainForDistance(dist, 60) * 0.9;
    if (vol < 0.02) return;
    this.thump(vol, 70);
    this.blip(300, 0.6, vol * 0.4, 'sawtooth', 40);
  }

  uiClick(): void {
    this.blip(660, 0.06, 0.08, 'square');
  }
  pickup(): void {
    this.blip(520, 0.1, 0.12, 'sine', 880);
  }
  radioBlip(): void {
    this.blip(1180, 0.07, 0.07, 'square');
    window.setTimeout(() => this.blip(880, 0.09, 0.07, 'square'), 110);
  }
  doorVan(): void {
    this.blip(140, 0.35, 0.25, 'sawtooth', 60);
    window.setTimeout(() => this.blip(90, 0.15, 0.3, 'square', 50), 280);
  }
  reload(): void {
    this.blip(300, 0.05, 0.12, 'square');
    window.setTimeout(() => this.blip(210, 0.06, 0.14, 'square'), 140);
    window.setTimeout(() => this.blip(420, 0.05, 0.14, 'square'), 420);
  }
  vault(): void {
    this.blip(220, 0.12, 0.12, 'sine', 330);
  }
  stingSuspicion(): void {
    this.blip(196, 0.9, 0.16, 'sawtooth', 185);
    this.blip(392, 0.9, 0.08, 'sine', 370);
  }
  stingDetained(): void {
    this.blip(110, 1.4, 0.22, 'sawtooth', 55);
    window.setTimeout(() => this.blip(165, 1.0, 0.14, 'sawtooth', 82), 200);
  }
  stingRelease(): void {
    this.blip(330, 0.5, 0.12, 'sine', 495);
  }
  whistle(): void {
    this.blip(2100, 0.35, 0.1, 'sine', 2400);
  }
  checkpoint(): void {
    this.blip(740, 0.12, 0.12, 'sine', 990);
  }
  missionOk(): void {
    this.blip(523, 0.16, 0.14, 'triangle');
    window.setTimeout(() => this.blip(659, 0.16, 0.14, 'triangle'), 150);
    window.setTimeout(() => this.blip(784, 0.3, 0.16, 'triangle'), 300);
  }
  hurt(): void {
    this.blip(160, 0.2, 0.2, 'sawtooth', 90);
  }
  horn(): void {
    this.blip(370, 0.35, 0.22, 'square');
    this.blip(466, 0.35, 0.18, 'square');
  }
  siren(): void {
    if (!this.ctx || !this.master || this.muted) return;
    try {
      const ctx = this.ctx;
      const o = ctx.createOscillator();
      o.type = 'triangle';
      o.frequency.value = 700;
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 0.7;
      const lg = ctx.createGain();
      lg.gain.value = 280;
      lfo.connect(lg).connect(o.frequency);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, ctx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.12, ctx.currentTime + 0.3);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 2.4);
      o.connect(g).connect(this.master);
      o.start();
      lfo.start();
      o.stop(ctx.currentTime + 2.5);
      lfo.stop(ctx.currentTime + 2.5);
    } catch {
      /* ignore */
    }
  }
  shout(): void {
    this.blip(520, 0.12, 0.16, 'sawtooth', 700);
    window.setTimeout(() => this.blip(620, 0.14, 0.16, 'sawtooth', 480), 140);
  }
}
