// Procedural animation: turns a baked template + a few scalar inputs into part matrices.
// Rotation convention (model frame, forward +Z): Rx(+) swings a hanging limb backwards and
// tips an upright part forward; Rz(+) raises a +X (left) limb outwards.
import * as THREE from 'three';
import type { WeaponDef } from '@/shared/schema';
import type { ModelTemplate, SegmentTemplate } from '../models/bake';

export type AttackStyle = 'swing' | 'thrust' | 'bow' | 'throw' | 'cast' | 'gun' | 'raise' | 'palm' | 'slam' | 'breath' | 'none';

export interface AnimInput {
  time: number;
  /** Planar speed in m/s. */
  speed: number;
  /** Accumulated gait phase (radians). */
  phase: number;
  /** -1 idle; 0..1 windup; 1..2 strike follow-through (a channel holds ~1.25). */
  attack: number;
  /** Motion of the current ability; the guard pose keeps following the held weapon. */
  style?: AttackStyle;
  airborne: boolean;
  stunned: boolean;
  /** Spring lean (radians): forward, sideways. */
  leanX: number;
  leanZ: number;
  /** Per-unit random offset so crowds do not move in sync. */
  seed: number;
  /** Speed at which the gait reaches full amplitude. */
  refSpeed: number;
  /** Turret yaw relative to the body (tower rig). */
  aim?: number;
  /** Climbing a wall (humanoid). */
  climbing?: boolean;
}

const tmpEuler = new THREE.Euler();
const tmpQuat = new THREE.Quaternion();
const tmpPos = new THREE.Vector3();
const tmpScale = new THREE.Vector3();
const tmpMat = new THREE.Matrix4();

const ease = (t: number) => {
  const c = t < 0 ? 0 : t > 1 ? 1 : t;
  return c * c * (3 - 2 * c);
};
const clamp01 = (t: number) => (t < 0 ? 0 : t > 1 ? 1 : t);

// Part names built once: posing runs for every unit every frame, so no arrays or template strings there.
const LIMBS = [
  { out: 1, arm: 'armL', forearm: 'forearmL', thigh: 'thighL', shin: 'shinL' },
  { out: -1, arm: 'armR', forearm: 'forearmR', thigh: 'thighR', shin: 'shinR' },
] as const;
const QUAD_LEGS: ReadonlyArray<readonly [string, string, number, boolean]> = [
  ['legFL', 'shinFL', 0, true],
  ['legBR', 'shinBR', 0.15, false],
  ['legFR', 'shinFR', Math.PI, true],
  ['legBL', 'shinBL', Math.PI + 0.15, false],
];
const DRAGON_TAIL = ['tail1', 'tail2', 'tail3', 'tail4'] as const;
const DRAGON_LEGS = [
  { legF: 'legFL', shinF: 'shinFL', legB: 'legBL', shinB: 'shinBL' },
  { legF: 'legFR', shinF: 'shinFR', legB: 'legBR', shinB: 'shinBR' },
] as const;
const WHEELS = ['wheelFL', 'wheelFR', 'wheelBL', 'wheelBR'] as const;

export function attackStyleFor(template: ModelTemplate, weapon: WeaponDef | undefined): AttackStyle {
  if (!weapon) return 'none';
  const humanoid = template.segments.find((s) => s.rig === 'humanoid');
  if (humanoid && weapon.castStyle && weapon.castStyle !== 'auto') return weapon.castStyle;
  if (weapon.attack === 'breath') return humanoid ? 'palm' : 'breath';
  const kind = (humanoid?.meta.weapon as string | undefined) ?? 'none';
  if (weapon.attack === 'heal' || kind === 'staff') return 'cast';
  if (kind === 'bow') return 'bow';
  if (kind === 'musket') return 'gun';
  if (!humanoid) return weapon.attack === 'melee' ? 'swing' : 'none';
  if (weapon.attack === 'chain') return 'palm';
  if (weapon.attack === 'strike' || weapon.attack === 'vortex') return 'raise';
  if (weapon.attack === 'nova') return 'slam';
  if (weapon.attack === 'projectile') return 'throw';
  if (kind === 'spear' || kind === 'lance' || kind === 'pitchfork') return 'thrust';
  return 'swing';
}

