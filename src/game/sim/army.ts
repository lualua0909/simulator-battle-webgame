// Army placement model + validation, shared by client UI, bot and online server.
import { z } from 'zod';
import { idSchema, type ContentBundle } from '@/shared/schema';
import type { Side, Terrain } from './terrain';

export type { Side };

export const placementSchema = z.object({
  unitId: idSchema,
  x: z.number(),
  z: z.number(),
});

export type Placement = z.infer<typeof placementSchema>;
export type Armies = Record<Side, Placement[]>;

export const armySchema = z.array(placementSchema).max(500);

export function armyCost(bundle: Pick<ContentBundle, 'units'>, army: readonly Placement[]): number {
  const costs = new Map(bundle.units.map((u) => [u.id, u.cost]));
  let total = 0;
  for (const p of army) total += costs.get(p.unitId) ?? 0;
  return total;
}

export type ArmyCheck = { ok: true } | { ok: false; error: string };

export function validateArmy(
  bundle: Pick<ContentBundle, 'units' | 'settings'>,
  terrain: Terrain,
  side: Side,
  army: readonly Placement[],
  budget: number,
): ArmyCheck {
  if (army.length > bundle.settings.maxUnitsPerSide) {
    return { ok: false, error: `Quá số lính tối đa (${bundle.settings.maxUnitsPerSide})` };
  }
  const ids = new Set(bundle.units.map((u) => u.id));
  for (const p of army) {
    if (!ids.has(p.unitId)) return { ok: false, error: `Lính không tồn tại: ${p.unitId}` };
    if (!terrain.inZone(side, p.x, p.z)) return { ok: false, error: 'Có lính nằm ngoài vùng triển khai' };
  }
  const cost = armyCost(bundle, army);
  if (cost > budget) return { ok: false, error: `Vượt ngân sách (${cost}/${budget})` };
  return { ok: true };
}

/** Mirror an army to the opposite side (used by bot/presets). */
export function mirrorArmy(army: readonly Placement[]): Placement[] {
  return army.map((p) => ({ unitId: p.unitId, x: -p.x, z: p.z }));
}
