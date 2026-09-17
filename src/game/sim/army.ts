// Army placement model + validation, shared by client UI, bot and online server.
import { z } from 'zod';
import { idSchema, type ContentBundle, type Settings, type UnitDef } from '@/shared/schema';
import { wallCenter, wallIndex, type Side, type Terrain } from './terrain';

export type { Side };

export const placementSchema = z.object({
  unitId: idSchema,
  x: z.number(),
  z: z.number(),
});

export type Placement = z.infer<typeof placementSchema>;
export type Armies = Record<Side, Placement[]>;

/** Builds a full 4-side army record, defaulting unfielded sides to empty. */
export function armies(sides: Partial<Armies>): Armies {
  return { blue: [], red: [], green: [], yellow: [], ...sides };
}

/** Units plus wall blocks (a 3-tier wall is 3 placements per cell). */
export const armySchema = z.array(placementSchema).max(1000);

export function armyCost(bundle: Pick<ContentBundle, 'units'>, army: readonly Placement[]): number {
  const costs = new Map(bundle.units.map((u) => [u.id, u.cost]));
  let total = 0;
  for (const p of army) total += costs.get(p.unitId) ?? 0;
  return total;
}

export const otherSide = (side: Side): Side => (side === 'blue' ? 'red' : 'blue');

/** Budget of one side: siege mode scales the base budget per role. */
export function sideBudget(settings: Pick<Settings, 'siege'>, base: number, side: Side, defense: Side | null): number {
  if (!defense) return base;
  return Math.round(base * (side === defense ? settings.siege.defenseBudget : settings.siege.attackBudget));
}

/** Grid structures (walls, watchtowers) occupy whole 2 m cells. */
export const isGridStructure = (u: Pick<UnitDef, 'structure'>): boolean => u.structure === 'wall' || u.structure === 'platform';

/** Whether a unit may be fielded by `side` in this mode (open battles have no structures). */
export function canField(u: Pick<UnitDef, 'structure' | 'siegeSide'>, side: Side, defense: Side | null): boolean {
  if (!defense) return u.structure === 'none';
  return u.siegeSide === 'any' || u.siegeSide === (side === defense ? 'defense' : 'attack');
}

export const cellKeyOf = (x: number, z: number): string => `${wallIndex(x)},${wallIndex(z)}`;

/** Snaps a point to the centre of its grid cell. */
export function snapToCell(x: number, z: number): { x: number; z: number } {
  return { x: wallCenter(wallIndex(x)), z: wallCenter(wallIndex(z)) };
}

export interface GridCellInfo {
  kind: 'wall' | 'platform';
  unitId: string;
  blocks: number;
  /** Non-structure units standing on the cell. */
  riders: number;
  /** Different grid structures were stacked on the cell. */
  mixed: boolean;
}

/** Grid structures of an army by cell key. */
export function gridCells(units: ReadonlyMap<string, UnitDef>, army: readonly Placement[]): Map<string, GridCellInfo> {
  const cells = new Map<string, GridCellInfo>();
  for (const p of army) {
    const u = units.get(p.unitId);
    if (!u || !isGridStructure(u)) continue;
    const key = cellKeyOf(p.x, p.z);
    const cell = cells.get(key);
    if (cell) {
      cell.blocks++;
      if (cell.unitId !== u.id) cell.mixed = true;
    } else cells.set(key, { kind: u.structure as GridCellInfo['kind'], unitId: u.id, blocks: 1, riders: 0, mixed: false });
  }
  for (const p of army) {
    const u = units.get(p.unitId);
    if (!u || u.structure !== 'none') continue;
    const cell = cells.get(cellKeyOf(p.x, p.z));
    if (cell) cell.riders++;
  }
  return cells;
}

export type ArmyCheck = { ok: true } | { ok: false; error: string };

export function validateArmy(
  bundle: Pick<ContentBundle, 'units' | 'settings'>,
  terrain: Terrain,
  side: Side,
  army: readonly Placement[],
  budget: number,
): ArmyCheck {
  const defense = terrain.defense;
  const siege = bundle.settings.siege;
  const units = new Map(bundle.units.map((u) => [u.id, u]));
  let blocks = 0;
  let cores = 0;
  for (const p of army) {
    const u = units.get(p.unitId);
    if (!u) return { ok: false, error: `Lính không tồn tại: ${p.unitId}` };
    if (!canField(u, side, defense)) return { ok: false, error: `${u.name} không dùng được cho phe này ở chế độ này` };
    if (!terrain.inZone(side, p.x, p.z)) return { ok: false, error: 'Có lính nằm ngoài vùng triển khai' };
    if (u.structure === 'wall') blocks++;
    if (u.structure === 'core') cores++;
    if (isGridStructure(u)) {
      const c = snapToCell(p.x, p.z);
      if (c.x !== p.x || c.z !== p.z) return { ok: false, error: `${u.name} phải đặt đúng ô lưới` };
    }
  }
  if (army.length - blocks > bundle.settings.maxUnitsPerSide) {
    return { ok: false, error: `Quá số lính tối đa (${bundle.settings.maxUnitsPerSide})` };
  }
  if (blocks > siege.maxWallBlocks) return { ok: false, error: `Quá số khối tường tối đa (${siege.maxWallBlocks})` };
  if (defense === side && cores !== 1) return { ok: false, error: 'Phe thủ thành cần đúng 1 Nhà chính' };
  const cells = gridCells(units, army);
  for (const cell of cells.values()) {
    if (cell.mixed) return { ok: false, error: 'Một ô lưới chỉ chứa một loại công trình' };
    if (cell.kind === 'wall' && cell.blocks > siege.maxTiers) return { ok: false, error: `Tường cao tối đa ${siege.maxTiers} tầng` };
    if (cell.kind === 'platform' && cell.blocks > 1) return { ok: false, error: 'Tháp canh không xếp chồng được' };
    if (cell.kind === 'platform' && cell.riders > siege.towerCapacity) return { ok: false, error: `Mỗi tháp canh chứa tối đa ${siege.towerCapacity} lính` };
  }
  for (const p of army) {
    const u = units.get(p.unitId)!;
    if ((u.structure === 'building' || u.structure === 'core') && overlapsGrid(cells, p.x, p.z, u.radius)) {
      return { ok: false, error: `${u.name} không được đè lên tường` };
    }
  }
  const cost = armyCost(bundle, army);
  if (cost > budget) return { ok: false, error: `Vượt ngân sách (${cost}/${budget})` };
  return { ok: true };
}

/** Whether a circle touches any grid structure cell. */
export function overlapsGrid(cells: ReadonlyMap<string, unknown>, x: number, z: number, r: number): boolean {
  for (let ix = wallIndex(x - r); ix <= wallIndex(x + r); ix++) {
    for (let iz = wallIndex(z - r); iz <= wallIndex(z + r); iz++) {
      if (cells.has(`${ix},${iz}`)) return true;
    }
  }
  return false;
}

/** Mirror an army to the opposite side (used by bot/presets). */
export function mirrorArmy(army: readonly Placement[]): Placement[] {
  return army.map((p) => ({ unitId: p.unitId, x: -p.x, z: p.z }));
}
