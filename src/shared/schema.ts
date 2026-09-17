// Game content schema — single source of truth for the CMS (validation + forms),
// the simulation (types) and the online server (army validation).
import { z } from 'zod';
import { checkSculptSpec, sculptSpecSchema, type SculptRig } from './sculpt';

export const DAMAGE_TYPES = ['blunt', 'slash', 'pierce', 'fire', 'magic'] as const;
export const ARMOR_CLASSES = ['unarmored', 'light', 'heavy', 'beast', 'siege'] as const;
export const ROLES = ['melee', 'ranged', 'support', 'siege'] as const;
export const ATTACK_KINDS = ['melee', 'projectile', 'breath', 'heal', 'chain', 'strike', 'vortex', 'nova', 'dash'] as const;
/** Body animation while winding up / releasing an ability ('auto' = derived from the kind and the held weapon). */
export const CAST_STYLES = ['auto', 'swing', 'thrust', 'bow', 'throw', 'cast', 'gun', 'raise', 'palm', 'slam'] as const;
export const STRIKE_VFX = ['lightning', 'meteor'] as const;
export const UNIT_ASSET_KINDS = ['humanoid', 'horse', 'elephant', 'dragon', 'bird', 'raptor', 'catapult', 'structure'] as const;
export const ENV_ASSET_KINDS = ['tree', 'rock', 'bush'] as const;
export const ASSET_KINDS = [...UNIT_ASSET_KINDS, ...ENV_ASSET_KINDS] as const;
export const PROJECTILE_MODELS = ['arrow', 'spear', 'stone', 'boulder', 'fireball', 'orb', 'bullet', 'meteor', 'shuriken'] as const;
export const PARTICLE_SHAPES = ['cube', 'tetra', 'sphere'] as const;
export const PARTICLE_DIRECTIONS = ['up', 'sphere', 'hemisphere', 'forward'] as const;
export const BOT_STRATEGIES = ['balanced', 'rush', 'ranged', 'tank', 'swarm', 'elite', 'counter'] as const;
export const FORMATIONS = ['line', 'wedge', 'flanks', 'blob', 'scatter'] as const;
/** Treasure chest looks of the reward boxes (src/game/models/chest.ts). */
export const CHEST_VARIANTS = ['wooden', 'silver', 'golden', 'giant', 'magical', 'super-magical'] as const;
/**
 * Siege-mode building behaviour: `wall` = stackable 2 m grid block units walk on, `platform` = grid
 * tower units stand on (range bonus), `building` = immovable (towers, barracks), `core` = the
 * keep the attackers must destroy. 'none' = a normal unit.
 */
export const STRUCTURE_KINDS = ['none', 'wall', 'platform', 'building', 'core'] as const;
/** Which side may field a unit in siege mode. */
export const SIEGE_SIDES = ['any', 'defense', 'attack'] as const;
/** Looks of the `structure` asset kind (src/game/models/structures.ts). */
export const STRUCTURE_TYPES = ['wall', 'brick-wall', 'watchtower', 'bow-tower', 'gun-tower', 'tesla', 'barracks', 'keep'] as const;
/** Highest star level of an upgraded unit. */
export const STAR_MAX = 5;

export type DamageType = (typeof DAMAGE_TYPES)[number];
export type ArmorClass = (typeof ARMOR_CLASSES)[number];
export type Role = (typeof ROLES)[number];
export type AssetKind = (typeof ASSET_KINDS)[number];
export type UnitAssetKind = (typeof UNIT_ASSET_KINDS)[number];
export type StructureKind = (typeof STRUCTURE_KINDS)[number];

export const idSchema = z.string().regex(/^[a-z0-9][a-z0-9-]{0,47}$/, 'id chỉ gồm chữ thường, số, dấu gạch ngang');
const refOrNull = idSchema.nullable().default(null);
const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'màu dạng #rrggbb');
const name = z.string().trim().min(1, 'bắt buộc').max(48);
const range2 = z.tuple([z.number(), z.number()]);