export class Poser {
  readonly count: number;
  private readonly rot: Float32Array;
  private readonly off: Float32Array;
  private readonly scl: Float32Array;

  constructor(
    readonly template: ModelTemplate,
    readonly style: AttackStyle,
  ) {
    this.count = template.parts.length;
    this.rot = new Float32Array(this.count * 3);
    this.off = new Float32Array(this.count * 3);
    this.scl = new Float32Array(this.count);
  }

  /** Writes model-space matrices for every part into `out`. */
  compute(input: AnimInput, out: THREE.Matrix4[]): void {
    this.rot.fill(0);
    this.off.fill(0);
    this.scl.fill(1);
    for (const seg of this.template.segments) {
      switch (seg.rig) {
        case 'humanoid':
          this.humanoid(seg, input);
          break;
        case 'raptor':
          this.raptor(seg, input);
          break;
        case 'quadruped':
          this.quadruped(seg, input);
          break;
        case 'dragon':
          this.dragon(seg, input);
          break;
        case 'bird':
          this.bird(seg, input);
          break;
        case 'catapult':
          this.catapult(seg, input);
          break;
        case 'tower':
          this.r(seg, 'turret', 0, input.aim ?? 0, 0);
          this.r(seg, 'flag', 0, Math.sin(input.time * 2.2 + input.seed * 6) * 0.35, 0);
          break;
        case 'static':
          this.r(seg, 'flag', 0, Math.sin(input.time * 2.2 + input.seed * 6) * 0.35, 0);
          break;
      }
    }
    const parts = this.template.parts;
    for (let i = 0; i < this.count; i++) {
      const p = parts[i];
      tmpEuler.set(this.rot[i * 3], this.rot[i * 3 + 1], this.rot[i * 3 + 2]);
      tmpQuat.setFromEuler(tmpEuler);
      tmpPos.set(this.off[i * 3], this.off[i * 3 + 1], this.off[i * 3 + 2]);
      tmpScale.setScalar(this.scl[i]);
      tmpMat.compose(tmpPos, tmpQuat, tmpScale);
      const m = out[i];
      m.multiplyMatrices(p.bind, tmpMat);
      if (p.parent >= 0) m.premultiply(out[p.parent]);
    }
  }

  private r(seg: SegmentTemplate, name: string, x: number, y = 0, z = 0): void {
    const i = seg.parts[name];
    if (i === undefined) return;
    this.rot[i * 3] += x;
    this.rot[i * 3 + 1] += y;
    this.rot[i * 3 + 2] += z;
  }

  private o(seg: SegmentTemplate, name: string, x: number, y: number, z: number): void {
    const i = seg.parts[name];
    if (i === undefined) return;
    this.off[i * 3] += x;
    this.off[i * 3 + 1] += y;
    this.off[i * 3 + 2] += z;
  }

  private hide(seg: SegmentTemplate, name: string): void {
    const i = seg.parts[name];
    if (i !== undefined) this.scl[i] = 0.0001;
  }

  // ------------------------------------------------------------------ humanoid

