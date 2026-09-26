import { loadEnvConfig } from '@next/env';

async function main() {
  loadEnvConfig(process.cwd());
  const { firestore } = await import('../src/server/firebase');
  const db = firestore();
  await db.runTransaction(async (tx) => {
    const units = await tx.get(db.collection('units'));
    const users = units.docs.filter((doc) => {
      const unit = doc.data();
      return unit.weaponId === 'monk-staff' || unit.skillIds?.includes('monk-staff');
    });
    if (users.length) throw new Error(`Still referenced by: ${users.map((doc) => doc.id).join(', ')}`);
    tx.delete(db.collection('weapons').doc('monk-staff'));
  });
  console.log('Deleted unused monk-staff from CMS.');
}

main().then(() => process.exit(0), (error) => {
  console.error(error);
  process.exit(1);
});