// ---------------------------------------------------------------- factions

export const factionSchema = z.object({
  id: idSchema,
  name,
  color: hex,
  icon: z.string().max(8).default('⚔️'),
  order: z.number().int().default(0),
});

// ---------------------------------------------------------------- units

export const unitSchema = z.object({
  id: idSchema,
  name,
  factionId: idSchema,
  description: z.string().max(300).default(''),
  role: z.enum(ROLES),
  cost: z.number().int().min(1).max(100000),
  hp: z.number().min(1).max(100000),
  speed: z.number().min(0).max(30),
  mass: z.number().min(0.1).max(500),
  radius: z.number().min(0.2).max(6),
  height: z.number().min(0.3).max(20),
  armorClass: z.enum(ARMOR_CLASSES),
  weaponId: idSchema,
  /** Extra abilities (documents of `weapons`), cast automatically in list order when ready. */
  skillIds: z.array(idSchema).max(6).default([]),
  /** Basic attack rate multiplier: cooldown and windup are divided by it. */
  attackSpeed: z.number().min(0.1).max(10).default(1),
  /** Skill rate multiplier: skill cooldown, cast time and channel interval are divided by it. */
  castSpeed: z.number().min(0.1).max(10).default(1),
  modelId: idSchema,
  riderModelId: refOrNull,
  flying: z.boolean().default(false),
  altitude: z.number().min(0).max(40).default(0),
  blockChance: z.number().min(0).max(0.95).default(0),
  chargeBonus: z.number().min(1).max(5).default(1),
  knockbackResist: z.number().min(0).max(1).default(0),
  trampleDamage: z.number().min(0).max(2000).default(0),
  // ---- siege mode
  structure: z.enum(STRUCTURE_KINDS).default('none'),
  siegeSide: z.enum(SIEGE_SIDES).default('any'),
  /** Climbs enemy walls instead of breaking them. */
  climbWalls: z.boolean().default(false),
  /** Barracks: unit produced every `spawnInterval` s while fewer than `spawnMax` of its own are alive. */
  spawnUnitId: refOrNull,
  spawnInterval: z.number().min(0.2).max(60).default(1),
  spawnMax: z.number().int().min(1).max(50).default(10),
  // ---- player collection (coins: 1 coin = 1 VND)
  /** Coins to unlock the unit; 0 = every player has it, guests included. */
  unlockCost: z.number().int().min(0).max(100_000_000).default(0),
  /** Shop price of one card; 0 = not sold. */
  cardPrice: z.number().int().min(0).max(1_000_000).default(0),
  /** Cards used up to reach star 1…5. */
  starCards: z
    .array(z.number().int().min(1).max(100_000))
    .length(STAR_MAX)
    .default(() => [100, 200, 300, 400, 500]),
  /** Coins paid to reach star 1…5. */
  starCoins: z
    .array(z.number().int().min(0).max(100_000_000))
    .length(STAR_MAX)
    .default(() => [1000, 2000, 4000, 8000, 16000]),
});

// ---------------------------------------------------------------- weapons

