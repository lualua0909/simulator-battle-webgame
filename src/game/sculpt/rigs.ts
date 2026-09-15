// Rig contracts: the part names, hierarchy and rest frames the game's procedural animation
// (render/animate.ts), ragdolls and mounts rely on. An img2threejs model that replaces an
// asset must honour its kind's contract, or it would stand frozen or swing the wrong limbs.
import * as THREE from 'three';
import { RIG_OF_KIND, type AssetDef, type AssetKind } from '@/shared/schema';
import type { SculptRig, WeaponStyle } from '@/shared/sculpt';
import { createAssetModel } from '../models';
import { bakeModel } from '../models/bake';

/** Studio targets: every asset kind plus a free-standing static prop (download only). */
export const SCULPT_KINDS = ['humanoid', 'horse', 'elephant', 'dragon', 'bird', 'raptor', 'catapult', 'tree', 'rock', 'bush', 'prop'] as const;
export type SculptKind = (typeof SCULPT_KINDS)[number];

export function rigOfKind(kind: SculptKind): SculptRig {
  return kind === 'prop' ? 'static' : RIG_OF_KIND[kind];
}

export interface PartRule {
  /** Acceptable nearest ancestor part ("root" = directly under the model). */
  parents: readonly string[];
  required: boolean;
  /** Held items may carry a rest rotation; animated joints must not. */
  heldItem?: boolean;
  note: string;
}

export interface RigContract {
  summary: string;
  parts: Record<string, PartRule>;
  sockets: Record<string, { note: string }>;
}

const pair = (name: (s: 'L' | 'R') => string, rule: (s: 'L' | 'R') => PartRule): Record<string, PartRule> => ({ [name('L')]: rule('L'), [name('R')]: rule('R') });
const legs = (prefix: string, parentOf: (key: string, side: 'L' | 'R') => string, required: boolean, note: string) =>
  Object.assign({}, ...['F', 'B'].map((k) => pair((s) => `${prefix}${k}${s}`, (s) => ({ parents: [parentOf(k, s)], required, note }))));

