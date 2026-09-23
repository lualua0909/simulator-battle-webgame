// Siege defence layouts for bots (and the "random" button of a defending player): a keep,
// a wall enclosure from a few templates fitted to the defenders' zone, towers at the
// corners, a watchtower on the front wall, shooters on the walls and a garrison inside.
import type { BotDef, ContentBundle, UnitDef } from '@/shared/schema';
import { canField, type Placement } from '../sim/army';
import { Rng, clamp } from '../sim/rng';
import { WALL_CELL, wallCenter, wallIndex, type Side, type Terrain } from '../sim/terrain';
import { generateBotArmy } from './generate';

type Content = Pick<ContentBundle, 'units' | 'weapons' | 'settings'>;

export const SIEGE_LAYOUTS = ['ring', 'front', 'double'] as const;
export type SiegeLayout = (typeof SIEGE_LAYOUTS)[number];

export interface SiegeDefenseOptions {
  bot: BotDef;
  content: Content;
  terrain: Terrain;
  side: Side;
  budget: number;
  seed: number;
  layout?: SiegeLayout;
}

export function generateSiegeDefense(opts: SiegeDefenseOptions): Placement[] {
  const { content, terrain, side, budget } = opts;
  const rng = new Rng(opts.seed);
  const siege = content.settings.siege;
  const usable = content.units.filter((u) => canField(u, side, side));
  const out: Placement[] = [];
  let left = budget;
  const buy = (u: UnitDef | undefined, x: number, z: number): boolean => {
    if (!u || u.cost > left) return false;
    out.push({ unitId: u.id, x, z });
    left -= u.cost;
    return true;
  };

  const zone = terrain.zoneOf(side);
  const front = side === 'blue' ? 1 : -1; // toward the attackers along x
  const depth = zone.x1 - zone.x0;
  const width = zone.z1 - zone.z0;
  // Enclosure half size in cells, fitted to the zone.
  const half = clamp(Math.floor((Math.min(depth, width) - 8) / (2 * WALL_CELL)), 2, Math.max(2, siege.botCastleHalf));
  const backX = side === 'blue' ? zone.x0 : zone.x1;
  const cx = wallIndex(backX + front * (half * WALL_CELL + 4));
  const cz = wallIndex(clamp(rng.range(-width * 0.15, width * 0.15), zone.z0 + half * WALL_CELL + 2, zone.z1 - half * WALL_CELL - 2));
  const center = { x: wallCenter(cx), z: wallCenter(cz) };

  const core = usable.find((u) => u.structure === 'core');
  if (!core) return [];
  out.push({ unitId: core.id, x: center.x, z: center.z });
  left -= core.cost;

  const wall = usable.filter((u) => u.structure === 'wall').sort((a, b) => a.cost - b.cost)[0];
  const platform = usable.filter((u) => u.structure === 'platform').sort((a, b) => a.cost - b.cost)[0];
  const towers = usable.filter((u) => u.structure === 'building' && !u.spawnUnitId && u.weaponId !== 'none').sort((a, b) => a.cost - b.cost);
  const barracks = usable.find((u) => u.structure === 'building' && u.spawnUnitId);
  // Wall garrison: only units that can hit the ground below from up there (not short-range breath etc.).
  const shoots = (u: UnitDef) => ['projectile', 'strike', 'chain'].includes(content.weapons.find((w) => w.id === u.weaponId)?.attack ?? '');
  const shooters = usable.filter((u) => u.structure === 'none' && u.role === 'ranged' && shoots(u) && !u.flying && u.radius <= 0.6).sort((a, b) => a.cost - b.cost);

  // ---- wall cells of the chosen template (relative cell offsets; +dx = toward the front)
  const layout = opts.layout ?? SIEGE_LAYOUTS[rng.int(SIEGE_LAYOUTS.length)];
  const cells: Array<[number, number]> = [];
  const ring = (h: number) => {
    for (let i = -h; i <= h; i++) cells.push([h, i], [-h, i]);
    for (let i = -h + 1; i <= h - 1; i++) cells.push([i, h], [i, -h]);
  };
  if (layout === 'ring') ring(half);
  else if (layout === 'double') {
    ring(half);
    for (let i = -half - 2; i <= half + 2; i++) if (half + 2 <= Math.floor(depth / WALL_CELL) - 1) cells.push([half + 2, i]);
  } else {
    // Front wall with wings bending back.
    for (let i = -half - 1; i <= half + 1; i++) cells.push([half, i]);
    for (let d = 1; d <= half; d++) cells.push([half - d, -half - 1], [half - d, half + 1]);
  }
  const toWorld = ([dx, dz]: [number, number]) => ({ x: wallCenter(cx + dx * front), z: wallCenter(cz + dz) });
  const inZone = (p: { x: number; z: number }) => terrain.inZone(side, p.x, p.z);
  const wallCells = cells.map((c) => ({ ...toWorld(c), front: c[0] === half })).filter(inZone);

  // ---- budget shares: walls, towers, garrison
  const wallBudget = left * siege.botWallShare;
  const tiers = wall ? clamp(Math.floor(wallBudget / Math.max(1, wallCells.length * wall.cost)), 1, siege.maxTiers) : 0;
  const frontCells = wallCells.filter((p) => p.front);
  const watch = platform && frontCells.length > 2 ? frontCells[Math.floor(frontCells.length / 2)] : null;
  let blocks = 0;
  for (const p of wallCells) {
    if (watch && p.x === watch.x && p.z === watch.z) continue;
    for (let t = 0; t < tiers && blocks < siege.maxWallBlocks; t++, blocks++) if (!buy(wall, p.x, p.z)) break;
  }
  if (watch && buy(platform, watch.x, watch.z)) {
    for (let k = 0; k < siege.towerCapacity; k++) buy(shooters[rng.int(Math.max(1, shooters.length))], watch.x, watch.z);
  }

  // Towers just inside the corners, the stronger ones in front.
  const towerBudget = budget * siege.botTowerShare;
  let towerSpent = 0;
  const inset = (half - 2) * WALL_CELL;
  const corners = [
    [inset, -inset],
    [inset, inset],
    [-inset, -inset],
    [-inset, inset],
  ];
  for (const [dx, dz] of corners) {
    const affordable = towers.filter((t) => t.cost <= Math.min(left, towerBudget - towerSpent));
    // Smaller enclosures have no room beside the keep.
    if (affordable.length === 0 || half < 5) break;
    const pick = affordable[Math.min(affordable.length - 1, Math.floor(rng.next() * affordable.length))];
    const x = center.x + dx * front;
    const z = center.z + dz;
    if (!inZone({ x, z })) continue;
    if (buy(pick, x, z)) towerSpent += pick.cost;
  }
  if (barracks && half >= 5 && left > budget * 0.35) buy(barracks, center.x - front * inset, center.z);

  // Shooters on the front and side walls, one every other cell.
  const wallSet = wallCells.filter((p) => !watch || p.x !== watch.x || p.z !== watch.z);
  const onWall = Math.floor(left * 0.35);
  let spentOnWall = 0;
  if (tiers > 0) {
    for (let i = 0; i < wallSet.length && shooters.length > 0; i += 2) {
      const u = shooters[Math.min(shooters.length - 1, rng.int(Math.min(3, shooters.length)))];
      if (spentOnWall + u.cost > onWall) break;
      if (buy(u, wallSet[i].x, wallSet[i].z)) spentOnWall += u.cost;
    }
  }

  // Garrison inside the walls, from the bot's usual composition.
  const garrison = generateBotArmy({ bot: opts.bot, content: { ...content, units: usable.filter((u) => u.structure === 'none') }, terrain, side, budget: left, seed: opts.seed + 1 });
  const taken = new Set(out.filter((p) => content.units.find((u) => u.id === p.unitId)?.structure !== 'none').map((p) => `${wallIndex(p.x)},${wallIndex(p.z)}`));
  const interior = Math.max(1, half - 1) * WALL_CELL;
  for (const g of garrison) {
    const u = content.units.find((d) => d.id === g.unitId)!;
    if (u.cost > left) continue;
    for (let attempt = 0; attempt < 12; attempt++) {
      const x = center.x + rng.range(-interior, interior);
      const z = center.z + rng.range(-interior, interior);
      // Keep clear of the keep, towers and wall cells.
      if (Math.abs(x - center.x) < core.radius + 1.5 && Math.abs(z - center.z) < core.radius + 1.5) continue;
      if (!inZone({ x, z }) || nearGrid(taken, x, z, u.radius + 1.6)) continue;
      if (out.some((p) => (p.x - x) ** 2 + (p.z - z) ** 2 < 2.2 && content.units.find((d) => d.id === p.unitId)?.structure === 'building')) continue;
      buy(u, x, z);
      break;
    }
  }
  return out;
}

function nearGrid(taken: ReadonlySet<string>, x: number, z: number, r: number): boolean {
  for (let ix = wallIndex(x - r); ix <= wallIndex(x + r); ix++) for (let iz = wallIndex(z - r); iz <= wallIndex(z + r); iz++) if (taken.has(`${ix},${iz}`)) return true;
  return false;
}