export const weaponSchema = z.object({
  id: idSchema,
  name,
  attack: z.enum(ATTACK_KINDS),
  damage: z.number().min(0).max(100000),
  damageType: z.enum(DAMAGE_TYPES),
  range: z.number().min(0.3).max(200),
  minRange: z.number().min(0).max(100).default(0),
  cooldown: z.number().min(0.05).max(60),
  windup: z.number().min(0).max(10),
  knockback: z.number().min(0).max(300).default(0),
  knockUp: z.number().min(0).max(60).default(0),
  cleaveArc: z.number().min(0).max(360).default(0),
  maxTargets: z.number().int().min(1).max(50).default(1),
  splashRadius: z.number().min(0).max(30).default(0),
  projectileId: refOrNull,
  projectileSpeed: z.number().min(1).max(200).default(20),
  spread: z.number().min(0).max(10).default(0),
  volley: z.number().int().min(1).max(20).default(1),
  hitParticleId: refOrNull,
  fireParticleId: refOrNull,
  // ---- skill behaviour (every kind)
  castStyle: z.enum(CAST_STYLES).default('auto'),
  /** Seconds before a skill can first be cast in a battle. */
  initialCooldown: z.number().min(0).max(60).default(0),
  /** A skill waits until this many enemies stand within its area around the target. */
  minTargets: z.number().int().min(1).max(50).default(1),
  /** Channel: repeat the effect every `interval` s for this long (vortex: lifetime of the whirlwind). */
  duration: z.number().min(0).max(30).default(0),
  interval: z.number().min(0.05).max(5).default(0.2),
  // ---- status effects on hit
  stunDuration: z.number().min(0).max(10).default(0),
  burnDps: z.number().min(0).max(1000).default(0),
  burnDuration: z.number().min(0).max(30).default(0),
  // ---- chain: jumps from the target to the nearest enemies
  chainCount: z.number().int().min(0).max(20).default(4),
  chainRange: z.number().min(0.5).max(30).default(6),
  chainFalloff: z.number().min(0).max(1).default(0.8),
  // ---- strike: blasts that fall from the sky after a telegraph
  strikeVfx: z.enum(STRIKE_VFX).default('lightning'),
  strikeCount: z.number().int().min(1).max(30).default(1),
  strikeDelay: z.number().min(0).max(10).default(0.5),
  strikeInterval: z.number().min(0).max(5).default(0.15),
  strikeSpread: z.number().min(0).max(30).default(0),
  // ---- vortex: a travelling whirlwind that pulls, lifts and flings
  zoneSpeed: z.number().min(0).max(20).default(3),
  pull: z.number().min(0).max(40).default(8),
  lift: z.number().min(0).max(40).default(8),
  // ---- visuals
  /** Lightning, whirlwind, shockwave and telegraph colour. */
  vfxColor: hex.default('#9fd8ff'),
  /** Secondary particles: at a strike / nova / whirlwind base, or where a projectile leaves (gun smoke). */
  areaParticleId: refOrNull,
});

// ---------------------------------------------------------------- projectiles

export const projectileSchema = z.object({
  id: idSchema,
  name,
  model: z.enum(PROJECTILE_MODELS),
  scale: z.number().min(0.1).max(10).default(1),
  color: hex.default('#ffffff'),
  gravity: z.number().min(0).max(60).default(9.8),
  hitRadius: z.number().min(0.05).max(5).default(0.3),
  lifetime: z.number().min(0.5).max(30).default(8),
  trailParticleId: refOrNull,
  impactParticleId: refOrNull,
  stick: z.boolean().default(false),
});

// ---------------------------------------------------------------- particles

export const particleSchema = z.object({
  id: idSchema,
  name,
  shape: z.enum(PARTICLE_SHAPES),
  additive: z.boolean().default(false),
  count: z.number().int().min(1).max(400),
  rate: z.number().min(0).max(400).default(30),
  lifetime: range2,
  speed: range2,
  direction: z.enum(PARTICLE_DIRECTIONS),
  spread: z.number().min(0).max(1).default(0.5),
  gravity: z.number().min(-40).max(60).default(9.8),
  drag: z.number().min(0).max(10).default(0.5),
  size: range2,
  colorStart: hex,
  colorEnd: hex,
  spin: z.number().min(0).max(40).default(3),
  emitRadius: z.number().min(0).max(10).default(0.1),
});

// ---------------------------------------------------------------- assets (procedural model presets)

