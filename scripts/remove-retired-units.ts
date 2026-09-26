import { loadEnvConfig } from '@next/env';

const unitIds = new Set(['knight', 'king', 'protector', 'thap-canh']);
const assetIds = new Set(['m-knight', 'm-king', 'm-protector', 'm-watchtower']);
const weaponIds = new Set(['knight-sword', 'greatsword', 'small-club']);

async function main() {
  loadEnvConfig(process.cwd());
  const { firestore } = await import('../src/server/firebase');
  const db = firestore();
  await db.runTransaction(async (tx) => {
    const units = await tx.get(db.collection('units'));
    for (const doc of units.docs) {
      if (unitIds.has(doc.id)) continue;
      const unit = doc.data();
      if (assetIds.has(unit.modelId) || assetIds.has(unit.riderModelId) || weaponIds.has(unit.weaponId) || unit.skillIds?.some((id: string) => weaponIds.has(id))) {
        throw new Error(`Shared dependency still used by ${doc.id}`);
      }
      if (unitIds.has(unit.spawnUnitId)) tx.update(doc.ref, { spawnUnitId: null });
    }
    for (const id of unitIds) tx.delete(db.collection('units').doc(id));
    for (const id of assetIds) tx.delete(db.collection('assets').doc(id));
    for (const id of weaponIds) tx.delete(db.collection('weapons').doc(id));
  });
  // Remove obsolete inventory keys without touching currency or historical ledgers.
  const { FieldValue } = await import('firebase-admin/firestore');
  const players = await db.collection('players').get();
  let cleaned = 0;
  for (const doc of players.docs) {
    const p = doc.data();
    const patch: Record<string, unknown> = {};
    if (p.unlocked?.some((id: string) => unitIds.has(id))) patch.unlocked = FieldValue.arrayRemove(...unitIds);
    for (const field of ['cards', 'stars']) {
      for (const id of unitIds) {
        if (p[field] && Object.hasOwn(p[field], id)) patch[`${field}.${id}`] = FieldValue.delete();
      }
    }
    if (Object.keys(patch).length) {
      await doc.ref.update(patch);
      cleaned++;
    }
  }
  console.log(`Removed 4 units, 4 assets, 3 exclusive weapons; cleaned ${cleaned} inventories.`);
}

main().then(() => process.exit(0), (error) => {
  console.error(error);
  process.exit(1);
});