  private humanoid(seg: SegmentTemplate, a: AnimInput): void {
    const t = a.time + a.seed * 10;
    const amp = seg.mounted ? 0 : Math.min(1.2, a.speed / Math.max(0.5, a.refSpeed));
    const s = Math.sin(a.phase);
    const c = Math.cos(a.phase);
    const breathe = Math.sin(t * 2.2) * 0.03;
    const weaponHand = (seg.meta.weaponHand as string) === 'L' ? 'L' : 'R';
    const hasWeapon = seg.parts.weapon !== undefined;
    const hasShield = seg.parts.offhand !== undefined;

    if (a.climbing) {
      // Hand over hand up the wall face, knees alternating.
      const k = Math.sin(t * 7);
      this.r(seg, 'armL', -2.7 + k * 0.45, 0, 0.25);
      this.r(seg, 'armR', -2.7 - k * 0.45, 0, -0.25);
      this.r(seg, 'forearmL', -0.4 - Math.max(0, k) * 0.6);
      this.r(seg, 'forearmR', -0.4 - Math.max(0, -k) * 0.6);
      this.r(seg, 'thighL', -0.9 - k * 0.5);
      this.r(seg, 'thighR', -0.9 + k * 0.5);
      this.r(seg, 'shinL', 1.2);
      this.r(seg, 'shinR', 1.2);
      this.r(seg, 'torso', -0.15);
      this.r(seg, 'head', -0.35);
      return;
    }

    if (a.airborne || a.stunned) {
      const f = a.airborne ? 1 : 0.5;
      this.r(seg, 'armL', Math.sin(t * 13) * 1.2 * f, 0, 0.9 + Math.sin(t * 9) * 0.6 * f);
      this.r(seg, 'armR', Math.sin(t * 11 + 1) * 1.2 * f, 0, -0.9 - Math.sin(t * 10) * 0.6 * f);
      this.r(seg, 'thighL', Math.sin(t * 12) * 0.9 * f, 0, 0.2);
      this.r(seg, 'thighR', Math.sin(t * 12 + 2) * 0.9 * f, 0, -0.2);
      this.r(seg, 'shinL', 0.6 * f);
      this.r(seg, 'shinR', 0.6 * f);
      this.r(seg, 'torso', a.leanX - 0.3 * f, 0, a.leanZ);
      this.r(seg, 'head', Math.sin(t * 7) * 0.3 * f, 0, Math.sin(t * 5) * 0.3 * f);
      return;
    }

    // legs
    if (seg.mounted) {
      this.r(seg, 'thighL', -1.35, 0, 0.45);
      this.r(seg, 'thighR', -1.35, 0, -0.45);
      this.r(seg, 'shinL', 1.25);
      this.r(seg, 'shinR', 1.25);
    } else {
      this.r(seg, 'thighL', -s * 0.75 * amp);
      this.r(seg, 'thighR', s * 0.75 * amp);
      this.r(seg, 'shinL', Math.max(0, c) * 1.0 * amp);
      this.r(seg, 'shinR', Math.max(0, -c) * 1.0 * amp);
      this.o(seg, 'hips', 0, Math.abs(s) * 0.06 * amp, 0);
      this.r(seg, 'hips', 0, s * 0.12 * amp, 0);
    }

    // torso wobble + lean into motion
    this.r(seg, 'torso', 0.1 * amp + a.leanX + breathe, -s * 0.1 * amp, a.leanZ);
    this.r(seg, 'head', -a.leanX * 0.6 + Math.sin(t * 1.7) * 0.05, Math.sin(t * 0.7) * 0.15, -a.leanZ * 0.8);
    this.r(seg, 'cape', 0.25 * amp + Math.max(0, -a.leanX) + Math.sin(t * 3) * 0.05);

    // idle arms: loose swing opposite to legs
    const swing = s * 0.55 * amp;
    this.r(seg, 'armL', swing, 0, 0.14);
    this.r(seg, 'armR', -swing, 0, -0.14);
    this.r(seg, 'forearmL', -0.2);
    this.r(seg, 'forearmR', -0.2);

    // guard poses
    const guardArm = weaponHand === 'R' ? 'armR' : 'armL';
    const guardFore = weaponHand === 'R' ? 'forearmR' : 'forearmL';
    const twist = weaponHand === 'R' ? 1 : -1;
    if (hasWeapon) {
      if (this.style === 'thrust') {
        this.r(seg, guardArm, -swing * 0.8 - 0.35, 0, 0);
        this.r(seg, guardFore, 0.15);
      } else if (this.style === 'bow') {
        this.r(seg, guardArm, -swing * 0.8 - 0.5, 0, 0);
        this.r(seg, guardFore, -0.7);
      } else if (this.style === 'gun') {
        // Musket held across the chest, muzzle forward; the free hand steadies the barrel.
        const off = weaponHand === 'R' ? 'armL' : 'armR';
        this.r(seg, guardArm, -swing * 0.3 - 0.75, 0.35 * twist, 0);
        this.r(seg, guardFore, -0.8);
        this.r(seg, off, -swing * 0.3 - 1.05, -0.55 * twist, 0);
        this.r(seg, weaponHand === 'R' ? 'forearmL' : 'forearmR', -0.45);
      } else {
        this.r(seg, guardArm, -swing * 0.8 - 0.45, 0, 0);
        this.r(seg, guardFore, -0.9);
      }
    }
    if (hasShield) {
      this.r(seg, 'armL', -swing * 0.9 - 0.8, 0, 0.1);
      this.r(seg, 'forearmL', -0.75);
    }

    // attacks
    const k = a.attack;
    if (k < 0) return;
    const wind = ease(Math.min(1, k));
    const strike = k > 1 ? clamp01((k - 1) * 3) : 0;
    const settle = k > 1 ? clamp01((k - 1.33) * 1.5) : 0;
    const arm = weaponHand === 'R' ? 'armR' : 'armL';
    const fore = weaponHand === 'R' ? 'forearmR' : 'forearmL';
    const channel = k > 1.2 && k < 1.3 ? 1 : 0;
    switch (a.style ?? this.style) {
      case 'swing':
      case 'throw': {
        const raise = -2.5 * wind * (1 - strike) + (-2.5 + 2.9) * strike * (1 - settle) - 2.5 * 0 * settle;
        this.r(seg, arm, raise, 0, 0);
        this.r(seg, fore, 0.5 * wind * (1 - strike));
        this.r(seg, 'torso', -0.15 * wind * (1 - strike) + 0.35 * strike * (1 - settle), -0.35 * twist * wind * (1 - strike) + 0.3 * twist * strike * (1 - settle), 0);
        if (this.style === 'throw' && k > 1 && strike > 0.4) this.hide(seg, 'weapon');
        break;
      }
      case 'thrust': {
        const pull = wind * (1 - strike);
        const push = strike * (1 - settle);
        this.r(seg, arm, 0.45 * pull - 0.9 * push, 0, 0);
        this.r(seg, fore, -0.25 * pull + 0.1 * push);
        this.r(seg, 'torso', -0.1 * pull + 0.3 * push, -0.3 * twist * pull + 0.2 * twist * push, 0);
        break;
      }
      case 'bow': {
        const draw = wind * (1 - strike);
        this.r(seg, 'armL', -0.95 * draw, 0, -0.1 * draw);
        this.r(seg, 'forearmL', 0.5 * draw);
        this.r(seg, 'armR', -1.25 * draw + 0.3 * strike * (1 - settle), 0, 0.2 * draw);
        this.r(seg, 'forearmR', -1.6 * draw);
        this.r(seg, 'torso', 0, 0.35 * draw, 0);
        break;
      }
      case 'cast': {
        const up = wind * (1 - strike);
        const point = strike * (1 - settle);
        this.r(seg, arm, -1.9 * up - 1.2 * point, 0, 0);
        this.r(seg, fore, 0.6 * up);
        this.r(seg, 'head', -0.25 * up, 0, 0);
        break;
      }
      case 'gun': {
        // Steady the aim, then the recoil kicks the muzzle up and rocks the shoulders back.
        const aim = wind * (1 - strike);
        const kick = strike * (1 - settle);
        this.r(seg, arm, -0.2 * aim - 0.3 * kick, 0, 0);
        this.r(seg, weaponHand === 'R' ? 'armL' : 'armR', -0.15 * aim - 0.35 * kick, 0, 0);
        this.r(seg, 'torso', 0.05 * aim - 0.2 * kick + Math.sin(t * 45) * 0.03 * channel, 0, 0);
        this.r(seg, 'head', 0.12 * aim, 0, 0);
        break;
      }
      case 'raise': {
        // Both hands up to the sky, then flung down toward the target.
        const up = wind * (1 - strike);
        const release = strike * (1 - settle);
        for (const l of LIMBS) {
          this.r(seg, l.arm, -2.6 * up - 1.5 * release, 0, (0.45 * up + 0.15 * release) * l.out);
          this.r(seg, l.forearm, -0.25 * up + 0.4 * release);
        }
        this.r(seg, 'torso', -0.22 * up + 0.3 * release, 0, 0);
        this.r(seg, 'head', -0.45 * up + 0.15 * release, 0, 0);
        break;
      }
      case 'palm': {
        // Draw the hand back, then thrust the open palm at the target (held while channelling).
        const pull = wind * (1 - strike);
        const push = strike * (1 - settle);
        this.r(seg, arm, 0.55 * pull - 1.2 * push + Math.sin(t * 38) * 0.05 * channel, 0, 0);
        this.r(seg, fore, -1.1 * pull + 0.8 * push);
        this.r(seg, weaponHand === 'R' ? 'armL' : 'armR', 0.35 * push, 0, 0);
        this.r(seg, 'torso', 0.12 * push, (-0.45 * pull + 0.3 * push) * twist, 0);
        break;
      }
      case 'slam': {
        // Fists overhead, then a crouching smash into the ground.
        const lift = wind * (1 - strike);
        const smash = strike * (1 - settle);
        for (const l of LIMBS) {
          this.r(seg, l.arm, -2.7 * lift - 0.7 * smash, 0, 0.25 * lift * l.out);
          this.r(seg, l.forearm, -0.4 * lift);
          this.r(seg, l.thigh, -0.55 * smash, 0, 0.1 * smash * l.out);
          this.r(seg, l.shin, 0.9 * smash);
        }
        this.r(seg, 'torso', -0.25 * lift + 0.65 * smash, 0, 0);
        this.o(seg, 'hips', 0, -0.16 * smash, 0);
        break;
      }
      default:
        break;
    }
  }