export const humanoidParamsSchema = z.object({
  bulk: z.number().min(0.5).max(2).default(1),
  skin: hex.default('#f2c29b'),
  shirt: hex.default('#3b6fd6'),
  pants: hex.default('#4a3b2a'),
  boots: hex.default('#3a2a1c'),
  armor: z.enum(['none', 'vest', 'plate', 'robe', 'loincloth', 'fur']).default('none'),
  armorColor: hex.default('#9aa3ad'),
  head: z
    .enum(['none', 'cap', 'helmet', 'greathelm', 'horned', 'crown', 'hood', 'wizard', 'headband', 'strawhat', 'ninja'])
    .default('none'),
  headColor: hex.default('#8a8f96'),
  hair: z.enum(['none', 'short', 'long', 'mohawk', 'topknot']).default('short'),
  hairColor: hex.default('#3b2616'),
  beard: z.enum(['none', 'short', 'long']).default('none'),
  brows: z.enum(['none', 'angry', 'worried']).default('angry'),
  cape: z.boolean().default(false),
  capeColor: hex.default('#b3262e'),
  weapon: z
    .enum(['none', 'club', 'bigclub', 'sword', 'greatsword', 'axe', 'spear', 'lance', 'hammer', 'bow', 'staff', 'pitchfork', 'stone', 'musket', 'katana'])
    .default('none'),
  offhand: z.enum(['none', 'shield-round', 'shield-kite', 'buckler']).default('none'),
  woodColor: hex.default('#8a5a2b'),
  metalColor: hex.default('#c9ced6'),
  orbColor: hex.default('#7cf2ff'),
  shieldColor: hex.default('#b3262e'),
});

export const horseParamsSchema = z.object({
  coat: hex.default('#7a4a2a'),
  mane: hex.default('#2b1a10'),
  saddle: hex.default('#5a3218'),
  barding: z.boolean().default(false),
  bardingColor: hex.default('#2f5fb3'),
});

export const elephantParamsSchema = z.object({
  skin: hex.default('#8d8f96'),
  tusks: z.boolean().default(true),
  tuskColor: hex.default('#f1ead8'),
  fur: z.boolean().default(false),
  howdah: z.boolean().default(false),
  blanket: hex.default('#b3262e'),
});

export const dragonParamsSchema = z.object({
  /** western = long fire dragon; baby = chubby upright baby dragon (same rig). */
  type: z.enum(['western', 'baby']).default('western'),
  body: hex.default('#b32a22'),
  belly: hex.default('#e8b04a'),
  wing: hex.default('#7a1c18'),
  horn: hex.default('#f3ead2'),
  eye: hex.default('#ffe34d'),
});

export const birdParamsSchema = z.object({
  body: hex.default('#5a3a1e'),
  wing: hex.default('#3e2714'),
  head: hex.default('#f4f1e8'),
  beak: hex.default('#f2b01e'),
});

export const raptorParamsSchema = z.object({
  body: hex.default('#5f9e4d'),
  belly: hex.default('#d9cf9e'),
  back: hex.default('#3c6e35'),
  eye: hex.default('#ffd23f'),
});

export const catapultParamsSchema = z.object({
  wood: hex.default('#8a5a2b'),
  metal: hex.default('#5d636b'),
  rope: hex.default('#d8c28a'),
  /** Burning pitch pot instead of a stone. */
  fire: z.boolean().default(false),
});

export const structureParamsSchema = z.object({
  type: z.enum(STRUCTURE_TYPES).default('wall'),
  stone: hex.default('#9a948a'),
  stone2: hex.default('#7d776e'),
  wood: hex.default('#7a5230'),
  roof: hex.default('#9a3a2a'),
  accent: hex.default('#d8b04a'),
  /** Khối tường chữ nhật vẽ bằng Three.js (nhẹ, không dùng glb): dài × cao × dày (m). Dài/dày luôn khớp ô lưới 2 m. */
  wallLength: z.number().min(1).max(8).default(2),
  wallHeight: z.number().min(0.5).max(4).default(2),
  wallDepth: z.number().min(1).max(8).default(2),
});

export const treeParamsSchema = z.object({
  type: z.enum(['pine', 'oak', 'birch', 'dead', 'palm', 'cactus']).default('pine'),
  trunk: hex.default('#6b4424'),
  leaf: hex.default('#2f7a3a'),
  leaf2: hex.default('#4f9a3f'),
  height: z.number().min(1).max(20).default(6),
});