export const RIG_CONTRACTS: Record<SculptRig, RigContract> = {
  humanoid: {
    summary: 'Biped standing on y = 0, facing +Z. Limbs hang straight down (−Y) from their joints in the rest pose.',
    parts: {
      hips: { parents: ['root'], required: true, note: 'pelvis pivot at hip-joint height; bobs and turns while walking' },
      ...pair((s) => `thigh${s}`, () => ({ parents: ['hips'], required: true, note: 'hip joint; leg hangs along −Y; swings about X' })),
      ...pair((s) => `shin${s}`, (s) => ({ parents: [`thigh${s}`], required: true, note: 'knee joint; shin + foot hang below; bends about X' })),
      torso: { parents: ['hips'], required: true, note: 'waist pivot; leans about X/Z and twists about Y' },
      ...pair((s) => `arm${s}`, () => ({ parents: ['torso'], required: true, note: 'shoulder joint; upper arm hangs along −Y; swings about X, raises about Z' })),
      ...pair((s) => `forearm${s}`, (s) => ({ parents: [`arm${s}`], required: true, note: 'elbow joint; forearm + hand hang along −Y; bends about X' })),
      head: { parents: ['torso'], required: true, note: 'neck pivot; head, hair and headgear sit above it' },
      weapon: {
        parents: ['forearmR', 'forearmL'],
        required: false,
        heldItem: true,
        note: 'grip in the fist (forearmR; forearmL when weaponStyle is bow), rotation [1.5708, 0, 0]. Author the weapon in this frame: origin = grip, +Y = along the blade/shaft, +Z = forward (true when the forearm is raised in guard)',
      },
      offhand: { parents: ['forearmL'], required: false, heldItem: true, note: 'shield or off-hand item gripped in the left fist, same frame as weapon; a shield face sits at +Z' },
      cape: { parents: ['torso'], required: false, note: 'cape pivot at the upper back; cloth hangs along −Y and swings about X' },
    },
    sockets: {},
  },
  quadruped: {
    summary: 'Four-legged mount standing on y = 0, facing +Z. Legs hang straight down (−Y) from shoulder/hip joints.',
    parts: {
      body: { parents: ['root'], required: true, note: 'barrel of the torso; bobs and pitches' },
      neck: { parents: ['body'], required: false, note: 'neck base; nods about X' },
      head: { parents: ['neck', 'body'], required: true, note: 'head pivot at the top of the neck' },
      ...legs('leg', () => 'body', true, 'shoulder/hip joint at the top of the leg; leg hangs along −Y; swings about X'),
      ...legs('shin', (k, s) => `leg${k}${s}`, true, 'knee joint; lower leg + hoof hang below; bends about X'),
      tail: { parents: ['body'], required: false, note: 'tail root; swishes about Z' },
      ...pair((s) => `ear${s}`, () => ({ parents: ['head'], required: false, note: 'ear root; flaps about Y' })),
      trunk1: { parents: ['head'], required: false, note: 'trunk base (elephants); curls about X' },
      trunk2: { parents: ['trunk1'], required: false, note: 'mid trunk' },
      trunk3: { parents: ['trunk2'], required: false, note: 'trunk tip' },
    },
    sockets: { saddle: { note: 'on body: where a rider’s hips sit (rider faces +Z)' } },
  },
  dragon: {
    summary: 'Flying winged beast, facing +Z; wings spread along ±X from the shoulders.',
    parts: {
      body: { parents: ['root'], required: true, note: 'torso; bobs with the wingbeat' },
      neck1: { parents: ['body'], required: false, note: 'neck base' },
      neck2: { parents: ['neck1'], required: false, note: 'upper neck' },
      head: { parents: ['neck2', 'neck1', 'body'], required: true, note: 'skull pivot' },
      jaw: { parents: ['head'], required: false, note: 'lower jaw hinge; opens about X to breathe fire' },
      tail1: { parents: ['body'], required: false, note: 'tail chain (tail1→tail4), sways about Y' },
      tail2: { parents: ['tail1'], required: false, note: 'tail segment' },
      tail3: { parents: ['tail2'], required: false, note: 'tail segment' },
      tail4: { parents: ['tail3'], required: false, note: 'tail tip' },
      ...pair((s) => `wing${s}`, () => ({ parents: ['body'], required: true, note: 'wing shoulder; wing extends along ±X; flaps about Z' })),
      ...pair((s) => `wingTip${s}`, (s) => ({ parents: [`wing${s}`], required: false, note: 'wing elbow; outer wing flaps about Z' })),
      ...legs('leg', () => 'body', false, 'hip/shoulder joint; tucked while flying'),
      ...legs('shin', (k, s) => `leg${k}${s}`, false, 'knee joint'),
    },
    sockets: { mouth: { note: 'on head or jaw, just in front of the snout: fire breath origin' } },
  },
  bird: {
    summary: 'Flying bird, facing +Z; wings spread along ±X.',
    parts: {
      body: { parents: ['root'], required: true, note: 'torso; bobs with the wingbeat and pitches into dives' },
      head: { parents: ['body'], required: true, note: 'neck pivot' },
      ...pair((s) => `wing${s}`, () => ({ parents: ['body'], required: true, note: 'wing shoulder; flaps about Z' })),
      ...pair((s) => `wingTip${s}`, (s) => ({ parents: [`wing${s}`], required: false, note: 'wing elbow' })),
      tail: { parents: ['body'], required: false, note: 'tail fan root' },
      legs: { parents: ['body'], required: false, note: 'both legs and talons; swing about X' },
    },
    sockets: {},
  },
  raptor: {
    summary: 'Bipedal theropod standing on y = 0, facing +Z. Horizontal torso, stiff tail chain counter-balancing the head.',
    parts: {
      body: { parents: ['root'], required: true, note: 'horizontal torso; bobs and pitches into the run' },
      neck: { parents: ['body'], required: true, note: 'neck base; lunges down-forward about X when biting' },
      head: { parents: ['neck'], required: true, note: 'skull pivot' },
      jaw: { parents: ['head'], required: true, note: 'lower jaw hinge; opens about X' },
      tail1: { parents: ['body'], required: true, note: 'tail chain (tail1→tail3), sways about Y' },
      tail2: { parents: ['tail1'], required: true, note: 'tail segment' },
      tail3: { parents: ['tail2'], required: true, note: 'tail tip' },
      ...pair((s) => `arm${s}`, () => ({ parents: ['body'], required: false, note: 'tiny arm; dangles along −Y' })),
      ...pair((s) => `thigh${s}`, () => ({ parents: ['body'], required: true, note: 'hip joint; thigh angles down-forward; swings about X' })),
      ...pair((s) => `shin${s}`, (s) => ({ parents: [`thigh${s}`], required: true, note: 'knee joint; shin + clawed foot below; folds about X' })),
    },
    sockets: { mouth: { note: 'on head, just past the snout: bite effect origin' } },
  },
  catapult: {
    summary: 'Siege engine on wheels, shooting towards +Z.',
    parts: {
      base: { parents: ['root'], required: true, note: 'frame on the axles' },
      ...legs('wheel', () => 'base', false, 'axle pivot at the wheel centre; rolls about X'),
      arm: { parents: ['base'], required: true, note: 'throwing arm pivot; the arm rests pointing backwards (−Z) and flings forward about X' },
      ammo: { parents: ['arm'], required: false, note: 'boulder in the cup; hidden at release' },
    },
    sockets: {},
  },
  static: {
    summary: 'Static prop standing on y = 0; the game merges it into one mesh, so no parts are needed.',
    parts: {},
    sockets: {},
  },
};

