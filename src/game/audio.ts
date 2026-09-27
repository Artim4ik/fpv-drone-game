/**
 * Procedural audio engine built on the Web Audio API.
 *
 * Everything is synthesized — no asset files:
 *  - 4-pole motor model: detuned saws, sub-harmonic and prop-wash noise,
 *    RPM follows throttle
 *  - wind noise band that opens up with airspeed
 *  - low-frequency engine rumble of the armoured column with a diesel chug LFO
 *  - shaped-charge launch, armour impacts (penetration / ricochet),
 *    distance-delayed stereo explosions with sub-bass, crack and debris
 *    tinkle layers, feed-loss static and arming beeps for the respawn.
 */

export type ImpactKind = "pen" | "ricochet" | "ground";

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  private motorNodes: {
    oscs: OscillatorNode[];
    multipliers: number[];
    gain: GainNode;
    filter: BiquadFilterNode;
    noiseGain: GainNode;
  } | null = null;
  private windGain: GainNode | null = null;
  private windFilter: BiquadFilterNode | null = null;
  private ambientGain: GainNode | null = null;
  private loopSources: AudioScheduledSourceNode[] = [];
  private muted = false;
  private disposed = false;

  private ensure(): AudioContext | null {
    if (this.disposed) return null;
    if (!this.ctx) {
      try {
        const Ctor: typeof AudioContext =
          window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        if (!Ctor) return null;
        this.ctx = new Ctor();
        this.master = this.ctx.createGain();
        this.master.gain.value = this.muted ? 0 : 1;
        this.master.connect(this.ctx.destination);
        this.noiseBuffer = this.makeNoiseBuffer();
      } catch {
        this.ctx = null;
        return null;
      }
    }
    if (this.ctx.state === "suspended") void this.ctx.resume().catch(() => undefined);
    return this.ctx;
  }

  private makeNoiseBuffer() {
    const ctx = this.ctx!;
    const buffer = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let index = 0; index < data.length; index += 1) {
      data[index] = Math.random() * 2 - 1;
    }
    return buffer;
  }

  private noiseSource(ctx: AudioContext) {
    const source = ctx.createBufferSource();
    source.buffer = this.noiseBuffer;
    source.loop = true;
    return source;
  }

  /** Stereo placement of a world source relative to where the drone looks. */
  private outputFor(ctx: AudioContext, pan: number) {
    const panner = ctx.createStereoPanner();
    panner.pan.value = Math.max(-1, Math.min(1, pan));
    panner.connect(this.master!);
    return panner;
  }

  setMuted(muted: boolean) {
    this.muted = muted;
    if (this.ctx && this.master) {
      this.master.gain.setTargetAtTime(muted ? 0 : 1, this.ctx.currentTime, 0.04);
    }
  }

  /** Starts the continuous layers (motor, wind, engine rumble). */
  startContinuous() {
    const ctx = this.ensure();
    if (!ctx || this.motorNodes) return;

    const motorFilter = ctx.createBiquadFilter();
    motorFilter.type = "lowpass";
    motorFilter.frequency.value = 2600;
    const motorGain = ctx.createGain();
    motorGain.gain.value = 0;
    motorFilter.connect(motorGain).connect(this.master!);

    // Detuned saws, a square body tone and a low sine sub-harmonic.
    const plan: Array<{ type: OscillatorType; multiplier: number; level: number }> = [
      { type: "sawtooth", multiplier: 1, level: 0.4 },
      { type: "sawtooth", multiplier: 1.51, level: 0.36 },
      { type: "sawtooth", multiplier: 2.04, level: 0.32 },
      { type: "square", multiplier: 0.5, level: 0.16 },
      { type: "sine", multiplier: 0.34, level: 0.5 },
    ];
    const oscs: OscillatorNode[] = [];
    const multipliers: number[] = [];
    const detunes = [0, 7, -5, 12, 0];
    plan.forEach((entry, index) => {
      const osc = ctx.createOscillator();
      osc.type = entry.type;
      osc.frequency.value = 120 * entry.multiplier;
      osc.detune.value = detunes[index];
      const partial = ctx.createGain();
      partial.gain.value = entry.level;
      osc.connect(partial).connect(motorFilter);
      osc.start();
      oscs.push(osc);
      multipliers.push(entry.multiplier);
    });

    const washNoise = this.noiseSource(ctx);
    const washFilter = ctx.createBiquadFilter();
    washFilter.type = "bandpass";
    washFilter.frequency.value = 700;
    washFilter.Q.value = 0.9;
    const washGain = ctx.createGain();
    washGain.gain.value = 0;
    washNoise.connect(washFilter).connect(washGain).connect(motorFilter);
    washNoise.start();
    this.loopSources.push(washNoise);

    this.motorNodes = { oscs, multipliers, gain: motorGain, filter: motorFilter, noiseGain: washGain };

    // Wind band.
    const windSource = this.noiseSource(ctx);
    const windFilter = ctx.createBiquadFilter();
    windFilter.type = "bandpass";
    windFilter.frequency.value = 500;
    windFilter.Q.value = 0.55;
    const windGain = ctx.createGain();
    windGain.gain.value = 0;
    windSource.connect(windFilter).connect(windGain).connect(this.master!);
    windSource.start();
    this.loopSources.push(windSource);
    this.windGain = windGain;
    this.windFilter = windFilter;

    // Armoured column diesel rumble with a slow chug modulation.
    const ambientSource = this.noiseSource(ctx);
    const ambientFilter = ctx.createBiquadFilter();
    ambientFilter.type = "lowpass";
    ambientFilter.frequency.value = 105;
    const ambientGain = ctx.createGain();
    ambientGain.gain.value = 0;
    ambientSource.connect(ambientFilter).connect(ambientGain).connect(this.master!);
    ambientSource.start();
    this.loopSources.push(ambientSource);
    this.ambientGain = ambientGain;

    const chug = ctx.createOscillator();
    chug.type = "square";
    chug.frequency.value = 5.4;
    const chugDepth = ctx.createGain();
    chugDepth.gain.value = 0.12;
    chug.connect(chugDepth).connect(ambientGain.gain);
    chug.start();
    this.loopSources.push(chug);
  }

  updateMotor(throttle: number, bodyRate: number) {
    const ctx = this.ensure();
    if (!ctx || !this.motorNodes) return;
    const t = ctx.currentTime;
    const spool = Math.max(0, Math.min(1, throttle));
    const base = 92 + spool * 296 + bodyRate * 6;
    for (let index = 0; index < this.motorNodes.oscs.length; index += 1) {
      this.motorNodes.oscs[index].frequency.setTargetAtTime(
        base * this.motorNodes.multipliers[index],
        t,
        0.05,
      );
    }
    this.motorNodes.gain.gain.setTargetAtTime(0.016 + spool * 0.08, t, 0.08);
    this.motorNodes.filter.frequency.setTargetAtTime(1700 + spool * 2400, t, 0.1);
    this.motorNodes.noiseGain.gain.setTargetAtTime(spool * spool * 0.055, t, 0.08);
  }

  updateWind(speed: number) {
    const ctx = this.ensure();
    if (!ctx || !this.windGain || !this.windFilter) return;
    const t = ctx.currentTime;
    const ratio = Math.min(speed / 36, 1);
    this.windGain.gain.setTargetAtTime(ratio * ratio * 0.4, t, 0.15);
    this.windFilter.frequency.setTargetAtTime(420 + speed * 30, t, 0.2);
  }

  updateAmbient(intensity: number) {
    const ctx = this.ensure();
    if (!ctx || !this.ambientGain) return;
    this.ambientGain.gain.setTargetAtTime(
      Math.max(0, Math.min(1, intensity)) * 0.42,
      ctx.currentTime,
      0.25,
    );
  }

  private delayed(ctx: AudioContext, distance: number, pan: number) {
    const dist = Math.max(4, Math.min(280, distance));
    const delay = ctx.createDelay(1.5);
    delay.delayTime.value = dist / 340;
    const attenuation = 1 / (1 + dist * 0.022);
    const nodeGain = ctx.createGain();
    nodeGain.gain.value = attenuation;
    delay.connect(nodeGain).connect(this.outputFor(ctx, pan));
    return delay;
  }

  /** RPG-7 style launch of the shaped charge. */
  launch() {
    const ctx = this.ensure();
    if (!ctx) return;
    const t = ctx.currentTime;
    const out = this.outputFor(ctx, 0);

    const burst = this.noiseSource(ctx);
    const burstFilter = ctx.createBiquadFilter();
    burstFilter.type = "bandpass";
    burstFilter.frequency.setValueAtTime(1900, t);
    burstFilter.frequency.exponentialRampToValueAtTime(260, t + 0.32);
    burstFilter.Q.value = 1.4;
    const burstGain = ctx.createGain();
    burstGain.gain.setValueAtTime(0.5, t);
    burstGain.gain.exponentialRampToValueAtTime(0.001, t + 0.34);
    burst.connect(burstFilter).connect(burstGain).connect(out);
    burst.start(t);
    burst.stop(t + 0.4);

    const pop = ctx.createOscillator();
    pop.type = "sine";
    pop.frequency.setValueAtTime(150, t);
    pop.frequency.exponentialRampToValueAtTime(46, t + 0.22);
    const popGain = ctx.createGain();
    popGain.gain.setValueAtTime(0.5, t);
    popGain.gain.exponentialRampToValueAtTime(0.001, t + 0.26);
    pop.connect(popGain).connect(out);
    pop.start(t);
    pop.stop(t + 0.3);
  }

  /** Distance-delayed explosion: crack, body, sub-bass and falling debris. */
  explosion(distance = 10, pan = 0) {
    const ctx = this.ensure();
    if (!ctx) return;
    const t = ctx.currentTime;
    const line = this.delayed(ctx, distance, pan);

    const crack = this.noiseSource(ctx);
    const crackFilter = ctx.createBiquadFilter();
    crackFilter.type = "highpass";
    crackFilter.frequency.value = 900;
    const crackGain = ctx.createGain();
    crackGain.gain.setValueAtTime(0.75, t);
    crackGain.gain.exponentialRampToValueAtTime(0.001, t + 0.14);
    crack.connect(crackFilter).connect(crackGain).connect(line);
    crack.start(t);
    crack.stop(t + 0.2);

    const body = this.noiseSource(ctx);
    const bodyFilter = ctx.createBiquadFilter();
    bodyFilter.type = "lowpass";
    bodyFilter.frequency.setValueAtTime(2400, t);
    bodyFilter.frequency.exponentialRampToValueAtTime(70, t + 1.5);
    const bodyGain = ctx.createGain();
    bodyGain.gain.setValueAtTime(1.0, t);
    bodyGain.gain.exponentialRampToValueAtTime(0.001, t + 1.8);
    body.connect(bodyFilter).connect(bodyGain).connect(line);
    body.start(t);
    body.stop(t + 1.9);

    const sub = ctx.createOscillator();
    sub.type = "sine";
    sub.frequency.setValueAtTime(68, t);
    sub.frequency.exponentialRampToValueAtTime(24, t + 1.2);
    const subGain = ctx.createGain();
    subGain.gain.setValueAtTime(0.85, t);
    subGain.gain.exponentialRampToValueAtTime(0.001, t + 1.35);
    sub.connect(subGain).connect(line);
    sub.start(t);
    sub.stop(t + 1.4);

    // Debris raining down after the blast.
    for (const delaySeconds of [0.32, 0.62, 0.98]) {
      const tinkle = ctx.createBufferSource();
      tinkle.buffer = this.noiseBuffer;
      const filter = ctx.createBiquadFilter();
      filter.type = "highpass";
      filter.frequency.value = 2600;
      const gain = ctx.createGain();
      const start = t + delaySeconds;
      gain.gain.setValueAtTime(0.14, start);
      gain.gain.exponentialRampToValueAtTime(0.001, start + 0.1);
      tinkle.connect(filter).connect(gain).connect(line);
      tinkle.start(start);
      tinkle.stop(start + 0.12);
    }
  }

  /** Armour interaction: penetration crunch, metallic ricochet or dirt burst. */
  impact(kind: ImpactKind, distance = 10, pan = 0) {
    const ctx = this.ensure();
    if (!ctx) return;
    const t = ctx.currentTime;
    const line = this.delayed(ctx, distance, pan);

    if (kind === "ricochet") {
      const ring = this.noiseSource(ctx);
      const filter = ctx.createBiquadFilter();
      filter.type = "bandpass";
      filter.frequency.setValueAtTime(3400, t);
      filter.frequency.exponentialRampToValueAtTime(1200, t + 0.3);
      filter.Q.value = 12;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.6, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.32);
      ring.connect(filter).connect(gain).connect(line);
      ring.start(t);
      ring.stop(t + 0.36);

      const ping = ctx.createOscillator();
      ping.type = "triangle";
      ping.frequency.setValueAtTime(2300, t);
      ping.frequency.exponentialRampToValueAtTime(760, t + 0.24);
      const pingGain = ctx.createGain();
      pingGain.gain.setValueAtTime(0.32, t);
      pingGain.gain.exponentialRampToValueAtTime(0.001, t + 0.26);
      ping.connect(pingGain).connect(line);
      ping.start(t);
      ping.stop(t + 0.28);
    }

    if (kind === "pen") {
      const crunch = this.noiseSource(ctx);
      const filter = ctx.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.setValueAtTime(1500, t);
      filter.frequency.exponentialRampToValueAtTime(240, t + 0.28);
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.75, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.4);
      crunch.connect(filter).connect(gain).connect(line);
      crunch.start(t);
      crunch.stop(t + 0.45);

      const thump = ctx.createOscillator();
      thump.type = "sine";
      thump.frequency.setValueAtTime(140, t);
      thump.frequency.exponentialRampToValueAtTime(38, t + 0.45);
      const thumpGain = ctx.createGain();
      thumpGain.gain.setValueAtTime(0.8, t);
      thumpGain.gain.exponentialRampToValueAtTime(0.001, t + 0.5);
      thump.connect(thumpGain).connect(line);
      thump.start(t);
      thump.stop(t + 0.55);

      // Torn metal.
      const tear = ctx.createOscillator();
      tear.type = "sawtooth";
      tear.frequency.setValueAtTime(700, t + 0.03);
      tear.frequency.exponentialRampToValueAtTime(90, t + 0.3);
      const tearGain = ctx.createGain();
      tearGain.gain.setValueAtTime(0.12, t + 0.03);
      tearGain.gain.exponentialRampToValueAtTime(0.001, t + 0.32);
      tear.connect(tearGain).connect(line);
      tear.start(t + 0.03);
      tear.stop(t + 0.34);
    }

    if (kind === "ground") {
      const dirt = this.noiseSource(ctx);
      const filter = ctx.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.setValueAtTime(900, t);
      filter.frequency.exponentialRampToValueAtTime(120, t + 0.5);
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.5, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.6);
      dirt.connect(filter).connect(gain).connect(line);
      dirt.start(t);
      dirt.stop(t + 0.65);
    }
  }

  /** Heavy contact with the ground (drone crash / hard landing). */
  thud(strength: number) {
    const ctx = this.ensure();
    if (!ctx) return;
    const t = ctx.currentTime;
    const out = this.outputFor(ctx, 0);
    const level = Math.min(1, Math.max(0.15, strength / 14));
    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(95, t);
    osc.frequency.exponentialRampToValueAtTime(34, t + 0.28);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.7 * level, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.34);
    osc.connect(gain).connect(out);
    osc.start(t);
    osc.stop(t + 0.36);

    const noise = this.noiseSource(ctx);
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 700;
    const noiseGain = ctx.createGain();
    noiseGain.gain.setValueAtTime(0.4 * level, t);
    noiseGain.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
    noise.connect(filter).connect(noiseGain).connect(out);
    noise.start(t);
    noise.stop(t + 0.24);
  }

  /** Video feed loss static when the drone is destroyed. */
  staticBurst() {
    const ctx = this.ensure();
    if (!ctx) return;
    const t = ctx.currentTime;
    const out = this.outputFor(ctx, 0);

    const staticNoise = this.noiseSource(ctx);
    const filter = ctx.createBiquadFilter();
    filter.type = "highpass";
    filter.frequency.setValueAtTime(700, t);
    filter.frequency.linearRampToValueAtTime(3200, t + 0.55);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.001, t);
    gain.gain.linearRampToValueAtTime(0.3, t + 0.03);
    gain.gain.setValueAtTime(0.3, t + 0.35);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.75);
    staticNoise.connect(filter).connect(gain).connect(out);
    staticNoise.start(t);
    staticNoise.stop(t + 0.8);

    const click = ctx.createOscillator();
    click.type = "square";
    click.frequency.value = 180;
    const clickGain = ctx.createGain();
    clickGain.gain.setValueAtTime(0.12, t);
    clickGain.gain.exponentialRampToValueAtTime(0.001, t + 0.1);
    click.connect(clickGain).connect(out);
    click.start(t);
    click.stop(t + 0.12);
  }

  /** Two arming beeps when a fresh drone spawns. */
  armBeeps() {
    const ctx = this.ensure();
    if (!ctx) return;
    const t = ctx.currentTime;
    const out = this.outputFor(ctx, 0);
    for (const offset of [0, 0.26]) {
      const osc = ctx.createOscillator();
      osc.type = "square";
      osc.frequency.value = 988;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.001, t + offset);
      gain.gain.linearRampToValueAtTime(0.09, t + offset + 0.015);
      gain.gain.setValueAtTime(0.09, t + offset + 0.14);
      gain.gain.exponentialRampToValueAtTime(0.001, t + offset + 0.2);
      osc.connect(gain).connect(out);
      osc.start(t + offset);
      osc.stop(t + offset + 0.22);
    }
  }

  /** Target-lock blip. */
  beep() {
    const ctx = this.ensure();
    if (!ctx) return;
    const t = ctx.currentTime;
    const out = this.outputFor(ctx, 0);
    const osc = ctx.createOscillator();
    osc.type = "square";
    osc.frequency.value = 1046;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.07, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.08);
    osc.connect(gain).connect(out);
    osc.start(t);
    osc.stop(t + 0.1);
  }

  dispose() {
    this.disposed = true;
    for (const source of this.loopSources) {
      try {
        source.stop();
      } catch {
        // already stopped
      }
    }
    this.loopSources = [];
    if (this.ctx) void this.ctx.close().catch(() => undefined);
    this.ctx = null;
    this.master = null;
    this.motorNodes = null;
    this.windGain = null;
    this.ambientGain = null;
    this.windFilter = null;
  }
}
