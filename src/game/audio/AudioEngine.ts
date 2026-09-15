// Procedural sound effects for skills, attacks, hits, deaths and structures.
// Nothing here is a sound file: every effect is synthesized at runtime from oscillators and
// filtered noise, the same way units and VFX in this codebase are built procedurally rather
// than loaded from assets. Driven by the same sim-event stream as EffectRenderer.
import * as THREE from 'three';
import type { ConfigBundle, ProjectileDef, WeaponDef } from '@/shared/schema';
import type { EffectHost } from '../render/effects';
import type { Terrain } from '../sim/terrain';
import type { BattleSim, SimEvent } from '../sim/world';

type Style = WeaponDef['castStyle'];

const MAX_DIST = 100;
const MAX_VOICES = 44;

/** Mirrors attackStyleFor's non-rig-dependent fallback (AudioEngine has no model templates to inspect). */
function resolveStyle(w: WeaponDef): Style {
  if (w.castStyle !== 'auto') return w.castStyle;
  switch (w.attack) {
    case 'heal':
      return 'cast';
    case 'chain':
      return 'palm';
    case 'strike':
    case 'vortex':
      return 'raise';
    case 'nova':
    case 'dash':
      return 'slam';
    case 'projectile':
      return 'throw';
    case 'breath':
      return 'palm';
    default:
      return 'swing';
  }
}

interface Hum {
  src: AudioBufferSourceNode;
  gain: GainNode;
  pan: StereoPannerNode | null;
}

interface NoiseOpts {
  type?: BiquadFilterType;
  freq: number;
  freqEnd?: number;
  q?: number;
  peak?: number;
  attack?: number;
}

