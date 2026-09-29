// KayKit Medieval Hexagon models the diorama map uses. scripts/build-kaykit-glb.ts packs exactly
// these (from assets/kaykit-hex/) into one public/models/kaykit-hex.glb, one node per name.
import type { Side } from '../sim/terrain';

export const TREES = ['tree_single_A', 'tree_single_B', 'trees_A_small', 'trees_B_small'];
export const ROCKS = ['rock_single_A', 'rock_single_B', 'rock_single_C', 'rock_single_D', 'rock_single_E'];
export const MOUNTAINS = ['mountain_A', 'mountain_B', 'mountain_C', 'mountain_A_grass_trees', 'mountain_B_grass', 'mountain_C_grass_trees'];
export const FORESTS = ['trees_A_large', 'trees_B_large', 'trees_A_medium', 'trees_B_medium', 'hills_A_trees', 'hills_C_trees'];
export const TILES = ['hex_grass', 'hex_water'];
const SIDES: readonly Side[] = ['blue', 'red', 'green', 'yellow'];
export const castleModel = (side: Side) => `building_castle_${side}`;
export const towerModel = (side: Side) => `building_tower_A_${side}`;

export const KAYKIT_MODELS = [...TILES, ...TREES, ...ROCKS, ...MOUNTAINS, ...FORESTS, ...SIDES.flatMap((s) => [castleModel(s), towerModel(s)])];

/** Source .gltf of a model, relative to assets/kaykit-hex/. */
export function kaykitSource(name: string): string {
  if (name.startsWith('hex_')) return `tiles/base/${name}.gltf`;
  if (name.startsWith('building_')) return `buildings/${name.split('_').pop()}/${name}.gltf`;
  return `decoration/nature/${name}.gltf`;
}