  // ------------------------------------------------------------------ raptor

  private raptor(seg: SegmentTemplate, a: AnimInput): void {
    const t = a.time + a.seed * 10;
    const amp = a.airborne ? 0 : Math.min(1.2, a.speed / Math.max(0.5, a.refSpeed));
    const p = a.phase;
    const s = Math.sin(p);

    if (a.airborne || a.stunned) {
      const f = a.airborne ? 1 : 0.5;
      this.r(seg, 'thighL', -0.9 * f);
      this.r(seg, 'thighR', -0.7 * f);
      this.r(seg, 'shinL', 1.2 * f);
      this.r(seg, 'shinR', 1.1 * f);
      this.r(seg, 'tail1', 0.15 * f);
      this.r(seg, 'neck', 0.25 * f);
      this.r(seg, 'head', Math.sin(t * 9) * 0.3 * (a.stunned ? 1 : 0.2), Math.sin(t * 7) * 0.2 * f, 0);
      this.r(seg, 'body', a.leanX * 0.3, 0, a.leanZ * 0.3);
      return;
    }

    // hind-leg gait (digitigrade: shins stay partly folded)
    this.r(seg, 'thighL', -s * 0.65 * amp);
    this.r(seg, 'thighR', s * 0.65 * amp);
    this.r(seg, 'shinL', 0.3 + Math.max(0, Math.cos(p)) * 0.85 * amp);
    this.r(seg, 'shinR', 0.3 + Math.max(0, -Math.cos(p)) * 0.85 * amp);
    // torso bobs and pitches into the run; the tail sways against the stride
    this.o(seg, 'body', 0, Math.abs(s) * 0.07 * amp, 0);
    this.r(seg, 'body', 0.14 * amp + a.leanX * 0.4, s * 0.05 * amp, a.leanZ * 0.4);
    this.r(seg, 'tail1', -0.05 * amp, Math.sin(t * 2.1) * 0.16, 0);
    this.r(seg, 'tail2', 0, Math.sin(t * 2.1 - 0.8) * 0.2, 0);
    this.r(seg, 'tail3', 0, Math.sin(t * 2.1 - 1.6) * 0.22, 0);
    // tiny arms dangle; head rides level and scans while idle
    this.r(seg, 'armL', -0.25 - s * 0.15 * amp);
    this.r(seg, 'armR', -0.25 + s * 0.15 * amp);
    this.r(seg, 'neck', -0.12 * amp + Math.sin(t * 1.4) * 0.04, Math.sin(t * 0.6) * 0.12 * (1 - amp * 0.5), 0);
    this.r(seg, 'head', 0.05, Math.sin(t * 0.9) * 0.15 * (1 - amp * 0.5), 0);
    this.r(seg, 'jaw', 0.05 + Math.sin(t * 2.2) * 0.02);

    // bite: rear up with jaws open, then lunge down and snap shut
    const k = a.attack;
    if (k < 0) return;
    const wind = ease(Math.min(1, k));
    const strike = k > 1 ? clamp01((k - 1) * 3) : 0;
    const settle = k > 1 ? clamp01((k - 1.33) * 1.5) : 0;
    this.r(seg, 'neck', -0.3 * wind * (1 - strike) + 0.6 * strike * (1 - settle));
    this.r(seg, 'head', -0.15 * wind * (1 - strike) + 0.25 * strike * (1 - settle));
    this.r(seg, 'jaw', 0.55 * wind * (1 - strike) + 0.1 * strike * (1 - settle));
    this.r(seg, 'body', 0.22 * strike * (1 - settle) - 0.08 * wind * (1 - strike));
    this.r(seg, 'tail1', 0.18 * strike * (1 - settle));
    this.r(seg, 'thighL', -0.3 * strike * (1 - settle));
    this.r(seg, 'thighR', -0.3 * strike * (1 - settle));
  }