export const rockParamsSchema = z.object({
  color: hex.default('#8b8d90'),
  color2: hex.default('#6f7276'),
  roughness: z.number().min(0).max(1).default(0.35),
  flatness: z.number().min(0.3).max(1).default(0.7),
});

export const bushParamsSchema = z.object({
  leaf: hex.default('#3f8a3a'),
  leaf2: hex.default('#5fa845'),
  berries: z.boolean().default(false),
  berryColor: hex.default('#d8283a'),
});

export const ASSET_PARAM_SCHEMAS = {
  humanoid: humanoidParamsSchema,
  horse: horseParamsSchema,
  elephant: elephantParamsSchema,
  dragon: dragonParamsSchema,
  bird: birdParamsSchema,
  raptor: raptorParamsSchema,
  catapult: catapultParamsSchema,
  structure: structureParamsSchema,
  tree: treeParamsSchema,
  rock: rockParamsSchema,
  bush: bushParamsSchema,
} satisfies Record<AssetKind, z.ZodType>;

export type HumanoidParams = z.infer<typeof humanoidParamsSchema>;
export type HorseParams = z.infer<typeof horseParamsSchema>;
export type ElephantParams = z.infer<typeof elephantParamsSchema>;
export type DragonParams = z.infer<typeof dragonParamsSchema>;
export type BirdParams = z.infer<typeof birdParamsSchema>;
export type RaptorParams = z.infer<typeof raptorParamsSchema>;
export type CatapultParams = z.infer<typeof catapultParamsSchema>;
export type StructureParams = z.infer<typeof structureParamsSchema>;
export type TreeParams = z.infer<typeof treeParamsSchema>;
export type RockParams = z.infer<typeof rockParamsSchema>;
export type BushParams = z.infer<typeof bushParamsSchema>;

/** Animation rig each asset kind uses; an img2threejs model must match it to replace the asset. */
export const RIG_OF_KIND = {
  humanoid: 'humanoid',
  horse: 'quadruped',
  elephant: 'quadruped',
  dragon: 'dragon',
  bird: 'bird',
  raptor: 'raptor',
  catapult: 'catapult',
  structure: 'static',
  tree: 'static',
  rock: 'static',
  bush: 'static',
} as const satisfies Record<AssetKind, SculptRig>;

/** img2threejs studio model that replaces the procedural preset (null = procedural). */
export const assetSculptSchema = z.object({
  studioId: z.string().max(64),
  version: z.number().int().min(1),
  spec: sculptSpecSchema,
});

/** Asset kinds whose uploaded .glb keeps its skeletal animation (rendered skinned, see models/glbSkinned.ts). */
export const SKINNED_GLB_KINDS = ['raptor', 'humanoid', 'dragon', 'horse'] as const satisfies readonly AssetKind[];
/**
 * Asset kinds whose uploaded .glb has no skeleton: baked rigid to one vertex-coloured
 * mesh but mounted on a quadruped `body` pivot (walk bob/lean still apply) with a
 * `saddle` socket so riders keep seating (see models/glbStatic.ts).
 */
export const RIGID_GLB_KINDS = ['elephant'] as const satisfies readonly AssetKind[];
/**
 * An admin-uploaded .glb/.gltf that replaces the procedural preset outright. Static-rig kinds
 * are baked to one vertex-coloured mesh; kinds in SKINNED_GLB_KINDS keep their skeletal
 * animation and play the embedded clips (idle/walk/run/attack/death) in battle; kinds in
 * RIGID_GLB_KINDS are baked rigid (the file carries no skeleton) but keep body motion + saddle.
 */
