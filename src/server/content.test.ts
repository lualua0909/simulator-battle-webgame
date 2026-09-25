import assert from 'node:assert/strict';
import test from 'node:test';
import { COLLECTIONS } from '@/shared/schema';
import { SEED } from '@/shared/seed';
import { parseDoc, toFirestore } from './content';

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