  // ------------------------------------------------------------------ quadruped

  private quadruped(seg: SegmentTemplate, a: AnimInput): void {
    const t = a.time + a.seed * 10;
    const amp = a.airborne ? 0 : Math.min(1.2, a.speed / Math.max(0.5, a.refSpeed));
    const p = a.phase;
    for (const [leg, shin, off, front] of QUAD_LEGS) {
      this.r(seg, leg, -Math.sin(p + off) * 0.5 * amp);
      const bend = Math.max(0, Math.cos(p + off)) * 0.7 * amp;
      this.r(seg, shin, front ? bend : -bend * 0.2 + bend);
    }
    this.o(seg, 'body', 0, Math.abs(Math.sin(p)) * 0.07 * amp, 0);
    this.r(seg, 'body', Math.sin(p * 2) * 0.03 * amp + a.leanX * 0.3, 0, a.leanZ * 0.3);
    this.r(seg, 'neck', Math.sin(p) * 0.06 * amp + Math.sin(t * 0.8) * 0.04);
    this.r(seg, 'head', Math.sin(t * 1.1) * 0.05, Math.sin(t * 0.5) * 0.15, 0);
    this.r(seg, 'tail', 0.2 * amp, 0, Math.sin(t * 2.3) * 0.25);
    this.r(seg, 'earL', 0, Math.sin(t * 1.6) * 0.3 + 0.1, 0);
    this.r(seg, 'earR', 0, -Math.sin(t * 1.6 + 0.4) * 0.3 - 0.1, 0);
    this.r(seg, 'trunk1', Math.sin(t * 1.2) * 0.12 + 0.05 * amp);
    this.r(seg, 'trunk2', Math.sin(t * 1.2 + 0.6) * 0.18);
    this.r(seg, 'trunk3', Math.sin(t * 1.2 + 1.2) * 0.25 - 0.1);
    if (a.stunned) this.r(seg, 'head', 0.25, 0, Math.sin(t * 6) * 0.2);

    const k = a.attack;
    if (k >= 0 && seg.parts.trunk1 !== undefined) {
      const wind = ease(Math.min(1, k));
      const strike = k > 1 ? clamp01((k - 1) * 3) * (1 - clamp01((k - 1.4) * 1.6)) : 0;
      this.r(seg, 'head', -0.35 * wind * (1 - strike) + 0.35 * strike, 0.4 * strike, 0);
      this.r(seg, 'trunk1', -1.0 * wind * (1 - strike));
      this.r(seg, 'trunk2', -0.6 * wind * (1 - strike));
      this.r(seg, 'body', -0.08 * wind * (1 - strike) + 0.05 * strike);
    }
  }

