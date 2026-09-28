import assert from 'node:assert/strict';
import test from 'node:test';
import { COLLECTIONS } from '@/shared/schema';
import { SEED } from '@/shared/seed';
import { getBundle, getDoc, parseDoc, toFirestore } from './content';

test('barracks replaces stale uploaded URLs with its bundled GLB while preserving scale', () => {
  const asset = SEED.assets.find((a) => a.id === 'm-barracks')!;
  const old = { ...asset, scale: 3.75, glb: { ...asset.glb!, url: '/uploads/models/m-barracks-1789451587792.glb' } };
  const migrated = parseDoc('assets', asset.id, old)!;
  assert.equal(migrated.glb?.url, '/models/nha-linh.glb');
  assert.equal(migrated.scale, 3.75);
  assert.equal(parseDoc('assets', asset.id, { ...old, glb: null })?.glb?.url, '/models/nha-linh.glb');
});

test('persisted flyer without a GLB upgrades to a visible flying stingray', () => {
  const asset = SEED.assets.find((a) => a.id === 'm-eagle')!;
  const unit = SEED.units.find((u) => u.id === 'eagle')!;
  const oldAsset = { ...asset, name: 'Đại bàng', glb: null, params: { beak: '#f2b01e' } };
  const migrated = parseDoc('assets', asset.id, oldAsset)!;
  assert.equal(migrated.name, 'Cá đuối bay');
  assert.equal(migrated.glb?.url, '/models/ca-duoi-bay.glb');
  assert.deepEqual(migrated.params, {});
  const migratedUnit = parseDoc('units', unit.id, { ...unit, name: 'Đại bàng', description: 'Bay, bổ nhào xuống cào.' })!;
  assert.equal(migratedUnit.name, 'Cá đuối bay');
  assert.equal(migratedUnit.modelId, migrated.id);
  assert.equal(migratedUnit.flying, true);
  assert.equal(migratedUnit.hp, unit.hp);
  assert.deepEqual(parseDoc('assets', migrated.id, migrated), migrated);
  assert.equal(oldAsset.glb, null);
});

/** Firestore rejects an array whose element is itself an array. */
function nestedArrayPath(value: unknown, path = ''): string | null {
  if (Array.isArray(value)) {
    for (const [i, v] of value.entries()) {
      if (Array.isArray(v)) return `${path}[${i}]`;
      const found = nestedArrayPath(v, `${path}[${i}]`);
      if (found) return found;
    }
  } else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      const found = nestedArrayPath(v, `${path}.${k}`);
      if (found) return found;
    }
  }
  return null;
}

test('every CMS document round-trips through its Firestore encoding', () => {
  for (const c of COLLECTIONS) {
    for (const doc of SEED[c]) {
      const data = toFirestore(c, doc);
      assert.equal(nestedArrayPath(data), null, `${c}/${doc.id} has an array nested in an array`);
      assert.deepEqual(parseDoc(c, doc.id, data), doc, `${c}/${doc.id}`);
    }
  }
});

test('hand-edited documents get defaults, invalid ones are dropped', () => {
  const { flying: _flying, blockChance: _blockChance, ...partial } = SEED.units[0];
  assert.deepEqual(parseDoc('units', SEED.units[0].id, partial), SEED.units[0]);
  const error = console.error;
  console.error = () => {};
  try {
    assert.equal(parseDoc('units', 'bad', { ...partial, cost: 'free' }), null);
  } finally {
    console.error = error;
  }
});

test('units saved with the old starCards default read at the new scale', () => {
  const base = JSON.parse(JSON.stringify(SEED.units[0])) as Record<string, unknown>;
  delete base.id;
  const old = parseDoc('units', 'old-scale', { ...base, starCards: [100, 200, 300, 400, 500] });
  assert.deepEqual(old?.starCards, [10, 20, 30, 40, 50]);
});

test('units saved with the old starCoins default read at the new scale (/100)', () => {
  const base = JSON.parse(JSON.stringify(SEED.units[0])) as Record<string, unknown>;
  delete base.id;
  const old = parseDoc('units', 'old-coins', { ...base, starCoins: [1000, 2000, 4000, 8000, 16000] });
  assert.deepEqual(old?.starCoins, [10, 20, 40, 80, 160]);
});


test('hot-reloaded content migrates cached eagle records and restores a missing model', async () => {
  const globalStore = globalThis as unknown as { __battleContent?: unknown };
  const previous = globalStore.__battleContent;
  const unit = SEED.units.find((u) => u.id === 'eagle')!;
  const asset = SEED.assets.find((a) => a.id === 'm-eagle')!;
  const docs = Object.fromEntries(COLLECTIONS.map((c) => [c, new Map<string, unknown>()]));
  docs.units.set(unit.id, { ...unit, name: 'Giant Eagle', hp: 1000 });
  docs.assets.set(asset.id, { ...asset, name: 'Giant Eagle', glb: null });
  globalStore.__battleContent = { docs, settings: SEED.settings, loaded: true, failures: 0, ready: Promise.resolve() };
  try {
    assert.equal((await getDoc('units', unit.id))?.name, 'Cá đuối bay');
    assert.equal((await getDoc('assets', asset.id))?.glb?.url, '/models/ca-duoi-bay.glb');
    const migrated = await getBundle();
    assert.equal(migrated.units[0].name, 'Cá đuối bay');
    assert.equal(migrated.assets[0].glb?.url, '/models/ca-duoi-bay.glb');
    docs.assets.clear();
    const repaired = await getBundle();
    assert.equal(repaired.units[0].hp, 1000);
    assert.equal(repaired.assets.find((a) => a.id === repaired.units[0].modelId)?.glb?.url, '/models/ca-duoi-bay.glb');
    assert.deepEqual(repaired.assets, migrated.assets);
    assert.equal(repaired.version, (await getBundle()).version);
    docs.units.clear();
    assert.equal((await getBundle()).assets.length, 0, 'do not restore assets for an absent unit');
  } finally {
    globalStore.__battleContent = previous;
  }
});
