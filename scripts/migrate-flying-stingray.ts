// Persist the flyer replacement while retaining IDs referenced by player cards.
import { loadEnvConfig } from '@next/env';

async function main() {
  loadEnvConfig(process.cwd());
  const { firestore } = await import('../src/server/firebase');
  const { parseDoc, toFirestore } = await import('../src/server/content');
  const db = firestore();
  await db.runTransaction(async (tx) => {
    const targets = [['units', 'eagle'], ['assets', 'm-eagle'], ['weapons', 'talons']] as const;
    const snapshots = await tx.getAll(...targets.map(([collection, id]) => db.collection(collection).doc(id)));
    for (const [i, snapshot] of snapshots.entries()) {
      if (!snapshot.exists) continue;
      const [collection, id] = targets[i];
      const doc = parseDoc(collection, id, snapshot.data()!);
      if (!doc) throw new Error(`Invalid ${collection}/${id}`);
      tx.set(snapshot.ref, toFirestore(collection, doc));
    }
  });
  console.log('Updated flying stingray unit, GLB asset and weapon.');
}

main().then(() => process.exit(0), (error) => {
  console.error(error);
  process.exit(1);
});