export interface ReferencePart {
  name: string;
  parent: string;
  /** Model-space pivot. */
  pivot: number[];
  /** Offset from the parent part's pivot. */
  local: number[];
  rotation: number[];
  /** Extent of the part's meshes in its own frame. */
  box: [number[], number[]] | null;
}

export interface ReferenceRig {
  kind: SculptKind;
  assetId: string | null;
  height: number;
  weaponStyle: WeaponStyle;
  parts: ReferencePart[];
  sockets: Array<{ name: string; part: string; local: number[] }>;
}

export function weaponStyleOf(weapon: unknown): WeaponStyle {
  if (weapon === 'none' || weapon === undefined) return 'none';
  if (weapon === 'bow' || weapon === 'staff') return weapon;
  if (weapon === 'spear' || weapon === 'lance' || weapon === 'pitchfork') return 'thrust';
  return 'swing';
}

// A fully equipped figure, so the reference shows the weapon, shield and cape frames too.
const DEFAULT_PARAMS: Partial<Record<AssetKind, AssetDef['params']>> = {
  humanoid: { weapon: 'sword', offhand: 'shield-round', cape: true, head: 'helmet' },
};

const round = (v: number) => Math.round(v * 1000) / 1000;
const vec = (v: THREE.Vector3 | THREE.Euler) => [round(v.x), round(v.y), round(v.z)];

/** Pivots and extents of the procedural model the studio output replaces (scale 1). */
export function referenceRig(kind: SculptKind, base?: AssetDef | null): ReferenceRig | null {
  if (kind === 'prop') return null;
  const asset: AssetDef =
    base && base.kind === kind
      ? { ...base, scale: 1, sculpt: null, glb: null }
      : { id: 'reference', name: 'reference', kind, scale: 1, seed: 1, params: DEFAULT_PARAMS[kind] ?? {}, sculpt: null, glb: null };
  const t = bakeModel(createAssetModel(asset));
  const pos = new THREE.Vector3();
  const quat = new THREE.Quaternion();
  const scl = new THREE.Vector3();
  const parts: ReferencePart[] = [];
  for (const p of t.parts) {
    if (p.segment !== 0 || p.parent < 0) continue;
    p.rest.decompose(pos, quat, scl);
    const pivot = vec(pos);
    const local = new THREE.Vector3().setFromMatrixPosition(p.bind);
    const rotation = new THREE.Euler().setFromQuaternion(new THREE.Quaternion().setFromRotationMatrix(p.bind));
    parts.push({
      name: p.local,
      parent: t.parts[p.parent].local,
      pivot,
      local: vec(local),
      rotation: vec(rotation),
      box: p.box ? [vec(p.box.min), vec(p.box.max)] : null,
    });
  }
  const sockets = Object.entries(t.sockets).map(([name, s]) => ({ name, part: t.parts[s.part].local, local: vec(new THREE.Vector3().setFromMatrixPosition(s.matrix)) }));
  return {
    kind,
    assetId: base?.kind === kind ? base.id : null,
    height: round(t.bounds.max.y - Math.min(0, t.bounds.min.y)),
    weaponStyle: kind === 'humanoid' ? weaponStyleOf(asset.params.weapon) : 'none',
    parts,
    sockets,
  };
}