export const assetGlbSchema = z.object({
  url: z.string(),
  fileName: z.string().max(200),
  uploadedAt: z.number(),
  /**
   * Recolour map keyed by material name. A plain hex multiplies the material (solid packs).
   * `{ from, to }` repaints textured pixels of the `from` hue family toward `to` (e.g. a blue
   * robe to red), keeping shading and leaving skin, trim and hair untouched.
   */
  tint: z.record(z.string(), z.union([hex, z.object({ from: hex, to: hex })])).default({}),
  /**
   * Mesh/node names to drop from a skeletal file on load (e.g. a character pack's whole
   * weapon arsenal riding in one hand). Exact match; the rest of the file is untouched.
   */
  hide: z.array(z.string().max(200)).default([]),
});
export type AssetGlb = z.infer<typeof assetGlbSchema>;

export const assetSchema = z
  .object({
    id: idSchema,
    name,
    kind: z.enum(ASSET_KINDS),
    scale: z.number().min(0.1).max(10).default(1),
    seed: z.number().int().min(0).max(1_000_000).default(1),
    params: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).default({}),
    sculpt: assetSculptSchema.nullable().default(null),
    glb: assetGlbSchema.nullable().default(null),
  })
  .superRefine((asset, ctx) => {
    const result = ASSET_PARAM_SCHEMAS[asset.kind].safeParse(asset.params);
    if (!result.success) {
      for (const issue of result.error.issues) {
        ctx.addIssue({ code: 'custom', message: issue.message, path: ['params', ...issue.path.map(String)] });
      }
    }
    if (asset.sculpt && asset.sculpt.spec.rig !== RIG_OF_KIND[asset.kind]) {
      ctx.addIssue({ code: 'custom', message: `model img2threejs dùng rig ${asset.sculpt.spec.rig}, asset loại ${asset.kind} cần rig ${RIG_OF_KIND[asset.kind]}`, path: ['sculpt'] });
    }
    for (const issue of asset.sculpt ? checkSculptSpec(asset.sculpt.spec) : []) {
      if (issue.level === 'fail') ctx.addIssue({ code: 'custom', message: issue.message, path: ['sculpt', 'spec'] });
    }
    if (asset.glb && RIG_OF_KIND[asset.kind] !== 'static' && !(SKINNED_GLB_KINDS as readonly string[]).includes(asset.kind) && !(RIGID_GLB_KINDS as readonly string[]).includes(asset.kind)) {
      ctx.addIssue({ code: 'custom', message: `upload glb chỉ dùng cho asset tĩnh (rig "static"), ${SKINNED_GLB_KINDS.join(', ')} (giữ animation trong file) hoặc ${RIGID_GLB_KINDS.join(', ')} (bake cứng, giữ chuyển động thân); asset loại ${asset.kind} cần rig ${RIG_OF_KIND[asset.kind]} để hoạt hình`, path: ['glb'] });
    }
    if (asset.glb && asset.sculpt) {
      ctx.addIssue({ code: 'custom', message: 'chỉ chọn một: model img2threejs hoặc glb upload', path: ['glb'] });
    }
  });

// ---------------------------------------------------------------- maps

const scatterSchema = z.object({
  perHectare: z.number().min(0).max(400).default(0),
  kinds: z.array(idSchema).default([]),
});

export const mapSchema = z.object({
  id: idSchema,
  name,
  seed: z.number().int().min(0).max(1_000_000),
  size: z.number().min(60).max(300).default(140),
  heightScale: z.number().min(0).max(20).default(4),
  hilliness: z.number().min(0.2).max(4).default(1),
  river: z.object({
    enabled: z.boolean().default(false),
    width: z.number().min(2).max(30).default(8),
    meander: z.number().min(0).max(40).default(10),
    /** > 0: the river is too deep to wade except a shallow ford this wide around z = 0. */
    ford: z.number().min(0).max(60).default(0),
  }),
  /** Plateau (m) rising toward the red side; negative raises the blue side. */
  rise: z.number().min(-20).max(20).default(0),
  trees: scatterSchema,
  rocks: scatterSchema,
  bushes: scatterSchema,
  grassColor: hex,
  dirtColor: hex,
  sandColor: hex,
  waterColor: hex,
  skyTop: hex,
  skyBottom: hex,
  fog: z.number().min(0).max(1).default(0.3),
  deployDepth: z.number().min(5).max(80).default(28),
  /** Siege mode: depth of the defenders' zone (0 = deployDepth). */
  defenseDepth: z.number().min(0).max(120).default(0),
  budget: z.number().int().min(100).max(1_000_000).default(3000),
});

