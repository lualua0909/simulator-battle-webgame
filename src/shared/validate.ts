// Cross-document reference integrity for CMS content.
import {
  UNIT_ASSET_KINDS,
  type AssetKind,
  type CollectionName,
  type ContentBundle,
} from './schema';

type Source = CollectionName | 'settings';

interface RefRule {
  from: Source;
  /** Dot path; arrays of ids are supported. */
  field: string;
  to: CollectionName;
  kinds?: readonly AssetKind[];
  /** Must be non-null when this predicate holds. */
  requiredWhen?: (doc: Record<string, unknown>) => boolean;
}

const RULES: RefRule[] = [
  { from: 'units', field: 'factionId', to: 'factions', requiredWhen: () => true },
  { from: 'units', field: 'weaponId', to: 'weapons', requiredWhen: () => true },
  { from: 'units', field: 'skillIds', to: 'weapons' },
  { from: 'units', field: 'modelId', to: 'assets', kinds: UNIT_ASSET_KINDS, requiredWhen: () => true },
  { from: 'units', field: 'riderModelId', to: 'assets', kinds: ['humanoid'] },
  { from: 'units', field: 'spawnUnitId', to: 'units' },
  { from: 'weapons', field: 'projectileId', to: 'projectiles', requiredWhen: (d) => d.attack === 'projectile' },
  { from: 'weapons', field: 'hitParticleId', to: 'particles' },
  { from: 'weapons', field: 'fireParticleId', to: 'particles' },
  { from: 'weapons', field: 'areaParticleId', to: 'particles' },
  { from: 'projectiles', field: 'trailParticleId', to: 'particles' },
  { from: 'projectiles', field: 'impactParticleId', to: 'particles' },
  { from: 'maps', field: 'trees.kinds', to: 'assets', kinds: ['tree'] },
  { from: 'maps', field: 'rocks.kinds', to: 'assets', kinds: ['rock'] },
  { from: 'maps', field: 'bushes.kinds', to: 'assets', kinds: ['bush'] },
  { from: 'bots', field: 'factionIds', to: 'factions' },
  { from: 'settings', field: 'deathParticleId', to: 'particles' },
  { from: 'settings', field: 'splashParticleId', to: 'particles' },
  { from: 'settings', field: 'landParticleId', to: 'particles' },
  { from: 'settings', field: 'burnParticleId', to: 'particles' },
];

export interface RefIssue {
  source: Source;
  id: string;
  field: string;
  message: string;
}

function getPath(doc: unknown, path: string): unknown {
  let cur: unknown = doc;
  for (const key of path.split('.')) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[key];
  }
  return cur;
}

function docsOf(bundle: ContentBundle, source: Source): Array<Record<string, unknown> & { id: string }> {
  if (source === 'settings') return [{ id: 'global', ...(bundle.settings as unknown as Record<string, unknown>) }];
  return bundle[source] as unknown as Array<Record<string, unknown> & { id: string }>;
}

export function findRefIssues(bundle: ContentBundle): RefIssue[] {
  const issues: RefIssue[] = [];
  for (const rule of RULES) {
    const targets = new Map<string, Record<string, unknown>>(
      (bundle[rule.to] as unknown as Array<Record<string, unknown> & { id: string }>).map((d) => [d.id, d]),
    );
    for (const doc of docsOf(bundle, rule.from)) {
      const value = getPath(doc, rule.field);
      const ids = Array.isArray(value) ? value : value == null || value === '' ? [] : [value];
      if (ids.length === 0 && rule.requiredWhen?.(doc)) {
        issues.push({ source: rule.from, id: doc.id, field: rule.field, message: `${rule.field} là bắt buộc` });
      }
      for (const ref of ids) {
        const target = targets.get(String(ref));
        if (!target) {
          issues.push({ source: rule.from, id: doc.id, field: rule.field, message: `${rule.field}: "${String(ref)}" không tồn tại trong ${rule.to}` });
        } else if (rule.kinds && !rule.kinds.includes(target.kind as AssetKind)) {
          issues.push({
            source: rule.from,
            id: doc.id,
            field: rule.field,
            message: `${rule.field}: "${String(ref)}" phải là asset loại ${rule.kinds.join('/')}`,
          });
        }
      }
    }
  }
  const factionCount = bundle.factions.length;
  if (factionCount === 0) issues.push({ source: 'factions', id: '-', field: '-', message: 'Cần ít nhất 1 phe' });
  if (bundle.maps.length === 0) issues.push({ source: 'maps', id: '-', field: '-', message: 'Cần ít nhất 1 bản đồ' });
  return issues;
}

/** Documents that reference `collection/id` (blocks deletes that would dangle). */
export function findDependents(bundle: ContentBundle, collection: CollectionName, id: string): string[] {
  const out: string[] = [];
  for (const rule of RULES) {
    if (rule.to !== collection) continue;
    for (const doc of docsOf(bundle, rule.from)) {
      const value = getPath(doc, rule.field);
      const ids = Array.isArray(value) ? value : [value];
      if (ids.includes(id)) out.push(`${rule.from}/${doc.id} (${rule.field})`);
    }
  }
  return out;
}
