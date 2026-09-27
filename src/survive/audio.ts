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
  private engSrc: AudioBufferSourceNode | null = null;
  private crowdGain: GainNode | null = null;
  private pulseTimer: number | null = null;
  mood: Mood = 'calm';
  private sirenNodes: AudioNode[] = [];
  private sirenOn = false;
  private cannonBuf: AudioBuffer | null = null;
  private cannonLoading = false;
  private sfxBufs = new Map<string, AudioBuffer>();
  private sfxLoading = new Set<string>();
  private loopNodes = new Map<string, AudioNode[]>();
  private loopTimers = new Map<string, number>();

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
    try {
      if (!this.engSrc && this.ctx && this.master && audible && vol > 0.005) {
        this.ensureSample('engine');
        const buf = this.sfxBufs.get('engine');
        if (buf) {
          const src = this.ctx.createBufferSource();
          src.buffer = buf;
          src.loop = true;
          const g = this.ctx.createGain();
          g.gain.value = 0;
          src.connect(g).connect(this.master);
          src.start();
          (src as unknown as { _g: GainNode })._g = g;
          this.engSrc = src;
        }
      }
      if (this.engSrc) {
        const g = (this.engSrc as unknown as { _g: GainNode })._g;
        g.gain.setTargetAtTime(audible ? vol * 1.4 : 0, t, 0.2);
        this.engSrc.playbackRate.setTargetAtTime(0.75 + rpm * 0.8, t, 0.2);
      }
    } catch {
      /* ignore */
    }
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
    if (surface === 'asphalt' || surface === 'dirt') {
      const heard = this.playSample(surface === 'dirt' ? 'step_gr' : 'step_as', run ? 0.3 : 0.18, 0.92 + Math.random() * 0.16);
      if (heard) return;
    }
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
      this.playSample('gunshot', vol * (enemy ? 0.8 : 0.7), 0.94 + Math.random() * 0.12, false, 0.005, enemy ? 2500 : 0);
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
    this.playSample('blast_near', vol * 0.55, 0.9 + Math.random() * 0.2);
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
    this.playSample('creak', 0.18, 0.9 + Math.random() * 0.2);
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

  /** Two-tone siren loop. Idempotent — safe to call every frame. */
  sirenLoop(on: boolean): void {
    if (!this.ctx || !this.master) {
      this.sirenOn = false;
      return;
    }
    if (on === this.sirenOn) return;
    this.sirenOn = on;
    if (!on) {
      for (const n of this.sirenNodes) {
        try {
          if (n instanceof OscillatorNode) n.stop();
          n.disconnect();
        } catch {
          /* ignore */
        }
      }
      this.sirenNodes = [];
      return;
    }
    try {
      const ctx = this.ctx;
      const o = ctx.createOscillator();
      o.type = 'triangle';
      o.frequency.value = 800;
      const lfo = ctx.createOscillator();
      lfo.type = 'square';
      lfo.frequency.value = 0.9;
      const lg = ctx.createGain();
      lg.gain.value = 130;
      lfo.connect(lg).connect(o.frequency);
      const g = ctx.createGain();
      g.gain.value = 0.0;
      g.gain.setTargetAtTime(0.06, ctx.currentTime, 0.4);
      o.connect(g).connect(this.master);
      o.start();
      lfo.start();
      this.sirenNodes.push(o, lfo, lg, g);
    } catch {
      /* ignore */
    }
  }

  /** Sliding-door sweep + clunk. */
  doorSlide(): void {
    if (!this.ctx || !this.master || this.muted) return;
    try {
      const ctx = this.ctx;
      const dur = 0.45;
      const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * dur), ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
      const src = ctx.createBufferSource();
      src.buffer = buf;
      const f = ctx.createBiquadFilter();
      f.type = 'bandpass';
      f.frequency.setValueAtTime(400, ctx.currentTime);
      f.frequency.exponentialRampToValueAtTime(1400, ctx.currentTime + dur);
      const g = ctx.createGain();
      g.gain.value = 0.25;
      src.connect(f).connect(g).connect(this.master);
      src.start();
      this.playSample('creak', 0.2, 0.9 + Math.random() * 0.2);
      window.setTimeout(() => this.blip(95, 0.14, 0.28, 'square', 55), 380);
    } catch {
      /* ignore */
    }
  }


  // ---------------- sample-based SFX (GitHub) ----------------
  private ensureSample(key: 'alarm' | 'blast_far' | 'blast_near' | 'launch' | 'rumble' | 'launch2' | 'blast_alt' | 'deepboom' | 'night' | 'engine' | 'honk' | 'thud' | 'glass' | 'bell' | 'crowd' | 'step_as' | 'step_gr' | 'gunshot' | 'crow' | 'creak' | 'growl'): void {
    if (!this.ctx || this.sfxBufs.has(key) || this.sfxLoading.has(key)) return;
    this.sfxLoading.add(key);
    import('./assets')
      .then(({ ASSET_URLS }) => {
        if (!this.ctx) return;
        const url = (ASSET_URLS as unknown as Record<string, string>)[key];
        if (!url) return;
        fetch(url)
          .then((r) => r.arrayBuffer())
          .then((b) => this.ctx!.decodeAudioData(b))
          .then((buf) => {
            this.sfxBufs.set(key, buf);
          })
          .catch(() => {
            /* keep synth */
          });
      })
      .catch(() => {
        /* keep synth */
      });
  }

  /** Play a cached sample; triggers async load on first use. Null when not ready. */
  private playSample(
    key: 'alarm' | 'blast_far' | 'blast_near' | 'launch' | 'rumble' | 'launch2' | 'blast_alt' | 'deepboom' | 'night' | 'engine' | 'honk' | 'thud' | 'glass' | 'bell' | 'crowd' | 'step_as' | 'step_gr' | 'gunshot' | 'crow' | 'creak' | 'growl',
    vol: number,
    rate = 1,
    loop = false,
    fadeIn = 0.05,
    filterFreq = 0,
  ): AudioBufferSourceNode | null {
    if (!this.ctx || !this.master || this.muted) return null;
    this.ensureSample(key);
    const buf = this.sfxBufs.get(key);
    if (!buf) return null;
    try {
      const ctx = this.ctx;
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.loop = loop;
      src.playbackRate.value = rate;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, ctx.currentTime);
      g.gain.exponentialRampToValueAtTime(Math.max(0.001, vol), ctx.currentTime + Math.max(0.01, fadeIn));
      src.connect(g);
      if (filterFreq > 0) {
        const f = ctx.createBiquadFilter();
        f.type = 'lowpass';
        f.frequency.value = filterFreq;
        g.connect(f).connect(this.master);
      } else {
        g.connect(this.master);
      }
      src.start();
      return src;
    } catch {
      return null;
    }
  }

  private stopLoop(name: string, fade = 0.5): void {
    const nodes = this.loopNodes.get(name);
    if (nodes) {
      const ctx = this.ctx;
      for (const n of nodes) {
        try {
          if (n instanceof GainNode && ctx) n.gain.setTargetAtTime(0, ctx.currentTime, fade / 3);
          else if (n instanceof OscillatorNode || n instanceof AudioBufferSourceNode) n.stop(ctx ? ctx.currentTime + fade : 0);
          else if (ctx) {
            const nn = n;
            window.setTimeout(() => {
              try {
                nn.disconnect();
              } catch {
                /* ignore */
              }
            }, fade * 1000);
          }
        } catch {
          /* ignore */
        }
      }
      this.loopNodes.delete(name);
    }
    const tm = this.loopTimers.get(name);
    if (tm !== undefined) {
      window.clearTimeout(tm);
      this.loopTimers.delete(name);
    }
  }

  /** Air-raid alarm: real sample loop, synth wail fallback. */
  airRaidLoop(on: boolean): void {
    if (!this.ctx || !this.master) return;
    this.stopLoop('air');
    if (!on) return;
    const src = this.playSample('alarm', 0.34, 1, true, 1.2);
    if (src) {
      this.loopNodes.set('air', [src]);
      return;
    }
    try {
      const ctx = this.ctx;
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = 620;
      const lfo = ctx.createOscillator();
      lfo.type = 'triangle';
      lfo.frequency.value = 0.16;
      const lg = ctx.createGain();
      lg.gain.value = 190;
      lfo.connect(lg).connect(o.frequency);
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = 1400;
      const g = ctx.createGain();
      g.gain.value = 0;
      g.gain.setTargetAtTime(0.14, ctx.currentTime, 1.0);
      o.connect(f).connect(g).connect(this.master);
      o.start();
      lfo.start();
      this.loopNodes.set('air', [o, lfo, lg, f, g]);
    } catch {
      /* ignore */
    }
  }

  /** Drizzle patter loop. */
  rainLoop(on: boolean, vol = 0.06): void {
    if (!this.ctx || !this.master) return;
    this.stopLoop('rain');
    if (!on) return;
    try {
      const ctx = this.ctx;
      const noise = this.loopedNoise(3, 2500);
      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = 1400;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 7500;
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 0.7;
      const lg = ctx.createGain();
      lg.gain.value = 900;
      lfo.connect(lg).connect(lp.frequency);
      const g = ctx.createGain();
      g.gain.value = 0;
      g.gain.setTargetAtTime(vol, ctx.currentTime, 2.5);
      noise.connect(hp).connect(lp).connect(g).connect(this.master);
      lfo.start();
      this.loopNodes.set('rain', [noise, hp, lp, lfo, lg, g]);
    } catch {
      /* ignore */
    }
  }

  /** Night wind loop. */
  windLoop(on: boolean, vol = 0.09): void {
    if (!this.ctx || !this.master) return;
    this.stopLoop('wind');
    if (!on) return;
    try {
      const ctx = this.ctx;
      const noise = this.loopedNoise(4, 300);
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 380;
      const g = ctx.createGain();
      g.gain.value = vol;
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 0.09;
      const lg = ctx.createGain();
      lg.gain.value = vol * 0.7;
      lfo.connect(lg).connect(g.gain);
      noise.connect(lp).connect(g).connect(this.master);
      lfo.start();
      this.loopNodes.set('wind', [noise, lp, lfo, lg, g]);
    } catch {
      /* ignore */
    }
  }

  /** Horror drone: detuned lows + faint shimmer. */
  horrorPad(on: boolean): void {
    if (!this.ctx || !this.master) return;
    this.stopLoop('pad');
    if (!on) return;
    try {
      const ctx = this.ctx;
      const nodes: AudioNode[] = [];
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 240;
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 0.05;
      const lg = ctx.createGain();
      lg.gain.value = 120;
      lfo.connect(lg).connect(lp.frequency);
      const g = ctx.createGain();
      g.gain.value = 0;
      g.gain.setTargetAtTime(0.3, ctx.currentTime, 2.0);
      lp.connect(g).connect(this.master);
      for (const f of [55, 55.6, 82.4, 110.3]) {
        const o = ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.value = f;
        const og = ctx.createGain();
        og.gain.value = 0.05;
        o.connect(og).connect(lp);
        o.start();
        nodes.push(o, og);
      }
      const sh = ctx.createOscillator();
      sh.type = 'sine';
      sh.frequency.value = 1244;
      const shg = ctx.createGain();
      shg.gain.value = 0.006;
      const tr = ctx.createOscillator();
      tr.frequency.value = 0.3;
      const trg = ctx.createGain();
      trg.gain.value = 0.004;
      tr.connect(trg).connect(shg.gain);
      sh.connect(shg).connect(this.master);
      sh.start();
      tr.start();
      lfo.start();
      this.loopNodes.set('pad', [...nodes, lp, lfo, lg, g, sh, shg, tr, trg]);
    } catch {
      /* ignore */
    }
  }

  /** Lub-dub heartbeat loop. */
  heartbeatLoop(on: boolean): void {
    this.stopLoop('heart');
    if (!on || !this.ctx) return;
    const beat = (): void => {
      if (!this.ctx || !this.loopTimers.has('heart')) return;
      this.thump(0.4, 58);
      window.setTimeout(() => this.thump(0.28, 52), 180);
      this.loopTimers.set('heart', window.setTimeout(beat, 1050));
    };
    this.loopTimers.set('heart', window.setTimeout(beat, 100));
  }

  /** Deep rumble bed (real sample loop). */
  rumbleLoop(on: boolean): void {
    if (!this.ctx || !this.master) return;
    this.stopLoop('rumble');
    if (!on) return;
    const src = this.playSample('rumble', 0.2, 0.9 + Math.random() * 0.2, true, 2.0, 500);
    if (src) this.loopNodes.set('rumble', [src]);
  }

  /** Distant blast / thunder. */
  thunderFar(vol = 0.5): void {
    if (!this.ctx || !this.master || this.muted) return;
    const key = Math.random() < 0.5 ? 'blast_far' : 'blast_alt';
    const src = this.playSample(key, vol, key === 'blast_far' ? 0.7 + Math.random() * 0.4 : 0.6 + Math.random() * 0.5, false, 0.08, 900);
    if (!src) this.thump(vol * 0.7, 48);
    else this.thump(vol * 0.4, 42);
  }

  /** Close crack. */
  thunderCrack(vol = 0.6): void {
    if (!this.ctx || !this.master || this.muted) return;
    const ckey = Math.random() < 0.6 ? 'blast_near' : 'blast_alt';
    const src = this.playSample(ckey, vol, 0.85 + Math.random() * 0.3, false, 0.01);
    if (!src) this.blip(180, 0.18, vol * 0.5, 'square', 60);
  }

  /** Distant launch whoosh. */
  launchDistant(): void {
    if (!this.ctx || !this.master || this.muted) return;
    const src = this.playSample('launch', 0.15, 0.8 + Math.random() * 0.3, false, 0.4, 1200);
    if (!src) this.blip(90, 1.2, 0.05, 'sawtooth', 45);
  }

  /** Distant missile launch (frontline). */
  missileLaunch(): void {
    if (!this.ctx || !this.master || this.muted) return;
    const src = this.playSample('launch2', 0.2, 0.85 + Math.random() * 0.3, false, 0.3, 1500);
    if (!src) this.blip(70, 1.6, 0.06, 'sawtooth', 40);
  }

  /** Deep detonation boom (blackout flash). */
  deepBoom(): void {
    if (!this.ctx || !this.master || this.muted) return;
    const src = this.playSample('deepboom', 0.7, 0.9 + Math.random() * 0.2, false, 0.02, 700);
    if (!src) this.thump(0.6, 45);
    else this.thump(0.35, 40);
  }

  /** Night ambience bed (real loop). */
  nightLoop(on: boolean): void {
    if (!this.ctx || !this.master) return;
    this.stopLoop('night');
    if (!on) return;
    const src = this.playSample('night', 0.13, 1, true, 3.0);
    if (src) this.loopNodes.set('night', [src]);
  }

  /** Bazaar murmur loop with positional gain. */
  crowdLoop(on: boolean): void {
    if (!this.ctx || !this.master) return;
    this.stopLoop('crowd');
    this.crowdGain = null;
    if (!on) return;
    this.ensureSample('crowd');
    const buf = this.sfxBufs.get('crowd');
    if (!buf) {
      this.loopTimers.set('crowd', window.setTimeout(() => this.crowdLoop(true), 1500));
      return;
    }
    try {
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      const g = this.ctx.createGain();
      g.gain.value = 0;
      src.connect(g).connect(this.master);
      src.start();
      this.crowdGain = g;
      this.loopNodes.set('crowd', [src, g]);
    } catch {
      /* ignore */
    }
  }

  setCrowd(v: number): void {
    if (!this.ctx || !this.crowdGain) return;
    this.crowdGain.gain.setTargetAtTime(Math.max(0, Math.min(1, v)) * 0.16, this.ctx.currentTime, 0.5);
  }

  /** Car horn. */
  honk(): void {
    if (!this.ctx || !this.master || this.muted) return;
    const src = this.playSample('honk', 0.1, 0.92 + Math.random() * 0.16);
    if (!src) this.horn();
  }

  /** Landing / body thud. */
  thudLand(): void {
    if (!this.ctx || !this.master || this.muted) return;
    const src = this.playSample('thud', 0.5, 0.9 + Math.random() * 0.2, false, 0.01, 600);
    if (!src) this.thump(0.4, 70);
  }

  /** Glass break. */
  glassBreak(vol = 0.5): void {
    if (!this.ctx || !this.master || this.muted) return;
    const src = this.playSample('glass', vol, 0.9 + Math.random() * 0.2);
    if (!src) this.blip(1800, 0.12, vol * 0.4, 'square', 900);
  }

  /** Distant church bell. */
  bellStrike(): void {
    if (!this.ctx || !this.master || this.muted) return;
    const src = this.playSample('bell', 0.2, 0.97 + Math.random() * 0.06, false, 0.01, 2500);
    if (!src) this.blip(146, 1.5, 0.08, 'sine', 140);
  }

  /** Distant crow. */
  crowCaw(): void {
    if (!this.ctx || !this.master || this.muted) return;
    this.playSample('crow', 0.09, 0.9 + Math.random() * 0.2);
  }

  /** Horror growl sting. */
  growlSting(): void {
    if (!this.ctx || !this.master || this.muted) return;
    const src = this.playSample('growl', 0.5, 0.95 + Math.random() * 0.1, false, 0.2, 800);
    if (!src) this.blip(55, 1.6, 0.2, 'sawtooth', 40);
  }

  /** Distant courtyard dog. */
  dogBark(): void {
    if (!this.ctx || !this.master || this.muted) return;
    const n = 2 + Math.floor(Math.random() * 3);
    for (let i = 0; i < n; i++) {
      window.setTimeout(() => {
        const f = 260 + Math.random() * 120;
        this.blip(f, 0.09, 0.045, 'square', f * 0.6);
      }, i * (180 + Math.random() * 120));
    }
  }

  /** Shahed-style putt-putt flyby with stereo pan. */
  shahedFlyby(dur = 9): void {
    if (!this.ctx || !this.master || this.muted) return;
    try {
      const ctx = this.ctx;
      const t0 = ctx.currentTime;
      const o1 = ctx.createOscillator();
      o1.type = 'sawtooth';
      o1.frequency.setValueAtTime(86, t0);
      o1.frequency.linearRampToValueAtTime(70, t0 + dur);
      const o2 = ctx.createOscillator();
      o2.type = 'square';
      o2.frequency.setValueAtTime(43, t0);
      o2.frequency.linearRampToValueAtTime(35, t0 + dur);
      const am = ctx.createOscillator();
      am.frequency.value = 23;
      const amg = ctx.createGain();
      amg.gain.value = 0.5;
      const eg = ctx.createGain();
      eg.gain.value = 0.5;
      am.connect(amg).connect(eg.gain);
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 320;
      bp.Q.value = 0.8;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(0.22, t0 + dur * 0.35);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      o1.connect(eg);
      o2.connect(eg);
      eg.connect(bp).connect(g);
      try {
        const pan = ctx.createStereoPanner();
        pan.pan.setValueAtTime(-0.9, t0);
        pan.pan.linearRampToValueAtTime(0.9, t0 + dur);
        g.connect(pan).connect(this.master);
      } catch {
        g.connect(this.master);
      }
      o1.start(t0);
      o2.start(t0);
      am.start(t0);
      const stop = t0 + dur + 0.1;
      o1.stop(stop);
      o2.stop(stop);
      am.stop(stop);
    } catch {
      /* ignore */
    }
  }

  /** Real recorded blast (frontline), falls back to synth. */
  explosionReal(dist: number): void {
    if (!this.ctx || !this.master || this.muted) return;
    if (this.cannonBuf) {
      try {
        const ctx = this.ctx;
        const src = ctx.createBufferSource();
        src.buffer = this.cannonBuf;
        src.playbackRate.value = 0.85 + Math.random() * 0.3;
        const g = ctx.createGain();
        g.gain.value = Math.max(0, Math.min(1, 60 / (60 + dist))) * 0.9;
        const f = ctx.createBiquadFilter();
        f.type = 'lowpass';
        f.frequency.value = 900;
        src.connect(f).connect(g).connect(this.master);
        src.start();
        return;
      } catch {
        /* fall through */
      }
    }
    if (!this.cannonLoading) {
      this.cannonLoading = true;
      import('./assets')
        .then(({ ASSET_URLS }) => {
          if (!this.ctx) return;
          fetch(ASSET_URLS.cannon)
            .then((r) => r.arrayBuffer())
            .then((b) => this.ctx!.decodeAudioData(b))
            .then((buf) => {
              this.cannonBuf = buf;
            })
            .catch(() => {
              /* keep synth */
            });
        })
        .catch(() => {
          /* keep synth */
        });
    }
    this.explosion(dist);
  }
}