// ---------------------------------------------------------------- bots

export const botSchema = z.object({
  id: idSchema,
  name,
  description: z.string().max(300).default(''),
  difficulty: z.number().int().min(1).max(5),
  budgetMultiplier: z.number().min(0.2).max(5).default(1),
  strategy: z.enum(BOT_STRATEGIES),
  factionIds: z.array(idSchema).default([]),
  reactive: z.boolean().default(false),
  formation: z.enum(FORMATIONS).default('line'),
  randomness: z.number().min(0).max(1).default(0.3),
  maxUnits: z.number().int().min(1).max(500).default(100),
});

// ---------------------------------------------------------------- settings (singleton)

const armorRow = z.object(Object.fromEntries(ARMOR_CLASSES.map((a) => [a, z.number().min(0).max(10)])) as Record<ArmorClass, z.ZodNumber>);

const boxRewardSchema = z.object({
  chest: z.enum(CHEST_VARIANTS),
  /** Coins in the box, drawn uniformly from [min, max]. */
  coins: z.tuple([z.number().int().min(0).max(1_000_000), z.number().int().min(0).max(1_000_000)]).refine(([lo, hi]) => lo <= hi, 'min phải ≤ max'),
  /** Cards in the box, shared between `kinds` random units. */
  cards: z.number().int().min(0).max(10_000),
  kinds: z.number().int().min(1).max(20),
});

export const economySchema = z.object({
  /** The x-hour box: once today's daily box is open, one more box every this many hours. */
  boxHours: z.number().min(0.1).max(168).default(3),
  /** Extra HP and damage per star (0.1 = +10 %). */
  starBonus: z.number().min(0).max(1).default(0.1),
  dailyBox: boxRewardSchema.default(() => ({ chest: 'golden' as const, coins: [200, 500] as [number, number], cards: 40, kinds: 3 })),
  hourlyBox: boxRewardSchema.default(() => ({ chest: 'silver' as const, coins: [50, 150] as [number, number], cards: 12, kinds: 2 })),
});

export const siegeSettingsSchema = z.object({
  /** Budget of each side = map (or room) budget × this. */
  defenseBudget: z.number().min(0.1).max(10).default(1),
  attackBudget: z.number().min(0.1).max(10).default(1),
  /** Height of one wall block (m); should match the wall assets' wallHeight. Blocks are wallLength×wallDepth m. */
  tierHeight: z.number().min(0.5).max(4).default(2),
  maxTiers: z.number().int().min(1).max(6).default(3),
  maxWallBlocks: z.number().int().min(0).max(1000).default(400),
  /** Range bonus of units standing on a watchtower (0.3 = +30 %). */
  towerRangeBonus: z.number().min(0).max(3).default(0.3),
  /** Units that fit on one watchtower. */
  towerCapacity: z.number().int().min(1).max(8).default(2),
  /** Damage per metre fallen beyond 2.5 m. */
  fallDamage: z.number().min(0).max(500).default(15),
  /** Speed multiplier walking over wall rubble. */
  rubbleSlow: z.number().min(0.1).max(1).default(0.55),
  /** Wall climbing speed (m/s). */
  climbSpeed: z.number().min(0.2).max(10).default(1.4),
  /** Falls up to this height (m) do no damage. */
  safeFall: z.number().min(0).max(20).default(2.5),
  /** Dash target choice: nearer by this many m² for shooters / for units on walls. */
  dashRangedPriority: z.number().min(0).max(1000).default(60),
  dashWallPriority: z.number().min(0).max(1000).default(120),
  /** Bot castles: budget shares of walls and towers, largest enclosure half size (cells from the keep). */
  botWallShare: z.number().min(0).max(1).default(0.35),
  botTowerShare: z.number().min(0).max(1).default(0.28),
  botCastleHalf: z.number().int().min(2).max(20).default(6),
});