  // ------------------------------------------------------------------ dragon

  private dragon(seg: SegmentTemplate, a: AnimInput): void {
    const t = a.time + a.seed * 10;
    const beat = Math.sin(t * 3.2);
    const beatTip = Math.sin(t * 3.2 - 0.7);
    this.r(seg, 'wingL', 0, 0, beat * 0.65 + 0.1);
    this.r(seg, 'wingR', 0, 0, -beat * 0.65 - 0.1);
    this.r(seg, 'wingTipL', 0, 0, beatTip * 0.45);
    this.r(seg, 'wingTipR', 0, 0, -beatTip * 0.45);
    this.o(seg, 'body', 0, -beat * 0.18, 0);
    this.r(seg, 'body', -0.08 + a.leanX * 0.3, 0, a.leanZ * 0.4);
    for (let i = 0; i < DRAGON_TAIL.length; i++) this.r(seg, DRAGON_TAIL[i], 0.06, Math.sin(t * 2 - (i + 1) * 0.7) * 0.16, 0);
    for (const l of DRAGON_LEGS) {
      this.r(seg, l.legF, 0.7);
      this.r(seg, l.shinF, 0.9);
      this.r(seg, l.legB, 0.9);
      this.r(seg, l.shinB, 0.6);
    }
    const breathing = a.attack >= 0 ? 1 : 0;
    this.r(seg, 'neck1', -0.1 + Math.sin(t * 1.3) * 0.05 + 0.35 * breathing);
    this.r(seg, 'neck2', 0.1 + 0.25 * breathing);
    this.r(seg, 'head', 0.15 + 0.35 * breathing, Math.sin(t * 0.9) * 0.1, 0);
    this.r(seg, 'jaw', 0.08 + 0.55 * breathing + Math.sin(t * 20) * 0.05 * breathing);
  }

