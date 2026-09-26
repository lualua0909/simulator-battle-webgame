import { loadEnvConfig } from '@next/env';

async function main() {
  loadEnvConfig(process.cwd());
  const { firestore } = await import('../src/server/firebase');
  const { SEED } = await import('../src/shared/seed');
  const glb = SEED.assets.find((asset) => asset.id === 'm-barracks')!.glb;
  const db = firestore();
  const count = await db.runTransaction(async (tx) => {
    const assets = await tx.get(db.collection('assets'));
    const barracks = assets.docs.filter((doc) => doc.data().kind === 'structure' && doc.data().params?.type === 'barracks');
    for (const doc of barracks) tx.update(doc.ref, { glb });
    return barracks.length;
  });
  console.log(`Updated ${count} barracks assets to /models/nha-linh.glb.`);
}

main().then(() => process.exit(0), (error) => {
  console.error(error);
  process.exit(1);
});
