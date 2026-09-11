// Game content schema — single source of truth for the CMS (validation + forms),
// the simulation (types) and the online server (army validation).
import { z } from 'zod';

export const DAMAGE_TYPES = ['blunt', 'slash', 'pierce', 'fire', 'magic'] as const;
export const ARMOR_CLASSES = ['unarmored', 'light', 'heavy', 'beast', 'siege'] as const;
export const ROLES = ['melee', 'ranged', 'support', 'siege'] as const;
export const ATTACK_KINDS = ['melee', 'projectile', 'breath', 'heal'] as const;
export const UNIT_ASSET_KINDS = ['humanoid', 'horse', 'elephant', 'dragon', 'bird', 'catapult'] as const;
export const ENV_ASSET_KINDS = ['tree', 'rock', 'bush'] as const;
export const ASSET_KINDS = [...UNIT_ASSET_KINDS, ...ENV_ASSET_KINDS] as const;
export const PROJECTILE_MODELS = ['arrow', 'spear', 'stone', 'boulder', 'fireball', 'orb'] as const;
export const PARTICLE_SHAPES = ['cube', 'tetra', 'sphere'] as const;
export const PARTICLE_DIRECTIONS = ['up', 'sphere', 'hemisphere', 'forward'] as const;
export const BOT_STRATEGIES = ['balanced', 'rush', 'ranged', 'tank', 'swarm', 'elite', 'counter'] as const;
export const FORMATIONS = ['line', 'wedge', 'flanks', 'blob', 'scatter'] as const;

export type DamageType = (typeof DAMAGE_TYPES)[number];
export type ArmorClass = (typeof ARMOR_CLASSES)[number];
export type Role = (typeof ROLES)[number];
export type AssetKind = (typeof ASSET_KINDS)[number];
export type UnitAssetKind = (typeof UNIT_ASSET_KINDS)[number];

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
  modelId: idSchema,
  riderModelId: refOrNull,
  flying: z.boolean().default(false),
  altitude: z.number().min(0).max(40).default(0),
  blockChance: z.number().min(0).max(0.95).default(0),
  chargeBonus: z.number().min(1).max(5).default(1),
  knockbackResist: z.number().min(0).max(1).default(0),
  trampleDamage: z.number().min(0).max(2000).default(0),
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
    .enum(['none', 'cap', 'helmet', 'greathelm', 'horned', 'crown', 'hood', 'wizard', 'headband', 'strawhat'])
    .default('none'),
  headColor: hex.default('#8a8f96'),
  hair: z.enum(['none', 'short', 'long', 'mohawk', 'topknot']).default('short'),
  hairColor: hex.default('#3b2616'),
  beard: z.enum(['none', 'short', 'long']).default('none'),
  brows: z.enum(['none', 'angry', 'worried']).default('angry'),
  cape: z.boolean().default(false),
  capeColor: hex.default('#b3262e'),
  weapon: z
    .enum(['none', 'club', 'bigclub', 'sword', 'greatsword', 'axe', 'spear', 'lance', 'hammer', 'bow', 'staff', 'pitchfork', 'stone'])
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

export const catapultParamsSchema = z.object({
  wood: hex.default('#8a5a2b'),
  metal: hex.default('#5d636b'),
  rope: hex.default('#d8c28a'),
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
  catapult: catapultParamsSchema,
  tree: treeParamsSchema,
  rock: rockParamsSchema,
  bush: bushParamsSchema,
} satisfies Record<AssetKind, z.ZodType>;

export type HumanoidParams = z.infer<typeof humanoidParamsSchema>;
export type HorseParams = z.infer<typeof horseParamsSchema>;
export type ElephantParams = z.infer<typeof elephantParamsSchema>;
export type DragonParams = z.infer<typeof dragonParamsSchema>;
export type BirdParams = z.infer<typeof birdParamsSchema>;
export type CatapultParams = z.infer<typeof catapultParamsSchema>;
export type TreeParams = z.infer<typeof treeParamsSchema>;
export type RockParams = z.infer<typeof rockParamsSchema>;
export type BushParams = z.infer<typeof bushParamsSchema>;

export const assetSchema = z
  .object({
    id: idSchema,
    name,
    kind: z.enum(ASSET_KINDS),
    scale: z.number().min(0.1).max(10).default(1),
    seed: z.number().int().min(0).max(1_000_000).default(1),
    params: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).default({}),
  })
  .superRefine((asset, ctx) => {
    const result = ASSET_PARAM_SCHEMAS[asset.kind].safeParse(asset.params);
    if (!result.success) {
      for (const issue of result.error.issues) {
        ctx.addIssue({ code: 'custom', message: issue.message, path: ['params', ...issue.path.map(String)] });
      }
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
  }),
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

export const settingsSchema = z.object({
  maxUnitsPerSide: z.number().int().min(1).max(500).default(150),
  battleTimeLimit: z.number().min(30).max(1800).default(300),
  ragdollLimit: z.number().int().min(0).max(400).default(80),
  corpseLimit: z.number().int().min(0).max(3000).default(800),
  gravity: z.number().min(1).max(40).default(9.8),
  friendlyFire: z.boolean().default(true),
  deathParticleId: refOrNull,
  splashParticleId: refOrNull,
  landParticleId: refOrNull,
  damageMatrix: z.object(Object.fromEntries(DAMAGE_TYPES.map((d) => [d, armorRow])) as Record<DamageType, typeof armorRow>),
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
