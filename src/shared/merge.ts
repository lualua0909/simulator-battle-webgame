// Brings built-in default content that a live database lacks (e.g. skills and units added by an
// update) into it, without changing or deleting the documents the admins already have.
import { COLLECTIONS, type CollectionName, type ContentBundle, type UnitDef } from './schema';
import { findRefIssues } from './validate';

export interface MissingDefaults {
  /** Default documents whose id is not in the database. */
  docs: Array<{ collection: CollectionName; id: string; name: string }>;
  /** Default units in the database that have no skills while the default version has some. */
  unskilled: Array<{ id: string; name: string; skillIds: string[] }>;
  /** Default units in the database without shop prices (from before the player collection) while the default version has them. */
  unpriced: Array<{ id: string; name: string }>;
  /** Settings references that are empty but set by default. */
  settings: string[];
}

export interface MergePick {
  /** "collection/id" of the default documents to add. */
  docs: string[];
  /** Give default skills to `unskilled` units. */
  skills: boolean;
  /** Give default unlock / card / star prices to `unpriced` units. */
  prices: boolean;
}

export interface MergeResult {
  content: ContentBundle;
  added: Array<{ collection: CollectionName; id: string }>;
  /** Picked documents left out because a reference would not resolve (e.g. a deleted faction). */
  skipped: string[];
  skilled: string[];
  priced: string[];
  settings: boolean;
}

const SETTINGS_REFS = ['burnParticleId'] as const;

const unpriced = (unit: UnitDef) => unit.unlockCost === 0 && unit.cardPrice === 0;

export function missingDefaults(current: ContentBundle, defaults: ContentBundle): MissingDefaults {
  const docs: MissingDefaults['docs'] = [];
  for (const c of COLLECTIONS) {
    const have = new Set(current[c].map((d) => d.id));
    for (const d of defaults[c]) if (!have.has(d.id)) docs.push({ collection: c, id: d.id, name: d.name });
  }
  const unskilled: MissingDefaults['unskilled'] = [];
  for (const u of current.units) {
    const def = defaults.units.find((d) => d.id === u.id);
    if (u.skillIds.length === 0 && def && def.skillIds.length > 0) unskilled.push({ id: u.id, name: u.name, skillIds: def.skillIds });
  }
  const priced = current.units.filter((u) => {
    const def = defaults.units.find((d) => d.id === u.id);
    return unpriced(u) && def && !unpriced(def);
  });
  const settings = SETTINGS_REFS.filter((k) => !current.settings[k] && defaults.settings[k]);
  return { docs, unskilled, unpriced: priced.map((u) => ({ id: u.id, name: u.name })), settings };
}

export function mergeDefaults(current: ContentBundle, defaults: ContentBundle, pick: MergePick): MergeResult {
  const wanted = new Set(pick.docs);
  const content = { ...current } as ContentBundle;
  const set = <K extends CollectionName>(c: K, docs: ContentBundle[K]) => {
    (content as unknown as Record<string, unknown>)[c] = docs;
  };
  let added: MergeResult['added'] = [];
  for (const c of COLLECTIONS) {
    const have = new Set(current[c].map((d) => d.id));
    const extra = defaults[c].filter((d) => !have.has(d.id) && wanted.has(`${c}/${d.id}`));
    set(c, [...current[c], ...extra] as ContentBundle[typeof c]);
    added.push(...extra.map((d) => ({ collection: c, id: d.id })));
  }
  // Leave out added documents whose references do not resolve; that can cascade, so repeat.
  const skipped: string[] = [];
  for (let pass = 0; pass < COLLECTIONS.length; pass++) {
    const isAdded = new Set(added.map((a) => `${a.collection}/${a.id}`));
    const bad = new Set(findRefIssues(content).map((i) => `${i.source}/${i.id}`).filter((key) => isAdded.has(key)));
    if (bad.size === 0) break;
    for (const c of COLLECTIONS) set(c, content[c].filter((d) => !bad.has(`${c}/${d.id}`)) as ContentBundle[typeof c]);
    added = added.filter((a) => !bad.has(`${a.collection}/${a.id}`));
    skipped.push(...bad);
  }
  const weapons = new Set(content.weapons.map((w) => w.id));
  const skilled: string[] = [];
  if (pick.skills) {
    set(
      'units',
      content.units.map((u) => {
        const def = defaults.units.find((d) => d.id === u.id);
        if (u.skillIds.length > 0 || !def || added.some((a) => a.collection === 'units' && a.id === u.id)) return u;
        const skillIds = def.skillIds.filter((id) => weapons.has(id));
        if (skillIds.length === 0) return u;
        skilled.push(u.id);
        return { ...u, skillIds };
      }),
    );
  }
  const priced: string[] = [];
  if (pick.prices) {
    set(
      'units',
      content.units.map((u) => {
        const def = defaults.units.find((d) => d.id === u.id);
        if (!unpriced(u) || !def || unpriced(def) || added.some((a) => a.collection === 'units' && a.id === u.id)) return u;
        priced.push(u.id);
        return { ...u, unlockCost: def.unlockCost, cardPrice: def.cardPrice, starCards: def.starCards, starCoins: def.starCoins };
      }),
    );
  }
  let settings = false;
  const particles = new Set(content.particles.map((p) => p.id));
  for (const key of SETTINGS_REFS) {
    const value = defaults.settings[key];
    if (!current.settings[key] && value && particles.has(value)) {
      content.settings = { ...content.settings, [key]: value };
      settings = true;
    }
  }
  return { content, added, skipped, skilled, priced, settings };
}
