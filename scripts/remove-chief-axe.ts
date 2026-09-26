import { loadEnvConfig } from '@next/env';

async function main() {
  loadEnvConfig(process.cwd());
  const { firestore } = await import('../src/server/firebase');
  const db = firestore();
  await db.runTransaction(async (tx) => {
    const replacement = await tx.get(db.collection('weapons').doc('dam'));
    if (!replacement.exists) throw new Error('Missing replacement attack: dam');
    const units = await tx.get(db.collection('units'));
    for (const doc of units.docs) {
      const unit = doc.data();
      const patch: Record<string, unknown> = {};
      if (unit.weaponId === 'chief-axe') patch.weaponId = 'dam';
      if (unit.skillIds?.includes('chief-axe')) patch.skillIds = unit.skillIds.filter((id: string) => id !== 'chief-axe');
      if (doc.id === 'chieftain' && unit.description === 'Rìu quét nhiều mục tiêu.') {
        patch.description = 'Đấm cận chiến, dậm đất đánh nhiều mục tiêu.';
      }
      if (Object.keys(patch).length) tx.update(doc.ref, patch);
    }
    tx.delete(db.collection('weapons').doc('chief-axe'));
  });
  console.log('Deleted chief-axe and repaired unit references.');
}

main().then(() => process.exit(0), (error) => {
  console.error(error);
  process.exit(1);
});