interface ToneOpts {
  type?: OscillatorType;
  freq: number;
  freqEnd?: number;
  peak?: number;
  attack?: number;
  detune?: number;
}

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noiseBuf: AudioBuffer | null = null;
  private muted = false;
  private voices = 0;
  private listenerX = 0;
  private listenerZ = 0;
  private listenerYaw = Math.PI;
  private terrain: Terrain | null = null;
  private readonly weapons: Map<string, WeaponDef>;
  private readonly projectiles: Map<string, ProjectileDef>;
  private readonly whirlHum = new Map<number, Hum>();
  private readonly v1 = new THREE.Vector3();

  constructor(bundle: ConfigBundle) {
    this.weapons = new Map(bundle.weapons.map((w) => [w.id, w]));
    this.projectiles = new Map(bundle.projectiles.map((p) => [p.id, p]));
  }

  setTerrain(terrain: Terrain): void {
    this.terrain = terrain;
  }

  setListener(x: number, z: number, yaw: number): void {
    this.listenerX = x;
    this.listenerZ = z;
    this.listenerYaw = yaw;
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (this.master) this.master.gain.value = muted ? 0 : 1;
  }

  isMuted(): boolean {
    return this.muted;
  }

  /** Must run inside a user gesture — browsers refuse to start audio otherwise. */
  resume(): void {
    const ctx = this.ensureCtx();
    if (ctx && ctx.state === 'suspended') void ctx.resume();
  }

  private ensureCtx(): AudioContext | null {
    if (this.ctx) return this.ctx;
    if (typeof window === 'undefined') return null;
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    const ctx = new Ctor();
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 1;
    // A big battle stacks dozens of hits at once; a limiter keeps that from hard-clipping.
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -18;
    limiter.knee.value = 12;
    limiter.ratio.value = 14;
    limiter.attack.value = 0.002;
    limiter.release.value = 0.15;
    this.master.connect(limiter);
    limiter.connect(ctx.destination);
    // 1s of white noise, reused (random offset + rate jitter) for every noise-based hit/whoosh below.
    const buf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    this.noiseBuf = buf;
    this.ctx = ctx;
    return ctx;
  }

  // ------------------------------------------------------------------ bus (distance + pan)

  /** A gain node to feed a one-shot sound into, wired for distance falloff and stereo pan. Null = too far / muted / voice cap hit. */
  private bus(x: number, z: number, gain: number, dur: number): GainNode | null {
    const ctx = this.ctx;
    if (!ctx || !this.master || this.muted || gain <= 0 || this.voices >= MAX_VOICES) return null;
    const dx = x - this.listenerX;
    const dz = z - this.listenerZ;
    const dist = Math.hypot(dx, dz);
    if (dist > MAX_DIST) return null;
    const atten = (1 - dist / MAX_DIST) ** 1.4;
    const g = ctx.createGain();
    g.gain.value = gain * atten;
    if (dist > 0.6 && ctx.createStereoPanner) {
      const pan = ctx.createStereoPanner();
      const rightX = -Math.sin(this.listenerYaw);
      const rightZ = Math.cos(this.listenerYaw);
      pan.pan.value = THREE.MathUtils.clamp((dx / dist) * rightX + (dz / dist) * rightZ, -1, 1);
      g.connect(pan);
      pan.connect(this.master);
    } else {
      g.connect(this.master);
    }
    this.voices++;
    window.setTimeout(() => {
      this.voices = Math.max(0, this.voices - 1);
    }, dur * 1000 + 60);
    return g;
  }

  // ------------------------------------------------------------------ primitives

  private noise(dest: AudioNode, dur: number, opts: NoiseOpts): void {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.playbackRate.value = 0.85 + Math.random() * 0.3;
    const offset = Math.random() * 0.5;
    const filter = ctx.createBiquadFilter();
    filter.type = opts.type ?? 'bandpass';
    filter.Q.value = opts.q ?? 1;
    const t0 = ctx.currentTime;
    filter.frequency.setValueAtTime(opts.freq, t0);
    if (opts.freqEnd !== undefined) filter.frequency.exponentialRampToValueAtTime(Math.max(20, opts.freqEnd), t0 + dur);
    const env = ctx.createGain();
    const peak = opts.peak ?? 1;
    const attack = opts.attack ?? 0.004;
    env.gain.setValueAtTime(0, t0);
    env.gain.linearRampToValueAtTime(peak, t0 + attack);
    env.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    src.connect(filter).connect(env).connect(dest);
    src.start(t0, offset);
    src.stop(t0 + dur + 0.02);
  }

  private tone(dest: AudioNode, dur: number, opts: ToneOpts): void {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    osc.type = opts.type ?? 'sine';
    if (opts.detune) osc.detune.value = opts.detune;
    const t0 = ctx.currentTime;
    osc.frequency.setValueAtTime(opts.freq, t0);
    if (opts.freqEnd !== undefined) osc.frequency.exponentialRampToValueAtTime(Math.max(20, opts.freqEnd), t0 + dur);
    const env = ctx.createGain();
    const peak = opts.peak ?? 1;
    const attack = opts.attack ?? 0.005;
    env.gain.setValueAtTime(0, t0);
    env.gain.linearRampToValueAtTime(peak, t0 + attack);
    env.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    osc.connect(env).connect(dest);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  // ------------------------------------------------------------------ events

  onEvent(e: SimEvent, host: EffectHost, sim: BattleSim): void {
    if (!this.ensureCtx()) return;
    switch (e.type) {
      case 'attack': {
        const w = this.weapons.get(e.weaponId);
        if (w) this.attackSound(w, e.x, e.z);
        return;
      }
      case 'cast': {
        const w = e.weaponId ? this.weapons.get(e.weaponId) : undefined;
        if (!w || e.duration < 0.18 || !host.chest(e.unitId, this.v1)) return;
        this.castSound(w, this.v1.x, this.v1.z, e.duration);
        return;
      }
      case 'hit': {
        const w = e.weaponId ? this.weapons.get(e.weaponId) : undefined;
        const target = sim.units[e.targetId];
        this.hitSound(w, e.x, e.z, e.blocked, !!target?.structure);
        return;
      }
      case 'death': {
        const u = sim.units[e.unitId];
        if (!u || u.structure) return; // structure collapse is voiced by wall-break/hit
        this.deathSound(u.x, u.z, u.def.radius);
        return;
      }
      case 'heal':
        this.healSound(e.x, e.z);
        return;
      case 'chain': {
        const w = this.weapons.get(e.weaponId);
        if (w) this.chainSound(e.targets, host);
        return;
      }
      case 'warn': {
        const w = this.weapons.get(e.weaponId);
        if (w) this.warnSound(w, e.x, e.z, e.delay);
        return;
      }
      case 'strike': {
        const w = this.weapons.get(e.weaponId);
        if (w) this.strikeSound(w, e.x, e.z, e.radius);
        return;
      }
      case 'nova': {
        const w = this.weapons.get(e.weaponId);
        if (w) this.novaSound(e.x, e.z, e.radius, w.attack === 'heal');
        return;
      }
      case 'zone-end':
        this.zoneEndSound(e.x, e.z);
        return;
      case 'wall-break':
        this.wallBreakSound(e.x, e.z, e.tiers);
        return;
      case 'impact': {
        const def = this.projectiles.get(e.defId);
        const wet = !!this.terrain && this.terrain.inWater(e.x, e.z) && e.y <= this.terrain.waterLevel + 0.4;
        this.impactSound(def, e.x, e.z, wet, e.stuck);
        return;
      }
      case 'land': {
        const wet = !!this.terrain && this.terrain.inWater(e.x, e.z);
        this.landSound(e.x, e.z, wet);
        return;
      }
      case 'spawn':
        if (host.chest(e.unitId, this.v1)) this.spawnSound(this.v1.x, this.v1.z);
        return;
      default:
        return;
    }
  }

  /** Continuous ambience (vortex wind hum) that tracks a moving zone across frames. */
  update(dt: number, sim: BattleSim | null): void {
    if (!this.ctx) return;
    if (!sim) {
      for (const [id, hum] of this.whirlHum) {
        this.stopHum(hum);
        this.whirlHum.delete(id);
      }
      return;
    }
    const seen = new Set<number>();
    for (const zn of sim.zones) {
      if (zn.weapon.attack !== 'vortex') continue;
      seen.add(zn.id);
      let hum: Hum | undefined = this.whirlHum.get(zn.id);
      if (!hum) {
        const started = this.startHum();
        if (!started) continue;
        hum = started;
        this.whirlHum.set(zn.id, hum);
      }
      const dx = zn.x - this.listenerX;
      const dz = zn.z - this.listenerZ;
      const dist = Math.hypot(dx, dz);
      const atten = dist > MAX_DIST ? 0 : (1 - dist / MAX_DIST) ** 1.6;
      const t = this.ctx.currentTime;
      hum.gain.gain.linearRampToValueAtTime(this.muted ? 0 : 0.22 * atten, t + 0.08);
      if (hum.pan && dist > 0.6) {
        const rightX = -Math.sin(this.listenerYaw);
        const rightZ = Math.cos(this.listenerYaw);
        hum.pan.pan.linearRampToValueAtTime(THREE.MathUtils.clamp((dx / dist) * rightX + (dz / dist) * rightZ, -1, 1), t + 0.08);
      }
    }
    for (const [id, hum] of this.whirlHum) {
      if (!seen.has(id)) {
        this.stopHum(hum);
        this.whirlHum.delete(id);
      }
    }
  }

  private startHum(): Hum | null {
    const ctx = this.ctx;
    const master = this.master;
    if (!ctx || !master) return null;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 500;
    filter.Q.value = 0.8;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    const pan = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    src.connect(filter).connect(gain);
    if (pan) {
      gain.connect(pan);
      pan.connect(master);
    } else {
      gain.connect(master);
    }
    src.start();
    return { src, gain, pan };
  }

  private stopHum(hum: Hum): void {
    const ctx = this.ctx!;
    hum.gain.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.25);
    hum.src.stop(ctx.currentTime + 0.3);
  }

  // ------------------------------------------------------------------ recipes

  private attackSound(w: WeaponDef, x: number, z: number): void {
    const dest = this.bus(x, z, 0.5, 0.3);
    if (!dest) return;
    switch (resolveStyle(w)) {
      case 'swing':
        this.noise(dest, 0.16, { type: 'bandpass', freq: 1200, freqEnd: 400, q: 1, peak: 0.9, attack: 0.01 });
        break;
      case 'thrust':
        this.noise(dest, 0.1, { type: 'highpass', freq: 1800, q: 2, peak: 0.7, attack: 0.005 });
        break;
      case 'bow':
        this.tone(dest, 0.1, { type: 'triangle', freq: 900, freqEnd: 260, peak: 0.5, attack: 0.002 });
        this.noise(dest, 0.06, { type: 'highpass', freq: 3000, q: 3, peak: 0.3, attack: 0.001 });
        break;
      case 'throw':
        this.noise(dest, 0.14, { type: 'bandpass', freq: 1500, freqEnd: 500, q: 1.2, peak: 0.7, attack: 0.006 });
        break;
      case 'gun':
        this.noise(dest, 0.08, { type: 'lowpass', freq: 3200, q: 0.7, peak: 1, attack: 0.001 });
        this.tone(dest, 0.05, { type: 'square', freq: 180, freqEnd: 60, peak: 0.35, attack: 0.001 });
        break;
      case 'raise':
        this.noise(dest, 0.22, { type: 'bandpass', freq: 700, freqEnd: 250, q: 1, peak: 0.6, attack: 0.03 });
        break;
      case 'palm':
        this.tone(dest, 0.18, { type: 'sine', freq: 700, freqEnd: 260, peak: 0.5, attack: 0.005 });
        break;
      case 'slam':
        this.tone(dest, 0.2, { type: 'sine', freq: 90, freqEnd: 40, peak: 0.7, attack: 0.002 });
        this.noise(dest, 0.14, { type: 'lowpass', freq: 400, q: 0.7, peak: 0.6, attack: 0.002 });
        break;
      case 'cast':
        this.tone(dest, 0.16, { type: 'sine', freq: 1200, freqEnd: 1800, peak: 0.35, attack: 0.004 });
        break;
      default:
        break;
    }
  }

  private castSound(w: WeaponDef, x: number, z: number, duration: number): void {
    const dest = this.bus(x, z, 0.3, duration);
    if (!dest) return;
    const lightning = w.attack === 'chain' || (w.attack === 'strike' && w.strikeVfx === 'lightning');
    if (lightning) {
      this.noise(dest, duration, { type: 'highpass', freq: 3000, q: 8, peak: 0.32, attack: duration * 0.6 });
      return;
    }
    const style = resolveStyle(w);
    if (style === 'bow') {
      this.noise(dest, duration, { type: 'bandpass', freq: 400, freqEnd: 700, q: 4, peak: 0.3, attack: duration * 0.7 });
      return;
    }
    if (style === 'slam') {
      this.tone(dest, duration, { type: 'sine', freq: 60, freqEnd: 90, peak: 0.35, attack: duration * 0.7 });
      return;
    }
    // cast / raise / palm and everything else: a rising magic shimmer.
    this.tone(dest, duration, { type: 'sine', freq: 300, freqEnd: 900, peak: 0.28, attack: duration * 0.8 });
    this.tone(dest, duration, { type: 'sine', freq: 450, freqEnd: 1350, peak: 0.14, attack: duration * 0.8 });
  }

  private hitSound(w: WeaponDef | undefined, x: number, z: number, blocked: boolean, structure: boolean): void {
    if (structure) {
      const dest = this.bus(x, z, 0.5, 0.16);
      if (dest) this.noise(dest, 0.14, { type: 'bandpass', freq: 900, freqEnd: 400, q: 2.2, peak: 1, attack: 0.002 });
      return;
    }
    if (blocked) {
      const dest = this.bus(x, z, 0.5, 0.2);
      if (!dest) return;
      this.noise(dest, 0.06, { type: 'highpass', freq: 2600, q: 6, peak: 0.9, attack: 0.001 });
      this.tone(dest, 0.16, { type: 'triangle', freq: 1400, freqEnd: 900, peak: 0.4, attack: 0.001 });
      return;
    }
    const dest = this.bus(x, z, 0.55, 0.3);
    if (!dest) return;
    switch (w?.damageType ?? 'blunt') {
      case 'blunt':
        this.noise(dest, 0.12, { type: 'lowpass', freq: 500, freqEnd: 160, q: 0.8, peak: 1, attack: 0.002 });
        this.tone(dest, 0.14, { type: 'sine', freq: 130, freqEnd: 70, peak: 0.5, attack: 0.002 });
        break;
      case 'slash':
        this.noise(dest, 0.1, { type: 'bandpass', freq: 3200, freqEnd: 1600, q: 3, peak: 1, attack: 0.001 });
        break;
      case 'pierce':
        this.noise(dest, 0.06, { type: 'highpass', freq: 3800, q: 5, peak: 0.9, attack: 0.001 });
        this.tone(dest, 0.08, { type: 'triangle', freq: 2200, freqEnd: 1100, peak: 0.3, attack: 0.001 });
        break;
      case 'fire':
        this.noise(dest, 0.22, { type: 'bandpass', freq: 1400, freqEnd: 500, q: 1.4, peak: 1, attack: 0.004 });
        break;
      case 'magic':
        this.tone(dest, 0.24, { type: 'sine', freq: 1100, freqEnd: 500, peak: 0.6, attack: 0.003 });
        this.tone(dest, 0.24, { type: 'sine', freq: 1650, freqEnd: 750, peak: 0.3, attack: 0.003 });
        break;
    }
  }

  private deathSound(x: number, z: number, radius: number): void {
    const size = THREE.MathUtils.clamp(radius / 3, 0, 1);
    const dest = this.bus(x, z, 0.5, 0.35);
    if (!dest) return;
    this.tone(dest, 0.3, { type: 'triangle', freq: 260 - size * 80, freqEnd: 90 - size * 30, peak: 0.5, attack: 0.004 });
    this.noise(dest, 0.2, { type: 'lowpass', freq: 700, freqEnd: 200, q: 0.7, peak: 0.4, attack: 0.01 });
  }

  private healSound(x: number, z: number): void {
    const dest = this.bus(x, z, 0.3, 0.3);
    if (!dest) return;
    this.tone(dest, 0.28, { type: 'sine', freq: 900, freqEnd: 1300, peak: 0.4, attack: 0.01 });
  }

  /** One crackling zap per target, staggered like the chain's visual bolts. */
  private chainSound(targets: number[], host: EffectHost): void {
    targets.forEach((id, i) => {
      if (!host.chest(id, this.v1)) return;
      const x = this.v1.x;
      const z = this.v1.z;
      window.setTimeout(() => {
        const dest = this.bus(x, z, 0.4, 0.14);
        if (!dest) return;
        this.noise(dest, 0.1, { type: 'highpass', freq: 3500, q: 6, peak: 0.8, attack: 0.001 });
        this.tone(dest, 0.08, { type: 'sawtooth', freq: 1800, freqEnd: 400, peak: 0.25, attack: 0.001 });
      }, i * 45);
    });
  }

  private warnSound(w: WeaponDef, x: number, z: number, delay: number): void {
    const meteor = w.strikeVfx === 'meteor';
    const dest = this.bus(x, z, meteor ? 0.35 : 0.15, delay);
    if (!dest) return;
    if (meteor) {
      this.tone(dest, delay, { type: 'sawtooth', freq: 2200, freqEnd: 260, peak: 0.3, attack: delay * 0.05 });
      this.noise(dest, delay, { type: 'bandpass', freq: 3000, freqEnd: 600, q: 2, peak: 0.25, attack: delay * 0.1 });
    } else {
      this.noise(dest, Math.min(delay, 0.5), { type: 'highpass', freq: 2500, q: 4, peak: 0.3, attack: 0.02 });
    }
  }

  private strikeSound(w: WeaponDef, x: number, z: number, radius: number): void {
    const meteor = w.strikeVfx === 'meteor';
    const size = THREE.MathUtils.clamp(radius / 10, 0, 1);
    const dest = this.bus(x, z, meteor ? 1 : 0.9, meteor ? 1.1 : 0.7);
    if (!dest) return;
    if (meteor) {
      this.noise(dest, 0.9 + size * 0.4, { type: 'lowpass', freq: 500, freqEnd: 80, q: 0.6, peak: 1, attack: 0.006 });
      this.tone(dest, 0.7, { type: 'sine', freq: 55, freqEnd: 30, peak: 0.8, attack: 0.003 });
    } else {
      this.noise(dest, 0.55 + size * 0.3, { type: 'bandpass', freq: 2200, freqEnd: 300, q: 0.9, peak: 1, attack: 0.001 });
      this.tone(dest, 0.5, { type: 'sawtooth', freq: 90, freqEnd: 45, peak: 0.5, attack: 0.001 });
    }
  }

  private novaSound(x: number, z: number, radius: number, heal: boolean): void {
    const dest = this.bus(x, z, 0.8, heal ? 0.5 : 0.6);
    if (!dest) return;
    if (heal) {
      this.tone(dest, 0.45, { type: 'sine', freq: 700, freqEnd: 1100, peak: 0.5, attack: 0.02 });
      this.tone(dest, 0.4, { type: 'sine', freq: 1050, freqEnd: 1650, peak: 0.25, attack: 0.06 });
      return;
    }
    const size = THREE.MathUtils.clamp(radius / 10, 0, 1);
    this.noise(dest, 0.35 + size * 0.2, { type: 'bandpass', freq: 1400, freqEnd: 250, q: 1, peak: 1, attack: 0.002 });
    this.tone(dest, 0.3, { type: 'sine', freq: 100, freqEnd: 50, peak: 0.5, attack: 0.002 });
  }

  private zoneEndSound(x: number, z: number): void {
    const dest = this.bus(x, z, 0.55, 0.4);
    if (dest) this.noise(dest, 0.4, { type: 'bandpass', freq: 900, freqEnd: 200, q: 1, peak: 0.8, attack: 0.01 });
  }

  private wallBreakSound(x: number, z: number, tiers: number): void {
    const collapsed = tiers === 0;
    const dest = this.bus(x, z, collapsed ? 0.9 : 0.6, collapsed ? 0.9 : 0.4);
    if (!dest) return;
    this.noise(dest, collapsed ? 0.8 : 0.35, { type: 'lowpass', freq: 700, freqEnd: 150, q: 0.7, peak: 1, attack: 0.004 });
    if (collapsed) this.tone(dest, 0.6, { type: 'sine', freq: 70, freqEnd: 35, peak: 0.5, attack: 0.01 });
  }

  private impactSound(def: ProjectileDef | undefined, x: number, z: number, wet: boolean, stuck: boolean): void {
    if (wet) {
      const dest = this.bus(x, z, 0.4, 0.2);
      if (dest) this.noise(dest, 0.18, { type: 'bandpass', freq: 1200, freqEnd: 300, q: 1, peak: 0.7, attack: 0.004 });
      return;
    }
    const dest = this.bus(x, z, 0.45, 0.25);
    if (!dest) return;
    switch (def?.model ?? 'stone') {
      case 'arrow':
      case 'spear':
        this.noise(dest, 0.08, { type: 'highpass', freq: 3200, q: 4, peak: 0.7, attack: 0.001 });
        if (stuck) this.tone(dest, 0.1, { type: 'triangle', freq: 500, freqEnd: 250, peak: 0.3, attack: 0.001 });
        break;
      case 'stone':
      case 'boulder':
        this.noise(dest, 0.18, { type: 'lowpass', freq: 500, freqEnd: 150, q: 0.7, peak: 0.9, attack: 0.002 });
        break;
      case 'fireball':
        this.noise(dest, 0.28, { type: 'bandpass', freq: 1300, freqEnd: 300, q: 1, peak: 0.9, attack: 0.003 });
        break;
      case 'orb':
        this.tone(dest, 0.2, { type: 'sine', freq: 800, freqEnd: 300, peak: 0.5, attack: 0.002 });
        break;
      case 'bullet':
        this.noise(dest, 0.05, { type: 'highpass', freq: 4000, q: 5, peak: 0.6, attack: 0.001 });
        break;
      case 'shuriken':
        this.noise(dest, 0.07, { type: 'bandpass', freq: 3500, q: 6, peak: 0.6, attack: 0.001 });
        break;
      case 'meteor':
        break; // voiced by the 'strike' boom instead
    }
  }

  private landSound(x: number, z: number, wet: boolean): void {
    const dest = this.bus(x, z, 0.4, 0.2);
    if (!dest) return;
    if (wet) this.noise(dest, 0.2, { type: 'bandpass', freq: 1000, freqEnd: 300, q: 1, peak: 0.7, attack: 0.004 });
    else this.noise(dest, 0.15, { type: 'lowpass', freq: 500, freqEnd: 150, q: 0.7, peak: 0.6, attack: 0.003 });
  }

  private spawnSound(x: number, z: number): void {
    const dest = this.bus(x, z, 0.15, 0.1);
    if (dest) this.tone(dest, 0.08, { type: 'sine', freq: 500, freqEnd: 800, peak: 0.3, attack: 0.005 });
  }

  // ------------------------------------------------------------------ lifecycle

  dispose(): void {
    for (const hum of this.whirlHum.values()) this.stopHum(hum);
    this.whirlHum.clear();
    if (this.ctx) void this.ctx.close();
    this.ctx = null;
    this.master = null;
    this.noiseBuf = null;
  }
}