export const settingsSchema = z.object({
  maxUnitsPerSide: z.number().int().min(1).max(500).default(150),
  /** Seconds; at the end a battle is a draw, a siege is won by the defenders. */
  battleTimeLimit: z.number().min(30).max(3600).default(600),
  ragdollLimit: z.number().int().min(0).max(400).default(80),
  corpseLimit: z.number().int().min(0).max(3000).default(800),
  gravity: z.number().min(1).max(40).default(9.8),
  /** Speed multiplier of ground units wading through water. */
  waterSlow: z.number().min(0.1).max(1).default(0.55),
  friendlyFire: z.boolean().default(true),
  /** Camera shake from big blasts (lightning, meteors). */
  cameraShake: z.boolean().default(true),
  deathParticleId: refOrNull,
  splashParticleId: refOrNull,
  landParticleId: refOrNull,
  /** Flames on burning units. */
  burnParticleId: refOrNull,
  damageMatrix: z.object(Object.fromEntries(DAMAGE_TYPES.map((d) => [d, armorRow])) as Record<DamageType, typeof armorRow>),
  /** Reward boxes and star upgrades. */
  economy: economySchema.default(() => economySchema.parse({})),
  siege: siegeSettingsSchema.default(() => siegeSettingsSchema.parse({})),
});

// ---------------------------------------------------------------- bundle

export type Faction = z.infer<typeof factionSchema>;
export type UnitDef = z.infer<typeof unitSchema>;
export type WeaponDef = z.infer<typeof weaponSchema>;
export type ProjectileDef = z.infer<typeof projectileSchema>;
export type ParticleDef = z.infer<typeof particleSchema>;
export type AssetDef = z.infer<typeof assetSchema>;
export type MapDef = z.infer<typeof mapSchema>;
export type BotDef = z.infer<typeof botSchema>;
export type Settings = z.infer<typeof settingsSchema>;
export type Economy = Settings['economy'];
export type SiegeSettings = Settings['siege'];
export type BoxConfig = Economy['dailyBox'];
export type ChestVariant = (typeof CHEST_VARIANTS)[number];

export const COLLECTIONS = ['factions', 'units', 'weapons', 'projectiles', 'particles', 'assets', 'maps', 'bots'] as const;
export type CollectionName = (typeof COLLECTIONS)[number];

export const COLLECTION_SCHEMAS = {
  factions: factionSchema,
  units: unitSchema,
  weapons: weaponSchema,
  projectiles: projectileSchema,
  particles: particleSchema,
  assets: assetSchema,
  maps: mapSchema,
  bots: botSchema,
} satisfies Record<CollectionName, z.ZodType>;

export interface CollectionDocs {
  factions: Faction;
  units: UnitDef;
  weapons: WeaponDef;
  projectiles: ProjectileDef;
  particles: ParticleDef;
  assets: AssetDef;
  maps: MapDef;
  bots: BotDef;
}

export type ContentBundle = { [K in CollectionName]: CollectionDocs[K][] } & { settings: Settings };

export interface ConfigBundle extends ContentBundle {
  /** Content hash; online peers must simulate with identical content. */
  version: string;
}

export function isCollection(value: string): value is CollectionName {
  return (COLLECTIONS as readonly string[]).includes(value);
}

export function parseAssetParams<K extends AssetKind>(kind: K, params: AssetDef['params']): z.infer<(typeof ASSET_PARAM_SCHEMAS)[K]> {
  const result = ASSET_PARAM_SCHEMAS[kind].safeParse(params);
  return (result.success ? result.data : ASSET_PARAM_SCHEMAS[kind].parse({})) as z.infer<(typeof ASSET_PARAM_SCHEMAS)[K]>;
}