  // ------------------------------------------------------------------ bird

  private bird(seg: SegmentTemplate, a: AnimInput): void {
    const t = a.time + a.seed * 10;
    const dive = a.attack >= 0 ? 1 : 0;
    const rate = dive ? 9 : 6;
    const beat = Math.sin(t * rate);
    this.r(seg, 'wingL', 0, 0, beat * 0.75 * (1 - dive * 0.5) + 0.15 - dive * 0.3);
    this.r(seg, 'wingR', 0, 0, -beat * 0.75 * (1 - dive * 0.5) - 0.15 + dive * 0.3);
    this.r(seg, 'wingTipL', 0, 0, Math.sin(t * rate - 0.6) * 0.5);
    this.r(seg, 'wingTipR', 0, 0, -Math.sin(t * rate - 0.6) * 0.5);
    this.o(seg, 'body', 0, -beat * 0.06, 0);
    this.r(seg, 'body', 0.1 + dive * 0.45 + a.leanX * 0.3, 0, a.leanZ * 0.5);
    this.r(seg, 'head', -dive * 0.3, Math.sin(t * 0.9) * 0.3, 0);
    this.r(seg, 'tail', Math.sin(t * 2) * 0.1);
    this.r(seg, 'legs', dive ? -0.9 : 0.6);
  }

  // ------------------------------------------------------------------ catapult

  private catapult(seg: SegmentTemplate, a: AnimInput): void {
    const roll = a.phase * 1.4;
    for (const w of WHEELS) this.r(seg, w, roll);
    const k = a.attack;
    if (k < 0) return;
    if (k <= 1) {
      this.r(seg, 'arm', -0.12 * ease(k));
      return;
    }
    const fling = clamp01((k - 1) * 5);
    const back = clamp01((k - 1.3) * 1.4);
    this.r(seg, 'arm', 1.95 * fling * (1 - back));
    if (fling > 0.5 && back < 0.95) this.hide(seg, 'ammo');
  }
}
